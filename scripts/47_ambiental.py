"""Variables ambientales del Observatorio Urbano Posadas — 5 fuentes Earth Engine.

Este script integra **cinco fuentes ambientales gratuitas y sin registro extra**
del catálogo público de Earth Engine. Cada subcomando responde una pregunta
distinta sobre el entorno físico-ambiental de los polígonos de Posadas
(definidos en ``config/poligonos.geojson``).

1) ``chirps`` — **Precipitación diaria CHIRPS v2.0** (UCSB-CHG).
   Asset: ``UCSB-CHG/CHIRPS/DAILY`` (banda ``precipitation``, resolución ~5 km,
   cobertura 1981-presente). Responde:
   *¿Cuánto llueve cada año en cada polígono y cómo se distribuye entre el
   "verano lluvioso" (oct-mar) y el "invierno seco" (abr-sep)?*

   Método: suma de mm por día dentro del año, promediada espacialmente por
   polígono (`reduceRegion` con `mean` sobre una imagen anual reducida con
   `sum`). Período: 2018-2025.

2) ``no2`` — **Sentinel-5P TROPOMI NO2 troposférico** (Copernicus).
   Asset: ``COPERNICUS/S5P/OFFL/L3_NO2``
   (banda ``tropospheric_NO2_column_number_density``, desde 2018-06-28,
   resolución nominal ~1.1 km). Responde:
   *¿Qué polígonos concentran más NO2 troposférico (proxy de tráfico / quema
   de combustibles) comparado con el promedio del bbox de Posadas?*

   Método: media anual de la banda troposférica y relación
   ``no2_relativo_bbox = no2_poligono / no2_bbox``. Período: 2019-2025 (2018
   solo tiene S2 parcial desde julio, lo excluimos para no mezclar promedios
   de pocos meses con años completos).

3) ``lst`` — **MODIS LST (temperatura superficial de suelo)**.
   Asset: ``MODIS/061/MOD11A2`` (8-day composite, bandas ``LST_Day_1km`` y
   ``LST_Night_1km`` en Kelvin × 0.02, resolución 1 km). Responde:
   *¿Qué tan "isla de calor" es cada polígono respecto al promedio del bbox
   de Posadas, en verano (dic-feb) e invierno (jun-ago)?*

   Método:
     - Conversión a °C: ``(LST × 0.02) - 273.15``.
     - Media estacional día/noche por polígono y por bbox.
     - ``isla_calor_c = lst_dia_verano_poligono - lst_dia_verano_bbox``.
   Período: 2018-2025. Verano argentino = DJF (dic año-1 + ene+feb año),
   invierno argentino = JJA (jun+jul+ago).

4) ``firms`` — **FIRMS detección de incendios activos**.
   Asset: ``FIRMS`` (daily fire alerts, desde 2000, resolución 1 km).
   Responde:
   *¿Cuántos focos de incendio detecta el satélite dentro del polígono cada
   año y qué porcentaje del polígono está afectado por algún foco?*

   Método:
     - Filtro de calidad: ``T21 >= 320 K`` y ``confidence >= 50`` para reducir
       falsos positivos (umbral conservador, el catálogo recomienda >= 50
       para análisis de "nominal + high confidence").
     - Conteo: píxeles FIRMS presentes en el polígono durante el año
       (``reduceRegion`` con ``count`` sobre una imagen ``max`` apilada).
     - ``pct_area_afectada = área_focos_km2 / área_poligono_km2 * 100``.
   Período: 2018-2025.

5) ``wdpa`` — **World Database on Protected Areas**.
   Asset: ``WCMC/WDPA/current/polygons`` (FeatureCollection, global).
   Responde:
   *¿Qué polígonos intersectan con alguna área protegida oficial y en qué
   porcentaje?*

   Método: ``filterBounds`` sobre el polígono, intersección de geometrías y
   cálculo de área en UTM 21S. Si hay múltiples APs, reportamos la de mayor
   solapamiento. Sin dimensión temporal (snapshot "current").

Uso::

    # correr las cinco
    python scripts/47_ambiental.py todo

    # una sola
    python scripts/47_ambiental.py chirps
    python scripts/47_ambiental.py no2 --anio-desde 2020
    python scripts/47_ambiental.py lst
    python scripts/47_ambiental.py firms
    python scripts/47_ambiental.py wdpa

    # forzar recomputación completa
    python scripts/47_ambiental.py todo --force

Outputs en ``data/processed/ambiental/``:

    - ``chirps_anual.csv``     — poligono_id, anio, precip_mm_anual,
      precip_mm_verano, precip_mm_invierno.
    - ``no2_anual.csv``        — poligono_id, anio, no2_mean_mol_m2,
      no2_relativo_bbox.
    - ``lst_anual.csv``        — poligono_id, anio, lst_dia_verano_c,
      lst_noche_verano_c, lst_dia_invierno_c, lst_noche_invierno_c,
      isla_calor_c.
    - ``firms_anual.csv``      — poligono_id, anio, n_focos,
      pct_area_afectada.
    - ``wdpa_intersection.csv`` — poligono_id, intersecta_ap, nombre_ap,
      pct_area_protegida (una fila por polígono).

Idempotencia: los CSV anuales están keyed por ``(poligono_id, anio)``. Si el
CSV ya existe, se lee y las combinaciones presentes se **saltan** (no se
recomputan), salvo que se pase ``--force``. ``wdpa_intersection.csv`` es
keyed sólo por ``poligono_id`` y sigue la misma regla.

Si un asset cambió de ID o no está accesible (permisos, Google movió la ruta)
se loguea WARNING y se continúa con los restantes cuando se usa ``todo``.
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
from pathlib import Path
from pathlib import Path as _Path
from typing import Any, Dict, List, Optional, Set, Tuple

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

from scripts.utils.config import Settings, load_settings
from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.io_geo import EPSG_UTM_POSADAS, load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Constantes de assets EE (verificados en el catálogo público el 2026-04-22)
# ---------------------------------------------------------------------------

CHIRPS_ASSET = "UCSB-CHG/CHIRPS/DAILY"
CHIRPS_BAND = "precipitation"
CHIRPS_SCALE_M = 5566  # resolución nominal del grid 0.05° en el ecuador.

S5P_NO2_ASSET = "COPERNICUS/S5P/OFFL/L3_NO2"
S5P_NO2_BAND = "tropospheric_NO2_column_number_density"
S5P_NO2_SCALE_M = 1113  # resolución nominal.

MODIS_LST_ASSET = "MODIS/061/MOD11A2"
MODIS_LST_DAY = "LST_Day_1km"
MODIS_LST_NIGHT = "LST_Night_1km"
MODIS_LST_SCALE_M = 1000
# Factor de escala MODIS y constante para Kelvin → °C.
MODIS_LST_SCALE_FACTOR = 0.02
KELVIN_ZERO_C = 273.15

FIRMS_ASSET = "FIRMS"
FIRMS_T21_BAND = "T21"
FIRMS_CONF_BAND = "confidence"
FIRMS_T21_THRESHOLD_K = 320.0
FIRMS_CONFIDENCE_MIN = 50
FIRMS_SCALE_M = 1000

WDPA_ASSET = "WCMC/WDPA/current/polygons"

# Períodos por defecto (cubre S5P y es suficiente para CHIRPS/LST/FIRMS).
ANIO_DESDE_DEFAULT = 2018
ANIO_HASTA_DEFAULT = 2025
# S5P empieza en jun-2018: para comparar años completos arrancamos en 2019.
NO2_ANIO_DESDE_DEFAULT = 2019


# ---------------------------------------------------------------------------
# Earth Engine init (una sola vez)
# ---------------------------------------------------------------------------


def inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine una vez para todo el script.

    Args:
        project_id: Project ID de Google Cloud. None usa el default ADC.

    Raises:
        SystemExit: si falla la inicialización.
    """
    try:
        import ee
    except ImportError as exc:
        logger.error("earthengine-api no está instalado. Corré: pip install earthengine-api")
        raise SystemExit(1) from exc

    try:
        if project_id:
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
        row: Fila de GeoDataFrame con atributo ``.geometry``.

    Returns:
        ee.Geometry equivalente en EPSG:4326.
    """
    import ee

    return ee.Geometry(row.geometry.__geo_interface__)


def _area_km2(row) -> float:
    """Calcula el área del polígono en km² reproyectando a UTM 21S.

    Args:
        row: Fila con geometría en EPSG:4326.

    Returns:
        Área en km².
    """
    import geopandas as gpd

    g = gpd.GeoDataFrame(geometry=[row.geometry], crs="EPSG:4326").to_crs(epsg=EPSG_UTM_POSADAS)
    return float(g.geometry.iloc[0].area) / 1_000_000.0


def _bbox_ee_geometry(settings: Settings) -> Any:
    """Construye una ``ee.Geometry.Rectangle`` del bbox de Posadas.

    Usa ``settings.geografia.bbox`` (oeste, sur, este, norte).

    Args:
        settings: Settings del proyecto con el bbox configurado.

    Returns:
        ee.Geometry cubriendo el bbox urbano de Posadas.
    """
    import ee

    b = settings.geografia.bbox
    return ee.Geometry.Rectangle([b.oeste, b.sur, b.este, b.norte])


def _write_csv(rows: List[Dict[str, Any]], destino: Path, columnas: List[str]) -> None:
    """Escribe una lista de dicts a CSV con columnas fijas.

    Args:
        rows: Lista de dicts (se ignoran keys extra fuera de ``columnas``).
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


