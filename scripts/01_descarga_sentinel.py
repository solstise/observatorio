"""Descarga composites Sentinel-2 SR desde Earth Engine para cada polígono y fecha.

Corresponde a la Tarea 1.4 del PROMPT_OBSERVATORIO_POSADAS.md.

Para cada (polígono, fecha-target) arma un composite mediano de Sentinel-2
SR_HARMONIZED filtrado por bounds, ventana ±60 días y CLOUDY_PIXEL_PERCENTAGE
bajo umbral. Aplica máscara de nubes usando la banda QA60. Exporta dos GeoTIFF:

    - `{poligono_id}_{YYYYMM}_rgb.tif`   — RGB 8-bit (B4, B3, B2) para timelapse.
    - `{poligono_id}_{YYYYMM}_multi.tif` — multi 16-bit (B2,B3,B4,B8,B11,B12)
      para análisis NDBI/NDVI posteriores.

Usa `getDownloadURL` para polígonos chicos (<30M píxeles). Para grandes,
divide en tiles con `split_polygon_into_tiles` de utils/io_geo y mosaicar
con rasterio.merge.

Manejo de interrupciones: guarda estado parcial y sale con 130.

Ejemplo de uso:
    # Correr con defaults (lee fechas de settings.yaml)
    python scripts/01_descarga_sentinel.py

    # Sobrescribir fechas
    python scripts/01_descarga_sentinel.py --fechas 2024-07,2025-07

    # Cambiar umbral de nubes
    python scripts/01_descarga_sentinel.py --cloud-threshold 30
"""

from __future__ import annotations

import json
import shutil
import sys

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
import sys as _sys
import tempfile
import traceback
import urllib.request
import zipfile
from datetime import datetime, timedelta
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

from scripts.utils.config import Settings, load_settings
from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.io_geo import (
    cache_check,
    estimate_pixels,
    load_geojson,
    split_polygon_into_tiles,
)
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

# Versión de este script — se escribe como tag en la metadata de los GeoTIFF.
SCRIPT_VERSION = "0.1.0"

# Bandas que exportamos. Las multi incluyen SWIR (B11, B12) resampleados a 10m.
BANDAS_RGB = ["B4", "B3", "B2"]
BANDAS_MULTI = ["B2", "B3", "B4", "B8", "B11", "B12"]

# Límite de píxeles de EE para getDownloadURL (oficialmente ~33M, dejamos margen).
MAX_PIXELS_DOWNLOAD_URL = 30_000_000

# Escala de Sentinel-2 en metros/pixel (10m para RGB+NIR, 20m para SWIR).
ESCALA_S2_M = 10


# ---------------------------------------------------------------------------
# Earth Engine helpers
# ---------------------------------------------------------------------------


def inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine (wrapper con mensajes útiles).

    Args:
        project_id: Project ID de Google Cloud. None acepta el default del ADC.

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
            f"Earth Engine inicializado "
            f"{'(proyecto ' + project_id + ')' if project_id else '(proyecto default)'}"
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló ee.Initialize(): {exc}")
        logger.error(
            "Ejecutá primero `python scripts/test_ee_auth.py --project PROJECT_ID` "
            "y resolvé los errores de autenticación antes de intentar descargar."
        )
        raise SystemExit(1) from exc


def _mask_s2_qa60(image):
    """Máscara de nubes usando la banda QA60 de Sentinel-2.

    Los bits 10 y 11 de QA60 indican nubes densas y cirrus respectivamente.
    Se enmascaran los píxeles con cualquiera de esos bits activos. La escala
    de reflectancia 0-10000 se normaliza a 0-1 dividiendo por 10000.

    Args:
        image: `ee.Image` de Sentinel-2 SR_HARMONIZED.

    Returns:
        `ee.Image` con máscara aplicada y reflectancia escalada a 0-1.
    """
    import ee

    qa = image.select("QA60")
    cloud_bit_mask = 1 << 10
    cirrus_bit_mask = 1 << 11
    mask = qa.bitwiseAnd(cloud_bit_mask).eq(0).And(qa.bitwiseAnd(cirrus_bit_mask).eq(0))
    # divide(10000) puede reescalar pero preservamos nombres originales.
    scaled = image.updateMask(mask).divide(10000)
    # ee.Image() asegura que el resultado sea tratado como Image tras copyProperties.
    return ee.Image(scaled.copyProperties(image, image.propertyNames()))


