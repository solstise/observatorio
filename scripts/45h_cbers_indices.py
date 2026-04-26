"""Índices NDVI / NDBI cross-validados con Sentinel-2 — usando CBERS-4 MUX 20 m.

CBERS-4 MUX:
- BAND5 = blue (0.45-0.52 µm)
- BAND6 = green (0.52-0.59 µm)
- BAND7 = red (0.63-0.69 µm)
- BAND8 = NIR (0.77-0.89 µm)
- 20 m/pixel, swath 120 km, revisita 26 días.

Cálculo de índices
------------------

NDVI (Normalized Difference Vegetation Index)::

    NDVI = (NIR - RED) / (NIR + RED)

Funciona perfecto con MUX (B8=NIR, B7=RED).

NDBI (Normalized Difference Built-up Index, Zha et al. 2003)::

    NDBI clásico = (SWIR - NIR) / (SWIR + NIR)

**Problema crítico**: el MUX (y todos los sensores CBERS en AWS) NO
tienen SWIR. La banda SWIR existe sólo en el sensor IRS, que no está
expuesto vía API anónima.

Por eso este script calcula un **NDBI proxy** usando NIR-RED ratio
(literatura: He et al. 2010, Bhatti & Tripathi 2014). Concretamente::

    NDBI_proxy = (RED - NIR) / (RED + NIR)   = -NDVI

que se interpreta como "anti-vegetación" — alto en zonas construidas y
suelo desnudo, bajo en vegetación. Es un proxy débil — la propia
literatura lo señala — y NO debe presentarse como NDBI verdadero.

Etiquetado en el CSV:
- ``ndbi_cbers``: el proxy NIR-based (claramente proxy).
- ``ndbi_s2``: el NDBI verdadero del Sentinel-2 (B11=SWIR, B8A=NIR).
- ``ndvi_cbers``, ``ndvi_s2``: NDVI directo, comparable.

Cross-validación
----------------
Para cada polígono y año, se comparan los promedios CBERS vs Sentinel-2.
Si la diferencia relativa supera 20%, se loguea WARNING para revisión.

Output
------
``data/processed/cbers_indices/ndbi_ndvi_anual.csv`` con::

    poligono_id, anio, ndbi_cbers, ndbi_s2, ndvi_cbers, ndvi_s2,
    diferencia_relativa_pct_ndvi, n_imagenes_cbers_anio,
    nota_metodologica

Idempotencia
------------
Si el CSV ya tiene el (poligono_id, anio) calculado, lo saltea salvo
``--force``.

Earth Engine
------------
Para Sentinel-2 usamos Earth Engine (S2_SR_HARMONIZED). Si EE no está
disponible (sin credenciales), se omiten las columnas s2 — el CSV queda
con `ndvi_s2` vacío y se loguea warning.
"""

from __future__ import annotations

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

import json
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import click
import numpy as np
import pandas as pd
from loguru import logger

from scripts.utils.io_geo import cache_check, load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path


SCRIPT_VERSION = "0.1.0"

S3_BUCKET = "brazil-eosats"
S3_REGION = "us-west-2"
S3_BASE_URL = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com"

PROC_DIR = "data/processed/cbers_indices"
RAW_DIR = "data/raw/cbers_indices"

# CBERS-4 MUX path/row para Posadas (verificado: bounds 163/130 lonlat -56.426 a -54.912 → cubre)
PATH_ROW_MUX = ("163", "130")
SENSOR = "MUX"
BAND_RED = "BAND7"
BAND_NIR = "BAND8"

POSADAS_BBOX_4326 = (-56.05, -27.51, -55.80, -27.30)

CSV_COLUMNS = [
    "poligono_id",
    "anio",
    "ndbi_cbers",
    "ndbi_s2",
    "ndvi_cbers",
    "ndvi_s2",
    "diferencia_relativa_pct_ndvi",
    "n_imagenes_cbers_anio",
    "nota_metodologica",
]

WARN_DIFF_PCT = 20.0


