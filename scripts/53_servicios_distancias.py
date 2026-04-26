"""Capa social — Distancias mínimas y densidad de servicios públicos por polígono.

Tarea Fase 3 (capa social, primera parte).

Para cada polígono monitoreado calcula, en metros (UTM 21S), la distancia
desde su centroide al servicio más cercano de cuatro categorías clave:

1. ``CAPS`` (Centro de Atención Primaria de Salud).
2. ``Escuela`` (incluye nivel inicial / primario / secundario y jardín).
3. ``Hospital``.
4. ``Transporte público`` (parada de colectivo o stop_position).

También calcula la densidad de servicios por km² *dentro* del polígono
(``conteo / area_km2``) para las tres categorías que tiene sentido contar
puntualmente — los hospitales son demasiado escasos para densidad útil, así
que se omite.

Fuentes de datos
----------------
- **CAPS**: ``data/raw/oficiales/caps_misiones.csv`` (Ministerio de Salud
  de Misiones, vía https://sig.misiones.gob.ar/mapas/emergencia/datos/).
  234 puntos a abril 2026, todos con lat/lon. Si el archivo no existe, se
  cae a OSM (``amenity=clinic`` + ``amenity=doctors`` + ``healthcare=clinic``).
- **Hospitales**: ``data/raw/oficiales/hospitales_misiones.csv`` (mismo
  origen oficial). 52 puntos. Fallback OSM ``amenity=hospital`` +
  ``healthcare=hospital``.
- **Escuelas**: OSM ``amenity=school|kindergarten|university|college``
  (el padrón nacional CABA-DiE tiene listado pero NO coordenadas, por eso
  acá usamos OSM como única fuente con geocodificación).
- **Transporte**: OSM ``highway=bus_stop`` + ``public_transport=stop_position``.

Output
------
``data/processed/social/distancias_por_poligono.csv`` con columnas:

- ``poligono_id``
- ``area_km2``
- ``dist_caps_m`` — distancia mínima centroide → CAPS más cercano (m).
- ``dist_escuela_m`` — distancia mínima centroide → escuela más cercana (m).
- ``dist_hospital_m`` — distancia mínima centroide → hospital más cercano (m).
- ``dist_transporte_m`` — distancia mínima centroide → parada bus más cercana.
- ``densidad_caps_km2`` — CAPS dentro del polígono / area_km2.
- ``densidad_escuela_km2`` — escuelas dentro del polígono / area_km2.
- ``densidad_transporte_km2`` — paradas dentro del polígono / area_km2.
- ``n_caps_dentro``, ``n_escuela_dentro``, ``n_hospital_dentro``,
  ``n_transporte_dentro`` — conteos crudos.
- ``fuente_caps`` — ``oficial_misiones``, ``osm`` o ``oficial+osm``.
- ``fuente_hospital`` — idem.
- ``fuente_escuela`` — siempre ``osm``.
- ``fuente_transporte`` — siempre ``osm``.

Uso
---
    python scripts/53_servicios_distancias.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import click
import pandas as pd
from loguru import logger

try:
    import geopandas as gpd  # type: ignore
    from shapely.geometry import Point  # type: ignore
except ImportError:  # pragma: no cover
    gpd = None
    Point = None

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------
import sys as _sys
from pathlib import Path as _Path
_p = _Path(__file__).resolve().parent
while _p != _p.parent:
    if (_p / "pyproject.toml").exists():
        if str(_p) not in _sys.path:
            _sys.path.insert(0, str(_p))
        break
    _p = _p.parent
# --- fin del parche ---------------------------------------------------------

from scripts.utils.config import load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path


# ---------------------------------------------------------------------------
# Mapeos OSM → categoría
# ---------------------------------------------------------------------------

OSM_TIPOS_CAPS = {
    "amenity=clinic",
    "amenity=doctors",
    "healthcare=clinic",
}
OSM_TIPOS_HOSPITAL = {
    "amenity=hospital",
    "healthcare=hospital",
}
OSM_TIPOS_ESCUELA = {
    "amenity=school",
    "amenity=kindergarten",
    "amenity=university",
    "amenity=college",
}
OSM_TIPOS_TRANSPORTE = {
    "highway=bus_stop",
    "public_transport=stop_position",
    "public_transport=platform",
}


# ---------------------------------------------------------------------------
# Carga de datos
# ---------------------------------------------------------------------------


def _cargar_oficial_misiones(
    csv_path: Path,
    crs_metrico: str,
    bbox: Tuple[float, float, float, float],
    columnas_lat_lon: Tuple[str, str],
) -> Optional["gpd.GeoDataFrame"]:
    """Carga un CSV oficial Misiones (lat/lon en columnas dadas) filtrado al bbox.

    Args:
        csv_path: ruta al CSV.
        crs_metrico: CRS de salida (EPSG:32721).
        bbox: (oeste, sur, este, norte) en grados.
        columnas_lat_lon: nombres de las columnas (lat_col, lon_col).

    Returns:
        GeoDataFrame en `crs_metrico`, o None si el archivo no existe.
    """
    if not csv_path.exists():
        return None
    df = pd.read_csv(csv_path)
    lat_col, lon_col = columnas_lat_lon
    if lat_col not in df.columns or lon_col not in df.columns:
        logger.warning(
            f"CSV {csv_path.name} sin columnas lat/lon esperadas "
            f"({lat_col}, {lon_col}); saltando."
        )
        return None
    df = df.dropna(subset=[lat_col, lon_col])
    df[lat_col] = pd.to_numeric(df[lat_col], errors="coerce")
    df[lon_col] = pd.to_numeric(df[lon_col], errors="coerce")
    df = df.dropna(subset=[lat_col, lon_col])

    # Filtro bbox para quedarnos con el área de interés (Posadas).
    oeste, sur, este, norte = bbox
    mask = (
        (df[lon_col] >= oeste)
        & (df[lon_col] <= este)
        & (df[lat_col] >= sur)
        & (df[lat_col] <= norte)
    )
    df = df[mask].copy()
    if df.empty:
        logger.warning(f"CSV {csv_path.name} no tiene puntos dentro del bbox.")
        return None
    geometry = [Point(lon, lat) for lat, lon in zip(df[lat_col], df[lon_col])]
    gdf = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
    gdf = gdf.to_crs(crs_metrico)
    logger.info(
        f"  {csv_path.name}: {len(gdf)} puntos en bbox (de {len(pd.read_csv(csv_path))} totales)."
    )
    return gdf


def _filtrar_osm(
    gdf_osm: "gpd.GeoDataFrame", tipos: set
) -> "gpd.GeoDataFrame":
    """Filtra el GeoDataFrame de servicios OSM por un set de tags ``key=value``."""
    if gdf_osm is None or gdf_osm.empty:
        return gdf_osm
    # ``tipo`` viene como ``key=value`` o concatenado por comas.
    def _matches(tipo_str: str) -> bool:
        if not isinstance(tipo_str, str):
            return False
        partes = [p.strip() for p in tipo_str.split(",") if p.strip()]
        return any(p in tipos for p in partes)
    mask = gdf_osm["tipo"].apply(_matches)
    return gdf_osm[mask].copy()


def _cargar_osm(
    osm_path: Path, crs_metrico: str
) -> Optional["gpd.GeoDataFrame"]:
    """Carga el GeoJSON de servicios OSM y reproyecta a CRS métrico."""
    if not osm_path.exists():
        logger.warning(f"OSM no encontrado en {osm_path}.")
        return None
    gdf = gpd.read_file(osm_path)
    if "tipo" not in gdf.columns:
        logger.warning(f"GeoJSON OSM sin columna 'tipo'.")
        return None
    return gdf.to_crs(crs_metrico)


# ---------------------------------------------------------------------------
# Cálculo principal
# ---------------------------------------------------------------------------


def _distancia_minima_y_conteo(
    centroide,
    poli_geom,
    gdf_pts: Optional["gpd.GeoDataFrame"],
) -> Tuple[Optional[float], int]:
    """Devuelve (dist_min_m, n_dentro_poligono) para un set de puntos.

    Si ``gdf_pts`` es None o vacío, devuelve (None, 0).
    """
    if gdf_pts is None or gdf_pts.empty:
        return None, 0
    distancias = gdf_pts.geometry.distance(centroide)
    dist_min = float(distancias.min())
    n_dentro = int(gdf_pts.geometry.within(poli_geom).sum())
    return round(dist_min, 1), n_dentro


def _procesar_poligono(
    row,
    capas: Dict[str, Optional["gpd.GeoDataFrame"]],
    fuentes: Dict[str, str],
) -> dict:
    """Para un polígono, computa todas las distancias y densidades."""
    pid = str(row["poligono_id"])
    geom = row.geometry
    centroide = geom.centroid
    area_km2 = float(geom.area / 1e6)

    dist_caps, n_caps = _distancia_minima_y_conteo(
        centroide, geom, capas["caps"]
    )
    dist_esc, n_esc = _distancia_minima_y_conteo(
        centroide, geom, capas["escuela"]
    )
    dist_hosp, n_hosp = _distancia_minima_y_conteo(
        centroide, geom, capas["hospital"]
    )
    dist_tra, n_tra = _distancia_minima_y_conteo(
        centroide, geom, capas["transporte"]
    )

    densidad = lambda n: round(n / area_km2, 3) if area_km2 > 0 else 0.0

    return {
        "poligono_id": pid,
        "area_km2": round(area_km2, 4),
        "dist_caps_m": dist_caps,
        "dist_escuela_m": dist_esc,
        "dist_hospital_m": dist_hosp,
        "dist_transporte_m": dist_tra,
        "n_caps_dentro": n_caps,
        "n_escuela_dentro": n_esc,
        "n_hospital_dentro": n_hosp,
        "n_transporte_dentro": n_tra,
        "densidad_caps_km2": densidad(n_caps),
        "densidad_escuela_km2": densidad(n_esc),
        "densidad_transporte_km2": densidad(n_tra),
        "fuente_caps": fuentes["caps"],
        "fuente_hospital": fuentes["hospital"],
        "fuente_escuela": fuentes["escuela"],
        "fuente_transporte": fuentes["transporte"],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option(
    "--poligonos",
    default="config/poligonos.geojson",
    type=click.Path(exists=True),
    help="GeoJSON de polígonos monitoreados.",
)
@click.option(
    "--osm-servicios",
    default="data/raw/osm/servicios_posadas.geojson",
    type=click.Path(),
    help="GeoJSON de servicios OSM (output de scripts/04_descarga_osm.py).",
)
@click.option(
    "--caps-oficial",
    default="data/raw/oficiales/caps_misiones.csv",
    type=click.Path(),
    help="CSV oficial CAPS Misiones (sig.misiones.gob.ar). Opcional.",
)
@click.option(
    "--hospitales-oficial",
    default="data/raw/oficiales/hospitales_misiones.csv",
    type=click.Path(),
    help="CSV oficial Hospitales Misiones. Opcional.",
)
@click.option(
    "--output",
    default="data/processed/social/distancias_por_poligono.csv",
    type=click.Path(),
    help="CSV de salida.",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    poligonos: str,
    osm_servicios: str,
    caps_oficial: str,
    hospitales_oficial: str,
    output: str,
    log_level: str,
) -> None:
    """Calcula distancias y densidades de servicios públicos por polígono."""
    setup_logger(nivel=log_level)

    if gpd is None:
        logger.error("geopandas no está instalado.")
        sys.exit(2)

    settings = load_settings()
    crs_metrico = settings.geografia.crs_metrico
    bbox = (
        settings.geografia.bbox.oeste,
        settings.geografia.bbox.sur,
        settings.geografia.bbox.este,
        settings.geografia.bbox.norte,
    )

    poligonos_path = resolve_path(poligonos)
    osm_path = resolve_path(osm_servicios)
    caps_path = resolve_path(caps_oficial)
    hosp_path = resolve_path(hospitales_oficial)
    output_path = resolve_path(output)
    ensure_parent(output_path)

    try:
        logger.info(f"Cargando polígonos desde {poligonos_path}.")
        gdf_poli = gpd.read_file(poligonos_path)
        if "poligono_id" not in gdf_poli.columns:
            if "id" in gdf_poli.columns:
                gdf_poli["poligono_id"] = gdf_poli["id"].astype(str)
            else:
                gdf_poli["poligono_id"] = gdf_poli.index.astype(str)
        gdf_poli = gdf_poli.to_crs(crs_metrico)
        logger.info(f"  {len(gdf_poli)} polígonos a procesar.")

        logger.info("Cargando capa OSM de servicios.")
        gdf_osm = _cargar_osm(osm_path, crs_metrico)

        # CAPS: oficial primero, OSM como complemento si está.
        logger.info("Cargando CAPS (fuente oficial Misiones + OSM).")
        gdf_caps_oficial = _cargar_oficial_misiones(
            caps_path, crs_metrico, bbox, ("Latitud", "Longitud")
        )
        gdf_caps_osm = _filtrar_osm(gdf_osm, OSM_TIPOS_CAPS) if gdf_osm is not None else None

        if gdf_caps_oficial is not None and gdf_caps_osm is not None and not gdf_caps_osm.empty:
            # Concatenamos pero NO deduplicamos (el oficial es autoridad y OSM
            # añade puntos privados que pueden no estar en el listado público).
            gdf_caps = pd.concat([gdf_caps_oficial, gdf_caps_osm], ignore_index=True)
            gdf_caps = gpd.GeoDataFrame(gdf_caps, geometry="geometry", crs=crs_metrico)
            fuente_caps = "oficial_misiones+osm"
        elif gdf_caps_oficial is not None:
            gdf_caps = gdf_caps_oficial
            fuente_caps = "oficial_misiones"
        else:
            gdf_caps = gdf_caps_osm
            fuente_caps = "osm"
        n_caps_total = len(gdf_caps) if gdf_caps is not None else 0
        logger.info(f"  CAPS: {n_caps_total} puntos (fuente: {fuente_caps}).")

        # Hospitales: idem patrón.
        logger.info("Cargando Hospitales (fuente oficial Misiones + OSM).")
        gdf_hosp_oficial = _cargar_oficial_misiones(
            hosp_path, crs_metrico, bbox, ("latitude", "longitude")
        )
        gdf_hosp_osm = _filtrar_osm(gdf_osm, OSM_TIPOS_HOSPITAL) if gdf_osm is not None else None

        if gdf_hosp_oficial is not None and gdf_hosp_osm is not None and not gdf_hosp_osm.empty:
            gdf_hosp = pd.concat([gdf_hosp_oficial, gdf_hosp_osm], ignore_index=True)
            gdf_hosp = gpd.GeoDataFrame(gdf_hosp, geometry="geometry", crs=crs_metrico)
            fuente_hosp = "oficial_misiones+osm"
        elif gdf_hosp_oficial is not None:
            gdf_hosp = gdf_hosp_oficial
            fuente_hosp = "oficial_misiones"
        else:
            gdf_hosp = gdf_hosp_osm
            fuente_hosp = "osm"
        n_hosp_total = len(gdf_hosp) if gdf_hosp is not None else 0
        logger.info(f"  Hospitales: {n_hosp_total} puntos (fuente: {fuente_hosp}).")

        # Escuelas y transporte: solo OSM (no hay alternativa con coords).
        logger.info("Filtrando escuelas y transporte desde OSM.")
        gdf_esc = _filtrar_osm(gdf_osm, OSM_TIPOS_ESCUELA) if gdf_osm is not None else None
        gdf_tra = _filtrar_osm(gdf_osm, OSM_TIPOS_TRANSPORTE) if gdf_osm is not None else None
        n_esc = len(gdf_esc) if gdf_esc is not None else 0
        n_tra = len(gdf_tra) if gdf_tra is not None else 0
        logger.info(f"  Escuelas: {n_esc} puntos | Transporte: {n_tra} puntos.")

        capas: Dict[str, Optional["gpd.GeoDataFrame"]] = {
            "caps": gdf_caps,
            "hospital": gdf_hosp,
            "escuela": gdf_esc,
            "transporte": gdf_tra,
        }
        fuentes: Dict[str, str] = {
            "caps": fuente_caps,
            "hospital": fuente_hosp,
            "escuela": "osm",
            "transporte": "osm",
        }

        filas: List[dict] = []
        for _, row in gdf_poli.iterrows():
            pid = str(row["poligono_id"])
            logger.info(f"Procesando polígono {pid}.")
            filas.append(_procesar_poligono(row, capas, fuentes))

        df = pd.DataFrame(filas)
        df.to_csv(output_path, index=False, encoding="utf-8")
        logger.info(f"CSV guardado en {output_path} ({len(df)} filas).")

        # Resumen rápido en logs.
        for col in ("dist_caps_m", "dist_escuela_m", "dist_hospital_m", "dist_transporte_m"):
            serie = df[col].dropna()
            if not serie.empty:
                logger.info(
                    f"  {col}: min={serie.min():.0f} m, "
                    f"max={serie.max():.0f} m, mediana={serie.median():.0f} m, "
                    f"n_validos={len(serie)}/{len(df)}."
                )
            else:
                logger.warning(f"  {col}: SIN datos válidos.")

    except Exception as exc:
        logger.exception(f"Error en script 53: {exc}")
        sys.exit(2)


if __name__ == "__main__":
    main()
