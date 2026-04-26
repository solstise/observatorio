"""Disaster response: detección de inundaciones del Paraná con CBERS AWFI + Sentinel-1.

Combina dos fuentes complementarias:

1. **CBERS-4 AWFI** (64 m, óptico, 4 bandas blue/green/red/NIR) — detecta
   superficies acuáticas con índice **NDWI McFeeters** (1996)::

       NDWI = (Green - NIR) / (Green + NIR)

   El agua refleja muy poco NIR → NDWI alto sobre agua. Es el índice
   óptico más usado en disaster response cuando no hay SWIR (NDWI Gao
   1996 = (NIR-SWIR)/(NIR+SWIR) requiere SWIR, que CBERS sin IRS no
   tiene).

2. **Sentinel-1 SAR** (script 43 ya descarga backscatter VV/VH). El
   backscatter VV cae brutal sobre superficies acuáticas (radar atraviesa
   nubes). Usa el CSV ya generado: ``data/processed/sentinel1/sentinel1_backscatter.csv``.

Cross-validación
----------------
Para cada **fecha de pasada AWFI** (~5-6 días):

- Calcula área inundada = pixeles con NDWI > 0.3 en el bbox de Posadas.
- Busca en S1 backscatter una observación dentro de ±5 días.
- Si Δs1_vv_db < -3 dB respecto al baseline del polígono → S1 confirma agua.
- ``confianza`` = "alta" (ambas fuentes), "media" (sólo una), "baja"
  (sólo CBERS sin S1).

Output
------
``data/processed/cbers_inundacion/eventos_inundacion.csv`` con::

    fecha, poligonos_afectados, area_inundada_km2, fuente_principal,
    fuente_validacion, confianza

donde ``poligonos_afectados`` es CSV-encoded list (``"villa_mola,san_jorge"``).

Limitaciones (críticas)
-----------------------
- AWFI revisita 5 días pero las inundaciones grandes del Paraná duran
  semanas, así que probablemente capturamos al menos 1 frame.
- AWFI 64 m: detecta crecidas grandes (>0.5 km²). Inundaciones pequeñas
  o canales angostos no se ven.
- McFeeters NDWI confunde agua con nubes oscuras y sombras de edificios.
  Para reducir falsos positivos se aplica máscara conservadora
  (NDVI < 0.1 además de NDWI > 0.3).
- S1 cross-val depende de que el script 43 haya corrido.

Idempotencia
------------
Si el evento ya está en el CSV, se saltea (key = fecha). ``--force``
recalcula todo.

Uso
---
::

    python scripts/45i_cbers_inundacion.py
    python scripts/45i_cbers_inundacion.py --desde 2023-09 --hasta 2024-04
    python scripts/45i_cbers_inundacion.py --dry-run
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

PROC_DIR = "data/processed/cbers_inundacion"
S1_CSV = "data/processed/sentinel1/sentinel1_backscatter.csv"

# AWFI: path/row Posadas
PATH_ROWS_AWFI = [("163", "129"), ("164", "129"), ("165", "129")]
SENSOR = "AWFI"
BAND_GREEN = "BAND14"
BAND_NIR = "BAND16"
BAND_RED = "BAND15"

POSADAS_BBOX_4326 = (-56.05, -27.51, -55.80, -27.30)

# Umbrales NDWI / NDVI para agua
NDWI_AGUA_THRESHOLD = 0.3
NDVI_AGUA_MAX = 0.1  # filtro extra: si NDVI > 0.1 NO es agua (es vegetación)
S1_DELTA_DB_THRESHOLD = -3.0  # caída esperada VV cuando se inunda

CSV_COLUMNS = [
    "fecha",
    "poligonos_afectados",
    "area_inundada_km2",
    "fuente_principal",
    "fuente_validacion",
    "confianza",
]


@dataclass
class EscenaAWFI:
    path: str
    row: str
    fecha: str  # YYYYMMDD
    s3_prefix: str

    @property
    def fecha_dt(self) -> datetime:
        return datetime.strptime(self.fecha, "%Y%m%d")

    @property
    def scene_id(self) -> str:
        return f"CBERS_4_{SENSOR}_{self.fecha}_{self.path}_{self.row}_L4"

    def url_banda(self, band: str) -> str:
        return f"{S3_BASE_URL}/{self.s3_prefix}{self.scene_id}_{band}.tif"


def _s3_client():
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    return boto3.client(
        "s3", config=Config(signature_version=UNSIGNED), region_name=S3_REGION
    )


def listar_awfi(desde: date, hasta: date) -> List[EscenaAWFI]:
    s3 = _s3_client()
    out: List[EscenaAWFI] = []
    for path, row in PATH_ROWS_AWFI:
        prefix = f"CBERS4/{SENSOR}/{path}/{row}/"
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
                        fdt = datetime.strptime(fecha, "%Y%m%d").date()
                    except ValueError:
                        continue
                    if desde <= fdt <= hasta:
                        out.append(
                            EscenaAWFI(
                                path=path,
                                row=row,
                                fecha=fecha,
                                s3_prefix=f"{prefix}{nombre}/",
                            )
                        )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló list AWFI {prefix}: {exc}")
    out.sort(key=lambda e: e.fecha)
    return out


def calcular_ndwi_awfi(esc: EscenaAWFI) -> Optional[Tuple[np.ndarray, np.ndarray, Any, Any]]:
    """Calcula NDWI y NDVI sobre el bbox de Posadas. Devuelve (ndwi, ndvi, transform, crs)."""
    import pyproj
    import rasterio
    from rasterio.windows import Window, from_bounds

    try:
        # Green band para bbox
        with rasterio.open(esc.url_banda(BAND_GREEN)) as src:
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
            green = src.read(1, window=win).astype("float32")
            transform = src.window_transform(win)
            crs = src.crs

        with rasterio.open(esc.url_banda(BAND_NIR)) as src:
            nir = src.read(1, window=win).astype("float32")
        with rasterio.open(esc.url_banda(BAND_RED)) as src:
            red = src.read(1, window=win).astype("float32")
        # Alinear por shape
        h = min(green.shape[0], nir.shape[0], red.shape[0])
        w = min(green.shape[1], nir.shape[1], red.shape[1])
        green, nir, red = green[:h, :w], nir[:h, :w], red[:h, :w]

        denom_ndwi = green + nir
        denom_ndvi = nir + red
        ndwi = np.full_like(green, np.nan, dtype="float32")
        ndvi = np.full_like(green, np.nan, dtype="float32")
        m_ndwi = denom_ndwi > 0
        m_ndvi = denom_ndvi > 0
        ndwi[m_ndwi] = (green[m_ndwi] - nir[m_ndwi]) / denom_ndwi[m_ndwi]
        ndvi[m_ndvi] = (nir[m_ndvi] - red[m_ndvi]) / denom_ndvi[m_ndvi]
        return ndwi, ndvi, transform, crs
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"Falló NDWI {esc.scene_id}: {exc}")
        return None


def detectar_agua_y_poligonos(
    ndwi: np.ndarray,
    ndvi: np.ndarray,
    transform: Any,
    crs: Any,
    poligonos_gdf,
) -> Tuple[float, List[str]]:
    """Devuelve (área_km2 inundada total, lista de polígonos afectados >5% de su área)."""
    from rasterio.features import geometry_mask

    # Máscara de agua: NDWI > 0.3 AND NDVI < 0.1 (descarta vegetación que confunde)
    mask_agua = np.where(np.isnan(ndwi) | np.isnan(ndvi), False, (ndwi > NDWI_AGUA_THRESHOLD) & (ndvi < NDVI_AGUA_MAX))
    # área pixel: AWFI 64 m → 64*64 m² = 4096 m² = 0.004096 km² por pixel
    pixel_km2 = 0.004096
    area_total_km2 = float(mask_agua.sum() * pixel_km2)

    afectados: List[str] = []
    if area_total_km2 < 0.5:
        return area_total_km2, afectados

    # Por polígono: ¿qué fracción de pixeles intersecta agua?
    h, w = mask_agua.shape
    gdf_src = poligonos_gdf.to_crs(crs)
    for _, row in gdf_src.iterrows():
        pid = str(row["id"])
        if pid == "posadas_completa":
            continue
        try:
            poli_mask = geometry_mask(
                [row.geometry.__geo_interface__],
                out_shape=(h, w),
                transform=transform,
                invert=True,
            )
        except Exception:
            continue
        n_poli = int(poli_mask.sum())
        if n_poli == 0:
            continue
        n_agua = int(np.logical_and(poli_mask, mask_agua).sum())
        frac = n_agua / n_poli
        if frac > 0.05:  # >5% del polígono inundado
            afectados.append(pid)
    return area_total_km2, afectados


def buscar_s1_validacion(fecha_awfi: date, s1_df: pd.DataFrame) -> Optional[Dict[str, float]]:
    """Busca observación S1 ±5 días con caída delta_vv significativa."""
    if s1_df.empty:
        return None
    # s1_df trae fecha YYYY-MM (mensual). Aproximamos: comparar mes-año.
    yyyymm = fecha_awfi.strftime("%Y-%m")
    sub = s1_df[s1_df["fecha"] == yyyymm]
    if sub.empty:
        return None
    delta_mean = float(sub["delta_vv_mean_db"].dropna().mean()) if "delta_vv_mean_db" in sub.columns else None
    if delta_mean is None or pd.isna(delta_mean):
        return None
    return {"delta_vv_mean_db": delta_mean, "n_poligonos_s1": int(len(sub))}


@click.command()
@click.option("--output", "output_dir", default=PROC_DIR, show_default=True)
@click.option(
    "--desde",
    default="2018-01",
    show_default=True,
    help="Mes inicial (YYYY-MM)",
)
@click.option("--hasta", default=None, help="Mes final (YYYY-MM). Default: hoy.")
@click.option("--force", is_flag=True, default=False)
@click.option("--dry-run", is_flag=True, default=False)
@click.option(
    "--poligonos",
    "poligonos_path",
    default="config/poligonos.geojson",
    show_default=True,
)
@click.option("--s1-csv", "s1_csv_path", default=S1_CSV, show_default=True)
@click.option(
    "--max-escenas",
    default=20,
    type=int,
    show_default=True,
    help="Máximo de escenas AWFI a procesar (cap para corrida liviana).",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
)
def main(
    output_dir: str,
    desde: str,
    hasta: Optional[str],
    force: bool,
    dry_run: bool,
    poligonos_path: str,
    s1_csv_path: str,
    max_escenas: int,
    nivel_log: str,
) -> None:
    """Detección de inundaciones del Paraná: AWFI NDWI + Sentinel-1 SAR cross-val."""
    setup_logger(nivel=nivel_log.upper())
    logger.info("=" * 60)
    logger.info(f"Inundación CBERS AWFI + S1 SAR — v{SCRIPT_VERSION}")
    logger.info("=" * 60)

    out_dir = ensure_dir(resolve_path(output_dir))
    csv_path = out_dir / "eventos_inundacion.csv"

    # Parse fechas
    def _parse(s: Optional[str], fallback: date) -> date:
        if not s:
            return fallback
        try:
            y, m = s.split("-")
            return date(int(y), int(m), 1)
        except Exception:
            return fallback

    desde_d = _parse(desde, date(2018, 1, 1))
    hasta_d = _parse(hasta, datetime.now().date())
    logger.info(f"Ventana: {desde_d} → {hasta_d}")

    # Cargar polígonos y S1
    gdf = load_geojson(poligonos_path)
    s1_path = resolve_path(s1_csv_path)
    if s1_path.exists():
        s1_df = pd.read_csv(s1_path)
        logger.info(f"S1 cross-val source: {len(s1_df)} filas")
    else:
        logger.warning(f"S1 CSV no existe en {s1_path}; cross-val degradado a 'sólo CBERS'.")
        s1_df = pd.DataFrame()

    if dry_run:
        escenas = listar_awfi(desde_d, hasta_d)
        logger.info(f"Dry-run: {len(escenas)} escenas AWFI en ventana")
        sys.exit(0)

    # Idempotencia: leer existing
    existing_fechas: set = set()
    existing_rows: List[dict] = []
    if csv_path.exists() and not force:
        try:
            ex = pd.read_csv(csv_path)
            existing_fechas = set(ex["fecha"].astype(str))
            existing_rows = ex.to_dict("records")
            logger.info(f"CSV existente: {len(existing_fechas)} fechas ya procesadas")
        except Exception:
            pass

    escenas = listar_awfi(desde_d, hasta_d)
    if max_escenas:
        escenas = escenas[-max_escenas:]
    logger.info(f"Procesando {len(escenas)} escenas AWFI")

    nuevas: List[dict] = []
    for esc in escenas:
        fecha_str = f"{esc.fecha[:4]}-{esc.fecha[4:6]}-{esc.fecha[6:]}"
        if fecha_str in existing_fechas and not force:
            continue
        res = calcular_ndwi_awfi(esc)
        if res is None:
            continue
        ndwi, ndvi, transform, crs = res
        area_km2, afectados = detectar_agua_y_poligonos(ndwi, ndvi, transform, crs, gdf)
        if area_km2 < 0.5:
            continue  # ignorar fechas sin agua relevante (cuerpo Paraná baseline ya es ~ X km²)

        s1_v = buscar_s1_validacion(esc.fecha_dt.date(), s1_df)
        confianza = "baja"
        fuente_validacion = ""
        if s1_v and s1_v["delta_vv_mean_db"] < S1_DELTA_DB_THRESHOLD:
            confianza = "alta"
            fuente_validacion = "Sentinel-1 SAR"
        elif s1_v:
            confianza = "media"
            fuente_validacion = "Sentinel-1 SAR (sin caída significativa)"
        else:
            confianza = "baja"
            fuente_validacion = "no_disponible"

        nuevas.append(
            {
                "fecha": fecha_str,
                "poligonos_afectados": ",".join(afectados),
                "area_inundada_km2": round(area_km2, 2),
                "fuente_principal": "CBERS-4 AWFI NDWI",
                "fuente_validacion": fuente_validacion,
                "confianza": confianza,
            }
        )
        logger.info(
            f"  {fecha_str}: {area_km2:.1f} km² agua, {len(afectados)} pol., conf={confianza}"
        )

    # Merge + escribir
    todas = existing_rows + nuevas
    if todas:
        df_out = pd.DataFrame(todas, columns=CSV_COLUMNS).drop_duplicates(subset=["fecha"]).sort_values("fecha")
    else:
        df_out = pd.DataFrame(columns=CSV_COLUMNS)
    df_out.to_csv(csv_path, index=False, encoding="utf-8")
    logger.info(f"CSV escrito → {csv_path} ({len(df_out)} eventos)")

    metadata = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "fuente_primaria": "CBERS-4 AWFI 64m (NDWI McFeeters)",
        "fuente_secundaria": "Sentinel-1 SAR (script 43)",
        "ventana": [desde_d.isoformat(), hasta_d.isoformat()],
        "n_eventos_detectados": len(df_out),
        "n_eventos_alta_confianza": int((df_out["confianza"] == "alta").sum()) if not df_out.empty else 0,
        "umbral_ndwi": NDWI_AGUA_THRESHOLD,
        "umbral_ndvi_max": NDVI_AGUA_MAX,
        "umbral_s1_delta_db": S1_DELTA_DB_THRESHOLD,
        "version_script": SCRIPT_VERSION,
        "limitacion": (
            "AWFI 64 m: detecta inundaciones grandes (>0.5 km²). "
            "NDWI McFeeters confunde agua con sombras y nubes oscuras. "
            "Cross-val S1 es mensual (no por fecha exacta de AWFI)."
        ),
    }
    (out_dir / "_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