def _leer_csv_existente(destino: Path, columnas: List[str]) -> List[Dict[str, Any]]:
    """Lee un CSV existente y devuelve las filas como dicts.

    Args:
        destino: Path del CSV.
        columnas: Columnas esperadas. Si el CSV no las tiene todas, devolvemos [].

    Returns:
        Lista de filas. Vacía si el archivo no existe o tiene header distinto.
    """
    if not destino.exists() or destino.stat().st_size == 0:
        return []
    try:
        with destino.open("r", encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            header = reader.fieldnames or []
            if not set(columnas).issubset(set(header)):
                logger.warning(
                    f"Header de {destino.name} no coincide con columnas esperadas. "
                    f"Regenerando desde cero."
                )
                return []
            return [dict(r) for r in reader]
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"No se pudo leer {destino.name}: {exc}. Regenerando desde cero.")
        return []


def _claves_poligono_anio(filas: List[Dict[str, Any]]) -> Set[Tuple[str, int]]:
    """Extrae el set de claves (poligono_id, anio) de filas previas.

    Args:
        filas: Filas ya escritas en un CSV.

    Returns:
        Set de tuplas (poligono_id, anio) para detectar qué falta computar.
    """
    claves: Set[Tuple[str, int]] = set()
    for r in filas:
        try:
            claves.add((str(r["poligono_id"]), int(r["anio"])))
        except (KeyError, ValueError, TypeError):
            continue
    return claves


def _claves_poligono(filas: List[Dict[str, Any]]) -> Set[str]:
    """Extrae el set de poligono_id de filas previas (sin dimensión anio).

    Args:
        filas: Filas ya escritas en un CSV.

    Returns:
        Set de poligono_id ya procesados.
    """
    return {str(r["poligono_id"]) for r in filas if r.get("poligono_id")}


# ---------------------------------------------------------------------------
# Parte 1 — CHIRPS (precipitación)
# ---------------------------------------------------------------------------