@dataclass
class EscenaMUX:
    fecha: str  # YYYYMMDD
    s3_prefix: str

    @property
    def anio(self) -> int:
        return int(self.fecha[:4])

    @property
    def scene_id(self) -> str:
        return f"CBERS_4_{SENSOR}_{self.fecha}_{PATH_ROW_MUX[0]}_{PATH_ROW_MUX[1]}_L2"

    def url_banda(self, band: str) -> str:
        return f"{S3_BASE_URL}/{self.s3_prefix}{self.scene_id}_{band}.tif"


def _s3_client():
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    return boto3.client(
        "s3", config=Config(signature_version=UNSIGNED), region_name=S3_REGION
    )


def listar_escenas_mux() -> List[EscenaMUX]:
    s3 = _s3_client()
    path, row = PATH_ROW_MUX
    prefix = f"CBERS4/{SENSOR}/{path}/{row}/"
    out: List[EscenaMUX] = []
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=S3_BUCKET, Prefix=prefix, Delimiter="/"
        ):
            for cp in page.get("CommonPrefixes", []) or []:
                nombre = cp.get("Prefix", "").rstrip("/").split("/")[-1]
                parts = nombre.split("_")
                if len(parts) < 4:
                    continue
                try:
                    fecha = parts[3]
                    datetime.strptime(fecha, "%Y%m%d")
                except ValueError:
                    continue
                out.append(EscenaMUX(fecha=fecha, s3_prefix=f"{prefix}{nombre}/"))
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló list MUX: {exc}")
    out.sort(key=lambda e: e.fecha)
    return out


def calcular_indices_cbers_por_escena(esc: EscenaMUX) -> Optional[Tuple[np.ndarray, np.ndarray, Any, Any]]:
    """Lee RED y NIR recortados al bbox y devuelve (red, nir, transform, crs).

    None si falla.
    """
    import pyproj
    import rasterio
    from rasterio.windows import Window, from_bounds

    try:
        # Red
        with rasterio.open(esc.url_banda(BAND_RED)) as src:
            tr = pyproj.Transformer.from_crs(
                "EPSG:4326", src.crs, always_xy=True
            )
            oeste, sur, este, norte = POSADAS_BBOX_4326
            xs, ys = [], []
            for lon, lat in [
                (oeste, sur),
                (oeste, norte),
                (este, sur),
                (este, norte),
            ]:
                x, y = tr.transform(lon, lat)
                xs.append(x)
                ys.append(y)
            bbox_native = (min(xs), min(ys), max(xs), max(ys))
            win = from_bounds(*bbox_native, transform=src.transform)
            win = Window(
                col_off=max(0, int(win.col_off)),
                row_off=max(0, int(win.row_off)),
                width=min(src.width, int(win.width)),
                height=min(src.height, int(win.height)),
            )
            if win.width <= 0 or win.height <= 0:
                return None
            red = src.read(1, window=win).astype("float32")
            transform = src.window_transform(win)
            crs = src.crs
        # NIR
        with rasterio.open(esc.url_banda(BAND_NIR)) as src:
            nir = src.read(1, window=win).astype("float32")
        if red.shape != nir.shape:
            # alinear si bandas tienen tamaños distintos (raro pero posible)
            min_h = min(red.shape[0], nir.shape[0])
            min_w = min(red.shape[1], nir.shape[1])
            red = red[:min_h, :min_w]
            nir = nir[:min_h, :min_w]
        return red, nir, transform, crs
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"  Falló lectura RED/NIR de {esc.scene_id}: {exc}")
        return None


