"""Historia larga del Observatorio Urbano Posadas — 3 datasets Earth Engine.

Este script integra **tres fuentes de profundidad histórica** para los polígonos
de Posadas (definidos en `config/poligonos.geojson`). Cada una responde una
pregunta distinta sobre la evolución urbana de largo plazo:

1) **MapBiomas Argentina Collection 1 (1998-2022)** — cobertura anual de suelo
   (urbano, vegetación, agua, cultivos) a 30m. Responde:
   *¿Cómo evolucionó la mancha urbana año a año frente a la vegetación nativa,
   el agua y los cultivos dentro de cada polígono?*

   Asset EE: ``projects/mapbiomas-public/assets/argentina/collection1/mapbiomas_argentina_collection1_integration_v1``

   Clases usadas (legenda específica de MapBiomas Argentina Col1 —
   **distinta del pan-MapBiomas Brasil**):
     - 22 → Área no vegetada / infraestructura / urbano  ← usamos esto como
       "urbano", validado empíricamente sobre chacra_32 y villa_cabello.
     - 3, 11, 12, 36, 49 → Bosque y vegetación nativa
     - 33 → Agua
     - 15, 18, 19, 21 → Cultivos / pastoreo

2) **GHSL P2023A (1975-2030, cada 5 años)** — superficie construida 100 m² y
   población global del JRC. Responde:
   *¿Desde cuándo hay "urbe" medible en cada polígono y cómo crecieron
   construcción y población antes de que tengamos Sentinel-2?*

   Assets EE:
     - ``JRC/GHSL/P2023A/GHS_BUILT_S`` (banda ``built_surface`` = m² construidos / celda 100 m)
     - ``JRC/GHSL/P2023A/GHS_POP``     (banda ``population_count``)

3) **VIIRS Nighttime Lights (2014-presente, mensual)** — luminosidad nocturna
   corregida. Responde:
   *¿Se prendieron focos de actividad económica / electrificación nuevos en
   zonas antes oscuras? Proxy de urbanización efectiva.*

   Asset EE: ``NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG`` (banda ``avg_rad``).
   Muestreamos enero y julio de cada año desde 2014 hasta hoy.

Uso::

    # correr los tres
    python scripts/44_historia_larga.py --todo

    # uno solo
    python scripts/44_historia_larga.py mapbiomas
    python scripts/44_historia_larga.py ghsl --anios 1975,2000,2020,2025
    python scripts/44_historia_larga.py viirs --desde 2018

Outputs en ``data/processed/historia_larga/``:

    - ``mapbiomas_por_poligono.csv`` — poligono_id, anio, pct_urbano,
      pct_vegetacion, pct_agua, pct_cultivos, clase_dominante
    - ``ghsl_por_poligono.csv``      — poligono_id, anio, built_surface_m2,
      pop_estimada, pct_built, densidad_pop_km2
    - ``viirs_por_poligono.csv``     — poligono_id, fecha, viirs_mean, viirs_sum

Si un dataset falla (MapBiomas requiere aceptar términos, GHSL cambió de nombre,
etc.) se loguea WARNING y se sigue con los restantes.
"""

from __future__ import annotations

import csv
import sys

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
import sys as _sys
import traceback
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from pathlib import Path as _Path
from typing import Any, Dict, List, Optional, Tuple

import click
from loguru import logger
from tqdm import tqdm

_p = _Path(__file__).resolve().parent
while _p != _p.parent:
    if (_p / "pyproject.toml").exists():
        if str(_p) not in _sys.path:
            _sys.path.insert(0, str(_p))
        break
    _p = _p.parent
# --- fin del parche ---------------------------------------------------------

from scripts.utils.config import load_settings
from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.io_geo import load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Constantes de datasets
# ---------------------------------------------------------------------------

# MapBiomas Argentina Collection 1: 1998-2022 (rango real), pero
# dejamos 1985-2023 en el CLI por si suben la colección próxima.
MAPBIOMAS_ASSET = (
    "projects/mapbiomas-public/assets/argentina/collection1/"
    "mapbiomas_argentina_collection1_integration_v1"
)

