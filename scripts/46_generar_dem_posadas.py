"""Genera hillshade y DEM crudo de Posadas a partir de Copernicus GLO-30 (EE).

Corresponde a la Tarea 4.6 del PROMPT_OBSERVATORIO_POSADAS.md (overlays del
dashboard). Para el bbox configurado en `config/settings.yaml` descarga el
DEM de Copernicus (`COPERNICUS/DEM/GLO30`) desde Google Earth Engine y
produce dos artefactos:

    - `data/raw/dem/posadas_dem.tif` — DEM crudo en metros, EPSG:4326, 30m.
    - `webapp/frontend/public/data/media/hillshade_posadas.png` — PNG con el
      hillshade renderizado (azimut 315°, altitud 45°) listo para servir
      como `<ImageOverlay>` de Leaflet. Acompañado de un sidecar JSON
      `hillshade_posadas.json` con los `bounds` (lat/lon WGS84) que el
      frontend usa directamente en `L.latLngBounds(...)`.

El script es idempotente: si los dos artefactos ya existen, sale sin
recomputar salvo que se pase `--force`.

Ejemplo de uso:
    # Correr con defaults (bbox de settings.yaml, proyecto de .env)
    python scripts/46_generar_dem_posadas.py

    # Forzar recomputación aunque el PNG ya exista
    python scripts/46_generar_dem_posadas.py --force

    # Overridear azimut y altitud del sol
    python scripts/46_generar_dem_posadas.py --azimuth 300 --altitude 50
"""

from __future__ import annotations

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
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
import traceback
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import click
from loguru import logger

from scripts.utils.config import Settings, load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, ensure_parent, resolve_path

SCRIPT_VERSION = "0.1.0"

# Escala nominal del Copernicus GLO-30 DEM. El sensor real es ~30m en el
# ecuador; EE reporta 10m en el nombre porque es la resolución del pixel de
# la banda. Usamos 30m para descarga (evita overfetch y respeta la fuente).
ESCALA_DEM_M = 30

# Parámetros por default del hillshade (iluminación noroeste, 45° sobre el
# horizonte — estándar cartográfico para el hemisferio sur).
HILLSHADE_AZIMUTH_DEFAULT = 315.0
HILLSHADE_ALTITUDE_DEFAULT = 45.0

# Resolución del PNG exportado. 1024px de ancho es suficiente para el bbox
# de Posadas (~20km × 20km → ~50m/px, un poco supermuestreado sobre 30m).
HILLSHADE_PNG_WIDTH = 1024


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
            "y resolvé los errores de autenticación antes de continuar."
        )
        raise SystemExit(1) from exc


def _construir_dem_bbox(oeste: float, sur: float, este: float, norte: float):
    """Devuelve (dem_image, bbox_geom) para el bbox dado.

    Usa `COPERNICUS/DEM/GLO30` que es un ImageCollection global. Mosaicamos
    con mean() sobre el bbox para obtener una sola imagen de elevación.

    Args:
        oeste, sur, este, norte: coordenadas WGS84 del bbox.

    Returns:
        Tupla (ee.Image de elevación en metros, ee.Geometry del bbox).
    """
    import ee

    bbox_geom = ee.Geometry.Rectangle([oeste, sur, este, norte], proj="EPSG:4326", geodesic=False)
    # GLO30 es una ImageCollection; cada imagen tiene banda 'DEM'.
    coleccion = ee.ImageCollection("COPERNICUS/DEM/GLO30").filterBounds(bbox_geom).select("DEM")
    # mosaic() toma el pixel más reciente; para DEM estático da lo mismo que mean().
    dem = coleccion.mosaic().rename("elevation")
    return dem, bbox_geom


# ---------------------------------------------------------------------------
# Descarga
# ---------------------------------------------------------------------------


