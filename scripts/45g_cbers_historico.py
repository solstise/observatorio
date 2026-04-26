"""Series temporales históricas CBERS — 1999-2013 NO disponible vía AWS.

La idea original era extender la serie del observatorio hacia atrás
(antes de 2014) usando CBERS-1 (1999-2003), CBERS-2 (2003-2010),
CBERS-2B (2007-2010) y CBERS-4 (desde 2014).

Estado real del dataset (verificado abril 2026)
-----------------------------------------------
**El bucket público AWS Open Data Registry sólo expone CBERS-4 (≥ 2014)
y CBERS-4A (≥ 2019).** No hay CBERS-1, CBERS-2 ni CBERS-2B en el bucket.

La STAC pública del INPE tampoco incluye colecciones CBERS-1/2/2B —
sólo CBERS-4{,A}.

Fechas mínimas verificadas en el bucket AWS (path/row 163/130 Posadas):
- CBERS-4 PAN5M: **20141215** → primer mes operativo
- CBERS-4 PAN10M: **20150424**
- CBERS-4 MUX: **20150110**

Para acceder al archivo CBERS-1/2/2B hay dos caminos:

1. **INPE CDSR** (http://www.dgi.inpe.br/CDSR/): catálogo histórico con
   CBERS-1/2/2B. Requiere registro con email y descarga manual o vía
   formulario. La API ha cambiado varias veces; sin SLA público.
2. **USGS EarthExplorer** (https://earthexplorer.usgs.gov/): mirror
   parcial de CBERS-2 ETM. Requiere login y descarga interactiva.

Ninguno de los dos es accesible vía API anónima desde un cron, por eso
este script:

- En modo normal: extiende la serie con **CBERS-4 PAN10M** (10 m, 2015+)
  porque es el sensor histórico CBERS más fino disponible vía AWS — una
  imagen por año, generando PNG 1200 px y CSV de provenance.
- En ``--dry-run``: imprime qué intentaría buscar si CBERS-1/2/2B fuera
  accesible (path/row aproximados, fuentes alternativas).

Output
------
- ``data/processed/cbers_historico/{anio}_posadas.png`` (uno por año
  2015-actual, 1200 px, escala de grises del PAN10M).
- ``data/processed/cbers_historico/serie_temporal_extendida.csv`` con
  columnas:
  ``anio, fuente_satelite, fecha_imagen, n_poligonos_cubiertos,
  calidad`` donde ``calidad`` ∈ {"alta" (CBERS-4), "preliminar" (CBERS
  pre-2014, no disponible hoy)}.

Limitación a comunicar (importante)
-----------------------------------
La serie pre-2014 NO se incluye porque el dataset no es accesible. Si
en el futuro INPE habilita una API anónima sobre el archivo histórico,
este script puede extenderse sin tocar el resto del pipeline.

NO se cron-eja
--------------
Este script NO va en el cron mensual. Corre 1 vez bajo
``workflow_dispatch`` manual cuando se quiera regenerar la serie.
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
import shutil
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import click
import pandas as pd
from loguru import logger

from scripts.utils.io_geo import cache_check, load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path


SCRIPT_VERSION = "0.1.0"

S3_BUCKET = "brazil-eosats"
S3_REGION = "us-west-2"
S3_BASE_URL = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com"

PROC_DIR = "data/processed/cbers_historico"
RAW_DIR = "data/raw/cbers_historico"
PNG_WIDTH = 1200

POSADAS_BBOX_4326 = (-56.05, -27.51, -55.80, -27.30)

# Path/row CBERS-4 PAN10M para Posadas (verificado)
PATH_ROW = ("163", "131")  # 163/131 cubre desde -56.046 hasta -55.140 lon → Posadas adentro
SENSOR = "PAN10M"
BANDA = "BAND2"  # PAN10M trae BAND2/3/4; B2=verde funciona como pancromática proxy

CSV_COLUMNS = [
    "anio",
    "fuente_satelite",
    "fecha_imagen",
    "n_poligonos_cubiertos",
    "calidad",
]


@dataclass
class EscenaAnual:
    anio: int
    fecha: str  # YYYYMMDD
    s3_prefix: str
    sensor: str = SENSOR

    @property
    def scene_id(self) -> str:
        return f"CBERS_4_{self.sensor}_{self.fecha}_{PATH_ROW[0]}_{PATH_ROW[1]}_L2"

    @property
    def url_banda(self) -> str:
        return f"{S3_BASE_URL}/{self.s3_prefix}{self.scene_id}_{BANDA}.tif"


def _s3_client():
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    return boto3.client(
        "s3", config=Config(signature_version=UNSIGNED), region_name=S3_REGION
    )


def listar_escenas_por_anio() -> Dict[int, List[EscenaAnual]]:
    """Lista escenas PAN10M para path/row Posadas, agrupadas por año."""
    s3 = _s3_client()
    path, row = PATH_ROW
    prefix = f"CBERS4/{SENSOR}/{path}/{row}/"

    por_anio: Dict[int, List[EscenaAnual]] = defaultdict(list)
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
                    fdt = datetime.strptime(fecha, "%Y%m%d")
                except ValueError:
                    continue
                e = EscenaAnual(
                    anio=fdt.year,
                    fecha=fecha,
                    s3_prefix=f"{prefix}{nombre}/",
                )
                por_anio[fdt.year].append(e)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló list S3 {prefix}: {exc}")
    # Orden por fecha dentro de cada año
    for k in por_anio:
        por_anio[k].sort(key=lambda e: e.fecha)
    return por_anio


def descargar_pan_recortado(esc: EscenaAnual, destino: Path) -> bool:
    """Descarga la banda PAN recortada al bbox de Posadas."""
    import pyproj
    import rasterio
    from rasterio.windows import Window, from_bounds

    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        with rasterio.open(esc.url_banda) as src:
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
                logger.error(f"Ventana vacía para {esc.scene_id}")
                return False
            arr = src.read(1, window=win)
            # Validez del recorte: la escena nominalmente cubre Posadas pero
            # el rectángulo del path/row puede caer en el borde y dejar el
            # bbox con casi todos píxeles nulos (no-data o agua flat). Si
            # >97% del área es 0, descartamos la escena para que el retry
            # pruebe la siguiente.
            import numpy as np
            n_total = int(arr.size)
            n_validos = int((arr > 0).sum())
            if n_total > 0 and n_validos / n_total < 0.03:
                logger.warning(
                    f"  {esc.scene_id}: recorte mayormente vacío ({n_validos}/{n_total} píxeles), descartando"
                )
                return False
            # Filtro de saturación: una escena con >70% de píxeles en el
            # tope (255) suele ser nube densa o sobre-exposición. El
            # stretch p2-p98 colapsa a una imagen plana inutilizable, así
            # que descartamos.
            if n_validos > 0:
                validos = arr[arr > 0]
                pct_saturados = float((validos >= 250).sum()) / float(n_validos)
                if pct_saturados > 0.7:
                    logger.warning(
                        f"  {esc.scene_id}: {pct_saturados*100:.0f}% píxeles saturados (probable nube), descartando"
                    )
                    return False
            transform = src.window_transform(win)
            meta = src.meta.copy()
            meta.update(
                {
                    "height": win.height,
                    "width": win.width,
                    "transform": transform,
                    "count": 1,
                    "compress": "deflate",
                    "tiled": True,
                    "blockxsize": 256,
                    "blockysize": 256,
                }
            )
            with rasterio.open(destino, "w", **meta) as dst:
                dst.write(arr, 1)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error(f"  Falló descarga {esc.scene_id}: {exc}")
        return False


def generar_png_anual(tif_path: Path, png_path: Path) -> bool:
    """Genera PNG 1200 px en escala de grises stretch p2-p98 a partir del TIFF PAN."""
    import numpy as np
    import rasterio
    from PIL import Image

    try:
        with rasterio.open(tif_path) as src:
            arr = src.read(1)
        valid = arr[arr > 0]
        if valid.size == 0:
            return False
        p2 = float(np.percentile(valid, 2))
        p98 = float(np.percentile(valid, 98))
        if p98 - p2 < 1e-6:
            gris = np.zeros_like(arr, dtype="uint8")
        else:
            clipped = np.clip((arr.astype("float32") - p2) / (p98 - p2), 0, 1)
            gris = (clipped * 255).astype("uint8")
            gris[arr == 0] = 0
        img = Image.fromarray(gris, mode="L")
        h, w = gris.shape
        if w != PNG_WIDTH:
            scale = PNG_WIDTH / w
            new_h = max(1, int(round(h * scale)))
            img = img.resize((PNG_WIDTH, new_h), Image.Resampling.LANCZOS)
        png_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(png_path, "PNG", optimize=True)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error(f"  Falló PNG: {exc}")
        return False


@click.command()
@click.option("--output", "output_dir", default=PROC_DIR, show_default=True)
@click.option("--raw-dir", "raw_dir", default=RAW_DIR, show_default=True)
@click.option("--force", is_flag=True, default=False)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Lista qué intentaría descargar para 1999-2013 y para 2014+.",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
)
def main(
    output_dir: str,
    raw_dir: str,
    force: bool,
    dry_run: bool,
    nivel_log: str,
) -> None:
    """Serie histórica CBERS — sólo 2015+ disponible vía AWS Open Data."""
    setup_logger(nivel=nivel_log.upper())
    logger.info("=" * 60)
    logger.info(f"CBERS histórico — v{SCRIPT_VERSION}")
    logger.info("=" * 60)
    logger.info("Aviso: CBERS-1/2/2B (1999-2013) NO accesible vía API anónima.")
    logger.info("Este script extiende con CBERS-4 PAN10M desde 2015.")

    out_proc = ensure_dir(resolve_path(output_dir))
    out_raw = ensure_dir(resolve_path(raw_dir))

    if dry_run:
        logger.info("Dry-run: listo qué intentaría buscar:")
        logger.info("--- CBERS-1/2/2B (1999-2013) ---")
        for anio in range(1999, 2014):
            logger.info(
                f"  {anio}: NO accesible vía AWS/STAC. Fuente: INPE CDSR (registro). Skip."
            )
        logger.info("--- CBERS-4 PAN10M (2015+) ---")
        por_anio = listar_escenas_por_anio()
        for anio in sorted(por_anio):
            n = len(por_anio[anio])
            primera = por_anio[anio][0].fecha if por_anio[anio] else "?"
            logger.info(f"  {anio}: {n} escenas en S3, primera={primera}")
        sys.exit(0)

    # Procesamiento real
    por_anio = listar_escenas_por_anio()
    if not por_anio:
        logger.warning("No se encontró ninguna escena PAN10M en S3.")
        sys.exit(0)

    # Cargar polígonos para contar cobertura
    try:
        gdf = load_geojson("config/poligonos.geojson")
        n_poligonos_total = int((gdf["id"].astype(str) != "posadas_completa").sum())
    except Exception:
        n_poligonos_total = 0

    rows: List[dict] = []
    procesados = 0

    for anio in sorted(por_anio):
        png_dest = out_proc / f"{anio}_posadas_pansharpen.png"

        # Cache hit con cualquier escena del año.
        if cache_check(png_dest) and not force:
            esc = por_anio[anio][0]
            logger.info(f"  {anio}: cache hit → skip")
            rows.append(
                {
                    "anio": anio,
                    "fuente_satelite": f"CBERS-4 {esc.sensor}",
                    "fecha_imagen": f"{esc.fecha[:4]}-{esc.fecha[4:6]}-{esc.fecha[6:]}",
                    "n_poligonos_cubiertos": n_poligonos_total,
                    "calidad": "alta",
                }
            )
            continue

        # Probamos hasta 12 escenas del año si la primera 404a o sale
        # nublada (S3 indexa prefixes que pueden no haber subido los TIFs,
        # y muchos pasajes invierno SH están saturados).
        candidatas = por_anio[anio][:12]
        esc_ok: Optional[EscenaAnual] = None
        for esc in candidatas:
            tif_dest = out_raw / f"cbers4_{esc.fecha}_pan10.tif"
            if cache_check(tif_dest) and not force:
                esc_ok = esc
                break
            if descargar_pan_recortado(esc, tif_dest):
                esc_ok = esc
                break
            logger.warning(f"  {anio}: escena {esc.fecha} no disponible, probando siguiente")

        if esc_ok is None:
            logger.error(f"  {anio}: ninguna de {len(candidatas)} escenas accesibles; skip")
            continue

        tif_dest = out_raw / f"cbers4_{esc_ok.fecha}_pan10.tif"
        if not generar_png_anual(tif_dest, png_dest):
            logger.error(f"  {anio}: falló PNG; skip")
            continue
        procesados += 1
        logger.info(f"  {anio}: OK → {png_dest.name} (escena {esc_ok.fecha})")

        rows.append(
            {
                "anio": anio,
                "fuente_satelite": f"CBERS-4 {esc_ok.sensor}",
                "fecha_imagen": f"{esc_ok.fecha[:4]}-{esc_ok.fecha[4:6]}-{esc_ok.fecha[6:]}",
                "n_poligonos_cubiertos": n_poligonos_total,
                "calidad": "alta",
            }
        )

    # Filas placeholder para 1999-2013 — sin datos pero para que el frontend
    # pueda mostrar "sin imagen disponible" cuando muestre la serie.
    for anio_ph in range(1999, 2014):
        if any(r["anio"] == anio_ph for r in rows):
            continue
        rows.append(
            {
                "anio": anio_ph,
                "fuente_satelite": "CBERS-1/2/2B (no accesible vía API anónima)",
                "fecha_imagen": "",
                "n_poligonos_cubiertos": 0,
                "calidad": "no_disponible",
            }
        )

    df = pd.DataFrame(rows, columns=CSV_COLUMNS).sort_values("anio")
    csv_out = out_proc / "serie_temporal_extendida.csv"
    df.to_csv(csv_out, index=False, encoding="utf-8")
    logger.info(f"CSV escrito → {csv_out} ({len(df)} filas)")

    primer_anio_real = df[df["calidad"] == "alta"]["anio"].min() if not df[df["calidad"] == "alta"].empty else None
    metadata = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "rango_anios_cubiertos": [
            int(primer_anio_real) if primer_anio_real else None,
            int(df["anio"].max()) if not df.empty else None,
        ],
        "anios_pre_2014_no_disponibles": list(range(1999, 2014)),
        "n_imagenes_generadas": procesados,
        "fuente_post_2014": "AWS s3://brazil-eosats/CBERS4/PAN10M/",
        "fuente_pre_2014": "no_accesible_via_api_anonima (INPE CDSR requiere registro)",
        "schema_csv": CSV_COLUMNS,
        "version_script": SCRIPT_VERSION,
        "limitacion": (
            "La serie histórica que se buscaba (1999-2013) requiere acceso "
            "manual al catálogo INPE CDSR. Aquí se entrega CBERS-4 desde "
            "2015, complementaria al WPM 4A (script 45) y AWFI (script 45f)."
        ),
    }
    (out_proc / "_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    logger.info("=" * 60)
    logger.info(f"Procesados: {procesados} años CBERS-4 PAN10M")
    logger.info(f"No disponibles: 1999-2013 (15 años, fuera de AWS/STAC)")
    sys.exit(0)


if __name__ == "__main__":
    main()