def _chirps_suma_en_rango(
    geom: Any,
    inicio: str,
    fin: str,
) -> Optional[float]:
    """Suma la precipitación diaria dentro de un rango de fechas y polígono.

    Primero reduce temporalmente con ``sum`` (mm totales en el período por
    pixel) y luego promedia espacialmente con ``mean`` dentro del polígono.

    Args:
        geom: ee.Geometry del polígono.
        inicio: Fecha inicio (YYYY-MM-DD) inclusiva.
        fin: Fecha fin (YYYY-MM-DD) exclusiva.

    Returns:
        mm promedio acumulados en el período, o None si no hay imágenes.
    """
    import ee

    try:
        col = ee.ImageCollection(CHIRPS_ASSET).filterDate(inicio, fin).select(CHIRPS_BAND)
        n = col.size().getInfo()
        if n == 0:
            return None
        suma_img = col.sum()
        stats = suma_img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=CHIRPS_SCALE_M,
            maxPixels=1e10,
            bestEffort=True,
        ).getInfo()
        if not stats:
            return None
        val = stats.get(CHIRPS_BAND)
        return float(val) if val is not None else 0.0
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"CHIRPS {inicio}→{fin} falló: {exc}")
        return None


def procesar_chirps(
    gdf,
    anio_desde: int,
    anio_hasta: int,
    destino_csv: Path,
    *,
    force: bool,
) -> Tuple[bool, str]:
    """Procesa CHIRPS: precipitación anual + estacional por polígono.

    Estaciones:
      - Verano lluvioso: 1-oct del año anterior → 1-abr del año actual
        (lluvias en hemisferio sur se reparten oct-mar).
      - Invierno seco:   1-abr del año → 1-oct del año (abr-sep).

    Args:
        gdf: GeoDataFrame con polígonos.
        anio_desde: Primer año (inclusive).
        anio_hasta: Último año (inclusive).
        destino_csv: Path de salida.
        force: Si True, ignora filas previas y recomputa todo.

    Returns:
        Tupla (ok, mensaje).
    """
    logger.info("=" * 60)
    logger.info(f"CHIRPS — precipitación anual + estacional {anio_desde}-{anio_hasta}")
    logger.info("=" * 60)

    columnas = [
        "poligono_id",
        "anio",
        "precip_mm_anual",
        "precip_mm_verano",
        "precip_mm_invierno",
    ]
    previas = [] if force else _leer_csv_existente(destino_csv, columnas)
    ya_hechas = _claves_poligono_anio(previas)
    if previas:
        logger.info(f"CHIRPS — {len(previas)} filas ya existen. Se saltarán salvo --force.")

    filas: List[Dict[str, Any]] = list(previas)
    total_iter = len(gdf) * (anio_hasta - anio_desde + 1)
    pbar = tqdm(total=total_iter, desc="CHIRPS", unit="pol-año")
    agregadas = 0

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        try:
            geom = _ee_geometry_from_row(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] geometría inválida: {exc}")
            pbar.update(anio_hasta - anio_desde + 1)
            continue

        for anio in range(anio_desde, anio_hasta + 1):
            if (poligono_id, anio) in ya_hechas:
                pbar.update(1)
                continue

            # Año completo.
            anual = _chirps_suma_en_rango(geom, f"{anio}-01-01", f"{anio + 1}-01-01")
            # Verano lluvioso: oct(anio-1) → abr(anio).
            verano = _chirps_suma_en_rango(geom, f"{anio - 1}-10-01", f"{anio}-04-01")
            # Invierno seco: abr(anio) → oct(anio).
            invierno = _chirps_suma_en_rango(geom, f"{anio}-04-01", f"{anio}-10-01")

            if anual is None and verano is None and invierno is None:
                logger.debug(f"[{poligono_id}|{anio}] CHIRPS sin datos.")
                pbar.update(1)
                continue

            fila = {
                "poligono_id": poligono_id,
                "anio": anio,
                "precip_mm_anual": round(anual or 0.0, 2),
                "precip_mm_verano": round(verano or 0.0, 2),
                "precip_mm_invierno": round(invierno or 0.0, 2),
            }
            filas.append(fila)
            agregadas += 1
            logger.debug(
                f"[{poligono_id}|{anio}] anual={fila['precip_mm_anual']}mm "
                f"verano={fila['precip_mm_verano']}mm "
                f"invierno={fila['precip_mm_invierno']}mm"
            )
            pbar.update(1)

    pbar.close()

    if not filas:
        return False, "CHIRPS no produjo ninguna fila."

    _write_csv(filas, destino_csv, columnas=columnas)
    return (
        True,
        f"CHIRPS OK — {len(filas)} filas ({agregadas} nuevas) en {destino_csv.name}",
    )


# ---------------------------------------------------------------------------
# Parte 2 — Sentinel-5P NO2 troposférico
# ---------------------------------------------------------------------------


def _no2_media_en_rango(
    geom: Any,
    inicio: str,
    fin: str,
) -> Optional[float]:
    """Media anual de NO2 troposférico (mol/m²) dentro de un polígono.

    Args:
        geom: ee.Geometry del polígono.
        inicio: Fecha inicio (YYYY-MM-DD) inclusiva.
        fin: Fecha fin (YYYY-MM-DD) exclusiva.

    Returns:
        Media en mol/m², o None si no hay imágenes válidas.
    """
    import ee

    try:
        col = ee.ImageCollection(S5P_NO2_ASSET).filterDate(inicio, fin).select(S5P_NO2_BAND)
        n = col.size().getInfo()
        if n == 0:
            return None
        img = col.mean()
        stats = img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=S5P_NO2_SCALE_M,
            maxPixels=1e10,
            bestEffort=True,
        ).getInfo()
        if not stats:
            return None
        val = stats.get(S5P_NO2_BAND)
        return float(val) if val is not None else None
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"S5P-NO2 {inicio}→{fin} falló: {exc}")
        return None


