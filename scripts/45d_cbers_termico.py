"""CBERS-4 IRS térmico — backup de UHI (script preparado, no operativo).

CBERS-4 lleva el sensor **IRS (InfraRed Multispectral Scanner)** con una
banda térmica (TIR) de **40 m**. La idea original era usarlo como
**complemento** del Landsat (script 49) cuando éste tiene gaps por nubes.

Estado real del dataset (verificado abril 2026)
-----------------------------------------------
**El bucket público AWS Open Data Registry ``s3://brazil-eosats/`` NO
expone CBERS-4 IRS.** Solo expone PAN5M, PAN10M, MUX y AWFI.

La STAC pública del INPE (``https://www.dgi.inpe.br/lgi-stac``) tampoco
incluye colecciones IRS — solo CBERS-4{,A} {PAN5M,PAN10M,MUX,WPM,WFI,AWFI}.

Las imágenes IRS existen en el catálogo del INPE
(``http://www.dgi.inpe.br/CDSR/`` o explorer.dgi.inpe.br) pero requieren:

1. Registro/login con email institucional.
2. Pedido de download manual o vía script con cookies de sesión.
3. Sin SLA público — la API de explorer cambió varias veces.

Por eso este script **NO descarga datos**: deja:

- ``data/processed/cbers_termico/lst_cbers_mensual.csv`` con el header
  exacto que el script 49 espera (vacío de filas pero válido como CSV)
  para que el merge en ``49_calor_pipeline.py`` no rompa.
- ``data/processed/cbers_termico/_metadata.json`` con el motivo (catálogo
  no accesible vía API anónima).

Si en el futuro se obtiene un mecanismo de descarga IRS (vía registro
INPE, USGS EarthExplorer mirror, o un nuevo bucket abierto), este script
puede extenderse para:

1. Buscar escenas IRS L4 que cubran path/row Posadas (probable 156-157 / 110-115).
2. Convertir DN → radiancia → temperatura aparente con factores oficiales
   IRS (calibración del sensor; NO los mismos coeficientes que Landsat).
3. Aplicar máscara de nubes (banda QA si la trae, o composite).
4. Stats por polígono (urbanos + rurales) → CSV con schema:
   ``poligono_id, anio, mes, lst_mean_cbers, n_pixeles, fecha_pasada, calidad``.
5. ``calidad`` ∈ {alta, media, baja} para que el merge del script 49
   priorice "alta" cuando Landsat tiene < 30% válidos.

Uso
---
::

    # Modo normal: escribe CSV vacío (compatible con script 49) + metadata.
    python scripts/45d_cbers_termico.py

    # Dry-run: lista qué intentaría hacer si IRS estuviera accesible.
    python scripts/45d_cbers_termico.py --dry-run

Conformidad con el pipeline de calor
------------------------------------
``49_calor_pipeline.py`` ya está preparado para mergear con CBERS térmico:
- ``--fuente cbers``: usa solo CBERS.
- ``--fuente merged`` (default): Landsat preferido; cae a CBERS donde
  Landsat tenga ``pct_validos < 30%``. La columna ``calidad`` ∈ {alta,
  media} se acepta como reemplazo válido.

Mientras este script no produzca filas, el merge degrada gracefully a
"sólo Landsat" (que es el comportamiento actual desde 2018).

Limitación crítica a comunicar
------------------------------
La revisita de CBERS-4 es 26 días. Aunque el sensor IRS estuviera
accesible mañana, NO sería un reemplazo continuo de Landsat (revisita 16
días). Sería un complemento útil cuando ambos coinciden con cielo claro.
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
import urllib.request
from datetime import datetime

import click
from loguru import logger

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

PROC_DIR = "data/processed/cbers_termico"

# Header esperado por scripts/49_calor_pipeline.py (CBERS_TERMICO_CSV_DEFAULT)
CSV_COLUMNS = [
    "poligono_id",
    "anio",
    "mes",
    "lst_mean_cbers",
    "n_pixeles",
    "fecha_pasada",
    "calidad",
]

# STAC INPE — para chequear si IRS aparece en el futuro
STAC_BASE = "https://www.dgi.inpe.br/lgi-stac"


def _verificar_stac_irs() -> dict:
    """Chequea si la STAC INPE expone alguna colección IRS.

    Hoy (abril 2026) la respuesta es no. Si en el futuro aparece, este
    script puede empezar a descargar.
    """
    info = {
        "stac_base": STAC_BASE,
        "buscaba_colecciones": ["CBERS4_IRS_L2_DN", "CBERS4_IRS_L4_DN"],
        "encontradas": [],
    }
    try:
        with urllib.request.urlopen(f"{STAC_BASE}/collections", timeout=15) as resp:
            data = json.load(resp)
        cols = [c.get("id", "") for c in data.get("collections", [])]
        info["encontradas"] = [c for c in cols if "IRS" in c.upper()]
        info["total_colecciones_stac"] = len(cols)
    except Exception as exc:  # noqa: BLE001
        info["error_stac"] = str(exc)
    return info


def _verificar_aws_irs() -> dict:
    """Chequea si el bucket AWS expone una carpeta IRS."""
    info = {"bucket": "brazil-eosats", "found": False}
    try:
        import boto3
        from botocore import UNSIGNED
        from botocore.config import Config

        s3 = boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name="us-west-2")
        # Hay tres satélites top: AMAZONIA1, CBERS4, CBERS4A. Si IRS apareciera, sería bajo CBERS4/IRS/.
        resp = s3.list_objects_v2(
            Bucket="brazil-eosats", Prefix="CBERS4/IRS/", Delimiter="/", MaxKeys=5
        )
        n = len(resp.get("CommonPrefixes", []) or [])
        info["found"] = n > 0
        info["n_path_prefixes"] = n
    except Exception as exc:  # noqa: BLE001
        info["error_aws"] = str(exc)
    return info


@click.command()
@click.option("--output", "output_dir", default=PROC_DIR, show_default=True)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="No escribe CSV ni metadata; sólo verifica accesibilidad de IRS.",
)
@click.option("--force", is_flag=True, default=False, help="No-op (compat con cron).")
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
)
def main(output_dir: str, dry_run: bool, force: bool, nivel_log: str) -> None:
    """CBERS-4 IRS térmico — placeholder mientras el dataset no esté accesible vía API anónima."""
    setup_logger(nivel=nivel_log.upper())
    logger.info("=" * 60)
    logger.info(f"CBERS-4 IRS térmico — v{SCRIPT_VERSION} (script preparado, sin datos)")
    logger.info("=" * 60)

    stac_info = _verificar_stac_irs()
    aws_info = _verificar_aws_irs()

    logger.info(f"STAC INPE colecciones IRS encontradas: {stac_info.get('encontradas')}")
    logger.info(f"AWS s3://brazil-eosats/CBERS4/IRS/ found: {aws_info.get('found')}")

    if stac_info.get("encontradas") or aws_info.get("found"):
        logger.warning(
            "¡IRS apareció en algún catálogo! Este script todavía no implementa "
            "la descarga — extender ``_descargar_irs`` siguiendo los TODOs."
        )

    if dry_run:
        logger.info("Dry-run: este script intentaría:")
        logger.info("  1) listar escenas IRS L4 path/row Posadas (~156-157/110-115)")
        logger.info("  2) leer banda térmica TIR (DN) recortada")
        logger.info("  3) aplicar calibración IRS DN → Kelvin → Celsius")
        logger.info("  4) máscara de nubes (banda QA si está)")
        logger.info("  5) stats LST por polígono → CSV con schema:")
        logger.info(f"     {CSV_COLUMNS}")
        logger.info("Como IRS no está en AWS Open Data ni en STAC INPE, no se descargó nada.")
        sys.exit(0)

    # Modo normal: escribir CSV vacío (header) + metadata para que el merge no rompa.
    out_dir = ensure_dir(resolve_path(output_dir))
    csv_path = out_dir / "lst_cbers_mensual.csv"
    csv_path.write_text(",".join(CSV_COLUMNS) + "\n", encoding="utf-8")
    logger.info(f"CSV vacío con header escrito → {csv_path} (compatible con script 49)")

    metadata = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sensor": "CBERS-4 IRS",
        "estado": "no_disponible_via_api_anonima",
        "razon": (
            "El bucket s3://brazil-eosats no expone CBERS-4 IRS (sólo "
            "PAN5M/PAN10M/MUX/AWFI). La STAC INPE tampoco lo incluye. "
            "Acceso requiere registro y descarga manual desde el catálogo "
            "INPE (http://www.dgi.inpe.br/CDSR/)."
        ),
        "verificacion_stac": stac_info,
        "verificacion_aws": aws_info,
        "schema_csv_objetivo": CSV_COLUMNS,
        "version_script": SCRIPT_VERSION,
        "que_pasa_con_el_merge_de_calor": (
            "scripts/49_calor_pipeline.py acepta CSV vacío y degrada a "
            "modo solo-Landsat. UHI sigue calculándose normalmente."
        ),
        "limitacion_aunque_estuviera_disponible": (
            "Revisita CBERS-4 26 días. Sería complemento de Landsat, no "
            "reemplazo. Solo aporta meses con <30% válidos en Landsat y "
            "donde IRS coincida con cielo claro."
        ),
    }
    (out_dir / "_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    logger.info(f"Metadata escrita → {out_dir / '_metadata.json'}")
    logger.info("OK — script terminó sin errores. CBERS térmico permanecerá no operativo.")
    sys.exit(0)


if __name__ == "__main__":
    main()