# Fallback si Argentina no existe o no acepta los términos.
MAPBIOMAS_FALLBACK_ASSETS = [
    # Chaco cubre el norte argentino y Paraguay — Posadas está sobre el Chaco.
    ("projects/mapbiomas-chaco/public/collection4/mapbiomas_chaco_collection4_" "integration_v1"),
    # Amazonía: lejos de Posadas pero garantiza fallback para testear el código.
    (
        "projects/mapbiomas-workspace/public/collection_3_1/"
        "mapbiomas_amazonia_collection_3_1_integration_v1"
    ),
]

# Clases MapBiomas — mapeo por legenda de MapBiomas Argentina Collection 1.
# OJO: difiere del legend pan-MapBiomas de Brasil.
# Verificado empíricamente sobre polígonos urbanos de Posadas (chacra_32,
# villa_cabello): la clase dominante en zonas urbanizadas es el id 22
# ("Área no vegetada / Infraestructura urbana" en la leyenda AR), no el 24
# (que es el código urbano en la leyenda Brasil).
#
# - 22: Área no vegetada / urbano / infraestructura (INCLUYE el "urbano").
# - 24: Urbano puro en Brasil (no aplica a AR Col1 pero se suma por seguridad).
MAPBIOMAS_CLASES_URBANO = [22, 24, 25]
# Vegetación nativa (bosque + otras formaciones leñosas/herbáceas).
#   3=Bosque nativo, 9=Silvicultura/plantación forestal (la dejamos fuera porque
#   es antropizada pero cercana al bosque), 11=Humedales,
#   12=Formación herbácea/pastizal, 36=Otras form. no leñosas.
MAPBIOMAS_CLASES_VEGETACION = [3, 11, 12, 36, 49, 50, 6, 4]
# Agua (ríos, lagos, acuicultura).
MAPBIOMAS_CLASES_AGUA = [33, 26, 31]
# Cultivos / pastoreo (actividad agropecuaria).
#   15=Pastura, 18=Agricultura, 19=Cultivos anuales, 20=Caña,
#   21=Mosaico, 39=Soja, 41=Otros cultivos, 62=Algodón.
MAPBIOMAS_CLASES_CULTIVOS = [14, 15, 18, 19, 20, 21, 39, 40, 41, 62]

# GHSL — años disponibles: 1975, 1980, ..., 2030 (cada 5).
GHSL_BUILT_COLLECTION = "JRC/GHSL/P2023A/GHS_BUILT_S"
GHSL_POP_COLLECTION = "JRC/GHSL/P2023A/GHS_POP"
GHSL_ANIOS_DEFAULT = [1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025, 2030]
GHSL_SCALE_M = 100  # 100 m de resolución nativa.

# VIIRS mensual desde 2014.
VIIRS_COLLECTION = "NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG"
VIIRS_SCALE_M = 500  # ~463 m, redondeamos a 500.


# ---------------------------------------------------------------------------
# Earth Engine init (una sola vez)
# ---------------------------------------------------------------------------


def inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine una vez para todo el script.

    Args:
        project_id: Project ID de Google Cloud. None usa el default del ADC.

    Raises:
        SystemExit: si falla la inicialización.
    """
    try:
        import ee
    except ImportError as exc:
        logger.error("earthengine-api no está instalado. Corré: pip install earthengine-api")
        raise SystemExit(1) from exc

    sa_key = __import__("os").environ.get("EE_SERVICE_ACCOUNT_KEY")
    try:
        if sa_key and Path(sa_key).exists():
            credentials = ee.ServiceAccountCredentials(None, sa_key)
            ee.Initialize(credentials)
        elif project_id:
            ee.Initialize(project=project_id)
        else:
            ee.Initialize()
        logger.info(
            f"Earth Engine OK "
            f"{'(proyecto ' + project_id + ')' if project_id else '(default ADC)'}"
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló ee.Initialize(): {exc}")
        logger.error(
            "Corré primero `python scripts/test_ee_auth.py --project PROJECT_ID` "
            "y resolvé los errores de autenticación."
        )
        raise SystemExit(1) from exc


# ---------------------------------------------------------------------------
# Helpers comunes
# ---------------------------------------------------------------------------


def _ee_geometry_from_row(row) -> Any:
    """Convierte la geometría shapely de una fila a ee.Geometry.

    Args:
        row: Fila de GeoDataFrame con .geometry.

    Returns:
        ee.Geometry equivalente.
    """
    import ee

    return ee.Geometry(row.geometry.__geo_interface__)


def _area_km2(row) -> float:
    """Calcula el área del polígono en km² (reproyectando a UTM 21S).

    Args:
        row: Fila con columna geometry en EPSG:4326.

    Returns:
        Área en km² (float).
    """
    import geopandas as gpd

    g = gpd.GeoDataFrame(geometry=[row.geometry], crs="EPSG:4326").to_crs(epsg=32721)
    return float(g.geometry.iloc[0].area) / 1_000_000.0


def _write_csv(rows: List[Dict[str, Any]], destino: Path, columnas: List[str]) -> None:
    """Escribe una lista de dicts a CSV con columnas fijas.

    Args:
        rows: Lista de dicts (pueden tener más keys; solo se escriben las de `columnas`).
        destino: Path de salida.
        columnas: Orden y nombres de las columnas.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=columnas, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    logger.info(f"CSV escrito → {destino} ({len(rows)} filas)")


# ---------------------------------------------------------------------------
# Parte 1 — MapBiomas
# ---------------------------------------------------------------------------


def _resolver_mapbiomas_asset() -> Optional[str]:
    """Devuelve el primer asset MapBiomas accesible, o None si ninguno funciona.

    Intenta primero el de Argentina (prioridad), y cae a Chaco / Amazonía.

    Returns:
        String con el asset ID válido o None si todos fallan.
    """
    import ee

    candidatos = [MAPBIOMAS_ASSET] + MAPBIOMAS_FALLBACK_ASSETS
    for asset in candidatos:
        try:
            img = ee.Image(asset)
            # Tocamos una propiedad chica para forzar la evaluación.
            bandas = img.bandNames().getInfo()
            if not bandas:
                logger.warning(f"MapBiomas asset {asset} sin bandas, saltando.")
                continue
            logger.info(f"MapBiomas asset resuelto: {asset} ({len(bandas)} bandas)")
            return asset
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"MapBiomas {asset} no accesible: {exc}")
    return None


def _histograma_clases_mapbiomas(
    mb_image: Any,
    band: str,
    geom: Any,
    scale_m: int = 30,
) -> Dict[int, int]:
    """Calcula histograma de clases MapBiomas en un polígono.

    Usa `reduceRegion` con `frequencyHistogram` que devuelve un dict
    {valor_clase_como_string: n_pixeles}.

    Args:
        mb_image: ee.Image de MapBiomas.
        band: Nombre de la banda (ej. "classification_2020").
        geom: ee.Geometry del polígono.
        scale_m: Resolución en metros (30 para MapBiomas).

    Returns:
        Dict {clase_id_int: n_pixeles_int}. Dict vacío si no hay datos.
    """
    import ee

    hist = (
        mb_image.select(band)
        .reduceRegion(
            reducer=ee.Reducer.frequencyHistogram(),
            geometry=geom,
            scale=scale_m,
            maxPixels=1e10,
            bestEffort=True,
        )
        .getInfo()
    )

    raw = hist.get(band) if hist else None
    if not raw:
        return {}
    # EE devuelve keys como strings → normalizamos a int.
    return {int(k): int(v) for k, v in raw.items()}


def _pct_por_grupo(
    hist: Dict[int, int],
    clases_grupo: List[int],
    total_pixeles: int,
) -> float:
    """Porcentaje de píxeles que caen en un grupo de clases.

    Args:
        hist: Histograma {clase: count}.
        clases_grupo: Clases a sumar.
        total_pixeles: Total de píxeles no nulos en el polígono.

    Returns:
        Porcentaje 0-100. Si total es 0, devuelve 0.
    """
    if total_pixeles <= 0:
        return 0.0
    suma = sum(hist.get(c, 0) for c in clases_grupo)
    return round(100.0 * suma / total_pixeles, 3)


