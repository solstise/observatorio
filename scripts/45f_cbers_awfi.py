"""CBERS-4 AWFI 64 m revisita 5 días — composite multi-fuente con Sentinel-2.

CBERS-4 AWFI (Advanced Wide Field Imager) es el "barredor ancho":
- 64 m/pixel (Posadas entera entra holgada)
- 866 km de swath
- **Revisita 5 días** (¡comparable a Sentinel-2!)
- 4 bandas: BAND13=blue, BAND14=green, BAND15=red, BAND16=NIR

Cuando Sentinel-2 está nublado el día de su pasada, AWFI puede tener
imagen útil 1-2 días antes/después. Combinando ambos en un composite
multi-fuente la cobertura útil mensual sube significativamente.

Fuente
------
``s3://brazil-eosats/CBERS4/AWFI/{path}/{row}/`` (AWS Open Data, anónimo).
La AWFI tiene un footprint enorme (~9 grados ancho); los path/row que
"tocan" Posadas son **163/129** (tile completo cubre Posadas dentro).

Verificación bounds (lonlat) AWFI 163/129:
    (-60.87, -29.99, -49.84, -21.54) → Posadas (-55.90, -27.37) dentro

Métrica generada
----------------
Cobertura mensual **comparativa** entre fuentes ópticas:

    data/processed/cbers_awfi/cobertura_mensual.csv

Columnas:
- ``mes``: YYYY-MM
- ``n_obs_s2``: cantidad de imágenes S2 disponibles ese mes (de Earth Engine).
- ``n_obs_awfi``: cantidad de escenas AWFI ese mes (de S3).
- ``n_obs_total``: suma sin doble conteo de fechas.
- ``gap_dias_max``: gap máximo entre observaciones consecutivas.
- ``mejora_pct_awfi``: porcentaje de aumento al sumar AWFI a S2 sólo.

Idempotencia
------------
Si el CSV ya tiene los meses 2018-01 hasta el mes anterior al actual,
sólo agrega los meses faltantes (los recientes). Con ``--force`` reescribe
todo.

Limitaciones a comunicar
------------------------
- AWFI no es estrictamente equivalente a S2: 64 m vs 10 m, 4 bandas vs
  13. Para análisis fino siempre se prefiere S2; AWFI cubre el "hueco"
  cuando hay nubes.
- El conteo de "imágenes disponibles" es bruto (presence/absence). Para
  saber si la imagen es **utilizable** habría que aplicar filtros de
  nubes — eso queda para Fase 2.
- **No descargamos las AWFI** en este script: la métrica viene de
  metadata S3 + STAC INPE. Una versión futura podría descargar +
  recortar para análisis de cambios.

Uso
---
::

    # corrida normal (mes corriente y los 12 anteriores)
    python scripts/45f_cbers_awfi.py

    # rango personalizado
    python scripts/45f_cbers_awfi.py --desde 2018-01 --hasta 2026-04

    # forzar recálculo total
    python scripts/45f_cbers_awfi.py --force
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

import calendar
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import click
import pandas as pd
from loguru import logger

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path


SCRIPT_VERSION = "0.1.0"

S3_BUCKET = "brazil-eosats"
S3_REGION = "us-west-2"
PROC_DIR = "data/processed/cbers_awfi"

# AWFI: path/row que cubre Posadas (verificado contra bounds reales)
AWFI_PATH_ROWS: List[Tuple[str, str]] = [
    ("163", "129"),
    ("164", "129"),
    ("165", "129"),
]


# ---------------------------------------------------------------------------
# Listado AWFI desde S3
# ---------------------------------------------------------------------------


def _s3_client():
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    return boto3.client(
        "s3", config=Config(signature_version=UNSIGNED), region_name=S3_REGION
    )


def listar_awfi_fechas(desde: date, hasta: date) -> List[Tuple[str, str, str]]:
    """Lista (path, row, YYYYMMDD) de escenas AWFI en bucket dentro de [desde, hasta].

    Cada escena AWFI tiene un único directorio por fecha-path-row con
    nombre ``CBERS_4_AWFI_{YYYYMMDD}_{path}_{row}_L4``.
    """
    s3 = _s3_client()
    fechas: List[Tuple[str, str, str]] = []
    for path, row in AWFI_PATH_ROWS:
        prefix = f"CBERS4/AWFI/{path}/{row}/"
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
                        fechas.append((path, row, fecha))
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló list AWFI {prefix}: {exc}")
    # dedup por (path, row, fecha) y ordenar
    fechas = sorted(set(fechas))
    return fechas


# ---------------------------------------------------------------------------
# Conteo Sentinel-2 por mes (Earth Engine)
# ---------------------------------------------------------------------------


def listar_s2_fechas_ee(desde: date, hasta: date) -> List[date]:
    """Cuenta imágenes S2 SR mensuales sobre el bbox de Posadas via Earth Engine.

    Si Earth Engine no está disponible (sin credenciales en este entorno),
    devuelve lista vacía y el composite degenera a "sólo AWFI".
    """
    try:
        import ee
    except ImportError:
        logger.warning("earthengine-api no instalado; n_obs_s2=0 por defecto.")
        return []

    try:
        # Inicializar EE — usamos service account si está definido en env
        import os
        sa_key = os.environ.get("EE_SERVICE_ACCOUNT_KEY")
        if sa_key and Path(sa_key).exists():
            credentials = ee.ServiceAccountCredentials(None, sa_key)
            ee.Initialize(credentials)
        else:
            ee.Initialize()
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"EE no inicializado (n_obs_s2=0): {exc}")
        return []

    bbox = ee.Geometry.Rectangle([-56.05, -27.51, -55.80, -27.30])
    col = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterDate(desde.isoformat(), (hasta).isoformat())
        .filterBounds(bbox)
    )
    try:
        # Reduce a una lista de fechas únicas
        fechas_ms = (
            col.aggregate_array("system:time_start").getInfo() or []
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Falló aggregate fechas S2: {exc}")
        return []

    fechas: List[date] = []
    for ms in fechas_ms:
        try:
            d = datetime.utcfromtimestamp(ms / 1000.0).date()
            if desde <= d <= hasta:
                fechas.append(d)
        except Exception:
            continue
    return sorted(set(fechas))


# ---------------------------------------------------------------------------
# Composite mensual
# ---------------------------------------------------------------------------


def construir_composite_mensual(
    awfi_dates: List[Tuple[str, str, str]],
    s2_dates: List[date],
    desde: date,
    hasta: date,
) -> pd.DataFrame:
    """Para cada mes en el rango, cuenta n_obs por fuente y calcula gap_dias_max."""
    rows = []
    cur = date(desde.year, desde.month, 1)
    while cur <= hasta:
        ult_dia = calendar.monthrange(cur.year, cur.month)[1]
        fin = date(cur.year, cur.month, ult_dia)
        if fin > hasta:
            fin = hasta

        s2_mes = sorted([d for d in s2_dates if cur <= d <= fin])
        awfi_mes_dates = sorted(
            {
                datetime.strptime(fecha, "%Y%m%d").date()
                for (_p, _r, fecha) in awfi_dates
                if cur <= datetime.strptime(fecha, "%Y%m%d").date() <= fin
            }
        )

        union = sorted(set(s2_mes) | set(awfi_mes_dates))
        n_obs_total = len(union)

        # gap_dias_max: máxima distancia consecutiva entre fechas
        if len(union) >= 2:
            gaps = [(union[i + 1] - union[i]).days for i in range(len(union) - 1)]
            gap_max = max(gaps)
        elif len(union) == 1:
            gap_max = (fin - cur).days
        else:
            gap_max = (fin - cur).days

        # mejora_pct_awfi: incremento al sumar AWFI
        n_s2 = len(s2_mes)
        n_awfi = len(awfi_mes_dates)
        if n_s2 > 0:
            mejora_pct = round(100.0 * (n_obs_total - n_s2) / n_s2, 1)
        elif n_awfi > 0:
            mejora_pct = 100.0  # solo AWFI = ganancia infinita expresada como 100%
        else:
            mejora_pct = 0.0

        rows.append(
            {
                "mes": cur.strftime("%Y-%m"),
                "n_obs_s2": n_s2,
                "n_obs_awfi": n_awfi,
                "n_obs_total": n_obs_total,
                "gap_dias_max": int(gap_max),
                "mejora_pct_awfi": float(mejora_pct),
            }
        )
        # avanzar mes
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_yyyymm(s: str, fallback: date) -> date:
    """Parsea YYYY-MM a primer día del mes."""
    try:
        y, m = s.split("-")
        return date(int(y), int(m), 1)
    except Exception:
        return fallback


@click.command()
@click.option("--output", "output_dir", default=PROC_DIR, show_default=True)
@click.option(
    "--desde",
    default="2018-01",
    show_default=True,
    help="Mes inicial inclusivo (YYYY-MM)",
)
@click.option(
    "--hasta",
    default=None,
    help="Mes final inclusivo. Default: mes corriente.",
)
@click.option("--force", is_flag=True, default=False)
@click.option("--dry-run", is_flag=True, default=False)
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
    nivel_log: str,
) -> None:
    """CBERS-4 AWFI cobertura multi-fuente mensual."""
    setup_logger(nivel=nivel_log.upper())
    logger.info("=" * 60)
    logger.info(f"CBERS-4 AWFI cobertura multi-fuente — v{SCRIPT_VERSION}")
    logger.info("=" * 60)

    desde_d = _parse_yyyymm(desde, date(2018, 1, 1))
    hasta_d = _parse_yyyymm(hasta, datetime.now().date()) if hasta else datetime.now().date()
    logger.info(f"Ventana: {desde_d.isoformat()} → {hasta_d.isoformat()}")

    out_dir = ensure_dir(resolve_path(output_dir))
    csv_path = out_dir / "cobertura_mensual.csv"

    # Idempotencia: si CSV existe, sólo recalculamos los meses recientes (últimos 3)
    if csv_path.exists() and not force:
        try:
            existing = pd.read_csv(csv_path)
            ultimo_mes = existing["mes"].max()
            logger.info(f"CSV existente con último mes {ultimo_mes}; sólo recalculo desde ahí.")
            try:
                y, m = ultimo_mes.split("-")
                desde_d = date(int(y), int(m), 1)
            except Exception:
                pass
        except Exception:
            existing = None
    else:
        existing = None

    if dry_run:
        logger.info("Dry-run: este script consultaría:")
        logger.info(f"  - S3 AWFI {AWFI_PATH_ROWS} entre {desde_d} y {hasta_d}")
        logger.info(f"  - Earth Engine S2_SR_HARMONIZED para mismas fechas")
        logger.info(f"  - escribiría → {csv_path}")
        sys.exit(0)

    # Listado AWFI
    logger.info("Listando escenas AWFI en S3 ...")
    awfi_fechas = listar_awfi_fechas(desde_d, hasta_d)
    logger.info(f"  → {len(awfi_fechas)} escenas AWFI encontradas")

    # Listado S2 vía EE (best-effort)
    logger.info("Listando S2 vía Earth Engine ...")
    s2_fechas = listar_s2_fechas_ee(desde_d, hasta_d)
    logger.info(f"  → {len(s2_fechas)} imágenes S2 encontradas")

    # Composite mensual
    df_new = construir_composite_mensual(awfi_fechas, s2_fechas, desde_d, hasta_d)
    logger.info(f"Composite mensual: {len(df_new)} filas")

    # Merge con existente
    if existing is not None and not existing.empty:
        # filtrar las filas viejas que ya recalculamos
        meses_nuevos = set(df_new["mes"])
        existing = existing[~existing["mes"].isin(meses_nuevos)]
        df_final = pd.concat([existing, df_new], ignore_index=True).sort_values("mes")
    else:
        df_final = df_new.sort_values("mes")

    df_final.to_csv(csv_path, index=False, encoding="utf-8")
    logger.info(f"CSV escrito → {csv_path} ({len(df_final)} filas totales)")

    # Métricas resumen para metadata
    if not df_final.empty:
        total_s2 = int(df_final["n_obs_s2"].sum())
        total_awfi = int(df_final["n_obs_awfi"].sum())
        total = int(df_final["n_obs_total"].sum())
        # cobertura: meses con >=1 obs / total meses
        meses_con_obs_s2 = int((df_final["n_obs_s2"] > 0).sum())
        meses_con_obs_total = int((df_final["n_obs_total"] > 0).sum())
        n_meses = len(df_final)
        cob_s2 = round(100.0 * meses_con_obs_s2 / max(n_meses, 1), 1)
        cob_total = round(100.0 * meses_con_obs_total / max(n_meses, 1), 1)
    else:
        total_s2 = total_awfi = total = 0
        cob_s2 = cob_total = 0.0

    metadata = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sensor": "CBERS-4 AWFI 64 m + Sentinel-2 SR",
        "rango": [desde_d.isoformat(), hasta_d.isoformat()],
        "n_meses": len(df_final),
        "total_obs_s2": total_s2,
        "total_obs_awfi": total_awfi,
        "total_obs_total": total,
        "cobertura_pct_s2_solo": cob_s2,
        "cobertura_pct_con_awfi": cob_total,
        "mejora_absoluta_pct": round(cob_total - cob_s2, 1),
        "fuente_s2": "Earth Engine COPERNICUS/S2_SR_HARMONIZED",
        "fuente_awfi": "AWS s3://brazil-eosats/CBERS4/AWFI/",
        "version_script": SCRIPT_VERSION,
        "limitacion": (
            "Conteo bruto de imágenes disponibles, sin filtrar nubes. "
            "Para utilización real habría que correr cloud-mask por escena."
        ),
    }
    (out_dir / "_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    logger.info("=" * 60)
    logger.info(
        f"Cobertura S2 sola: {cob_s2}% | con AWFI: {cob_total}% | mejora: +{round(cob_total - cob_s2, 1)} pp"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