def procesar_no2(
    gdf,
    bbox_geom: Any,
    anio_desde: int,
    anio_hasta: int,
    destino_csv: Path,
    *,
    force: bool,
) -> Tuple[bool, str]:
    """Procesa Sentinel-5P NO2 troposférico por polígono y año.

    Args:
        gdf: GeoDataFrame con polígonos.
        bbox_geom: ee.Geometry del bbox urbano de Posadas (contexto).
        anio_desde: Primer año (≥2019 recomendado; 2018 solo parcial).
        anio_hasta: Último año (inclusive).
        destino_csv: Path de salida.
        force: Si True, recomputa todo.

    Returns:
        Tupla (ok, mensaje).
    """
    logger.info("=" * 60)
    logger.info(f"Sentinel-5P NO2 — media anual {anio_desde}-{anio_hasta}")
    logger.info("=" * 60)

    columnas = ["poligono_id", "anio", "no2_mean_mol_m2", "no2_relativo_bbox"]
    previas = [] if force else _leer_csv_existente(destino_csv, columnas)
    ya_hechas = _claves_poligono_anio(previas)
    if previas:
        logger.info(f"NO2 — {len(previas)} filas ya existen. Se saltarán salvo --force.")

    # Cacheamos el NO2 del bbox por año (una sola consulta por año).
    no2_bbox_por_anio: Dict[int, Optional[float]] = {}

    filas: List[Dict[str, Any]] = list(previas)
    total_iter = len(gdf) * (anio_hasta - anio_desde + 1)
    pbar = tqdm(total=total_iter, desc="NO2", unit="pol-año")
    agregadas = 0

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        try:
            geom = _ee_geometry_from_row(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] geometría inválida: {exc}")
            pbar.update(anio_hasta - anio_desde + 1)
            continue

        for anio in range(anio_desde, anio_hasta + 1):
            if (poligono_id, anio) in ya_hechas:
                pbar.update(1)
                continue

            if anio not in no2_bbox_por_anio:
                no2_bbox_por_anio[anio] = _no2_media_en_rango(
                    bbox_geom, f"{anio}-01-01", f"{anio + 1}-01-01"
                )
                if no2_bbox_por_anio[anio] is not None:
                    logger.debug(f"NO2 bbox Posadas {anio} = {no2_bbox_por_anio[anio]:.4e} mol/m²")

            no2_pol = _no2_media_en_rango(geom, f"{anio}-01-01", f"{anio + 1}-01-01")
            no2_bbox = no2_bbox_por_anio.get(anio)

            if no2_pol is None:
                logger.debug(f"[{poligono_id}|{anio}] NO2 sin datos.")
                pbar.update(1)
                continue

            relativo = round(no2_pol / no2_bbox, 4) if no2_bbox and no2_bbox != 0 else None
            fila = {
                "poligono_id": poligono_id,
                "anio": anio,
                "no2_mean_mol_m2": f"{no2_pol:.6e}",
                "no2_relativo_bbox": relativo if relativo is not None else "",
            }
            filas.append(fila)
            agregadas += 1
            logger.debug(f"[{poligono_id}|{anio}] no2={no2_pol:.4e} mol/m² " f"rel_bbox={relativo}")
            pbar.update(1)

    pbar.close()

    if not filas:
        return False, "NO2 no produjo ninguna fila."

    _write_csv(filas, destino_csv, columnas=columnas)
    return (
        True,
        f"NO2 OK — {len(filas)} filas ({agregadas} nuevas) en {destino_csv.name}",
    )


# ---------------------------------------------------------------------------
# Parte 3 — MODIS LST (temperatura superficie)
# ---------------------------------------------------------------------------


def _lst_media_estacional_c(
    geom: Any,
    band: str,
    inicio: str,
    fin: str,
) -> Optional[float]:
    """Media de LST (en °C) para una banda MODIS en un rango temporal y polígono.

    Aplica el factor de escala 0.02 y convierte Kelvin → Celsius.

    Args:
        geom: ee.Geometry del polígono.
        band: ``LST_Day_1km`` o ``LST_Night_1km``.
        inicio: Fecha inicio (YYYY-MM-DD) inclusiva.
        fin: Fecha fin (YYYY-MM-DD) exclusiva.

    Returns:
        Temperatura media en °C, o None si no hay datos.
    """
    import ee

    try:
        col = ee.ImageCollection(MODIS_LST_ASSET).filterDate(inicio, fin).select(band)
        n = col.size().getInfo()
        if n == 0:
            return None
        # Promedio temporal de las composiciones 8-day del período.
        img = col.mean()
        stats = img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=MODIS_LST_SCALE_M,
            maxPixels=1e10,
            bestEffort=True,
        ).getInfo()
        if not stats:
            return None
        raw = stats.get(band)
        if raw is None:
            return None
        # raw está en Kelvin ya multiplicado × 1/scale_factor (es decir: raw * 0.02 = K real).
        kelvin = float(raw) * MODIS_LST_SCALE_FACTOR
        return kelvin - KELVIN_ZERO_C
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"LST {band} {inicio}→{fin} falló: {exc}")
        return None


def _rango_verano(anio: int) -> Tuple[str, str]:
    """Rango de verano austral DJF para un año dado (dic año-1, ene-feb año).

    Args:
        anio: Año al que "pertenece" el verano (el ene y feb son de ese año).

    Returns:
        Tupla (inicio, fin) en formato YYYY-MM-DD, con fin exclusivo.
    """
    return (f"{anio - 1}-12-01", f"{anio}-03-01")


def _rango_invierno(anio: int) -> Tuple[str, str]:
    """Rango de invierno austral JJA (jun-ago) para un año dado.

    Args:
        anio: Año del invierno.

    Returns:
        Tupla (inicio, fin) en formato YYYY-MM-DD, con fin exclusivo.
    """
    return (f"{anio}-06-01", f"{anio}-09-01")


