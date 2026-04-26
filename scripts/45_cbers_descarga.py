"""Descarga imágenes CBERS-4A WPM y genera pansharpen RGB de alta resolución (2 m).

Capa de imagen complementaria a Sentinel-2 (10 m) para inspección urbana
detallada de los polígonos del Observatorio. Combina la banda pancromática
(2 m) con las bandas multiespectrales (8 m) usando el algoritmo de **Brovey**
para producir un RGB color a 2 m efectivos.

Fuente
------
Bucket público AWS Open Data Registry ``s3://brazil-eosats/`` (us-west-2).
Estructura: ``CBERS4A/WPM/{path}/{row}/CBERS_4A_WPM_{YYYYMMDD}_{path}_{row}_L4/``
Bandas: ``BAND0`` = pan (2 m), ``BAND1`` = blue, ``BAND2`` = green,
``BAND3`` = red, ``BAND4`` = nir (8 m). Todas en EPSG:32721 (UTM 21S, mismo
CRS métrico que el Observatorio). Acceso anónimo con
``Config(signature_version=UNSIGNED)``.

Path/Row para Posadas
---------------------
Posadas (-27.37, -55.90 → UTM21S ≈ 608.781 / 6.972.103) cae sobre
``path=213, row=148`` para la pasada principal. La escena de ese path/row
cubre el bbox extendido del Observatorio (-56.05, -27.51, -55.80, -27.30)
en una sola tile. Como fallback el script considera path=213/row=147
(norte) y path=214/row=147+148 (oeste).

Selección de imagen
-------------------
1) Lista las escenas L4 disponibles en S3 para los path/row candidatos,
   filtrando por ventana temporal (default últimos 180 días).
2) Para cada escena, lee bounds remotamente (rasterio + GDAL VSI) y
   verifica que cubra el bbox de Posadas.
3) Cruza con la API STAC del INPE (``https://www.dgi.inpe.br/lgi-stac``)
   para conocer ``cloud_cover`` (las imágenes L2 y L4 comparten metadata).
4) Elige la escena con mejor cobertura, menor nubosidad y más reciente.

Pansharpen
----------
Algoritmo **Brovey**:

    R_pan = R_ms * (PAN / I)
    G_pan = G_ms * (PAN / I)
    B_pan = B_ms * (PAN / I)

donde ``I = (R_ms + G_ms + B_ms) / 3`` es la "intensidad sintética". Las
bandas MS se upsamplean al grid del PAN (factor 4×) con remuestreo bilineal
y se hace la operación en float32. El resultado se rescaló a 8-bit con
stretch p2-p98 por banda (consistente con ``01_descarga_sentinel.py``).

Output
------
- ``data/raw/cbers/cbers4a_{yyyymmdd}_pan.tif``  (PAN recortada al bbox
  Posadas, 2 m)
- ``data/raw/cbers/cbers4a_{yyyymmdd}_red.tif``, ``..._green.tif``,
  ``..._blue.tif``, ``..._nir.tif`` (MS recortadas al bbox, 8 m)
- ``data/raw/cbers/posadas_{yyyymm}_pansharpen.tif``  (RGB 8-bit, 2 m,
  EPSG:32721)
- ``data/raw/cbers/posadas_{yyyymm}_metadata.json``  (provenance)

Idempotencia
------------
Si ``posadas_{yyyymm}_pansharpen.tif`` del mes corriente ya existe, el
script termina sin hacer nada salvo que se pase ``--force``.

Uso
---
::

    # corrida normal: busca última escena válida y produce pansharpen
    python scripts/45_cbers_descarga.py

    # forzar recomputación
    python scripts/45_cbers_descarga.py --force

    # ventana temporal más amplia
    python scripts/45_cbers_descarga.py --dias 365

    # dry-run: sólo lista candidatos, no descarga
    python scripts/45_cbers_descarga.py --dry-run

Dependencias
------------
- ``boto3`` (S3 anónimo).
- ``rasterio`` (lectura remota vía GDAL VSI ``/vsis3/``).
- ``shapely`` (intersecciones bbox-escena).
- Acceso a internet a ``brazil-eosats.s3.us-west-2.amazonaws.com`` y
  opcionalmente a ``www.dgi.inpe.br`` (STAC para cloud_cover).
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
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import click
from loguru import logger

from scripts.utils.io_geo import cache_check
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

# Configuración del bucket público AWS Open Data Registry
S3_BUCKET = "brazil-eosats"
S3_REGION = "us-west-2"
S3_BASE_URL = f"https://{S3_BUCKET}.s3.{S3_REGION}.amazonaws.com"

# STAC del INPE — usamos GET /collections/{id}/items con bbox
STAC_BASE = "https://www.dgi.inpe.br/lgi-stac"
STAC_COLLECTION = "CBERS4A_WPM_L2_DN"  # La metadata de cloud_cover está aquí

# Bbox de Posadas extendido — usado para filtrar scenes y para el recorte
# (oeste, sur, este, norte) en EPSG:4326
POSADAS_BBOX_4326 = (-56.05, -27.51, -55.80, -27.30)

# Bbox de Posadas en UTM 21S — derivado de POSADAS_BBOX_4326 por pyproj.
# Lo cacheamos una vez al inicio para no reproyectar 44 veces.
# (calculado en _bbox_utm())

# Path/row candidatos que pueden cubrir Posadas. El primero es el principal.
PATH_ROW_CANDIDATES: List[Tuple[str, str]] = [
    ("213", "148"),  # principal — cubre todo el bbox extendido
    ("214", "147"),  # fallback norte-oeste
    ("214", "148"),  # fallback sur-oeste
    ("213", "147"),  # fallback norte
]

# Umbrales
DEFAULT_CLOUD_THRESHOLD = 30  # %
DEFAULT_DIAS = 180

# Banda → Asset key en S3 (BAND0=pan, BAND1=blue, BAND2=green, BAND3=red, BAND4=nir)
BANDA_KEY = {
    "pan": "BAND0",
    "blue": "BAND1",
    "green": "BAND2",
    "red": "BAND3",
    "nir": "BAND4",
}

# CRS objetivo: EPSG:32721 (UTM 21S) — mismo que el Observatorio
CRS_OBJETIVO = "EPSG:32721"


# ---------------------------------------------------------------------------
# Estructura de candidato
# ---------------------------------------------------------------------------


@dataclass
class CandidatoEscena:
    """Una escena CBERS-4A WPM L4 en S3 que potencialmente cubre Posadas."""

    path: str
    row: str
    fecha: str  # YYYYMMDD
    s3_prefix: str  # CBERS4A/WPM/{path}/{row}/CBERS_4A_WPM_{fecha}_{path}_{row}_L4/
    bounds_utm: Optional[Tuple[float, float, float, float]] = None
    cubre_completo: bool = False
    cobertura_pct: float = 0.0
    cloud_cover: Optional[float] = None  # % de la STAC INPE; None si no se pudo cruzar

    @property
    def fecha_dt(self) -> datetime:
        return datetime.strptime(self.fecha, "%Y%m%d")

    @property
    def yyyymm(self) -> str:
        return self.fecha[:6]

    @property
    def scene_id(self) -> str:
        return f"CBERS_4A_WPM_{self.fecha}_{self.path}_{self.row}_L4"

    def s3_key(self, banda_key: str) -> str:
        """Devuelve la clave S3 completa para una banda dada."""
        return f"{self.s3_prefix}{self.scene_id}_{banda_key}.tif"


# ---------------------------------------------------------------------------
# Helpers S3
# ---------------------------------------------------------------------------


def _s3_client():
    """Cliente S3 anónimo (sin credenciales). Lazy import para no cargar boto3 si no hace falta."""
    import boto3
    from botocore import UNSIGNED
    from botocore.config import Config

    return boto3.client("s3", config=Config(signature_version=UNSIGNED), region_name=S3_REGION)


def _listar_escenas_s3(path: str, row: str) -> List[str]:
    """Lista los nombres de escenas L4 disponibles en S3 para un path/row.

    Args:
        path: WRS path (e.g. "213").
        row: WRS row (e.g. "148").

    Returns:
        Lista de strings con el nombre de escena (sin trailing slash):
        ``CBERS_4A_WPM_{YYYYMMDD}_{path}_{row}_L4``.
    """
    s3 = _s3_client()
    prefix = f"CBERS4A/WPM/{path}/{row}/"
    try:
        resp = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix, Delimiter="/", MaxKeys=200)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló listObjectsV2 sobre {prefix}: {exc}")
        return []
    nombres: List[str] = []
    for cp in resp.get("CommonPrefixes", []) or []:
        full = cp.get("Prefix", "")
        # Drop trailing slash and keep last segment
        nombre = full.rstrip("/").split("/")[-1]
        if nombre.endswith("_L4"):
            nombres.append(nombre)
    return nombres


def _bbox_utm() -> Tuple[float, float, float, float]:
    """Devuelve (min_x, min_y, max_x, max_y) de POSADAS_BBOX_4326 en UTM 21S."""
    import pyproj

    transformer = pyproj.Transformer.from_crs("EPSG:4326", CRS_OBJETIVO, always_xy=True)
    oeste, sur, este, norte = POSADAS_BBOX_4326
    xs, ys = [], []
    for lon, lat in [
        (oeste, sur),
        (oeste, norte),
        (este, sur),
        (este, norte),
    ]:
        x, y = transformer.transform(lon, lat)
        xs.append(x)
        ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys))


def _leer_bounds_remotos(s3_key: str) -> Optional[Tuple[float, float, float, float]]:
    """Lee los bounds (UTM) de un .tif remoto sin descargarlo entero."""
    import rasterio

    url = f"{S3_BASE_URL}/{s3_key}"
    try:
        with rasterio.open(url) as src:
            b = src.bounds
            return (float(b.left), float(b.bottom), float(b.right), float(b.top))
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"No se pudo leer bounds de {s3_key}: {exc}")
        return None


# ---------------------------------------------------------------------------
# STAC INPE — para cloud_cover
# ---------------------------------------------------------------------------


def _consultar_stac_cloud(scene_id: str, fecha: str) -> Optional[float]:
    """Cruza la metadata STAC INPE para obtener ``cloud_cover`` de una escena.

    La STAC del INPE catalogiza items L2_DN con IDs como
    ``CBERS4A_WPM{path}{row}{YYYYMMDD}ETC2``. La fecha y path/row coinciden
    con los de la escena L4 en S3.

    Args:
        scene_id: ``CBERS_4A_WPM_{YYYYMMDD}_{path}_{row}_L4``
        fecha: YYYYMMDD.

    Returns:
        Float con % de nubes (0-100) o None si no se pudo cruzar.
    """
    # Reconstruir el ID STAC: CBERS4A_WPM{path}{row}{YYYYMMDD}ETC2
    parts = scene_id.split("_")
    if len(parts) < 6:
        return None
    path, row = parts[4], parts[5]
    stac_id = f"CBERS4A_WPM{path}{row}{fecha}ETC2"

    url = f"{STAC_BASE}/collections/{STAC_COLLECTION}/items/{stac_id}"
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            data = json.load(resp)
        cloud = data.get("properties", {}).get("cloud_cover")
        if cloud is not None:
            return float(cloud)
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"STAC INPE no devolvió cloud_cover para {stac_id}: {exc}")
    return None


# ---------------------------------------------------------------------------
# Descubrimiento de candidatos
# ---------------------------------------------------------------------------


def descubrir_candidatos(
    dias_atras: int = DEFAULT_DIAS,
    cloud_threshold: int = DEFAULT_CLOUD_THRESHOLD,
    intentar_stac: bool = True,
) -> List[CandidatoEscena]:
    """Descubre escenas CBERS-4A WPM L4 que potencialmente cubren Posadas.

    Args:
        dias_atras: Ventana temporal hacia atrás (días desde hoy).
        cloud_threshold: % máximo de cobertura nubosa aceptada al filtrar.
        intentar_stac: Si True, consulta STAC INPE para obtener cloud_cover.

    Returns:
        Lista de candidatos ordenada por (cobertura desc, cloud asc, fecha desc).
    """
    fecha_corte = datetime.now() - timedelta(days=dias_atras)
    bbox_utm = _bbox_utm()
    logger.info(f"Bbox Posadas (UTM 21S): {tuple(round(x) for x in bbox_utm)}")
    logger.info(
        f"Buscando escenas con fecha >= {fecha_corte.strftime('%Y-%m-%d')} en {len(PATH_ROW_CANDIDATES)} path/row..."
    )

    candidatos: List[CandidatoEscena] = []
    for path, row in PATH_ROW_CANDIDATES:
        nombres = _listar_escenas_s3(path, row)
        logger.debug(f"  S3 path={path}/row={row}: {len(nombres)} escenas en total")
        for nombre in nombres:
            # Parsear fecha
            try:
                # CBERS_4A_WPM_{YYYYMMDD}_{path}_{row}_L4
                parts = nombre.split("_")
                fecha = parts[3]
                fdt = datetime.strptime(fecha, "%Y%m%d")
            except (ValueError, IndexError):
                continue
            if fdt < fecha_corte:
                continue
            cand = CandidatoEscena(
                path=path,
                row=row,
                fecha=fecha,
                s3_prefix=f"CBERS4A/WPM/{path}/{row}/{nombre}/",
            )
            candidatos.append(cand)

    logger.info(f"Encontrados {len(candidatos)} candidatos en S3 dentro de la ventana temporal.")

    # Verificar cobertura espacial leyendo bounds remotamente (banda más liviana = BAND1)
    for cand in candidatos:
        bounds = _leer_bounds_remotos(cand.s3_key("BAND1"))
        if bounds is None:
            continue
        cand.bounds_utm = bounds
        # Cobertura: cuánto del bbox de Posadas cae dentro de la escena
        bb_x0, bb_y0, bb_x1, bb_y1 = bbox_utm
        sc_x0, sc_y0, sc_x1, sc_y1 = bounds
        ix0, iy0 = max(bb_x0, sc_x0), max(bb_y0, sc_y0)
        ix1, iy1 = min(bb_x1, sc_x1), min(bb_y1, sc_y1)
        if ix1 > ix0 and iy1 > iy0:
            inter_area = (ix1 - ix0) * (iy1 - iy0)
            bbox_area = (bb_x1 - bb_x0) * (bb_y1 - bb_y0)
            cand.cobertura_pct = (inter_area / bbox_area) * 100.0
            cand.cubre_completo = (
                sc_x0 <= bb_x0 and sc_x1 >= bb_x1 and sc_y0 <= bb_y0 and sc_y1 >= bb_y1
            )

    # Filtrar a los que tengan al menos algo de cobertura
    candidatos = [c for c in candidatos if c.cobertura_pct > 0]
    logger.info(f"  {len(candidatos)} candidatos cubren parte del bbox de Posadas.")

    # Cruzar con STAC para cloud_cover (best-effort)
    if intentar_stac:
        for cand in candidatos:
            cand.cloud_cover = _consultar_stac_cloud(cand.scene_id, cand.fecha)

    # Filtrar por nubes si tenemos info
    pre_filtro = len(candidatos)
    candidatos = [
        c for c in candidatos if c.cloud_cover is None or c.cloud_cover <= cloud_threshold
    ]
    if pre_filtro != len(candidatos):
        logger.info(
            f"  Filtrados {pre_filtro - len(candidatos)} candidatos con cloud_cover > {cloud_threshold}%."
        )

    # Ordenar: cobertura desc, cloud asc, fecha desc
    def _orden(c: CandidatoEscena) -> tuple:
        cloud = c.cloud_cover if c.cloud_cover is not None else 50.0
        return (-c.cobertura_pct, cloud, -c.fecha_dt.timestamp())

    candidatos.sort(key=_orden)
    return candidatos


# ---------------------------------------------------------------------------
# Descarga de bandas (recortadas al bbox de Posadas)
# ---------------------------------------------------------------------------


def descargar_banda_recortada(
    cand: CandidatoEscena,
    banda_clave: str,
    destino: Path,
) -> bool:
    """Descarga la banda ``banda_clave`` de la escena recortándola al bbox de Posadas.

    Lee la banda remotamente con rasterio (vía HTTPS GDAL VSI) y escribe sólo
    la ventana del bbox extendido de Posadas.

    Args:
        cand: Candidato con prefix S3 y bounds.
        banda_clave: ``"pan"``, ``"red"``, ``"green"``, ``"blue"``, ``"nir"``.
        destino: Path destino del .tif recortado.

    Returns:
        True si se escribió OK, False si falló.
    """
    import rasterio
    from rasterio.windows import Window, from_bounds

    s3_key = cand.s3_key(BANDA_KEY[banda_clave])
    url = f"{S3_BASE_URL}/{s3_key}"
    bbox_utm = _bbox_utm()
    destino.parent.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    try:
        with rasterio.open(url) as src:
            win = from_bounds(*bbox_utm, transform=src.transform)
            # Snap a entero y clip dentro de la imagen
            win = Window(
                col_off=max(0, int(win.col_off)),
                row_off=max(0, int(win.row_off)),
                width=min(src.width, int(win.width)),
                height=min(src.height, int(win.height)),
            )
            if win.width <= 0 or win.height <= 0:
                logger.error(f"Ventana vacía para {banda_clave} en {s3_key}")
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
                    # Aseguramos COG-friendly
                    "compress": "deflate",
                    "tiled": True,
                    "blockxsize": 256,
                    "blockysize": 256,
                }
            )
            with rasterio.open(destino, "w", **meta) as dst:
                dst.write(arr, 1)
        logger.info(
            f"  {banda_clave:>5s} ({BANDA_KEY[banda_clave]}) → {destino.name} "
            f"({win.width}x{win.height}, {arr.dtype}, {time.time() - t0:.1f}s)"
        )
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error(f"  Falló descarga de {banda_clave}: {exc}")
        return False


# ---------------------------------------------------------------------------
# Pansharpen Brovey
# ---------------------------------------------------------------------------


def pansharpen_brovey(
    pan_path: Path,
    red_path: Path,
    green_path: Path,
    blue_path: Path,
    output_path: Path,
) -> Dict[str, Any]:
    """Aplica pansharpen Brovey: combina PAN (2 m) + RGB (8 m) → RGB (2 m).

    Algoritmo:
        I = (R + G + B) / 3                      (intensidad sintética MS)
        R_pan = R * (PAN / I)                    (idem G y B)

    Pasos:
    1) Resamplea las bandas MS al grid del PAN con bilinear.
    2) Convierte a float32 para evitar overflow en multiplicaciones.
    3) Aplica fórmula Brovey.
    4) Aplica stretch p2-p98 por banda y convierte a uint8.

    Args:
        pan_path: GeoTIFF del PAN (2 m).
        red_path: GeoTIFF del rojo (8 m).
        green_path: GeoTIFF del verde (8 m).
        blue_path: GeoTIFF del azul (8 m).
        output_path: Destino del .tif RGB 8-bit pansharpen.

    Returns:
        Dict con stats (p2/p98 por banda, dimensiones, tiempo).
    """
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject

    t0 = time.time()
    logger.info("Aplicando pansharpen Brovey...")

    with rasterio.open(pan_path) as pan_src:
        pan = pan_src.read(1).astype("float32")
        pan_meta = pan_src.meta.copy()
        pan_transform = pan_src.transform
        pan_crs = pan_src.crs
        h_pan, w_pan = pan.shape

    # Resamplea cada MS al grid del PAN
    def _upsample_to_pan(ms_path: Path) -> "np.ndarray":
        with rasterio.open(ms_path) as ms_src:
            arr = np.zeros((h_pan, w_pan), dtype="float32")
            reproject(
                source=rasterio.band(ms_src, 1),
                destination=arr,
                src_transform=ms_src.transform,
                src_crs=ms_src.crs,
                dst_transform=pan_transform,
                dst_crs=pan_crs,
                resampling=Resampling.bilinear,
            )
            return arr

    red = _upsample_to_pan(red_path)
    green = _upsample_to_pan(green_path)
    blue = _upsample_to_pan(blue_path)

    # Brovey: I = mean(R, G, B)
    intensity = (red + green + blue) / 3.0
    # Evitar div/0 — donde I==0, factor=0 (zona sin info)
    factor = np.zeros_like(intensity, dtype="float32")
    mask_valid = intensity > 0
    factor[mask_valid] = pan[mask_valid] / intensity[mask_valid]

    r_pan = red * factor
    g_pan = green * factor
    b_pan = blue * factor

    # Stretch p2-p98 por banda → uint8
    out = np.zeros((3, h_pan, w_pan), dtype="uint8")
    stats: Dict[str, Any] = {}
    for i, (banda, arr) in enumerate([("red", r_pan), ("green", g_pan), ("blue", b_pan)]):
        valid = arr[(arr > 0) & np.isfinite(arr)]
        if valid.size == 0:
            stats[f"{banda}_p2"] = 0.0
            stats[f"{banda}_p98"] = 1.0
            continue
        p2 = float(np.percentile(valid, 2))
        p98 = float(np.percentile(valid, 98))
        stats[f"{banda}_p2"] = p2
        stats[f"{banda}_p98"] = p98
        if p98 - p2 < 1e-6:
            out[i] = 0
        else:
            clipped = np.clip((arr - p2) / (p98 - p2), 0, 1)
            out[i] = (clipped * 255).astype("uint8")

    pan_meta.update(
        {
            "count": 3,
            "dtype": "uint8",
            "nodata": 0,
            "compress": "deflate",
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
            "photometric": "RGB",
        }
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(output_path, "w", **pan_meta) as dst:
        dst.write(out)
        dst.set_band_description(1, "Red (Brovey-pansharpen)")
        dst.set_band_description(2, "Green (Brovey-pansharpen)")
        dst.set_band_description(3, "Blue (Brovey-pansharpen)")

    elapsed = time.time() - t0
    logger.info(
        f"Pansharpen completado en {elapsed:.1f}s → {output_path.name} "
        f"({w_pan}x{h_pan} px, 2 m/pixel)"
    )
    stats["dimensiones"] = (w_pan, h_pan)
    stats["resolucion_m"] = 2
    stats["elapsed_s"] = elapsed
    return stats


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _escribir_metadata(
    metadata_path: Path,
    cand: CandidatoEscena,
    pansharpen_stats: Dict[str, Any],
    n_poligonos: int,
) -> None:
    """Escribe el JSON de metadata para freshness y trazabilidad."""
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "sensor": "CBERS-4A WPM",
        "resolucion_pan_m": 2,
        "resolucion_ms_m": 8,
        "resolucion_pansharpen_m": 2,
        "fecha_imagen": f"{cand.fecha[:4]}-{cand.fecha[4:6]}-{cand.fecha[6:]}",
        "path": cand.path,
        "row": cand.row,
        "scene_id": cand.scene_id,
        "n_poligonos_cubiertos": n_poligonos,
        "cloud_cover_pct": cand.cloud_cover,
        "cobertura_bbox_pct": round(cand.cobertura_pct, 1),
        "fuente": "INPE / AWS Open Data Registry (s3://brazil-eosats)",
        "algoritmo_pansharpen": "Brovey",
        "version_script": SCRIPT_VERSION,
        "pansharpen_stats": pansharpen_stats,
    }
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    logger.info(f"Metadata escrita → {metadata_path}")


@click.command()
@click.option(
    "--output",
    "output_dir",
    default="data/raw/cbers",
    show_default=True,
    help="Directorio de salida para los .tif descargados y el pansharpen.",
)
@click.option(
    "--cloud-threshold",
    "cloud_threshold",
    default=DEFAULT_CLOUD_THRESHOLD,
    type=int,
    show_default=True,
    help="Umbral máximo de cobertura nubosa (%) según STAC INPE.",
)
@click.option(
    "--dias",
    "dias",
    default=DEFAULT_DIAS,
    type=int,
    show_default=True,
    help="Ventana temporal en días hacia atrás para buscar escenas.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Forzar redescarga aunque el pansharpen del mes ya exista.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="No descarga ni procesa: sólo lista candidatos y elige el mejor.",
)
@click.option(
    "--no-stac",
    is_flag=True,
    default=False,
    help="Saltea la consulta a STAC INPE (cloud_cover quedará en None).",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    output_dir: str,
    cloud_threshold: int,
    dias: int,
    force: bool,
    dry_run: bool,
    no_stac: bool,
    nivel_log: str,
) -> None:
    """Descarga CBERS-4A WPM y produce pansharpen RGB de Posadas (2 m)."""
    setup_logger(nivel=nivel_log.upper())
    out = ensure_dir(resolve_path(output_dir))

    logger.info("=" * 60)
    logger.info(f"CBERS-4A WPM — Descarga + Pansharpen (v{SCRIPT_VERSION})")
    logger.info("=" * 60)
    logger.info(f"Output dir:        {out}")
    logger.info(f"Cloud threshold:   {cloud_threshold}%")
    logger.info(f"Ventana temporal:  últimos {dias} días")
    logger.info(f"Dry-run:           {dry_run}")
    logger.info(f"Force:             {force}")

    # Descubrir candidatos
    candidatos = descubrir_candidatos(
        dias_atras=dias,
        cloud_threshold=cloud_threshold,
        intentar_stac=not no_stac,
    )

    if not candidatos:
        logger.error(
            "No se encontró ninguna escena CBERS-4A WPM válida en S3 que cubra Posadas "
            f"en los últimos {dias} días con cloud_cover<={cloud_threshold}%."
        )
        logger.info(
            "Sugerencias: 1) ampliar --dias 365, 2) subir --cloud-threshold 50, "
            "3) revisar conectividad a brazil-eosats.s3.us-west-2.amazonaws.com."
        )
        sys.exit(2)

    logger.info("Top candidatos (mejor primero):")
    for i, c in enumerate(candidatos[:5]):
        cloud = f"{c.cloud_cover:.0f}%" if c.cloud_cover is not None else "?"
        flag = "+" if c.cubre_completo else " "
        logger.info(
            f"  [{i + 1}] {flag} {c.fecha[:4]}-{c.fecha[4:6]}-{c.fecha[6:]} | "
            f"path/row={c.path}/{c.row} | cloud={cloud} | "
            f"bbox-cover={c.cobertura_pct:.1f}% | {c.scene_id}"
        )

    elegida = candidatos[0]
    logger.info("=" * 60)
    logger.info(
        f"Escena elegida: {elegida.scene_id} (cloud={elegida.cloud_cover}, "
        f"cover={elegida.cobertura_pct:.1f}%)"
    )

    if dry_run:
        logger.info("Dry-run completado. No se descargó nada.")
        sys.exit(0)

    # Idempotencia: si ya existe el pansharpen del mes corriente, salimos
    pansharpen_path = out / f"posadas_{elegida.yyyymm}_pansharpen.tif"
    if cache_check(pansharpen_path) and not force:
        logger.info(f"Ya existe {pansharpen_path.name} → skip " "(usá --force para sobreescribir).")
        sys.exit(0)

    # Descargar bandas (recortadas)
    logger.info("Descargando 5 bandas recortadas al bbox de Posadas...")
    paths: Dict[str, Path] = {}
    for banda in ["pan", "red", "green", "blue", "nir"]:
        dest = out / f"cbers4a_{elegida.fecha}_{banda}.tif"
        if cache_check(dest) and not force:
            logger.info(f"  {banda}: ya existe en cache → skip")
            paths[banda] = dest
            continue
        ok = descargar_banda_recortada(elegida, banda, dest)
        if not ok:
            logger.error(f"Aborto: falló descarga de banda {banda}.")
            sys.exit(3)
        paths[banda] = dest

    # Pansharpen Brovey
    stats = pansharpen_brovey(
        pan_path=paths["pan"],
        red_path=paths["red"],
        green_path=paths["green"],
        blue_path=paths["blue"],
        output_path=pansharpen_path,
    )

    # Metadata para freshness (n_poligonos lo definirá el script 45b al recortar)
    metadata_path = out / f"posadas_{elegida.yyyymm}_metadata.json"
    _escribir_metadata(metadata_path, elegida, stats, n_poligonos=0)

    logger.info("=" * 60)
    logger.info("Resumen")
    logger.info("=" * 60)
    logger.info(f"  Pansharpen: {pansharpen_path}")
    logger.info(f"  Metadata:   {metadata_path}")
    logger.info("  Resolución: 2 m/pixel (PAN), 8 m fuente MS")
    logger.info("  Próximo paso: python scripts/45b_cbers_recortar.py " "(recortar a 43 polígonos)")
    sys.exit(0)


if __name__ == "__main__":
    main()