def _descargar_url(url: str, destino: Path) -> None:
    """Descarga una URL a un archivo destino."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=600) as resp, destino.open("wb") as fh:
        shutil.copyfileobj(resp, fh)


def _extraer_tif_de_zip(zip_path: Path, destino_tif: Path) -> None:
    """Extrae el primer .tif de un zip de EE al path destino."""
    with zipfile.ZipFile(zip_path) as z:
        tifs = [n for n in z.namelist() if n.lower().endswith((".tif", ".tiff"))]
        if not tifs:
            raise RuntimeError(f"El zip {zip_path} no contiene .tif")
        with z.open(tifs[0]) as src, destino_tif.open("wb") as dst:
            shutil.copyfileobj(src, dst)


def _descargar_image_como_tif(image, geom, destino_tif: Path, escala: int) -> None:
    """Baja un ee.Image como GeoTIFF vía getDownloadURL.

    Maneja tanto .zip (EE lo devuelve cuando hay múltiples bandas/regiones)
    como .tif directo (cuando es mono-banda y cabe en el límite).

    Args:
        image: ee.Image.
        geom: ee.Geometry del recorte (bbox).
        destino_tif: Path final del .tif.
        escala: Resolución en metros/pixel.
    """
    url = image.clip(geom).getDownloadURL(
        {
            "region": geom,
            "scale": escala,
            "crs": "EPSG:4326",
            "format": "GEO_TIFF",
            "maxPixels": 1e9,
        }
    )
    logger.debug(f"URL de descarga EE: {url[:80]}...")

    ensure_parent(destino_tif)
    tmp = destino_tif.with_suffix(".download.tmp")
    _descargar_url(url, tmp)

    with tmp.open("rb") as fh:
        magic = fh.read(4)
    if magic[:2] == b"PK":
        _extraer_tif_de_zip(tmp, destino_tif)
        tmp.unlink(missing_ok=True)
    else:
        tmp.rename(destino_tif)


# ---------------------------------------------------------------------------
# Renderizado del hillshade a PNG
# ---------------------------------------------------------------------------


def _renderizar_hillshade_png(
    dem_tif: Path,
    destino_png: Path,
    azimuth: float,
    altitude: float,
    width_px: int,
) -> Tuple[Dict[str, float], Tuple[int, int]]:
    """Lee un DEM en .tif, computa hillshade local y lo guarda como PNG.

    Usamos el algoritmo clásico de Horn (1981): gradientes por diferencias
    centrales, conversión del azimut y la altitud a radianes, y combinación
    coseno del ángulo de incidencia. Esto replica `ee.Terrain.hillshade`
    suficientemente bien y evita un segundo round-trip a EE (que a veces
    falla al exportar uint8 con padding).

    Args:
        dem_tif: Path al .tif de elevación.
        destino_png: Path de salida para el PNG 8-bit.
        azimuth: Azimut del sol en grados (0=norte, 90=este, 180=sur, 270=oeste).
        altitude: Altitud del sol sobre el horizonte en grados.
        width_px: Ancho en píxeles del PNG de salida (alto calculado para
            preservar aspecto del bbox en lat/lon).

    Returns:
        Tupla (bounds_dict, (width, height)). `bounds_dict` tiene las claves
        south/west/north/east en WGS84 para el sidecar JSON. `(width, height)`
        son las dimensiones reales del PNG.
    """
    import numpy as np
    import rasterio
    from PIL import Image

    with rasterio.open(dem_tif) as src:
        dem = src.read(1).astype("float32")
        bounds = src.bounds
        src_width = src.width
        src_height = src.height
        nodata = src.nodata

    logger.info(
        f"DEM cargado: {src_width}×{src_height} px | "
        f"bounds=(W={bounds.left:.4f}, S={bounds.bottom:.4f}, "
        f"E={bounds.right:.4f}, N={bounds.top:.4f})"
    )

    # Sanea nodata.
    if nodata is not None:
        dem = np.where(dem == nodata, np.nan, dem)
    dem_min = float(np.nanmin(dem))
    dem_max = float(np.nanmax(dem))
    logger.info(f"DEM elevación: min={dem_min:.1f}m max={dem_max:.1f}m")

    # Cell size aproximado en metros (asumimos píxeles cuadrados en grados y
    # convertimos la latitud central a metros con un factor único — suficiente
    # para un bbox chico como Posadas).
    lat_center = (bounds.top + bounds.bottom) / 2.0
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * float(np.cos(np.deg2rad(lat_center)))
    dx_deg = (bounds.right - bounds.left) / src_width
    dy_deg = (bounds.top - bounds.bottom) / src_height
    dx_m = dx_deg * m_per_deg_lon
    dy_m = dy_deg * m_per_deg_lat

    # Reemplazamos nan por el mínimo para que los gradientes no exploten.
    dem_filled = np.where(np.isnan(dem), dem_min, dem)

    # Gradientes por diferencias centrales (np.gradient devuelve dz/dy, dz/dx).
    dzdy, dzdx = np.gradient(dem_filled, dy_m, dx_m)
    # Nota: el eje Y del raster crece hacia el sur, por eso invertimos dzdy
    # para que pendientes positivas apunten al norte.
    dzdy = -dzdy

    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(dzdy, -dzdx)

    az_rad = np.deg2rad(360.0 - azimuth + 90.0)  # convención geográfica
    alt_rad = np.deg2rad(altitude)

    shaded = np.sin(alt_rad) * np.cos(slope) + np.cos(alt_rad) * np.sin(slope) * np.cos(
        az_rad - aspect
    )
    shaded = np.clip(shaded, 0.0, 1.0)
    shaded_uint8 = (shaded * 255).astype("uint8")

    # Resampleo al ancho deseado conservando aspecto lat/lon.
    target_h = max(1, int(round(width_px * (src_height / src_width))))
    img = Image.fromarray(shaded_uint8, mode="L")
    img = img.resize((width_px, target_h), Image.BILINEAR)

    # Convertimos a LA (gris + alpha). El alpha es una función de la intensidad
    # para que las zonas planas (shaded ~ sin(alt)) queden más transparentes y
    # no tapen las capas de abajo.
    arr = np.array(img, dtype="uint8")
    # Alpha: 0 cuando shaded=sin(alt) (plano puro), hasta 255 en caras de pendiente.
    base = int(np.sin(alt_rad) * 255)
    alpha = np.clip(np.abs(arr.astype("int16") - base) * 3, 0, 255).astype("uint8")
    la = np.stack([arr, alpha], axis=-1)
    img_la = Image.fromarray(la, mode="LA")

    ensure_parent(destino_png)
    img_la.save(destino_png, format="PNG", optimize=True)

    bounds_dict: Dict[str, float] = {
        "south": float(bounds.bottom),
        "west": float(bounds.left),
        "north": float(bounds.top),
        "east": float(bounds.right),
    }
    return bounds_dict, (width_px, target_h)


def _escribir_sidecar(
    png_path: Path,
    bounds: Dict[str, float],
    size_px: Tuple[int, int],
    dem_min: float,
    dem_max: float,
    azimuth: float,
    altitude: float,
) -> Path:
    """Escribe el sidecar JSON con bounds y metadata del PNG.

    Returns:
        Path del .json generado.
    """
    sidecar = png_path.with_suffix(".json")
    meta: Dict[str, Any] = {
        "fuente": "COPERNICUS/DEM/GLO30 via Google Earth Engine",
        "producto": "hillshade",
        "generado_por": f"scripts/46_generar_dem_posadas.py v{SCRIPT_VERSION}",
        "generado_en": datetime.now().isoformat(timespec="seconds"),
        "crs": "EPSG:4326",
        "bounds": bounds,
        "size_px": {"width": size_px[0], "height": size_px[1]},
        "hillshade": {
            "azimuth_deg": azimuth,
            "altitude_deg": altitude,
            "algoritmo": "Horn (1981) local",
        },
        "dem_elevacion_m": {
            "min": dem_min,
            "max": dem_max,
        },
    }
    sidecar.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return sidecar


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _resolver_paths(dem_tif_arg: str, hillshade_png_arg: str) -> Tuple[Path, Path]:
    """Convierte los paths de CLI a absolutos y asegura los directorios padres."""
    dem_tif = resolve_path(dem_tif_arg)
    hillshade_png = resolve_path(hillshade_png_arg)
    ensure_dir(dem_tif.parent)
    ensure_dir(hillshade_png.parent)
    return dem_tif, hillshade_png


@click.command(help="Genera hillshade y DEM crudo de Posadas desde Copernicus GLO-30.")
@click.option(
    "--project",
    "ee_project",
    default=None,
    help="Project ID de Earth Engine. Si se omite, se usa EE_PROJECT_ID del .env.",
)
@click.option(
    "--dem-tif",
    "dem_tif_arg",
    default="data/raw/dem/posadas_dem.tif",
    show_default=True,
    help="Path al GeoTIFF de elevación crudo de salida.",
)
@click.option(
    "--hillshade-png",
    "hillshade_png_arg",
    default="webapp/frontend/public/data/media/hillshade_posadas.png",
    show_default=True,
    help="Path al PNG de hillshade para el frontend.",
)
@click.option(
    "--azimuth",
    default=HILLSHADE_AZIMUTH_DEFAULT,
    show_default=True,
    help="Azimut del sol en grados (0=norte, 90=este).",
)
@click.option(
    "--altitude",
    default=HILLSHADE_ALTITUDE_DEFAULT,
    show_default=True,
    help="Altitud del sol sobre el horizonte en grados.",
)
@click.option(
    "--width-px",
    default=HILLSHADE_PNG_WIDTH,
    show_default=True,
    type=int,
    help="Ancho en píxeles del PNG exportado.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Recomputar aunque los artefactos ya existan.",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    ee_project: Optional[str],
    dem_tif_arg: str,
    hillshade_png_arg: str,
    azimuth: float,
    altitude: float,
    width_px: int,
    force: bool,
    nivel_log: str,
) -> None:
    """Descarga Copernicus GLO-30 DEM para el bbox de Posadas y genera hillshade."""
    setup_logger(nivel=nivel_log.upper())
    settings: Settings = load_settings()

    dem_tif, hillshade_png = _resolver_paths(dem_tif_arg, hillshade_png_arg)

    bbox = settings.geografia.bbox
    logger.info("=" * 60)
    logger.info("DEM Posadas — Copernicus GLO-30 via Earth Engine")
    logger.info("=" * 60)
    logger.info(f"Bbox: W={bbox.oeste} S={bbox.sur} E={bbox.este} N={bbox.norte} (WGS84)")
    logger.info(f"DEM crudo:       {dem_tif}")
    logger.info(f"Hillshade PNG:   {hillshade_png}")
    logger.info(f"Azimuth/Altitud: {azimuth}° / {altitude}°")
    logger.info(f"Proyecto EE:     {ee_project or settings.env.ee_project_id or '(default ADC)'}")

    sidecar = hillshade_png.with_suffix(".json")
    if not force and dem_tif.exists() and hillshade_png.exists() and sidecar.exists():
        logger.info("Artefactos ya existen. Usá --force para regenerarlos.")
        sys.exit(0)

    # 1. Inicializar EE.
    ee_project_resolved = ee_project or settings.env.ee_project_id
    inicializar_ee(ee_project_resolved)

    # 2. Armar el DEM y bajar el .tif crudo.
    try:
        dem_image, bbox_geom = _construir_dem_bbox(bbox.oeste, bbox.sur, bbox.este, bbox.norte)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló la construcción del DEM: {exc}")
        logger.debug(traceback.format_exc())
        sys.exit(2)

    if dem_tif.exists() and not force:
        logger.info(f"DEM crudo ya existe, no lo redescargo: {dem_tif}")
    else:
        logger.info("Descargando DEM crudo desde Earth Engine...")
        try:
            _descargar_image_como_tif(dem_image, bbox_geom, dem_tif, ESCALA_DEM_M)
            logger.info(f"DEM crudo guardado: {dem_tif} ({dem_tif.stat().st_size/1e6:.1f} MB)")
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló la descarga del DEM: {exc}")
            logger.debug(traceback.format_exc())
            sys.exit(3)

    # 3. Renderizar hillshade y sidecar.
    try:
        bounds, size_px = _renderizar_hillshade_png(
            dem_tif=dem_tif,
            destino_png=hillshade_png,
            azimuth=azimuth,
            altitude=altitude,
            width_px=width_px,
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló el renderizado del hillshade: {exc}")
        logger.debug(traceback.format_exc())
        sys.exit(4)

    # Metadata del sidecar (elevaciones re-leídas del tif para que queden registradas).
    import numpy as _np  # alias local para no chocar con import superior si se reordena
    import rasterio

    with rasterio.open(dem_tif) as src:
        dem_arr = src.read(1)
        nodata = src.nodata
    if nodata is not None:
        dem_arr = _np.where(dem_arr == nodata, _np.nan, dem_arr)
    dem_min = float(_np.nanmin(dem_arr))
    dem_max = float(_np.nanmax(dem_arr))

    sidecar_path = _escribir_sidecar(
        png_path=hillshade_png,
        bounds=bounds,
        size_px=size_px,
        dem_min=dem_min,
        dem_max=dem_max,
        azimuth=azimuth,
        altitude=altitude,
    )

    logger.info("-" * 60)
    logger.info(f"Hillshade PNG:   {hillshade_png} ({hillshade_png.stat().st_size/1e3:.1f} KB)")
    logger.info(f"Sidecar bounds:  {sidecar_path}")
    logger.info(f"Tamaño PNG:      {size_px[0]}×{size_px[1]} px")
    logger.info(f"Elevación:       {dem_min:.1f}m – {dem_max:.1f}m")
    logger.info("=" * 60)
    logger.info("OK. El frontend debe referenciar /data/media/hillshade_posadas.png")
    logger.info("y leer los bounds del sidecar JSON.")
    sys.exit(0)


if __name__ == "__main__":
    main()