def procesar_lst(
    gdf,
    bbox_geom: Any,
    anio_desde: int,
    anio_hasta: int,
    destino_csv: Path,
    *,
    force: bool,
) -> Tuple[bool, str]:
    """Procesa MODIS LST día/noche por polígono + isla de calor vs bbox.

    Args:
        gdf: GeoDataFrame con polígonos.
        bbox_geom: ee.Geometry del bbox urbano de Posadas (contexto).
        anio_desde: Primer año.
        anio_hasta: Último año (inclusive).
        destino_csv: Path de salida.
        force: Si True, recomputa todo.

    Returns:
        Tupla (ok, mensaje).
    """
    logger.info("=" * 60)
    logger.info(f"MODIS LST — temperatura día/noche + isla de calor {anio_desde}-{anio_hasta}")
    logger.info("=" * 60)

    columnas = [
        "poligono_id",
        "anio",
        "lst_dia_verano_c",
        "lst_noche_verano_c",
        "lst_dia_invierno_c",
        "lst_noche_invierno_c",
        "isla_calor_c",
    ]
    previas = [] if force else _leer_csv_existente(destino_csv, columnas)
    ya_hechas = _claves_poligono_anio(previas)
    if previas:
        logger.info(f"LST — {len(previas)} filas ya existen. Se saltarán salvo --force.")

    # Cache del LST día verano del bbox (base para calcular isla de calor).
    bbox_lst_verano_por_anio: Dict[int, Optional[float]] = {}

    filas: List[Dict[str, Any]] = list(previas)
    total_iter = len(gdf) * (anio_hasta - anio_desde + 1)
    pbar = tqdm(total=total_iter, desc="LST", unit="pol-año")
    agregadas = 0

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        try:
            geom = _ee_geometry_from_row(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] geometría inválida: {exc}")
            pbar.update(anio_hasta - anio_desde + 1)
            continue

        for anio in range(anio_desde, anio_hasta + 1):
            if (poligono_id, anio) in ya_hechas:
                pbar.update(1)
                continue

            v_ini, v_fin = _rango_verano(anio)
            i_ini, i_fin = _rango_invierno(anio)

            lst_dia_v = _lst_media_estacional_c(geom, MODIS_LST_DAY, v_ini, v_fin)
            lst_noche_v = _lst_media_estacional_c(geom, MODIS_LST_NIGHT, v_ini, v_fin)
            lst_dia_i = _lst_media_estacional_c(geom, MODIS_LST_DAY, i_ini, i_fin)
            lst_noche_i = _lst_media_estacional_c(geom, MODIS_LST_NIGHT, i_ini, i_fin)

            if anio not in bbox_lst_verano_por_anio:
                bbox_lst_verano_por_anio[anio] = _lst_media_estacional_c(
                    bbox_geom, MODIS_LST_DAY, v_ini, v_fin
                )
                if bbox_lst_verano_por_anio[anio] is not None:
                    logger.debug(
                        f"LST día verano bbox {anio} = " f"{bbox_lst_verano_por_anio[anio]:.2f}°C"
                    )

            bbox_lst = bbox_lst_verano_por_anio.get(anio)
            isla = (
                round(lst_dia_v - bbox_lst, 3)
                if (lst_dia_v is not None and bbox_lst is not None)
                else None
            )

            if all(x is None for x in (lst_dia_v, lst_noche_v, lst_dia_i, lst_noche_i)):
                logger.debug(f"[{poligono_id}|{anio}] LST sin datos.")
                pbar.update(1)
                continue

            fila = {
                "poligono_id": poligono_id,
                "anio": anio,
                "lst_dia_verano_c": round(lst_dia_v, 3) if lst_dia_v is not None else "",
                "lst_noche_verano_c": round(lst_noche_v, 3) if lst_noche_v is not None else "",
                "lst_dia_invierno_c": round(lst_dia_i, 3) if lst_dia_i is not None else "",
                "lst_noche_invierno_c": round(lst_noche_i, 3) if lst_noche_i is not None else "",
                "isla_calor_c": isla if isla is not None else "",
            }
            filas.append(fila)
            agregadas += 1
            logger.debug(
                f"[{poligono_id}|{anio}] día_v={fila['lst_dia_verano_c']}°C "
                f"noche_v={fila['lst_noche_verano_c']}°C "
                f"isla_calor={fila['isla_calor_c']}°C"
            )
            pbar.update(1)

    pbar.close()

    if not filas:
        return False, "LST no produjo ninguna fila."

    _write_csv(filas, destino_csv, columnas=columnas)
    return (
        True,
        f"LST OK — {len(filas)} filas ({agregadas} nuevas) en {destino_csv.name}",
    )


# ---------------------------------------------------------------------------
# Parte 4 — FIRMS (incendios)
# ---------------------------------------------------------------------------


