"""Cálculo de distancias y cobertura de servicios públicos por polígono.

Tarea 2.4 segunda parte — Fase 2.

Consume los outputs de ``scripts/04_descarga_osm.py`` y, para cada polígono
monitoreado, calcula:

- Distancia mínima al servicio más cercano de cada tipo (metros en UTM 21S).
- Conteos de servicios en radios 500 m, 1000 m, 2000 m (desde centroide).
- Indicador binario ``cobertura_adecuada`` según umbrales convencionales:

    +---------------------------+-----------+
    | Tipo de servicio          | Umbral    |
    +===========================+===========+
    | CAPS / clinic             | < 1500 m  |
    | Escuela                   | <  800 m  |
    | Hospital                  | < 5000 m  |
    | Farmacia                  | < 1500 m  |
    | Parada colectivo          | <  400 m  |
    +---------------------------+-----------+

Output principal
----------------
``data/processed/servicios_por_poligono.csv`` con columnas:
``poligono_id, tipo_servicio, distancia_minima_m, nombre_servicio_cercano,
n_en_500m, n_en_1000m, n_en_2000m, cobertura_adecuada``.

Output secundario
-----------------
``data/processed/servicios_por_poligono.geojson`` con los puntos del servicio
más cercano de cada tipo por polígono, geometría LineString ``poligono →
servicio`` para visualización rápida.

Uso
---
    python scripts/40_calcular_distancias_servicios.py \\
        --poligonos config/poligonos.geojson \\
        --servicios data/raw/osm/servicios_posadas.geojson
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import click
import pandas as pd
from loguru import logger

try:
    import geopandas as gpd  # type: ignore
    from shapely.geometry import LineString, Point  # type: ignore
except ImportError:  # pragma: no cover
    gpd = None
    LineString = None
    Point = None

from scripts.utils.config import load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path

# ---------------------------------------------------------------------------
# Clasificación / umbrales
# ---------------------------------------------------------------------------

# Clasificadores: mapea regex de tag OSM a la "familia" lógica del indicador.
# Orden importa: se aplica el primero que matchea.
FAMILIAS_SERVICIO: List[Tuple[str, List[str]]] = [
    ("caps_clinic", ["amenity=clinic", "amenity=doctors", "healthcare=clinic"]),
    ("hospital", ["amenity=hospital", "healthcare=hospital"]),
    ("escuela", ["amenity=school"]),
    ("jardin", ["amenity=kindergarten"]),
    ("universidad", ["amenity=university", "amenity=college"]),
    ("farmacia", ["amenity=pharmacy"]),
    ("parada_colectivo", ["highway=bus_stop", "public_transport=stop_position"]),
    ("policia", ["amenity=police"]),
    ("bomberos", ["amenity=fire_station"]),
    ("supermercado", ["shop=supermarket"]),
    ("mercado", ["amenity=marketplace"]),
    ("banco_atm", ["amenity=bank", "amenity=atm"]),
    ("plaza_parque", ["leisure=park", "leisure=playground", "leisure=pitch"]),
]

UMBRALES_COBERTURA_M: Dict[str, float] = {
    "caps_clinic": 1500.0,
    "hospital": 5000.0,
    "escuela": 800.0,
    "jardin": 1000.0,
    "farmacia": 1500.0,
    "parada_colectivo": 400.0,
}

RADIOS_M: List[int] = [500, 1000, 2000]


def _familia_de_tipo(tipo: str) -> Optional[str]:
    """Dado un string 'key=value,key=value...', devuelve la familia o None."""
    partes = [p.strip() for p in (tipo or "").split(",") if p.strip()]
    for familia, patrones in FAMILIAS_SERVICIO:
        for parte in partes:
            if parte in patrones:
                return familia
    return None


# ---------------------------------------------------------------------------
# Cálculo principal
# ---------------------------------------------------------------------------


def _cargar_gdfs(
    poligonos_path: Path, servicios_path: Path, crs_metrico: str
) -> Tuple["gpd.GeoDataFrame", "gpd.GeoDataFrame"]:
    """Carga y reproyecta polígonos y servicios al CRS métrico."""
    gdf_poli = gpd.read_file(poligonos_path)
    if "poligono_id" not in gdf_poli.columns:
        if "id" in gdf_poli.columns:
            gdf_poli["poligono_id"] = gdf_poli["id"].astype(str)
        elif "name" in gdf_poli.columns:
            gdf_poli["poligono_id"] = gdf_poli["name"].astype(str)
        else:
            gdf_poli["poligono_id"] = gdf_poli.index.astype(str)

    gdf_svc = gpd.read_file(servicios_path)
    if "tipo" not in gdf_svc.columns:
        logger.error("El GeoJSON de servicios no tiene columna 'tipo'.")
        sys.exit(1)
    gdf_svc["familia"] = gdf_svc["tipo"].apply(_familia_de_tipo)
    antes = len(gdf_svc)
    gdf_svc = gdf_svc[gdf_svc["familia"].notna()].copy()
    logger.info(
        f"Servicios con familia reconocida: {len(gdf_svc)} "
        f"(descartados {antes - len(gdf_svc)} sin mapping)."
    )

    gdf_poli = gdf_poli.to_crs(crs_metrico)
    gdf_svc = gdf_svc.to_crs(crs_metrico)
    return gdf_poli, gdf_svc


def _procesar_poligono(
    row_poli,
    gdf_svc: "gpd.GeoDataFrame",
) -> Tuple[List[dict], List[dict]]:
    """Computa métricas de servicios para un polígono.

    Returns:
        (filas_csv, features_geojson_cercanos)
    """
    pid = str(row_poli["poligono_id"])
    geom_poli = row_poli.geometry
    centroide = geom_poli.centroid

    # Distancias desde centroide (más rápido y clásico en estudios de accesibilidad).
    # Uso de spatial index de gdf_svc para evitar O(N) naive.
    sindex = gdf_svc.sindex

    filas_csv: List[dict] = []
    geojson_features: List[dict] = []

    # Agrupamos servicios por familia una sola vez.
    por_familia = dict(list(gdf_svc.groupby("familia")))

    for familia, _ in FAMILIAS_SERVICIO:
        subset = por_familia.get(familia)
        if subset is None or subset.empty:
            filas_csv.append(
                {
                    "poligono_id": pid,
                    "tipo_servicio": familia,
                    "distancia_minima_m": None,
                    "nombre_servicio_cercano": None,
                    "osm_id_cercano": None,
                    "n_en_500m": 0,
                    "n_en_1000m": 0,
                    "n_en_2000m": 0,
                    "cobertura_adecuada": False if familia in UMBRALES_COBERTURA_M else None,
                }
            )
            continue

        # Distancia mínima
        distancias = subset.geometry.distance(centroide)
        idx_min = distancias.idxmin()
        dist_min = float(distancias.loc[idx_min])
        svc_cercano = subset.loc[idx_min]

        # Conteos por radio (usamos spatial index contra el centroide con un buffer)
        conteos = {}
        for radio in RADIOS_M:
            buf = centroide.buffer(radio)
            candidatos_idx = list(sindex.intersection(buf.bounds))
            if candidatos_idx:
                candidatos = gdf_svc.iloc[candidatos_idx]
                candidatos = candidatos[candidatos["familia"] == familia]
                if not candidatos.empty:
                    dentro = candidatos[candidatos.geometry.within(buf)]
                    conteos[radio] = int(len(dentro))
                else:
                    conteos[radio] = 0
            else:
                conteos[radio] = 0

        umbral = UMBRALES_COBERTURA_M.get(familia)
        cobertura = bool(dist_min <= umbral) if umbral is not None else None

        filas_csv.append(
            {
                "poligono_id": pid,
                "tipo_servicio": familia,
                "distancia_minima_m": round(dist_min, 1),
                "nombre_servicio_cercano": svc_cercano.get("name"),
                "osm_id_cercano": svc_cercano.get("osm_id"),
                "n_en_500m": conteos[500],
                "n_en_1000m": conteos[1000],
                "n_en_2000m": conteos[2000],
                "cobertura_adecuada": cobertura,
            }
        )

        # Feature para el GeoJSON: línea centroide→servicio
        if LineString is not None:
            linea = LineString([(centroide.x, centroide.y), svc_cercano.geometry.coords[0]])
            geojson_features.append(
                {
                    "type": "Feature",
                    "geometry": linea.__geo_interface__,
                    "properties": {
                        "poligono_id": pid,
                        "familia": familia,
                        "nombre": svc_cercano.get("name"),
                        "osm_id": svc_cercano.get("osm_id"),
                        "distancia_m": round(dist_min, 1),
                    },
                }
            )

    return filas_csv, geojson_features


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
    "--servicios",
    default="data/raw/osm/servicios_posadas.geojson",
    type=click.Path(exists=True),
    help="GeoJSON de servicios (output del script 04).",
)
@click.option(
    "--output",
    default="data/processed/servicios_por_poligono.csv",
    type=click.Path(),
    help="CSV de salida.",
)
@click.option(
    "--geojson-cercanos",
    default="data/processed/servicios_por_poligono.geojson",
    type=click.Path(),
    help="GeoJSON con líneas polígono→servicio cercano.",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    poligonos: str,
    servicios: str,
    output: str,
    geojson_cercanos: str,
    log_level: str,
) -> None:
    """Calcula distancias y cobertura de servicios por polígono."""
    setup_logger(nivel=log_level)

    if gpd is None:
        logger.error("geopandas no está instalado.")
        sys.exit(1)

    settings = load_settings()
    crs_metrico = settings.geografia.crs_metrico

    poligonos_path = resolve_path(poligonos)
    servicios_path = resolve_path(servicios)
    output_path = resolve_path(output)
    geojson_path = resolve_path(geojson_cercanos)
    ensure_parent(output_path)
    ensure_parent(geojson_path)

    logger.info(f"Reproyectando a {crs_metrico} para cálculos en metros.")
    gdf_poli, gdf_svc = _cargar_gdfs(poligonos_path, servicios_path, crs_metrico)

    todas_filas: List[dict] = []
    todas_features: List[dict] = []

    for _, row in gdf_poli.iterrows():
        pid = row.get("poligono_id")
        logger.info(f"Procesando polígono {pid}.")
        filas, features = _procesar_poligono(row, gdf_svc)
        todas_filas.extend(filas)
        todas_features.extend(features)

    df = pd.DataFrame(todas_filas)
    df.to_csv(output_path, index=False, encoding="utf-8")
    logger.info(f"CSV guardado en {output_path} ({len(df)} filas).")

    # GeoJSON con líneas polígono→servicio (reconvertido a 4326 para web)
    if todas_features:
        gdf_lineas = gpd.GeoDataFrame.from_features(todas_features, crs=crs_metrico)
        gdf_lineas = gdf_lineas.to_crs("EPSG:4326")
        gdf_lineas.to_file(geojson_path, driver="GeoJSON")
        logger.info(f"GeoJSON guardado en {geojson_path} ({len(gdf_lineas)} líneas).")


if __name__ == "__main__":
    main()
