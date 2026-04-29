"""Descarga CBERS-4 PAN5M (5 m, pancromática) y recorta por polígono.

Lo más fino que existe en CBERS gratuito y abierto: la cámara
**PAN5M** del satélite CBERS-4 entrega una banda pancromática de
**5 metros** de resolución espacial (banda 1, 0.51-0.85 µm). Es B&N puro
— no tiene RGB asociado en el bucket AWS (a diferencia del WPM 4A).

El bucket ``s3://brazil-eosats/CBERS4/PAN5M/`` está abierto (anónimo) y
contiene escenas L2 desde 2014-12. El path/row WRS-2 que cubre Posadas es
**163/130** (primario) y **163/131** (fallback sur).

Diferencia clave con el WPM (4A) que ya descargamos en el script 45:
- **WPM 4A**: pan 2 m + MS 8 m → permite hacer pansharpen RGB.
- **PAN5M 4**: pan 5 m sólo (single band). Sin MS, no hay color. Salida
  en escala de grises 8-bit con stretch p2-p98.

Fallback chain
--------------
1. PAN5M (5 m) — primario.
2. Si no hay escena PAN5M con cloud_cover<=30% en ventana (default 90 días),
   fallback a **PAN10M** (10 m) que comparte path/row.
3. Si tampoco hay PAN10M, no se hace nada — el frontend muestra el
   WPM 4A más reciente del script 45.

Output
------
- ``data/raw/cbers_pan5/cbers4_{YYYYMMDD}_pan{5|10}.tif`` (recorte AOI)
- ``data/processed/cbers_pan5/{poligono_id}_pan5_{YYYYMM}.png``
- ``data/processed/cbers_pan5/{poligono_id}_pan5_latest.png`` (alias estable)
- ``data/processed/cbers_pan5/_metadata.json`` (provenance)

Uso
---
::

    # corrida normal
    python scripts/45c_cbers_pan5.py

    # forzar re-descarga
    python scripts/45c_cbers_pan5.py --force

    # solo listar candidatos
    python scripts/45c_cbers_pan5.py --dry-run

Idempotencia
------------
Si ya hay imágenes del mes corriente y ``--force`` no se pasó, sale OK
sin descargar.

Limitaciones conocidas (decirlas claro)
---------------------------------------
1. PAN5M es **B&N**: no hay color natural. Si se necesita color a 5 m,
   habría que combinarla con el MUX (20 m) — pero la diferencia de
   resoluciones (4×) hace que el pansharpen quede peor que el del WPM 4A.
   Por eso se publica B&N puro.
2. La revisita de CBERS-4 PAN5M es ~26 días, vulnerable a nubes. El
   fallback a PAN10M agrega ~5 días extra de chances.
3. Si ambos sensores fallan, NO se interpolan ni se generan imágenes
   sintéticas — el frontend cae al WPM 4A del script 45.
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
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import click
from loguru import logger

from scripts.utils.io_geo import cache_check, load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

# Bucket público AWS Open Data Registry
S3_BUCKET = "brazil-eosats"
S3_REGION = "us-west-2"
S3_BASE_URL = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com"

# STAC INPE para cloud_cover
STAC_BASE = "https://www.dgi.inpe.br/lgi-stac"

# Bbox Posadas extendido (mismo que el resto del observatorio)
POSADAS_BBOX_4326 = (-56.05, -27.51, -55.80, -27.30)

# CBERS-4 PAN5M path/row para Posadas — verificado vía STAC INPE 2026-04-28.
# Posadas bbox: (-56.05, -27.51, -55.80, -27.30).
#
#   163/131 bbox: (-56.05, -28.25, -55.15, -27.08) → ✓ Posadas FULL coverage
#   163/130 bbox: (-55.82, -27.36, -54.93, -26.19) → ✗ apenas clip NE
#   164/131 bbox: (-56.91, -28.24, -56.02, -27.09) → cubre solo borde W
#
# Versión anterior usaba 163/130 primero, lo que descargaba la escena
# pero el raster NO se solapaba con ningún polígono ("Input shapes do
# not overlap raster" para los 44 barrios) → 0 PNGs generados.
PATH_ROW_CANDIDATES: List[Tuple[str, str]] = [
    ("163", "131"),  # primario — cubre Posadas entera
    ("164", "131"),  # fallback oeste si la primaria está nublada
]

# Sensores fallback chain (5m → 10m)
SENSORES_PRIORIZADOS = [
    ("PAN5M", "BAND1", 5),  # sensor, banda, resolución_m
    ("PAN10M", "BAND2", 10),  # PAN10M trae bandas 2/3/4 — usamos BAND2 (verde) como pan
]

DEFAULT_CLOUD_THRESHOLD = 30
DEFAULT_DIAS = 90

POLIGONOS_EXCLUIR = {"posadas_completa"}
PNG_WIDTH = 1200

RAW_DIR = "data/raw/cbers_pan5"
PROC_DIR = "data/processed/cbers_pan5"


@dataclass
class CandidatoPAN:
    sensor: str
    banda: str
    resolucion_m: int
    path: str
    row: str
    fecha: str  # YYYYMMDD
    s3_prefix: str
    cloud_cover: Optional[float] = None
    cobertura_pct: float = 0.0

    @property
    def fecha_dt(self) -> datetime:
        return datetime.strptime(self.fecha, "%Y%m%d")

    @property
    def yyyymm(self) -> str:
        return self.fecha[:6]

    @property
    def scene_id(self) -> str:
        # CBERS_4_PAN5M_20141215_163_130_L2
        return f"CBERS_4_{self.sensor}_{self.fecha}_{self.path}_{self.row}_L2"

    def s3_key(self) -> str:
        return f"{self.s3_prefix}{self.scene_id}_{self.banda}.tif"


def _s3_client():
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    return boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name=S3_REGION)


def _listar_escenas_s3(sensor: str, path: str, row: str) -> List[str]:
    """Devuelve nombres de escenas L2 disponibles en S3 (último segmento del prefix)."""
    s3 = _s3_client()
    prefix = f"CBERS4/{sensor}/{path}/{row}/"
    try:
        paginator = s3.get_paginator("list_objects_v2")
        nombres: List[str] = []
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix, Delimiter="/"):
            for cp in page.get("CommonPrefixes", []) or []:
                nombre = cp.get("Prefix", "").rstrip("/").split("/")[-1]
                if nombre.endswith("_L2"):
                    nombres.append(nombre)
        return nombres
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló listObjectsV2 sobre {prefix}: {exc}")
        return []


def _consultar_stac_cloud(
    sensor: str, scene_id: str, fecha: str, path: str, row: str
) -> Optional[float]:
    """Trata de obtener cloud_cover desde STAC INPE para CBERS-4 PAN5M/PAN10M."""
    coleccion = f"CBERS4_{sensor}_L2_DN"
    # ID típico STAC: CBERS4_PAN5M_{path}{row}_{YYYYMMDD}
    candidatos_id = [
        f"CBERS4_{sensor}{path}{row}{fecha}",
        f"CBERS4_{sensor}_{path}_{row}_{fecha}",
        scene_id,
    ]
    for stac_id in candidatos_id:
        url = f"{STAC_BASE}/collections/{coleccion}/items/{stac_id}"
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                data = json.load(resp)
            cloud = data.get("properties", {}).get("cloud_cover")
            if cloud is not None:
                return float(cloud)
        except Exception:
            continue
    return None


def descubrir_candidatos(
    dias_atras: int = DEFAULT_DIAS,
    cloud_threshold: int = DEFAULT_CLOUD_THRESHOLD,
    intentar_stac: bool = True,
) -> List[CandidatoPAN]:
    """Lista escenas PAN5M / PAN10M candidatas, en orden sensor preferido + recencia."""
    fecha_corte = datetime.now() - timedelta(days=dias_atras)
    candidatos: List[CandidatoPAN] = []

    for sensor, banda, resolucion in SENSORES_PRIORIZADOS:
        for path, row in PATH_ROW_CANDIDATES:
            nombres = _listar_escenas_s3(sensor, path, row)
            for nombre in nombres:
                # CBERS_4_PAN5M_20141215_163_130_L2 → fecha = parts[3]
                parts = nombre.split("_")
                if len(parts) < 6:
                    continue
                try:
                    fecha = parts[3]
                    fdt = datetime.strptime(fecha, "%Y%m%d")
                except ValueError:
                    continue
                if fdt < fecha_corte:
                    continue
                cand = CandidatoPAN(
                    sensor=sensor,
                    banda=banda,
                    resolucion_m=resolucion,
                    path=path,
                    row=row,
                    fecha=fecha,
                    s3_prefix=f"CBERS4/{sensor}/{path}/{row}/{nombre}/",
                )
                # cobertura asumida: el path/row está pre-validado para Posadas
                cand.cobertura_pct = 100.0
                candidatos.append(cand)

    logger.info(
        f"Encontrados {len(candidatos)} candidatos PAN5M/PAN10M dentro de {dias_atras} días"
    )

    # cloud_cover via STAC (best-effort)
    if intentar_stac:
        for c in candidatos[:30]:  # cap para no martillar STAC
            c.cloud_cover = _consultar_stac_cloud(c.sensor, c.scene_id, c.fecha, c.path, c.row)

    # filtrar por nubes si tenemos info
    pre = len(candidatos)
    candidatos = [
        c for c in candidatos if c.cloud_cover is None or c.cloud_cover <= cloud_threshold
    ]
    if pre != len(candidatos):
        logger.info(
            f"  Filtrados {pre - len(candidatos)} candidatos con cloud_cover > {cloud_threshold}%"
        )

    # Ordenar: PAN5M antes que PAN10M, luego más reciente, luego menos nubes
    def _orden(c: CandidatoPAN) -> tuple:
        cloud = c.cloud_cover if c.cloud_cover is not None else 50.0
        sensor_rank = 0 if c.sensor == "PAN5M" else 1
        return (sensor_rank, -c.fecha_dt.timestamp(), cloud)

    candidatos.sort(key=_orden)
    return candidatos


def descargar_recortado(cand: CandidatoPAN, destino: Path) -> bool:
    """Descarga la banda PAN recortada al bbox de Posadas."""
    import pyproj
    import rasterio
    from rasterio.windows import Window, from_bounds

    s3_key = cand.s3_key()
    url = f"{S3_BASE_URL}/{s3_key}"
    destino.parent.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    try:
        with rasterio.open(url) as src:
            # Reproyectar bbox a CRS del raster
            tr = pyproj.Transformer.from_crs("EPSG:4326", src.crs, always_xy=True)
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
                logger.error(f"Ventana vacía para {s3_key}")
                return False
            arr = src.read(1, window=win)
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
        logger.info(
            f"  PAN ({cand.sensor}/{cand.banda}) → {destino.name} "
            f"({win.width}x{win.height} {arr.dtype}, {time.time() - t0:.1f}s)"
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error(f"  Falló descarga: {exc}")
        return False


def recortar_y_pngear_por_poligono(
    pan_tif: Path,
    geom_geojson: dict,
    poligono_id: str,
    yyyymm: str,
    out_dir: Path,
    force: bool = False,
) -> Tuple[bool, Dict[str, Any]]:
    """Recorta el PAN por la geometría del polígono y produce un PNG B&N stretch p2-p98."""
    import geopandas as gpd
    import numpy as np
    import rasterio
    from PIL import Image
    from rasterio.mask import mask as rio_mask
    from shapely.geometry import shape

    info: Dict[str, Any] = {"poligono_id": poligono_id, "yyyymm": yyyymm}
    png_dest = out_dir / f"{poligono_id}_pan5_{yyyymm}.png"
    latest_png = out_dir / f"{poligono_id}_pan5_latest.png"

    if cache_check(png_dest) and cache_check(latest_png) and not force:
        info["cache_hit"] = True
        return True, info

    geom_4326 = shape(geom_geojson)
    gdf = gpd.GeoDataFrame(geometry=[geom_4326], crs="EPSG:4326")

    with rasterio.open(pan_tif) as src:
        gdf_src = gdf.to_crs(src.crs)
        try:
            out_image, _ = rio_mask(
                src,
                [gdf_src.geometry.iloc[0].__geo_interface__],
                crop=True,
                filled=True,
                nodata=0,
            )
        except ValueError as exc:
            logger.warning(f"  {poligono_id}: {exc}")
            return False, info

    arr = out_image[0]
    valid = arr[arr > 0]
    if valid.size == 0:
        logger.warning(f"  {poligono_id}: 0 píxeles válidos tras recorte")
        return False, info

    # Stretch p2-p98 → uint8
    p2 = float(np.percentile(valid, 2))
    p98 = float(np.percentile(valid, 98))
    if p98 - p2 < 1e-6:
        gris = np.zeros_like(arr, dtype="uint8")
    else:
        clipped = np.clip((arr.astype("float32") - p2) / (p98 - p2), 0, 1)
        gris = (clipped * 255).astype("uint8")
        gris[arr == 0] = 0

    # PNG redimensionado
    h, w = gris.shape
    img = Image.fromarray(gris, mode="L")
    if w != PNG_WIDTH:
        scale = PNG_WIDTH / w
        new_h = max(1, int(round(h * scale)))
        img = img.resize((PNG_WIDTH, new_h), Image.Resampling.LANCZOS)

    out_dir.mkdir(parents=True, exist_ok=True)
    img.save(png_dest, "PNG", optimize=True)
    shutil.copy2(png_dest, latest_png)

    info["png_path"] = str(png_dest)
    info["p2"] = p2
    info["p98"] = p98
    info["ancho_px"] = w
    info["alto_px"] = h
    info["n_pixeles_validos"] = int(valid.size)
    return True, info


@click.command()
@click.option("--output", "output_dir", default=PROC_DIR, show_default=True)
@click.option("--raw-dir", "raw_dir", default=RAW_DIR, show_default=True)
@click.option(
    "--cloud-threshold",
    default=DEFAULT_CLOUD_THRESHOLD,
    type=int,
    show_default=True,
)
@click.option("--dias", default=DEFAULT_DIAS, type=int, show_default=True)
@click.option("--force", is_flag=True, default=False)
@click.option("--dry-run", is_flag=True, default=False)
@click.option("--no-stac", is_flag=True, default=False)
@click.option(
    "--poligonos",
    "poligonos_path",
    default="config/poligonos.geojson",
    show_default=True,
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
)
def main(
    output_dir: str,
    raw_dir: str,
    cloud_threshold: int,
    dias: int,
    force: bool,
    dry_run: bool,
    no_stac: bool,
    poligonos_path: str,
    nivel_log: str,
) -> None:
    """CBERS-4 PAN5M (5 m B&N) — descarga + recorte por polígono."""
    setup_logger(nivel=nivel_log.upper())
    out_proc = ensure_dir(resolve_path(output_dir))
    out_raw = ensure_dir(resolve_path(raw_dir))

    logger.info("=" * 60)
    logger.info(f"CBERS-4 PAN5M (B&N 5 m) — v{SCRIPT_VERSION}")
    logger.info("=" * 60)

    # Idempotencia mensual: ¿ya hay PNGs del mes corriente?
    yyyymm_actual = datetime.now().strftime("%Y%m")
    existentes = list(out_proc.glob(f"*_pan5_{yyyymm_actual}.png"))
    if existentes and not force and not dry_run:
        logger.info(
            f"Ya existen {len(existentes)} PNGs PAN5 para {yyyymm_actual} → skip "
            "(usá --force para regenerar)"
        )
        sys.exit(0)

    candidatos = descubrir_candidatos(
        dias_atras=dias,
        cloud_threshold=cloud_threshold,
        intentar_stac=not no_stac,
    )
    if not candidatos:
        logger.warning(
            f"Sin candidatos PAN5M/PAN10M en últimos {dias} días con cloud<={cloud_threshold}%. "
            "Frontend caerá al WPM 4A del script 45."
        )
        sys.exit(0)

    logger.info("Top candidatos:")
    for i, c in enumerate(candidatos[:5]):
        cloud = f"{c.cloud_cover:.0f}%" if c.cloud_cover is not None else "?"
        logger.info(
            f"  [{i + 1}] {c.sensor} {c.fecha[:4]}-{c.fecha[4:6]}-{c.fecha[6:]} "
            f"path/row={c.path}/{c.row} cloud={cloud}"
        )

    if dry_run:
        logger.info("Dry-run completo, no se descargó nada.")
        sys.exit(0)

    # Recorte por polígono — iteramos por candidatos hasta cubrir TODOS los
    # polígonos. La escena más reciente puede tener nubes sobre la mitad
    # norte de Posadas (que es donde está el casco urbano), entonces los
    # polígonos sin píxeles válidos los completamos con escenas más viejas
    # del fallback. Cada polígono usa la escena MÁS RECIENTE disponible
    # para él (el _latest.png queda con la primera que cubrió).
    gdf = load_geojson(poligonos_path)
    gdf_pub = gdf[~gdf["id"].astype(str).isin(POLIGONOS_EXCLUIR)].reset_index(drop=True)

    pendientes: set = {str(r["id"]) for _, r in gdf_pub.iterrows()}
    total_pol = len(pendientes)
    cubiertos: List[Dict[str, Any]] = []
    errores: List[str] = []
    escenas_usadas: List[Dict[str, Any]] = []
    elegida = candidatos[0]  # La principal (la más reciente) para metadata

    MAX_INTENTOS = min(5, len(candidatos))
    t0 = time.time()
    for idx, c in enumerate(candidatos[:MAX_INTENTOS]):
        if not pendientes:
            logger.info("Todos los polígonos cubiertos — fin de iteración.")
            break

        logger.info(
            f"[escena {idx + 1}/{MAX_INTENTOS}] {c.scene_id} — "
            f"{len(pendientes)} polígonos pendientes"
        )

        pan_tif = out_raw / f"cbers4_{c.fecha}_pan{c.resolucion_m}.tif"
        if not (cache_check(pan_tif) and not force):
            ok = descargar_recortado(c, pan_tif)
            if not ok:
                logger.warning("  download falló — siguiente candidato.")
                continue
        else:
            logger.info(f"  cache hit raw {pan_tif.name}")

        nuevos_cubiertos = 0
        for pid in list(pendientes):
            row = gdf_pub[gdf_pub["id"].astype(str) == pid].iloc[0]
            try:
                ok, info = recortar_y_pngear_por_poligono(
                    pan_tif=pan_tif,
                    geom_geojson=row.geometry.__geo_interface__,
                    poligono_id=pid,
                    yyyymm=c.yyyymm,
                    out_dir=out_proc,
                    force=force,
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(f"  {pid}: excepción {exc}")
                errores.append(pid)
                pendientes.discard(pid)
                continue
            if ok:
                cubiertos.append(info)
                pendientes.discard(pid)
                nuevos_cubiertos += 1

        escenas_usadas.append(
            {
                "scene_id": c.scene_id,
                "fecha": c.fecha,
                "cloud_cover_pct": c.cloud_cover,
                "polygons_cubiertos_aqui": nuevos_cubiertos,
            }
        )
        logger.info(
            f"  +{nuevos_cubiertos} polígonos cubiertos por esta escena, "
            f"quedan {len(pendientes)} sin cobertura"
        )

    sin_cobertura: List[str] = sorted(pendientes)
    elapsed = time.time() - t0

    # Metadata
    metadata = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sensor": f"CBERS-4 {elegida.sensor}",
        "resolucion_m": elegida.resolucion_m,
        "fecha_imagen": f"{elegida.fecha[:4]}-{elegida.fecha[4:6]}-{elegida.fecha[6:]}",
        "path": elegida.path,
        "row": elegida.row,
        "scene_id": elegida.scene_id,
        "cloud_cover_pct": elegida.cloud_cover,
        "n_poligonos_cubiertos": len(cubiertos),
        "n_poligonos_sin_cobertura": len(sin_cobertura),
        "n_poligonos_total": total_pol,
        "escenas_usadas": escenas_usadas,
        "fuente": "INPE / AWS Open Data Registry (s3://brazil-eosats)",
        "version_script": SCRIPT_VERSION,
        "fallback_chain": "PAN5M -> PAN10M -> WPM4A (script 45)",
        "color_o_bn": "B&N (pancromática única)",
    }
    (out_proc / "_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    logger.info("=" * 60)
    logger.info(
        f"PAN5 sync — OK={len(cubiertos)} sin_cobertura={len(sin_cobertura)} err={len(errores)}"
    )
    logger.info(f"  Tiempo total: {elapsed:.1f}s")
    sys.exit(0 if not errores else 1)


if __name__ == "__main__":
    main()