def _firms_stats_anio(
    geom: Any,
    anio: int,
    area_km2: float,
) -> Optional[Dict[str, float]]:
    """Cuenta focos FIRMS y área afectada en un año para un polígono.

    Aplica filtros ``T21 >= 320 K`` y ``confidence >= 50``. Usa
    ``reduceRegion`` con ``count`` sobre una banda enmascarada para calcular
    tanto el número de detecciones como la fracción de área del polígono
    que toca al menos un foco.

    Args:
        geom: ee.Geometry del polígono.
        anio: Año objetivo.
        area_km2: Área del polígono en km² (para el pct_area_afectada).

    Returns:
        Dict con ``n_focos`` y ``pct_area_afectada``, o None si no hay
        imágenes FIRMS en ese año para ese polígono.
    """
    import ee

    try:
        col = (
            ee.ImageCollection(FIRMS_ASSET)
            .filterDate(f"{anio}-01-01", f"{anio + 1}-01-01")
            .filterBounds(geom)
        )
        n_imagenes = col.size().getInfo()
        if n_imagenes == 0:
            return {"n_focos": 0, "pct_area_afectada": 0.0}

        # Máscara por calidad: T21 >= 320 y confidence >= 50.
        def _mask_quality(img: Any) -> Any:
            t21 = img.select(FIRMS_T21_BAND)
            conf = img.select(FIRMS_CONF_BAND)
            mask = t21.gte(FIRMS_T21_THRESHOLD_K).And(conf.gte(FIRMS_CONFIDENCE_MIN))
            return img.updateMask(mask)

        col_q = col.map(_mask_quality).select(FIRMS_T21_BAND)

        # n_focos = suma de pixel_area "presencia" sobre toda la colección.
        # Usamos count() sobre la colección para contar detecciones por pixel,
        # luego reduceRegion con sum() para total de detecciones en el polígono.
        count_img = col_q.count()
        sum_dict = count_img.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=geom,
            scale=FIRMS_SCALE_M,
            maxPixels=1e10,
            bestEffort=True,
        ).getInfo()
        n_focos = int(sum_dict.get(FIRMS_T21_BAND, 0) or 0) if sum_dict else 0

        # Área afectada: cualquier píxel que haya tenido al menos una
        # detección válida. max() sobre la colección deja 1 en pixeles tocados.
        any_img = col_q.max().mask(col_q.count().gt(0))
        # ee.Image.pixelArea() da m² por píxel.
        area_img = ee.Image.pixelArea().updateMask(any_img.mask())
        area_dict = area_img.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=geom,
            scale=FIRMS_SCALE_M,
            maxPixels=1e10,
            bestEffort=True,
        ).getInfo()
        area_m2 = float(area_dict.get("area", 0) or 0) if area_dict else 0.0
        pct = 100.0 * (area_m2 / 1_000_000.0) / area_km2 if area_km2 > 0 else 0.0

        # Consistencia: si no hay focos, no hay área afectada.
        # bestEffort=True puede inflar la estimación por solapamiento de pixel
        # grids; forzamos 0 cuando n_focos==0 para evitar este artefacto.
        if n_focos <= 0:
            pct = 0.0

        return {"n_focos": n_focos, "pct_area_afectada": round(pct, 4)}
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"FIRMS {anio} falló: {exc}")
        return None


def procesar_firms(
    gdf,
    anio_desde: int,
    anio_hasta: int,
    destino_csv: Path,
    *,
    force: bool,
) -> Tuple[bool, str]:
    """Procesa FIRMS: conteo de focos + % área afectada por polígono y año.

    Args:
        gdf: GeoDataFrame con polígonos.
        anio_desde: Primer año.
        anio_hasta: Último año (inclusive).
        destino_csv: Path de salida.
        force: Si True, recomputa todo.

    Returns:
        Tupla (ok, mensaje).
    """
    logger.info("=" * 60)
    logger.info(
        f"FIRMS — focos {anio_desde}-{anio_hasta} "
        f"(T21≥{FIRMS_T21_THRESHOLD_K}K, conf≥{FIRMS_CONFIDENCE_MIN})"
    )
    logger.info("=" * 60)

    columnas = ["poligono_id", "anio", "n_focos", "pct_area_afectada"]
    previas = [] if force else _leer_csv_existente(destino_csv, columnas)
    ya_hechas = _claves_poligono_anio(previas)
    if previas:
        logger.info(f"FIRMS — {len(previas)} filas ya existen. Se saltarán salvo --force.")

    filas: List[Dict[str, Any]] = list(previas)
    total_iter = len(gdf) * (anio_hasta - anio_desde + 1)
    pbar = tqdm(total=total_iter, desc="FIRMS", unit="pol-año")
    agregadas = 0

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        try:
            geom = _ee_geometry_from_row(row)
            area_km2 = _area_km2(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] fallo preparación geom: {exc}")
            pbar.update(anio_hasta - anio_desde + 1)
            continue

        for anio in range(anio_desde, anio_hasta + 1):
            if (poligono_id, anio) in ya_hechas:
                pbar.update(1)
                continue

            stats = _firms_stats_anio(geom, anio, area_km2)
            if stats is None:
                logger.debug(f"[{poligono_id}|{anio}] FIRMS sin datos.")
                pbar.update(1)
                continue

            fila = {
                "poligono_id": poligono_id,
                "anio": anio,
                "n_focos": stats["n_focos"],
                "pct_area_afectada": stats["pct_area_afectada"],
            }
            filas.append(fila)
            agregadas += 1
            logger.debug(
                f"[{poligono_id}|{anio}] focos={stats['n_focos']} "
                f"pct_area={stats['pct_area_afectada']}%"
            )
            pbar.update(1)

    pbar.close()

    if not filas:
        return False, "FIRMS no produjo ninguna fila."

    _write_csv(filas, destino_csv, columnas=columnas)
    return (
        True,
        f"FIRMS OK — {len(filas)} filas ({agregadas} nuevas) en {destino_csv.name}",
    )


# ---------------------------------------------------------------------------
# Parte 5 — WDPA (áreas protegidas)
# ---------------------------------------------------------------------------


def _wdpa_interseccion_poligono(geom: Any, area_poligono_km2: float) -> Dict[str, Any]:
    """Calcula intersección del polígono con WDPA global.

    Si hay múltiples APs que intersectan, devuelve la de mayor solapamiento.

    Args:
        geom: ee.Geometry del polígono.
        area_poligono_km2: Área del polígono en km².

    Returns:
        Dict con claves ``intersecta_ap`` (bool/str "True"/"False"),
        ``nombre_ap`` (str) y ``pct_area_protegida`` (float 0-100).
    """
    import ee

    try:
        fc = ee.FeatureCollection(WDPA_ASSET).filterBounds(geom)
        n = fc.size().getInfo()
        if n == 0:
            return {
                "intersecta_ap": False,
                "nombre_ap": "",
                "pct_area_protegida": 0.0,
            }

        # Para cada feature intersectante, calculamos el área de intersección.
        def _calcular_interseccion(feat: Any) -> Any:
            inter = feat.geometry().intersection(geom, ee.ErrorMargin(1))
            area_m2 = inter.area(ee.ErrorMargin(1))
            return feat.set({"area_inter_m2": area_m2})

        con_inter = fc.map(_calcular_interseccion).filter(ee.Filter.gt("area_inter_m2", 0))
        n_inter = con_inter.size().getInfo()
        if n_inter == 0:
            return {
                "intersecta_ap": False,
                "nombre_ap": "",
                "pct_area_protegida": 0.0,
            }

        mayor = con_inter.sort("area_inter_m2", False).first()
        info = mayor.getInfo()
        props = info.get("properties", {}) if info else {}
        area_inter_m2 = float(props.get("area_inter_m2", 0) or 0)
        nombre = str(props.get("NAME", "") or "")
        pct = (
            100.0 * (area_inter_m2 / 1_000_000.0) / area_poligono_km2
            if area_poligono_km2 > 0
            else 0.0
        )
        return {
            "intersecta_ap": True,
            "nombre_ap": nombre,
            "pct_area_protegida": round(pct, 4),
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"WDPA intersección falló: {exc}")
        return {
            "intersecta_ap": False,
            "nombre_ap": f"ERROR: {exc}",
            "pct_area_protegida": 0.0,
        }