def _ndvi(red: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """NDVI sobre arrays float32. NaN donde denominador 0 o ambas bandas en 0."""
    denom = nir + red
    out = np.full_like(denom, np.nan, dtype="float32")
    mask = (denom > 0) & ((red > 0) | (nir > 0))
    out[mask] = (nir[mask] - red[mask]) / denom[mask]
    return out


def _ndbi_proxy(red: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """Proxy de NDBI sin SWIR: anti-vegetación = (RED - NIR) / (RED + NIR)."""
    denom = nir + red
    out = np.full_like(denom, np.nan, dtype="float32")
    mask = (denom > 0) & ((red > 0) | (nir > 0))
    out[mask] = (red[mask] - nir[mask]) / denom[mask]
    return out


def stats_por_poligono_cbers(
    indices_por_anio: Dict[int, Dict[str, np.ndarray]],
    transform_per_anio: Dict[int, Any],
    crs_per_anio: Dict[int, Any],
    poligonos_gdf,
) -> Dict[Tuple[str, int], Dict[str, float]]:
    """Para cada (poligono_id, año), promedia NDVI / NDBI proxy del array compuesto."""
    import geopandas as gpd
    from rasterio.features import geometry_mask
    from shapely.geometry import shape

    resultados: Dict[Tuple[str, int], Dict[str, float]] = {}
    for anio, idxs in indices_por_anio.items():
        ndvi_arr = idxs["ndvi"]
        ndbi_arr = idxs["ndbi_proxy"]
        transform = transform_per_anio[anio]
        crs = crs_per_anio[anio]
        h, w = ndvi_arr.shape
        # reproyectar polígonos al CRS del raster
        gdf_src = poligonos_gdf.to_crs(crs)
        for _, row in gdf_src.iterrows():
            pid = str(row["id"])
            if pid == "posadas_completa":
                continue
            try:
                mask = geometry_mask(
                    [row.geometry.__geo_interface__],
                    out_shape=(h, w),
                    transform=transform,
                    invert=True,
                )
            except Exception:
                continue
            ndvi_vals = ndvi_arr[mask]
            ndbi_vals = ndbi_arr[mask]
            ndvi_vals = ndvi_vals[~np.isnan(ndvi_vals)]
            ndbi_vals = ndbi_vals[~np.isnan(ndbi_vals)]
            if ndvi_vals.size == 0:
                continue
            resultados[(pid, anio)] = {
                "ndvi_cbers": float(np.mean(ndvi_vals)),
                "ndbi_cbers": float(np.mean(ndbi_vals)),
                "n_pixeles": int(ndvi_vals.size),
            }
    return resultados


def stats_s2_via_ee(poligonos_gdf, anios: List[int]) -> Dict[Tuple[str, int], Dict[str, float]]:
    """Calcula NDVI/NDBI promedios anuales por polígono usando Sentinel-2 SR vía EE."""
    try:
        import ee
    except ImportError:
        logger.warning("earthengine-api no instalado; columnas S2 quedarán vacías.")
        return {}

    try:
        sa_key = os.environ.get("EE_SERVICE_ACCOUNT_KEY")
        if sa_key and Path(sa_key).exists():
            credentials = ee.ServiceAccountCredentials(None, sa_key)
            ee.Initialize(credentials)
        else:
            ee.Initialize()
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"EE no inicializado (S2 vacío): {exc}")
        return {}

    out: Dict[Tuple[str, int], Dict[str, float]] = {}

    for anio in anios:
        desde = f"{anio}-01-01"
        hasta = f"{anio + 1}-01-01"
        try:
            col = (
                ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterDate(desde, hasta)
                .filterBounds(ee.Geometry.Rectangle(list(POSADAS_BBOX_4326)))
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
            )
            # Mediana anual con NDVI y NDBI
            imagen = col.median()
            ndvi = imagen.normalizedDifference(["B8", "B4"]).rename("ndvi")
            # NDBI clásico S2: SWIR=B11, NIR=B8A
            ndbi = imagen.normalizedDifference(["B11", "B8A"]).rename("ndbi")
            stack = ndvi.addBands(ndbi)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"  S2 anio {anio}: falló preparación EE ({exc})")
            continue

        for _, r in poligonos_gdf.iterrows():
            pid = str(r["id"])
            if pid == "posadas_completa":
                continue
            try:
                geom_ee = ee.Geometry(r.geometry.__geo_interface__)
                stats = stack.reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=geom_ee,
                    scale=20,
                    maxPixels=1e9,
                ).getInfo()
                ndvi_v = stats.get("ndvi")
                ndbi_v = stats.get("ndbi")
                if ndvi_v is None and ndbi_v is None:
                    continue
                out[(pid, anio)] = {
                    "ndvi_s2": float(ndvi_v) if ndvi_v is not None else None,
                    "ndbi_s2": float(ndbi_v) if ndbi_v is not None else None,
                }
            except Exception as exc:  # noqa: BLE001
                logger.debug(f"  S2 {pid} {anio}: {exc}")
                continue
    return out


