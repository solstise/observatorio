"""CBERS SWIR cross-validación FIRMS — script preparado, no operativo.

CBERS-4 IRS lleva 3 bandas SWIR (1.55-1.75 µm) a 80 m. Combinada con la
banda térmica TIR del mismo IRS, permite detectar fuegos activos
("hot spots") en complemento al producto FIRMS de la NASA (basado en
MODIS/VIIRS, ~1 km).

Estado real del dataset (verificado abril 2026)
-----------------------------------------------
Idéntico a ``45d_cbers_termico.py``: **el bucket público AWS Open Data
Registry NO expone CBERS-4 IRS**. La STAC pública del INPE tampoco. Las
imágenes IRS existen en el catálogo del INPE pero requieren registro y
descarga manual.

Como sin SWIR no podemos detectar fuegos por nuestra cuenta, este script
hace cross-validación **degenerada**: produce un CSV con schema correcto
donde ``n_focos_cbers_swir = 0`` y ``agreement_pct = NaN`` para todas las
filas, marcando `fuente_secundaria = "no_disponible"`.

Esto NO es engaño: es un placeholder honesto que mantiene el contrato de
schema con el resto del pipeline. Si en el futuro IRS se habilita, este
script se extiende para:

1. Descargar bandas SWIR + TIR del IRS L4 para cada mes-año.
2. Detectar firmas de fuego: SWIR alto + TIR alto = fuego activo
   (algoritmo similar a MODIS Fire: NDVI bajo, SWIR > umbral, TIR > umbral).
3. Cruzar coincidencias temporales (±2 días) y espaciales (~80 m) con
   ``data/processed/ambiental/firms_anual.csv``.
4. ``agreement_pct = 100 * matches / max(n_firms, n_cbers)`` por barrio-año.

Output schema (objetivo)
------------------------
``data/processed/cbers_swir/firms_crossval_anual.csv`` con columnas:

- ``poligono_id``: slug del barrio.
- ``anio``: int.
- ``n_focos_firms``: cantidad de detecciones FIRMS (script 47).
- ``n_focos_cbers_swir``: cantidad de detecciones CBERS SWIR.
- ``n_coincidencias``: ambas fuentes detectaron en ±2 días.
- ``agreement_pct``: float 0-100 o NaN.
- ``fuente_secundaria``: "cbers_irs_swir" si operativo, "no_disponible" si no.

Uso
---
::

    # Modo normal: produce CSV degenerate con n_focos_cbers_swir=0
    python scripts/45e_cbers_swir.py

    # Dry-run: solo verifica accesibilidad
    python scripts/45e_cbers_swir.py --dry-run
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
import sys
from datetime import datetime
from typing import List

import click
import pandas as pd
from loguru import logger

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

PROC_DIR = "data/processed/cbers_swir"
FIRMS_CSV_DEFAULT = "data/processed/ambiental/firms_anual.csv"

CSV_COLUMNS = [
    "poligono_id",
    "anio",
    "n_focos_firms",
    "n_focos_cbers_swir",
    "n_coincidencias",
    "agreement_pct",
    "fuente_secundaria",
]


def _verificar_irs_disponible() -> bool:
    """Igual que 45d: chequea si IRS aparece en AWS o STAC."""
    try:
        import boto3
        from botocore import UNSIGNED
        from botocore.config import Config

        s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name="us-west-2")
        resp = s3.list_objects_v2(
            Bucket="brazil-eosats", Prefix="CBERS4/IRS/", Delimiter="/", MaxKeys=5
        )
        return len(resp.get("CommonPrefixes", []) or []) > 0
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"AWS check falló: {exc}")
        return False


@click.command()
@click.option("--output", "output_dir", default=PROC_DIR, show_default=True)
@click.option("--firms-csv", "firms_csv", default=FIRMS_CSV_DEFAULT, show_default=True)
@click.option("--dry-run", is_flag=True, default=False)
@click.option("--force", is_flag=True, default=False, help="No-op (compat con cron).")
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
)
def main(
    output_dir: str,
    firms_csv: str,
    dry_run: bool,
    force: bool,
    nivel_log: str,
) -> None:
    """Cross-val SWIR-FIRMS — placeholder honesto mientras IRS no esté accesible."""
    setup_logger(nivel=nivel_log.upper())
    logger.info("=" * 60)
    logger.info(f"CBERS SWIR cross-val FIRMS — v{SCRIPT_VERSION}")
    logger.info("=" * 60)

    irs_disp = _verificar_irs_disponible()
    logger.info(f"CBERS-4 IRS disponible vía API anónima: {irs_disp}")

    if dry_run:
        logger.info("Dry-run: este script intentaría:")
        logger.info("  1) descargar bandas SWIR + TIR del IRS por mes-año")
        logger.info("  2) detectar fuegos activos (SWIR alto + TIR alto)")
        logger.info("  3) cruzar coincidencias ±2 días con FIRMS")
        logger.info(f"  4) escribir CSV con schema {CSV_COLUMNS}")
        sys.exit(0)

    out_dir = ensure_dir(resolve_path(output_dir))

    # Si IRS no está disponible: producir CSV degenerate consistente con FIRMS.
    firms_path = resolve_path(firms_csv)
    if not firms_path.exists():
        logger.warning(f"FIRMS CSV no existe en {firms_path}. Escribo CSV vacío (sólo header).")
        out_csv = out_dir / "firms_crossval_anual.csv"
        out_csv.write_text(",".join(CSV_COLUMNS) + "\n", encoding="utf-8")
    else:
        firms = pd.read_csv(firms_path)
        logger.info(f"FIRMS source: {len(firms)} filas")
        rows: List[dict] = []
        for _, r in firms.iterrows():
            rows.append(
                {
                    "poligono_id": r.get("poligono_id"),
                    "anio": r.get("anio"),
                    "n_focos_firms": int(float(r.get("n_focos") or 0)),
                    "n_focos_cbers_swir": 0,  # IRS no disponible
                    "n_coincidencias": 0,
                    "agreement_pct": float("nan"),
                    "fuente_secundaria": ("cbers_irs_swir" if irs_disp else "no_disponible"),
                }
            )
        df_out = pd.DataFrame(rows, columns=CSV_COLUMNS)
        out_csv = out_dir / "firms_crossval_anual.csv"
        df_out.to_csv(out_csv, index=False, encoding="utf-8")
        logger.info(f"CSV escrito → {out_csv} ({len(df_out)} filas)")

    metadata = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sensor": "CBERS-4 IRS SWIR (3 bandas) + TIR",
        "estado": (
            "no_disponible_via_api_anonima" if not irs_disp else "disponible_pero_no_implementado"
        ),
        "razon": (
            "Bucket s3://brazil-eosats no expone CBERS-4 IRS. STAC INPE "
            "tampoco. Sólo PAN5M/PAN10M/MUX/AWFI están en AWS abierto."
        ),
        "fuente_primaria_actual": "FIRMS NASA (MODIS+VIIRS) via script 47",
        "schema_csv": CSV_COLUMNS,
        "version_script": SCRIPT_VERSION,
        "limitacion_metodologica": (
            "Sin SWIR ni TIR de CBERS, no podemos cross-validar FIRMS de "
            "forma independiente. La AWFI tiene NIR pero no SWIR ni TIR — "
            "para fuegos activos NIR alone no alcanza."
        ),
    }
    (out_dir / "_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info(
        "OK — script terminó. SWIR cross-val permanecerá degenerate hasta que IRS sea accesible."
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