def procesar_wdpa(
    gdf,
    destino_csv: Path,
    *,
    force: bool,
) -> Tuple[bool, str]:
    """Procesa WDPA: intersección de cada polígono con áreas protegidas.

    Args:
        gdf: GeoDataFrame con polígonos.
        destino_csv: Path de salida.
        force: Si True, recomputa todo.

    Returns:
        Tupla (ok, mensaje).
    """
    logger.info("=" * 60)
    logger.info("WDPA — intersección con áreas protegidas (snapshot 'current')")
    logger.info("=" * 60)

    columnas = ["poligono_id", "intersecta_ap", "nombre_ap", "pct_area_protegida"]
    previas = [] if force else _leer_csv_existente(destino_csv, columnas)
    ya_hechas = _claves_poligono(previas)
    if previas:
        logger.info(f"WDPA — {len(previas)} filas ya existen. Se saltarán salvo --force.")

    filas: List[Dict[str, Any]] = list(previas)
    pbar = tqdm(total=len(gdf), desc="WDPA", unit="poligono")
    agregadas = 0

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        if poligono_id in ya_hechas:
            pbar.update(1)
            continue
        try:
            geom = _ee_geometry_from_row(row)
            area_km2 = _area_km2(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] fallo preparación geom: {exc}")
            pbar.update(1)
            continue

        res = _wdpa_interseccion_poligono(geom, area_km2)
        fila = {
            "poligono_id": poligono_id,
            "intersecta_ap": str(res["intersecta_ap"]),
            "nombre_ap": res["nombre_ap"],
            "pct_area_protegida": res["pct_area_protegida"],
        }
        filas.append(fila)
        agregadas += 1
        logger.debug(
            f"[{poligono_id}] intersecta={res['intersecta_ap']} "
            f"AP='{res['nombre_ap']}' pct={res['pct_area_protegida']}%"
        )
        pbar.update(1)

    pbar.close()

    if not filas:
        return False, "WDPA no produjo ninguna fila."

    _write_csv(filas, destino_csv, columnas=columnas)
    return (
        True,
        f"WDPA OK — {len(filas)} filas ({agregadas} nuevas) en {destino_csv.name}",
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@dataclass
class ResultadoFuente:
    """Resultado de correr una fuente individual."""

    nombre: str
    ok: bool
    mensaje: str


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
    default="data/processed/ambiental",
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
    "--force",
    is_flag=True,
    default=False,
    help="Recomputar aunque existan filas previas en los CSV.",
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
    force: bool,
    nivel_log: str,
) -> None:
    """Variables ambientales — CHIRPS + NO2 + LST + FIRMS + WDPA por polígono.

    Correr un subcomando (chirps, no2, lst, firms, wdpa) o ``todo`` para los cinco.
    """
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    ctx.ensure_object(dict)
    ctx.obj["poligonos_path"] = poligonos_path
    ctx.obj["output_dir"] = output_dir
    ctx.obj["ee_project"] = ee_project or settings.env.ee_project_id
    ctx.obj["force"] = force
    ctx.obj["settings"] = settings

    logger.info("=" * 60)
    logger.info("Ambiental — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"Polígonos:   {poligonos_path}")
    logger.info(f"Output dir:  {output_dir}")
    logger.info(f"EE project:  {ctx.obj['ee_project'] or '(default ADC)'}")
    logger.info(f"Force:       {force}")

    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())
        ctx.exit(0)


def _cargar_gdf_e_init(ctx: click.Context):
    """Carga GeoDataFrame + inicializa EE. Helper común a todos los subcomandos.

    Args:
        ctx: click.Context con ``ee_project`` y ``poligonos_path``.

    Returns:
        GeoDataFrame cargado desde el path configurado.
    """
    inicializar_ee(ctx.obj["ee_project"])
    gdf = load_geojson(ctx.obj["poligonos_path"])
    if "id" not in gdf.columns:
        logger.error("El GeoJSON no tiene columna 'id'. Abortando.")
        sys.exit(2)
    logger.info(f"Se cargaron {len(gdf)} polígonos.")
    return gdf