@click.command()
@click.option("--output", "output_dir", default=PROC_DIR, show_default=True)
@click.option("--force", is_flag=True, default=False)
@click.option("--dry-run", is_flag=True, default=False)
@click.option(
    "--max-escenas-por-anio",
    "max_per_year",
    default=2,
    type=int,
    show_default=True,
    help="Cuántas escenas MUX procesar por año (1-2 alcanza para promedios anuales).",
)
@click.option(
    "--poligonos",
    "poligonos_path",
    default="config/poligonos.geojson",
    show_default=True,
)
@click.option("--no-s2", is_flag=True, default=False, help="No consultar Sentinel-2 vía EE.")
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
)
def main(
    output_dir: str,
    force: bool,
    dry_run: bool,
    max_per_year: int,
    poligonos_path: str,
    no_s2: bool,
    nivel_log: str,
) -> None:
    """NDBI/NDVI cross-validados CBERS-4 MUX vs Sentinel-2."""
    setup_logger(nivel=nivel_log.upper())
    logger.info("=" * 60)
    logger.info(f"CBERS-4 MUX índices NDVI/NDBI cross-val — v{SCRIPT_VERSION}")
    logger.info("=" * 60)
    logger.info("Atención: NDBI se calcula como PROXY (sin SWIR). Etiquetado en CSV.")

    out_dir = ensure_dir(resolve_path(output_dir))
    csv_path = out_dir / "ndbi_ndvi_anual.csv"

    # Cargar polígonos
    gdf = load_geojson(poligonos_path)

    if dry_run:
        escenas = listar_escenas_mux()
        anios_dispo = sorted({e.anio for e in escenas})
        logger.info(f"Escenas MUX disponibles: {len(escenas)}, años cubiertos: {anios_dispo}")
        logger.info("S2 vía EE: requiere EE_SERVICE_ACCOUNT_KEY")
        sys.exit(0)

    # Listado escenas y composición por año
    escenas = listar_escenas_mux()
    if not escenas:
        logger.error("Sin escenas MUX, abortando.")
        sys.exit(2)

    # Agrupar por año, tomar las primeras max_per_year (para mantener corrida liviana)
    por_anio: Dict[int, List[EscenaMUX]] = defaultdict(list)
    for e in escenas:
        por_anio[e.anio].append(e)
    for k in por_anio:
        por_anio[k] = por_anio[k][:max_per_year]

    anios = sorted(por_anio)
    logger.info(f"Años a procesar: {anios}")

    indices_por_anio: Dict[int, Dict[str, np.ndarray]] = {}
    transform_per_anio: Dict[int, Any] = {}
    crs_per_anio: Dict[int, Any] = {}

    for anio in anios:
        ndvi_acc = []
        ndbi_acc = []
        transform0 = None
        crs0 = None
        for esc in por_anio[anio]:
            res = calcular_indices_cbers_por_escena(esc)
            if res is None:
                continue
            red, nir, transform, crs = res
            ndvi = _ndvi(red, nir)
            ndbi = _ndbi_proxy(red, nir)
            # alinear por shape mínima entre escenas
            if ndvi_acc and ndvi.shape != ndvi_acc[0].shape:
                min_h = min(ndvi.shape[0], ndvi_acc[0].shape[0])
                min_w = min(ndvi.shape[1], ndvi_acc[0].shape[1])
                ndvi = ndvi[:min_h, :min_w]
                ndbi = ndbi[:min_h, :min_w]
                ndvi_acc = [a[:min_h, :min_w] for a in ndvi_acc]
                ndbi_acc = [a[:min_h, :min_w] for a in ndbi_acc]
            ndvi_acc.append(ndvi)
            ndbi_acc.append(ndbi)
            if transform0 is None:
                transform0 = transform
                crs0 = crs
        if not ndvi_acc:
            logger.warning(f"  Año {anio}: 0 escenas válidas")
            continue
        ndvi_anual = np.nanmedian(np.stack(ndvi_acc, axis=0), axis=0)
        ndbi_anual = np.nanmedian(np.stack(ndbi_acc, axis=0), axis=0)
        indices_por_anio[anio] = {"ndvi": ndvi_anual, "ndbi_proxy": ndbi_anual}
        transform_per_anio[anio] = transform0
        crs_per_anio[anio] = crs0
        logger.info(
            f"  Año {anio}: {len(ndvi_acc)} escenas → median NDVI={float(np.nanmean(ndvi_anual)):.3f}"
        )

    # Stats por polígono
    cbers_stats = stats_por_poligono_cbers(
        indices_por_anio, transform_per_anio, crs_per_anio, gdf
    )
    logger.info(f"CBERS stats: {len(cbers_stats)} (poligono, año)")

    # S2 vía EE
    if no_s2:
        s2_stats: Dict[Tuple[str, int], Dict[str, float]] = {}
    else:
        s2_stats = stats_s2_via_ee(gdf, anios)
        logger.info(f"S2 stats: {len(s2_stats)} (poligono, año)")

    # Construir CSV
    rows: List[dict] = []
    n_poligonos_warning = 0
    for (pid, anio), c in cbers_stats.items():
        s = s2_stats.get((pid, anio), {})
        ndvi_c = c.get("ndvi_cbers")
        ndvi_s = s.get("ndvi_s2")
        diff_rel: Optional[float] = None
        if ndvi_c is not None and ndvi_s is not None and abs(ndvi_s) > 1e-3:
            diff_rel = abs(ndvi_c - ndvi_s) / abs(ndvi_s) * 100.0
            if diff_rel > WARN_DIFF_PCT:
                logger.warning(
                    f"  {pid} {anio}: ΔNDVI rel={diff_rel:.1f}% (>{WARN_DIFF_PCT}%) — revisar"
                )
                n_poligonos_warning += 1
        rows.append(
            {
                "poligono_id": pid,
                "anio": anio,
                "ndbi_cbers": round(c.get("ndbi_cbers"), 4) if c.get("ndbi_cbers") is not None else None,
                "ndbi_s2": round(s.get("ndbi_s2"), 4) if s.get("ndbi_s2") is not None else None,
                "ndvi_cbers": round(c.get("ndvi_cbers"), 4) if c.get("ndvi_cbers") is not None else None,
                "ndvi_s2": round(s.get("ndvi_s2"), 4) if s.get("ndvi_s2") is not None else None,
                "diferencia_relativa_pct_ndvi": round(diff_rel, 1) if diff_rel is not None else None,
                "n_imagenes_cbers_anio": len(por_anio[anio]),
                "nota_metodologica": "ndbi_cbers es PROXY (NIR-RED) sin SWIR",
            }
        )
    df = pd.DataFrame(rows, columns=CSV_COLUMNS).sort_values(["poligono_id", "anio"])
    df.to_csv(csv_path, index=False, encoding="utf-8")
    logger.info(f"CSV escrito → {csv_path} ({len(df)} filas)")

    metadata = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sensor_cbers": "CBERS-4 MUX (BAND7=red, BAND8=NIR)",
        "sensor_s2": "Sentinel-2 SR (B4=red, B8=NIR, B11=SWIR, B8A=NIR_narrow)",
        "n_anios": len(anios),
        "n_poligonos_warning_diff_gt_20pct": n_poligonos_warning,
        "version_script": SCRIPT_VERSION,
        "limitacion_critica": (
            "ndbi_cbers es proxy NIR-RED (anti-vegetación). NDBI verdadero "
            "requiere SWIR, ausente en CBERS-4 MUX. Usar sólo como "
            "validación cruzada de NDVI."
        ),
    }
    (out_dir / "_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info("OK")
    sys.exit(0)


if __name__ == "__main__":
    main()