def _build_composite(
    geom,
    fecha_target: str,
    cloud_threshold: int,
    ventana_dias: int = 60,
) -> Tuple[Any, int]:
    """Construye composite mediano Sentinel-2 SR para una geometría y fecha objetivo.

    Args:
        geom: `ee.Geometry` del polígono.
        fecha_target: String YYYY-MM. Se interpreta como el día 15 del mes.
        cloud_threshold: % máximo de CLOUDY_PIXEL_PERCENTAGE.
        ventana_dias: Días a cada lado de la fecha target (default 60).

    Returns:
        Tupla (imagen_composite, n_imagenes_en_coleccion).
    """
    import ee

    # Interpretamos YYYY-MM como el día 15 de ese mes (mitad de mes).
    fecha_centro = datetime.strptime(fecha_target + "-15", "%Y-%m-%d")
    inicio = (fecha_centro - timedelta(days=ventana_dias)).strftime("%Y-%m-%d")
    fin = (fecha_centro + timedelta(days=ventana_dias)).strftime("%Y-%m-%d")

    coleccion = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(geom)
        .filterDate(inicio, fin)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_threshold))
    )

    n = coleccion.size().getInfo()
    if n == 0:
        # Sin filtro de nubes para intentar al menos saber si hay alguna imagen.
        n_total = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(geom)
            .filterDate(inicio, fin)
            .size()
            .getInfo()
        )
        logger.warning(
            f"   Sin imágenes con CLOUDY_PIXEL_PERCENTAGE<{cloud_threshold} "
            f"entre {inicio} y {fin}. Sin filtro había {n_total}."
        )
        return None, 0

    # Aplicamos máscara de nubes y hacemos mediana.
    coleccion_masked = coleccion.map(_mask_s2_qa60)
    composite = coleccion_masked.median()
    return composite, n


def _cloud_percentage_promedio(
    geom,
    fecha_target: str,
    cloud_threshold: int,
    ventana_dias: int = 60,
) -> Optional[float]:
    """Calcula el CLOUDY_PIXEL_PERCENTAGE promedio de las imágenes usadas en el composite.

    Útil para metadata. Si la colección está vacía devuelve None.
    """
    import ee

    fecha_centro = datetime.strptime(fecha_target + "-15", "%Y-%m-%d")
    inicio = (fecha_centro - timedelta(days=ventana_dias)).strftime("%Y-%m-%d")
    fin = (fecha_centro + timedelta(days=ventana_dias)).strftime("%Y-%m-%d")

    coleccion = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(geom)
        .filterDate(inicio, fin)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", cloud_threshold))
    )
    try:
        stats = coleccion.aggregate_mean("CLOUDY_PIXEL_PERCENTAGE").getInfo()
        return float(stats) if stats is not None else None
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Descarga
# ---------------------------------------------------------------------------