def _clase_dominante(hist: Dict[int, int]) -> int:
    """Devuelve el ID de clase con mayor cantidad de píxeles.

    Args:
        hist: Histograma {clase: count}.

    Returns:
        ID de clase dominante, o 0 si el histograma está vacío.
    """
    if not hist:
        return 0
    return max(hist.items(), key=lambda kv: kv[1])[0]


def procesar_mapbiomas(
    gdf,
    anio_desde: int,
    anio_hasta: int,
    destino_csv: Path,
) -> Tuple[bool, str]:
    """Procesa MapBiomas para todos los polígonos y años.

    Args:
        gdf: GeoDataFrame con polígonos (columna `id`).
        anio_desde: Primer año a samplear.
        anio_hasta: Último año a samplear (inclusive).
        destino_csv: Path al CSV de salida.

    Returns:
        Tupla (ok, mensaje). ok=True si se escribió al menos una fila.
    """
    import ee

    logger.info("=" * 60)
    logger.info(f"MapBiomas — cobertura anual {anio_desde}-{anio_hasta}")
    logger.info("=" * 60)

    asset = _resolver_mapbiomas_asset()
    if asset is None:
        return False, "Ningún asset MapBiomas fue accesible."

    mb_image = ee.Image(asset)
    bandas_disponibles = set(mb_image.bandNames().getInfo())
    logger.info(f"Bandas disponibles en MapBiomas: {len(bandas_disponibles)}")

    filas: List[Dict[str, Any]] = []
    total_iter = len(gdf) * (anio_hasta - anio_desde + 1)
    pbar = tqdm(total=total_iter, desc="MapBiomas", unit="pol-año")

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        try:
            geom = _ee_geometry_from_row(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] Geometría inválida: {exc}")
            pbar.update(anio_hasta - anio_desde + 1)
            continue

        for anio in range(anio_desde, anio_hasta + 1):
            band = f"classification_{anio}"
            if band not in bandas_disponibles:
                logger.debug(f"[{poligono_id}|{anio}] banda '{band}' no existe en asset. Skip.")
                pbar.update(1)
                continue

            try:
                hist = _histograma_clases_mapbiomas(mb_image, band, geom)
                total_px = sum(hist.values())

                fila = {
                    "poligono_id": poligono_id,
                    "anio": anio,
                    "total_pixeles": total_px,
                    "pct_urbano": _pct_por_grupo(hist, MAPBIOMAS_CLASES_URBANO, total_px),
                    "pct_vegetacion": _pct_por_grupo(hist, MAPBIOMAS_CLASES_VEGETACION, total_px),
                    "pct_agua": _pct_por_grupo(hist, MAPBIOMAS_CLASES_AGUA, total_px),
                    "pct_cultivos": _pct_por_grupo(hist, MAPBIOMAS_CLASES_CULTIVOS, total_px),
                    "clase_dominante": _clase_dominante(hist),
                }
                filas.append(fila)
                logger.debug(
                    f"[{poligono_id}|{anio}] urbano={fila['pct_urbano']}% "
                    f"veg={fila['pct_vegetacion']}% agua={fila['pct_agua']}% "
                    f"dom={fila['clase_dominante']}"
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(f"[{poligono_id}|{anio}] fallo reduceRegion: {exc}")
            finally:
                pbar.update(1)

    pbar.close()

    if not filas:
        return False, "MapBiomas no produjo ninguna fila."

    _write_csv(
        filas,
        destino_csv,
        columnas=[
            "poligono_id",
            "anio",
            "total_pixeles",
            "pct_urbano",
            "pct_vegetacion",
            "pct_agua",
            "pct_cultivos",
            "clase_dominante",
        ],
    )
    return True, f"MapBiomas OK — {len(filas)} filas en {destino_csv.name} (asset={asset})"


# ---------------------------------------------------------------------------
# Parte 2 — GHSL (Built-up Surface + Population)
# ---------------------------------------------------------------------------


def _reduce_ghsl_sum(
    asset_id: str,
    anio: int,
    band: str,
    geom: Any,
) -> Optional[float]:
    """Suma los valores de una banda GHSL dentro de un polígono.

    GHSL son grids 100 m × 100 m donde la banda es el valor total de la celda
    (m² construidos o personas). Por eso aplicamos `sum` y no `mean`.

    Args:
        asset_id: ID del asset GHSL (ImageCollection).
        anio: Año objetivo.
        band: Banda a reducir.
        geom: ee.Geometry.

    Returns:
        Float con la suma total, o None si no hay imagen para ese año.
    """
    import ee

    # GHSL expone cada año como una imagen dentro de una ImageCollection.
    # El ID directo es `<asset>/<anio>` en la ImageCollection P2023A.
    try:
        image = ee.Image(f"{asset_id}/{anio}")
        result = (
            image.select(band)
            .reduceRegion(
                reducer=ee.Reducer.sum(),
                geometry=geom,
                scale=GHSL_SCALE_M,
                maxPixels=1e10,
                bestEffort=True,
            )
            .getInfo()
        )
        if not result:
            return None
        val = result.get(band)
        return float(val) if val is not None else 0.0
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"GHSL {asset_id}/{anio} falló: {exc}")
        return None