@cli.command("chirps")
@click.option("--anio-desde", default=ANIO_DESDE_DEFAULT, show_default=True, type=int)
@click.option("--anio-hasta", default=ANIO_HASTA_DEFAULT, show_default=True, type=int)
@click.pass_context
def cmd_chirps(ctx: click.Context, anio_desde: int, anio_hasta: int) -> None:
    """CHIRPS — precipitación anual + estacional."""
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    destino = out / "chirps_anual.csv"

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning("Interrupción en CHIRPS — CSV puede estar incompleto.")
        )
        try:
            ok, msg = procesar_chirps(gdf, anio_desde, anio_hasta, destino, force=ctx.obj["force"])
        except Exception as exc:  # noqa: BLE001
            logger.error(f"CHIRPS excepción: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"CHIRPS falló con excepción: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


@cli.command("no2")
@click.option("--anio-desde", default=NO2_ANIO_DESDE_DEFAULT, show_default=True, type=int)
@click.option("--anio-hasta", default=ANIO_HASTA_DEFAULT, show_default=True, type=int)
@click.pass_context
def cmd_no2(ctx: click.Context, anio_desde: int, anio_hasta: int) -> None:
    """Sentinel-5P NO2 troposférico — media anual + relativo al bbox."""
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    destino = out / "no2_anual.csv"
    bbox_geom = _bbox_ee_geometry(ctx.obj["settings"])

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning("Interrupción en NO2 — CSV puede estar incompleto.")
        )
        try:
            ok, msg = procesar_no2(
                gdf, bbox_geom, anio_desde, anio_hasta, destino, force=ctx.obj["force"]
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"NO2 excepción: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"NO2 falló con excepción: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


@cli.command("lst")
@click.option("--anio-desde", default=ANIO_DESDE_DEFAULT, show_default=True, type=int)
@click.option("--anio-hasta", default=ANIO_HASTA_DEFAULT, show_default=True, type=int)
@click.pass_context
def cmd_lst(ctx: click.Context, anio_desde: int, anio_hasta: int) -> None:
    """MODIS LST — temperatura superficie día/noche + isla de calor."""
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    destino = out / "lst_anual.csv"
    bbox_geom = _bbox_ee_geometry(ctx.obj["settings"])

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning("Interrupción en LST — CSV puede estar incompleto.")
        )
        try:
            ok, msg = procesar_lst(
                gdf, bbox_geom, anio_desde, anio_hasta, destino, force=ctx.obj["force"]
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"LST excepción: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"LST falló con excepción: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


@cli.command("firms")
@click.option("--anio-desde", default=ANIO_DESDE_DEFAULT, show_default=True, type=int)
@click.option("--anio-hasta", default=ANIO_HASTA_DEFAULT, show_default=True, type=int)
@click.pass_context
def cmd_firms(ctx: click.Context, anio_desde: int, anio_hasta: int) -> None:
    """FIRMS — conteo de focos de incendio + % área afectada."""
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    destino = out / "firms_anual.csv"

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning("Interrupción en FIRMS — CSV puede estar incompleto.")
        )
        try:
            ok, msg = procesar_firms(gdf, anio_desde, anio_hasta, destino, force=ctx.obj["force"])
        except Exception as exc:  # noqa: BLE001
            logger.error(f"FIRMS excepción: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"FIRMS falló con excepción: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


@cli.command("wdpa")
@click.pass_context
def cmd_wdpa(ctx: click.Context) -> None:
    """WDPA — intersección con áreas protegidas (snapshot actual)."""
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    destino = out / "wdpa_intersection.csv"

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning("Interrupción en WDPA — CSV puede estar incompleto.")
        )
        try:
            ok, msg = procesar_wdpa(gdf, destino, force=ctx.obj["force"])
        except Exception as exc:  # noqa: BLE001
            logger.error(f"WDPA excepción: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"WDPA falló con excepción: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


@cli.command("todo")
@click.option("--anio-desde", default=ANIO_DESDE_DEFAULT, show_default=True, type=int)
@click.option("--anio-hasta", default=ANIO_HASTA_DEFAULT, show_default=True, type=int)
@click.option(
    "--no2-desde",
    default=NO2_ANIO_DESDE_DEFAULT,
    show_default=True,
    type=int,
    help="Año desde para NO2 (S5P empieza en jun-2018; default 2019).",
)
@click.pass_context
def cmd_todo(
    ctx: click.Context,
    anio_desde: int,
    anio_hasta: int,
    no2_desde: int,
) -> None:
    """Ejecuta las 5 fuentes secuencialmente (CHIRPS, NO2, LST, FIRMS, WDPA)."""
    gdf = _cargar_gdf_e_init(ctx)
    out = ensure_dir(resolve_path(ctx.obj["output_dir"]))
    bbox_geom = _bbox_ee_geometry(ctx.obj["settings"])
    force = ctx.obj["force"]

    resultados: List[ResultadoFuente] = []

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning(
                "Interrupción durante 'todo'. Los CSV parcialmente escritos quedan en disco."
            )
        )

        # Orden: CHIRPS primero (rápido, feedback), luego NO2, LST, FIRMS y WDPA.
        for nombre, fn in [
            (
                "chirps",
                lambda: procesar_chirps(
                    gdf, anio_desde, anio_hasta, out / "chirps_anual.csv", force=force
                ),
            ),
            (
                "no2",
                lambda: procesar_no2(
                    gdf, bbox_geom, no2_desde, anio_hasta, out / "no2_anual.csv", force=force
                ),
            ),
            (
                "lst",
                lambda: procesar_lst(
                    gdf, bbox_geom, anio_desde, anio_hasta, out / "lst_anual.csv", force=force
                ),
            ),
            (
                "firms",
                lambda: procesar_firms(
                    gdf, anio_desde, anio_hasta, out / "firms_anual.csv", force=force
                ),
            ),
            (
                "wdpa",
                lambda: procesar_wdpa(gdf, out / "wdpa_intersection.csv", force=force),
            ),
        ]:
            try:
                ok, msg = fn()
            except Exception as exc:  # noqa: BLE001
                logger.error(f"{nombre} excepción: {exc}")
                logger.debug(traceback.format_exc())
                ok, msg = False, f"{nombre} falló: {exc}"
            resultados.append(ResultadoFuente(nombre, ok, msg))

    # --- Resumen final ---
    logger.info("=" * 60)
    logger.info("Resumen ambiental")
    logger.info("=" * 60)
    for r in resultados:
        status = "OK " if r.ok else "FAIL"
        logger.info(f"[{status}] {r.nombre:8s} → {r.mensaje}")
    n_ok = sum(1 for r in resultados if r.ok)
    logger.info(f"Total: {n_ok}/{len(resultados)} fuentes completaron con éxito.")
    if n_ok < len(resultados):
        logger.warning("Hubo fallas. Revisá el log y corré los subcomandos individuales.")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    cli(obj={})