def _descargar_url(url: str, destino: Path) -> None:
    """Baja una URL a un archivo destino, creando el padre si hace falta.

    Args:
        url: URL a descargar.
        destino: Path de destino.

    Raises:
        RuntimeError: si la descarga falla.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=300) as resp, destino.open("wb") as fh:
            shutil.copyfileobj(resp, fh)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Fallo descargando {url}: {exc}") from exc


def _extraer_tif_de_zip(zip_path: Path, destino_tif: Path) -> None:
    """Extrae el primer .tif de un zip de EE y lo mueve a destino_tif.

    Earth Engine devuelve un zip con uno o más .tif dentro (bandas concatenadas).
    Para RGB y multi esperamos un único archivo multi-band.
    """
    with zipfile.ZipFile(zip_path) as z:
        tifs = [n for n in z.namelist() if n.lower().endswith((".tif", ".tiff"))]
        if not tifs:
            raise RuntimeError(f"El zip {zip_path} no contiene .tif")
        # EE puede exportar bandas separadas como `download.B4.tif`. Si hay más de uno
        # los mergeamos con rasterio a uno solo.
        if len(tifs) == 1:
            with z.open(tifs[0]) as src, destino_tif.open("wb") as dst:
                shutil.copyfileobj(src, dst)
        else:
            # Extraemos todo y fusionamos como bandas.
            tmpdir = zip_path.parent / (zip_path.stem + "_extract")
            tmpdir.mkdir(exist_ok=True)
            for name in tifs:
                with z.open(name) as src, (tmpdir / Path(name).name).open("wb") as dst:
                    shutil.copyfileobj(src, dst)
            _concat_bandas_a_tif(sorted(tmpdir.glob("*.tif")), destino_tif)
            shutil.rmtree(tmpdir, ignore_errors=True)


def _concat_bandas_a_tif(tifs: List[Path], destino: Path) -> None:
    """Concatena varios TIFFs mono-banda en uno multi-banda.

    Args:
        tifs: Lista de .tif mono-banda en el mismo CRS/extent.
        destino: .tif multi-banda de salida.
    """
    import rasterio

    if not tifs:
        raise RuntimeError("No hay .tif para concatenar.")

    with rasterio.open(tifs[0]) as src0:
        meta = src0.meta.copy()
        meta.update(count=len(tifs))
        with rasterio.open(destino, "w", **meta) as dst:
            for i, p in enumerate(tifs, start=1):
                with rasterio.open(p) as src:
                    dst.write(src.read(1), i)


def _descargar_tile(
    image,
    geom,
    bandas: List[str],
    destino: Path,
    escala: int = ESCALA_S2_M,
) -> None:
    """Descarga una ee.Image recortada a una geometría en GeoTIFF vía getDownloadURL.

    Args:
        image: `ee.Image` (ya con máscara, escalado o no).
        geom: `ee.Geometry` del recorte.
        bandas: Lista de bandas a exportar.
        destino: Path final del .tif.
        escala: Resolución en metros/pixel.
    """
    url = (
        image.select(bandas)
        .clip(geom)
        .getDownloadURL(
            {
                "region": geom,
                "scale": escala,
                "crs": "EPSG:4326",
                "format": "GEO_TIFF",
                "maxPixels": 1e9,
            }
        )
    )

    destino.parent.mkdir(parents=True, exist_ok=True)
    # EE puede devolver zip o tif directo según el tamaño. Manejamos ambos casos.
    tmp = destino.with_suffix(".download.tmp")
    _descargar_url(url, tmp)

    # Detectamos si es zip por magic bytes.
    with tmp.open("rb") as fh:
        magic = fh.read(4)
    if magic[:2] == b"PK":
        # Es un zip.
        _extraer_tif_de_zip(tmp, destino)
        tmp.unlink(missing_ok=True)
    else:
        # Es un .tif directo.
        tmp.rename(destino)


def _descargar_con_tiles(
    image,
    polygon_geom,
    bandas: List[str],
    destino_final: Path,
    escala: int = ESCALA_S2_M,
) -> None:
    """Descarga una imagen dividida en tiles y la mosaicar localmente.

    Se invoca cuando el polígono excede `MAX_PIXELS_DOWNLOAD_URL`.

    Args:
        image: `ee.Image` ya compuesta.
        polygon_geom: `shapely.Polygon` original en EPSG:4326.
        bandas: Bandas a exportar.
        destino_final: Path destino del .tif mosaicado.
        escala: Metros por pixel.
    """
    import ee
    import rasterio
    from rasterio.merge import merge

    tiles = split_polygon_into_tiles(
        polygon_geom,
        max_pixels=MAX_PIXELS_DOWNLOAD_URL,
        resolution_m=escala,
    )
    logger.info(f"   Polígono grande → dividido en {len(tiles)} tiles para descarga")

    with tempfile.TemporaryDirectory(prefix="s2_tiles_") as tmpdir:
        tile_paths: List[Path] = []
        for idx, tile_poly in enumerate(tiles):
            tile_geom = ee.Geometry.Polygon(
                list(tile_poly.exterior.coords), proj="EPSG:4326", evenOdd=False
            )
            tile_path = Path(tmpdir) / f"tile_{idx:03d}.tif"
            _descargar_tile(image, tile_geom, bandas, tile_path, escala)
            tile_paths.append(tile_path)

        # Mosaicar con rasterio.merge.
        srcs = [rasterio.open(p) for p in tile_paths]
        try:
            mosaic, transform = merge(srcs)
            meta = srcs[0].meta.copy()
            meta.update(
                {
                    "height": mosaic.shape[1],
                    "width": mosaic.shape[2],
                    "transform": transform,
                    "count": mosaic.shape[0],
                }
            )
            destino_final.parent.mkdir(parents=True, exist_ok=True)
            with rasterio.open(destino_final, "w", **meta) as dst:
                dst.write(mosaic)
        finally:
            for s in srcs:
                s.close()


# ---------------------------------------------------------------------------
# Conversión y tagging
# ---------------------------------------------------------------------------


def _escalar_a_rgb_8bit(
    src_tif: Path, dst_tif: Path, metadata_tags: Dict[str, str]
) -> Dict[str, float]:
    """Convierte un .tif de reflectancia 0-1 (B4,B3,B2) a RGB 8-bit 0-255.

    Aplica stretch por percentil 2-98 por banda (recomendado sobre min-max,
    ver PROMPT sección 10.1).

    Args:
        src_tif: .tif de reflectancia con 3 bandas en orden B4, B3, B2.
        dst_tif: Path destino 8-bit.
        metadata_tags: Tags a embeber como metadata del .tif.

    Returns:
        Dict con estadísticas por banda (p2, p98) para log/telemetría.
    """
    import numpy as np
    import rasterio

    with rasterio.open(src_tif) as src:
        data = src.read()  # shape (bands, h, w)
        meta = src.meta.copy()

    stats: Dict[str, float] = {}
    out = np.zeros_like(data, dtype="uint8")
    for i in range(data.shape[0]):
        band = data[i]
        valid = band[np.isfinite(band) & (band > 0)]
        if valid.size == 0:
            p2, p98 = 0.0, 1.0
        else:
            p2 = float(np.percentile(valid, 2))
            p98 = float(np.percentile(valid, 98))
        stats[f"banda_{i+1}_p2"] = p2
        stats[f"banda_{i+1}_p98"] = p98
        if p98 - p2 < 1e-6:
            out[i] = 0
        else:
            clipped = np.clip((band - p2) / (p98 - p2), 0, 1)
            out[i] = (clipped * 255).astype("uint8")

    meta.update(dtype="uint8", nodata=0)
    with rasterio.open(dst_tif, "w", **meta) as dst:
        dst.write(out)
        dst.update_tags(**{k: str(v) for k, v in metadata_tags.items()})
    return stats


def _escalar_a_multi_16bit(src_tif: Path, dst_tif: Path, metadata_tags: Dict[str, str]) -> None:
    """Convierte un .tif de reflectancia 0-1 a 16-bit (factor 10000 — como viene de ESA).

    Args:
        src_tif: Multi-banda 0-1.
        dst_tif: Destino 16-bit uint.
        metadata_tags: Tags a embeber.
    """
    import numpy as np
    import rasterio

    with rasterio.open(src_tif) as src:
        data = src.read()
        meta = src.meta.copy()

    # Reflectancia 0-1 → 0-10000 uint16.
    scaled = np.clip(data * 10000, 0, 65535).astype("uint16")

    meta.update(dtype="uint16", nodata=0)
    with rasterio.open(dst_tif, "w", **meta) as dst:
        dst.write(scaled)
        dst.update_tags(**{k: str(v) for k, v in metadata_tags.items()})


# ---------------------------------------------------------------------------
# Pipeline por polígono-fecha
# ---------------------------------------------------------------------------


def _procesar_poligono_fecha(
    poligono_id: str,
    geometry_geojson: dict,
    fecha_target: str,
    cloud_threshold: int,
    output_dir: Path,
) -> Dict[str, Any]:
    """Procesa un par (polígono, fecha) y exporta los dos GeoTIFF.

    Args:
        poligono_id: Identificador del polígono (slug).
        geometry_geojson: Diccionario GeoJSON de la geometría.
        fecha_target: String YYYY-MM.
        cloud_threshold: Umbral nubes.
        output_dir: Directorio de salida.

    Returns:
        Dict con resumen: {poligono_id, fecha_target, n_imagenes, rgb_path,
        multi_path, cloud_pct_mean, pixels_estimados, warnings}.
    """
    import ee
    from shapely.geometry import shape

    yyyymm = fecha_target.replace("-", "")  # "2024-07" → "202407"
    rgb_path = output_dir / f"{poligono_id}_{yyyymm}_rgb.tif"
    multi_path = output_dir / f"{poligono_id}_{yyyymm}_multi.tif"

    resultado: Dict[str, Any] = {
        "poligono_id": poligono_id,
        "fecha_target": fecha_target,
        "n_imagenes": 0,
        "rgb_path": str(rgb_path),
        "multi_path": str(multi_path),
        "cloud_pct_mean": None,
        "pixels_estimados": None,
        "warnings": [],
        "status": "pendiente",
    }

    # Idempotencia — si ya existen ambos, skip.
    if cache_check(rgb_path) and cache_check(multi_path):
        logger.info(f"[{poligono_id}|{fecha_target}] Ya existe en caché → skip")
        resultado["status"] = "cache_hit"
        return resultado

    # Construimos la geometría EE y la shapely.
    try:
        ee_geom = ee.Geometry(geometry_geojson)
        shp_geom = shape(geometry_geojson)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[{poligono_id}] Geometría inválida: {exc}")
        resultado["status"] = "error_geometria"
        resultado["warnings"].append(str(exc))
        return resultado

    pixels_est = estimate_pixels(shp_geom, resolution_m=ESCALA_S2_M)
    resultado["pixels_estimados"] = pixels_est
    logger.info(
        f"[{poligono_id}|{fecha_target}] Pixeles estimados: {pixels_est:,} "
        f"({'tile único' if pixels_est <= MAX_PIXELS_DOWNLOAD_URL else 'tiles múltiples'})"
    )

    composite, n = _build_composite(ee_geom, fecha_target, cloud_threshold)
    resultado["n_imagenes"] = n

    if composite is None or n == 0:
        msg = f"Sin imágenes válidas para {poligono_id} en {fecha_target}"
        logger.warning(msg)
        resultado["warnings"].append(msg)
        resultado["status"] = "sin_datos"
        return resultado

    # Estadística informativa.
    cloud_mean = _cloud_percentage_promedio(ee_geom, fecha_target, cloud_threshold)
    resultado["cloud_pct_mean"] = cloud_mean
    logger.info(
        f"[{poligono_id}|{fecha_target}] N imágenes={n} | "
        f"CLOUDY_PIXEL_PERCENTAGE promedio={cloud_mean}"
    )

    # Metadata para los .tif.
    tags_base = {
        "fuente": "Sentinel-2 SR_HARMONIZED via Google Earth Engine",
        "fecha_target": fecha_target,
        "fecha_descarga": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "cloud_threshold_filtro": str(cloud_threshold),
        "cloud_pct_promedio": f"{cloud_mean:.2f}" if cloud_mean is not None else "NA",
        "n_imagenes_composite": str(n),
        "version_script": SCRIPT_VERSION,
        "poligono_id": poligono_id,
    }

    # --- RGB ---
    tmp_rgb = output_dir / f".tmp_{poligono_id}_{yyyymm}_rgb_float.tif"
    try:
        if pixels_est <= MAX_PIXELS_DOWNLOAD_URL:
            _descargar_tile(composite, ee_geom, BANDAS_RGB, tmp_rgb)
        else:
            _descargar_con_tiles(composite, shp_geom, BANDAS_RGB, tmp_rgb)

        tags_rgb = dict(tags_base, tipo="rgb_8bit", bandas=",".join(BANDAS_RGB))
        stats = _escalar_a_rgb_8bit(tmp_rgb, rgb_path, tags_rgb)
        logger.info(
            f"[{poligono_id}|{fecha_target}] RGB 8-bit exportado → {rgb_path.name} "
            f"(stretch p2/p98 por banda)"
        )
        logger.debug(f"   stats: {stats}")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[{poligono_id}|{fecha_target}] Falló export RGB: {exc}")
        logger.debug(traceback.format_exc())
        resultado["warnings"].append(f"rgb_error: {exc}")
    finally:
        tmp_rgb.unlink(missing_ok=True)

    # --- MULTI ---
    tmp_multi = output_dir / f".tmp_{poligono_id}_{yyyymm}_multi_float.tif"
    try:
        if pixels_est <= MAX_PIXELS_DOWNLOAD_URL:
            _descargar_tile(composite, ee_geom, BANDAS_MULTI, tmp_multi)
        else:
            _descargar_con_tiles(composite, shp_geom, BANDAS_MULTI, tmp_multi)

        tags_multi = dict(tags_base, tipo="multi_16bit", bandas=",".join(BANDAS_MULTI))
        _escalar_a_multi_16bit(tmp_multi, multi_path, tags_multi)
        logger.info(f"[{poligono_id}|{fecha_target}] MULTI 16-bit exportado → {multi_path.name}")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[{poligono_id}|{fecha_target}] Falló export MULTI: {exc}")
        logger.debug(traceback.format_exc())
        resultado["warnings"].append(f"multi_error: {exc}")
    finally:
        tmp_multi.unlink(missing_ok=True)

    if cache_check(rgb_path) and cache_check(multi_path):
        resultado["status"] = "ok"
    else:
        resultado["status"] = "parcial"

    return resultado


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parsear_fechas(fechas_cli: Optional[str], settings: Settings) -> List[str]:
    """Devuelve la lista de fechas target desde CLI o settings.yaml."""
    if fechas_cli:
        return [f.strip() for f in fechas_cli.split(",") if f.strip()]
    return settings.sentinel2.fechas_target


def _guardar_resumen_parcial(resumen: List[Dict[str, Any]], destino: Path) -> None:
    """Guarda un CSV/JSON parcial con el resumen de lo procesado. Robusto a fallas."""
    try:
        destino.parent.mkdir(parents=True, exist_ok=True)
        with destino.open("w", encoding="utf-8") as fh:
            json.dump(resumen, fh, ensure_ascii=False, indent=2)
        logger.info(f"Resumen parcial guardado → {destino}")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"No se pudo guardar resumen parcial: {exc}")


@click.command()
@click.option(
    "--poligonos",
    "poligonos_path",
    default="config/poligonos.geojson",
    show_default=True,
    help="Path al GeoJSON de polígonos.",
)
@click.option(
    "--fechas",
    "fechas_cli",
    default=None,
    help=(
        "Fechas target separadas por coma (ej: '2018-07,2019-07'). "
        "Si se omite, se usan las de settings.yaml."
    ),
)
@click.option(
    "--output",
    "output_dir",
    default="data/raw/sentinel2",
    show_default=True,
    help="Directorio de salida para los GeoTIFF.",
)
@click.option(
    "--cloud-threshold",
    "cloud_threshold",
    default=None,
    type=int,
    help="Umbral de CLOUDY_PIXEL_PERCENTAGE (default: de settings.yaml).",
)
@click.option(
    "--project",
    "ee_project",
    default=None,
    help="Project ID de Earth Engine. Si se omite, se usa EE_PROJECT_ID del .env.",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    poligonos_path: str,
    fechas_cli: Optional[str],
    output_dir: str,
    cloud_threshold: Optional[int],
    ee_project: Optional[str],
    nivel_log: str,
) -> None:
    """Descarga composites Sentinel-2 SR por polígono y fecha (Tarea 1.4)."""
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    # Resolución de parámetros.
    thr = cloud_threshold if cloud_threshold is not None else settings.sentinel2.cloud_threshold
    fechas = _parsear_fechas(fechas_cli, settings)
    out = ensure_dir(resolve_path(output_dir))
    ee_project_resolved = ee_project or settings.env.ee_project_id

    logger.info("=" * 60)
    logger.info("Descarga Sentinel-2 SR — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"Polígonos:          {poligonos_path}")
    logger.info(f"Fechas target:      {', '.join(fechas)}")
    logger.info(f"Cloud threshold:    {thr}%")
    logger.info(f"Output dir:         {out}")
    logger.info(f"EE project:         {ee_project_resolved or '(default del ADC)'}")

    # Inicialización.
    inicializar_ee(ee_project_resolved)
    gdf = load_geojson(poligonos_path)
    if "id" not in gdf.columns:
        logger.error("El GeoJSON no tiene la columna 'id' en properties. No se puede continuar.")
        sys.exit(2)

    logger.info(f"Se cargaron {len(gdf)} polígonos.")

    # Estado compartido para persistencia parcial si llega Ctrl+C.
    resumen: List[Dict[str, Any]] = []
    resumen_path = out / "_resumen_descarga.json"

    with graceful_interrupt() as state:
        state.on_interrupt(lambda: _guardar_resumen_parcial(resumen, resumen_path))

        total_combinaciones = len(gdf) * len(fechas)
        logger.info(f"Total combinaciones (polígono × fecha): {total_combinaciones}")

        pbar = tqdm(total=total_combinaciones, desc="Descargas S2", unit="img")
        try:
            for _, row in gdf.iterrows():
                poligono_id = str(row["id"])
                geom_geojson = row.geometry.__geo_interface__
                for fecha in fechas:
                    try:
                        res = _procesar_poligono_fecha(
                            poligono_id=poligono_id,
                            geometry_geojson=geom_geojson,
                            fecha_target=fecha,
                            cloud_threshold=thr,
                            output_dir=out,
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.error(f"[{poligono_id}|{fecha}] Excepción no manejada: {exc}")
                        logger.debug(traceback.format_exc())
                        res = {
                            "poligono_id": poligono_id,
                            "fecha_target": fecha,
                            "status": "excepcion",
                            "warnings": [str(exc)],
                        }
                    resumen.append(res)
                    pbar.update(1)
        finally:
            pbar.close()

    # Guardado final del resumen.
    _guardar_resumen_parcial(resumen, resumen_path)

    # --- Honestidad metodológica: resumen por consola ---
    total = len(resumen)
    ok = sum(1 for r in resumen if r.get("status") == "ok")
    cache = sum(1 for r in resumen if r.get("status") == "cache_hit")
    sin_datos = sum(1 for r in resumen if r.get("status") == "sin_datos")
    errores = sum(
        1 for r in resumen if r.get("status") in ("parcial", "excepcion", "error_geometria")
    )
    warnings_count = sum(len(r.get("warnings", [])) for r in resumen)

    logger.info("=" * 60)
    logger.info("Resumen descarga Sentinel-2")
    logger.info("=" * 60)
    logger.info(f"Total combinaciones:  {total}")
    logger.info(f"OK (nuevas):          {ok}")
    logger.info(f"OK (cache hit):       {cache}")
    logger.info(f"Sin datos/nubes:      {sin_datos}")
    logger.info(f"Con errores:          {errores}")
    logger.info(f"Warnings acumulados:  {warnings_count}")
    pct_valido = (ok + cache) / total * 100 if total else 0
    logger.info(f"% de fechas con datos válidos: {pct_valido:.1f}%")
    logger.info(f"Resumen JSON: {resumen_path}")

    if errores > 0:
        logger.warning(
            "Hubo combinaciones con errores. Revisá el log y corré de nuevo "
            "(la idempotencia salta lo ya descargado)."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