def procesar_ghsl(
    gdf,
    anios: List[int],
    destino_csv: Path,
) -> Tuple[bool, str]:
    """Procesa GHSL built-up surface + población por polígono y año.

    Args:
        gdf: GeoDataFrame con polígonos (columna `id`).
        anios: Lista de años a samplear (1975-2030, múltiplos de 5).
        destino_csv: Path al CSV de salida.

    Returns:
        Tupla (ok, mensaje).
    """
    logger.info("=" * 60)
    logger.info(f"GHSL — built-up surface + población ({min(anios)}-{max(anios)})")
    logger.info("=" * 60)

    filas: List[Dict[str, Any]] = []
    total_iter = len(gdf) * len(anios)
    pbar = tqdm(total=total_iter, desc="GHSL", unit="pol-año")

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        try:
            geom = _ee_geometry_from_row(row)
            area_km2 = _area_km2(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] fallo preparación geom: {exc}")
            pbar.update(len(anios))
            continue

        for anio in anios:
            built_m2 = _reduce_ghsl_sum(GHSL_BUILT_COLLECTION, anio, "built_surface", geom)
            pop = _reduce_ghsl_sum(GHSL_POP_COLLECTION, anio, "population_count", geom)

            if built_m2 is None and pop is None:
                logger.debug(f"[{poligono_id}|{anio}] sin dato GHSL.")
                pbar.update(1)
                continue

            built_m2 = built_m2 or 0.0
            pop = pop or 0.0
            area_m2 = area_km2 * 1_000_000.0

            fila = {
                "poligono_id": poligono_id,
                "anio": anio,
                "built_surface_m2": round(built_m2, 2),
                "pop_estimada": round(pop, 2),
                "pct_built": round(100.0 * built_m2 / area_m2, 4) if area_m2 > 0 else 0.0,
                "densidad_pop_km2": round(pop / area_km2, 2) if area_km2 > 0 else 0.0,
                "area_km2": round(area_km2, 4),
            }
            filas.append(fila)
            logger.debug(
                f"[{poligono_id}|{anio}] built={built_m2:,.0f} m² "
                f"pop={pop:,.1f} pct_built={fila['pct_built']}%"
            )
            pbar.update(1)

    pbar.close()

    if not filas:
        return False, "GHSL no produjo ninguna fila."

    _write_csv(
        filas,
        destino_csv,
        columnas=[
            "poligono_id",
            "anio",
            "built_surface_m2",
            "pop_estimada",
            "pct_built",
            "densidad_pop_km2",
            "area_km2",
        ],
    )
    return True, f"GHSL OK — {len(filas)} filas en {destino_csv.name}"


# ---------------------------------------------------------------------------
# Parte 3 — VIIRS Nighttime Lights
# ---------------------------------------------------------------------------


def _viirs_meses_a_samplear(desde_anio: int, hasta_anio: int) -> List[Tuple[int, int]]:
    """Enumera pares (año, mes) a samplear: enero y julio de cada año.

    Args:
        desde_anio: Primer año (inclusive).
        hasta_anio: Último año (inclusive).

    Returns:
        Lista de tuplas (año, mes) con mes ∈ {1, 7}.
    """
    salida: List[Tuple[int, int]] = []
    for a in range(desde_anio, hasta_anio + 1):
        for m in (1, 7):
            salida.append((a, m))
    return salida


def _viirs_mes_avg_rad(
    geom: Any,
    anio: int,
    mes: int,
) -> Optional[Dict[str, float]]:
    """Calcula mean + sum de `avg_rad` para un mes VIIRS dentro de un polígono.

    Args:
        geom: ee.Geometry.
        anio: Año.
        mes: 1-12.

    Returns:
        Dict {'mean': float, 'sum': float} o None si no hay imagen.
    """
    import ee

    # Rango exacto del mes.
    inicio = f"{anio}-{mes:02d}-01"
    if mes == 12:
        fin = f"{anio + 1}-01-01"
    else:
        fin = f"{anio}-{mes + 1:02d}-01"

    try:
        coleccion = (
            ee.ImageCollection(VIIRS_COLLECTION)
            .filterDate(inicio, fin)
            .filterBounds(geom)
            .select("avg_rad")
        )
        n = coleccion.size().getInfo()
        if n == 0:
            return None
        img = coleccion.mean()  # normalmente hay 1 imagen/mes; mean por si acaso.

        stats = img.reduceRegion(
            reducer=ee.Reducer.mean().combine(ee.Reducer.sum(), sharedInputs=True),
            geometry=geom,
            scale=VIIRS_SCALE_M,
            maxPixels=1e10,
            bestEffort=True,
        ).getInfo()

        if not stats:
            return None
        mean = stats.get("avg_rad_mean")
        suma = stats.get("avg_rad_sum")
        return {
            "mean": float(mean) if mean is not None else 0.0,
            "sum": float(suma) if suma is not None else 0.0,
        }
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"VIIRS {anio}-{mes:02d} falló: {exc}")
        return None


def procesar_viirs(
    gdf,
    desde_anio: int,
    hasta_anio: int,
    destino_csv: Path,
) -> Tuple[bool, str]:
    """Procesa VIIRS nighttime lights enero+julio de cada año.

    Args:
        gdf: GeoDataFrame con polígonos.
        desde_anio: Primer año (≥2014).
        hasta_anio: Último año (inclusive).
        destino_csv: Path al CSV de salida.

    Returns:
        Tupla (ok, mensaje).
    """
    logger.info("=" * 60)
    logger.info(f"VIIRS — nighttime lights ene/jul {desde_anio}-{hasta_anio}")
    logger.info("=" * 60)

    meses = _viirs_meses_a_samplear(desde_anio, hasta_anio)
    filas: List[Dict[str, Any]] = []
    total_iter = len(gdf) * len(meses)
    pbar = tqdm(total=total_iter, desc="VIIRS", unit="pol-mes")

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        try:
            geom = _ee_geometry_from_row(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] geometría inválida: {exc}")
            pbar.update(len(meses))
            continue

        for anio, mes in meses:
            stats = _viirs_mes_avg_rad(geom, anio, mes)
            if stats is None:
                pbar.update(1)
                continue

            fecha_str = f"{anio}-{mes:02d}-01"
            fila = {
                "poligono_id": poligono_id,
                "fecha": fecha_str,
                "anio": anio,
                "mes": mes,
                "viirs_mean": round(stats["mean"], 4),
                "viirs_sum": round(stats["sum"], 2),
            }
            filas.append(fila)
            logger.debug(
                f"[{poligono_id}|{fecha_str}] mean={fila['viirs_mean']} " f"sum={fila['viirs_sum']}"
            )
            pbar.update(1)

    pbar.close()

    if not filas:
        return False, "VIIRS no produjo ninguna fila."

    _write_csv(
        filas,
        destino_csv,
        columnas=["poligono_id", "fecha", "anio", "mes", "viirs_mean", "viirs_sum"],
    )
    return True, f"VIIRS OK — {len(filas)} filas en {destino_csv.name}"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@dataclass
class ResultadoFuente:
    """Resultado de correr una fuente individual."""

    nombre: str
    ok: bool
    mensaje: str


def _parse_anios(anios_str: Optional[str], default: List[int]) -> List[int]:
    """Parsea '1975,2000,2020' → [1975, 2000, 2020] o devuelve el default."""
    if not anios_str:
        return default
    try:
        return sorted({int(x.strip()) for x in anios_str.split(",") if x.strip()})
    except ValueError as exc:
        raise click.BadParameter(f"Lista de años inválida: {exc}") from exc


@click.group(invoke_without_command=True)
@click.option(
    "--poligonos",
    "poligonos_path",
    default="config/poligonos.geojson",
    show_default=True,
    help="Path al GeoJSON de polígonos.",
)
@click.option(
    "--output-dir",
    "output_dir",
    default="data/processed/historia_larga",
    show_default=True,
    help="Directorio raíz de salida de los CSV.",
)
@click.option(
    "--project",
    "ee_project",
    default=None,
    help="Project ID Earth Engine. Default: EE_PROJECT_ID del .env.",
)
@click.option(
    "--todo",
    is_flag=True,
    default=False,
    help="Correr los 3 datasets (MapBiomas + GHSL + VIIRS).",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
)
@click.pass_context
def cli(
    ctx: click.Context,
    poligonos_path: str,
    output_dir: str,
    ee_project: Optional[str],
    todo: bool,
    nivel_log: str,
) -> None:
    """Historia larga — MapBiomas + GHSL + VIIRS por polígono.

    Correr subcomando (mapbiomas, ghsl, viirs) o --todo para los tres.
    """
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    ctx.ensure_object(dict)
    ctx.obj["poligonos_path"] = poligonos_path
    ctx.obj["output_dir"] = output_dir
    ctx.obj["ee_project"] = ee_project or settings.env.ee_project_id
    ctx.obj["settings"] = settings

    logger.info("=" * 60)
    logger.info("Historia larga — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"Polígonos:   {poligonos_path}")
    logger.info(f"Output dir:  {output_dir}")
    logger.info(f"EE project:  {ctx.obj['ee_project'] or '(default ADC)'}")

    if ctx.invoked_subcommand is None and not todo:
        click.echo(ctx.get_help())
        ctx.exit(0)

    if todo:
        _ejecutar_todo(ctx)
        ctx.exit(0)


def _cargar_gdf_e_init(ctx: click.Context):
    """Carga GeoDataFrame + inicializa EE. Helper común a todos los subcomandos."""
    inicializar_ee(ctx.obj["ee_project"])
    gdf = load_geojson(ctx.obj["poligonos_path"])
    if "id" not in gdf.columns:
        logger.error("El GeoJSON no tiene columna 'id'. Abortando.")
        sys.exit(2)
    logger.info(f"Se cargaron {len(gdf)} polígonos.")
    return gdf


@cli.command("mapbiomas")
@click.option("--anio-desde", default=1985, show_default=True, type=int)
@click.option("--anio-hasta", default=2023, show_default=True, type=int)
@click.pass_context
def cmd_mapbiomas(ctx: click.Context, anio_desde: int, anio_hasta: int) -> None:
    """Cobertura anual MapBiomas Argentina Collection 1."""
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    destino = out / "mapbiomas_por_poligono.csv"

    with graceful_interrupt() as state:
        # Guardado parcial (nota: MapBiomas acumula filas en memoria, si llega
        # SIGINT a mitad no hay persistencia incremental — pero el próximo run
        # reusa el CSV ya escrito si el anterior completó).
        state.on_interrupt(
            lambda: logger.warning("Interrupción en MapBiomas — CSV puede estar incompleto.")
        )
        try:
            ok, msg = procesar_mapbiomas(gdf, anio_desde, anio_hasta, destino)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"MapBiomas excepcion: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"MapBiomas falló con excepción: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


@cli.command("ghsl")
@click.option(
    "--anios",
    "anios_str",
    default=None,
    help=f"Años separados por coma. Default: {','.join(str(a) for a in GHSL_ANIOS_DEFAULT)}",
)
@click.pass_context
def cmd_ghsl(ctx: click.Context, anios_str: Optional[str]) -> None:
    """GHSL built-up surface + población (1975-2030, cada 5 años)."""
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    destino = out / "ghsl_por_poligono.csv"
    anios = _parse_anios(anios_str, GHSL_ANIOS_DEFAULT)

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning("Interrupción en GHSL — CSV puede estar incompleto.")
        )
        try:
            ok, msg = procesar_ghsl(gdf, anios, destino)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"GHSL excepcion: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"GHSL falló con excepción: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


@cli.command("viirs")
@click.option("--desde", "desde_anio", default=2014, show_default=True, type=int)
@click.option("--hasta", "hasta_anio", default=None, type=int, help="Default: año actual.")
@click.pass_context
def cmd_viirs(ctx: click.Context, desde_anio: int, hasta_anio: Optional[int]) -> None:
    """VIIRS nighttime lights enero + julio desde 2014."""
    if hasta_anio is None:
        hasta_anio = datetime.now().year
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    destino = out / "viirs_por_poligono.csv"

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning("Interrupción en VIIRS — CSV puede estar incompleto.")
        )
        try:
            ok, msg = procesar_viirs(gdf, desde_anio, hasta_anio, destino)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"VIIRS excepcion: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"VIIRS falló con excepción: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


def _ejecutar_todo(ctx: click.Context) -> None:
    """Ejecuta las 3 fuentes secuencialmente y loguea un resumen final.

    Si una falla, las otras siguen. Al final se imprime qué fue OK y qué no.
    """
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    resultados: List[ResultadoFuente] = []

    # Orden: VIIRS primero (rápido → feedback temprano), luego GHSL (12 años),
    # y MapBiomas al final (más pesado, 38 años × N polígonos).
    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning(
                "Interrupción durante --todo. Los CSV parcialmente escritos quedan en disco."
            )
        )

        # VIIRS
        try:
            ok, msg = procesar_viirs(
                gdf,
                desde_anio=2014,
                hasta_anio=datetime.now().year,
                destino_csv=out / "viirs_por_poligono.csv",
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"VIIRS excepcion: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"VIIRS falló: {exc}"
        resultados.append(ResultadoFuente("viirs", ok, msg))

        # GHSL
        try:
            ok, msg = procesar_ghsl(
                gdf,
                anios=GHSL_ANIOS_DEFAULT,
                destino_csv=out / "ghsl_por_poligono.csv",
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"GHSL excepcion: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"GHSL falló: {exc}"
        resultados.append(ResultadoFuente("ghsl", ok, msg))

        # MapBiomas (el más sensible a permisos de asset)
        try:
            ok, msg = procesar_mapbiomas(
                gdf,
                anio_desde=1985,
                anio_hasta=2023,
                destino_csv=out / "mapbiomas_por_poligono.csv",
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"MapBiomas excepcion: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"MapBiomas falló: {exc}"
        resultados.append(ResultadoFuente("mapbiomas", ok, msg))

    # --- Resumen final ---
    logger.info("=" * 60)
    logger.info("Resumen historia larga")
    logger.info("=" * 60)
    for r in resultados:
        status = "OK " if r.ok else "FAIL"
        logger.info(f"[{status}] {r.nombre:10s} → {r.mensaje}")
    n_ok = sum(1 for r in resultados if r.ok)
    logger.info(f"Total: {n_ok}/{len(resultados)} fuentes completaron con éxito.")
    if n_ok < len(resultados):
        logger.warning("Hubo fallas. Revisá el log y corré los subcomandos individuales.")


if __name__ == "__main__":
    cli(obj={})
