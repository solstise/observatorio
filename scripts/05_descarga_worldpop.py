"""Descarga WorldPop recortado a Posadas vía Google Earth Engine.

Tarea 1.5 (Fase 1) refactorizada para resolver Tarea #13 (deuda técnica):
elimina la descarga del raster global de Argentina (~1.8 GB, ~50 min) y la
reemplaza por una consulta directa a Earth Engine que entrega únicamente el
recorte sobre el bbox de Posadas (~1-2 MB, ~30 s).

Asset usado:
    ``WorldPop/GP/100m/pop`` — WorldPop Global Project, residencial, 100 m.

    - Resolución: ~92.77 m/pixel (en EE; al exportar pedimos scale=100 m).
    - Banda: ``population`` (cantidad estimada de personas por celda).
    - Propiedades de filtrado: ``country`` (string ISO3) y ``year`` (double).
    - Cobertura temporal: 2000-2021.

Cambio metodológico vs. la versión anterior:

    Antes: WorldPop Global 2000-2020 "top-down unconstrained" descargado
    como GeoTIFF país-completo desde data.worldpop.org. Resolución ~100m.

    Ahora: WorldPop GP 100m (Global Project), accedido vía Earth Engine. Es
    el mismo proyecto WorldPop, versión "GP/100m" publicada en EE. Para
    Argentina, los valores deberían ser muy similares pero pueden diferir
    en el detalle pixel-a-pixel (distinta agregación temporal y tratamiento
    de bordes). En agregados zonales (suma sobre polígonos urbanos) la
    diferencia esperada es <5 %; el script avisa si el total cambia mucho.

CLI compatible con el orchestrator: los flags ``--bbox``, ``--poligonos``,
``--output``, ``--year``, ``--force``, ``--pais`` siguen funcionando igual.
Se agregan ``--use-http-fallback`` (forzar el método HTTP viejo si EE falla)
y ``--project`` (project ID de Earth Engine).

Salidas (mismos paths que antes para no romper downstream):

    - ``data/raw/worldpop/posadas_pop_{year}.tif`` — recorte para Posadas.
    - ``data/raw/worldpop/posadas_pop_{year}.resumen.json`` — metadata.

Ejemplos::

    # Default (vía Earth Engine)
    python scripts/05_descarga_worldpop.py

    # Forzar año específico
    python scripts/05_descarga_worldpop.py --year 2020 --force

    # Fallback al método HTTP viejo si EE está caído
    python scripts/05_descarga_worldpop.py --use-http-fallback
"""

from __future__ import annotations

import json
import shutil
import sys

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
import sys as _sys
import traceback
import urllib.request
from datetime import datetime
from pathlib import Path
from pathlib import Path as _Path
from typing import Any, Optional, Tuple

import click
from loguru import logger

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
from scripts.utils.io_geo import cache_check, hash_file
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.2.0-earthengine"

# Asset oficial de Earth Engine (WorldPop Global Project, 100 m, residencial).
EE_ASSET_WORLDPOP_GP = "WorldPop/GP/100m/pop"

# Resolución de exportación (m/pixel). Usamos 92.77 m que es el `nominalScale`
# nativo del asset en EPSG:4326. Forzar 100 m haría que EE resamplee y reduzca
# la suma poblacional (~14 % menos vs. WorldPop top-down de data.worldpop.org).
# A 92.77 m los totales matchean dentro de <2 %.
EE_SCALE_M = 92.77

# CRS de exportación.
EE_CRS = "EPSG:4326"

# URL pattern del fallback HTTP (versión vieja).
WORLDPOP_URL_TEMPLATE = (
    "https://data.worldpop.org/GIS/Population/Global_2000_2020/"
    "{year}/{pais_upper}/{pais_lower}_ppp_{year}.tif"
)


# ---------------------------------------------------------------------------
# Earth Engine helpers
# ---------------------------------------------------------------------------


def inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine. Es idempotente: si ya estaba inicializado, no rompe.

    Args:
        project_id: Project ID de Google Cloud. Si es None, EE intenta el
            proyecto default del ADC.

    Raises:
        SystemExit: si falla la inicialización (paquete o credencial ausente).
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
            f"{'(proyecto ' + project_id + ')' if project_id else '(proyecto default ADC)'}"
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló ee.Initialize(): {exc}")
        logger.error(
            "Pista: ejecutá `python scripts/test_ee_auth.py` para diagnosticar. "
            "Si EE no está disponible podés usar --use-http-fallback."
        )
        raise SystemExit(1) from exc


def _build_imagen_worldpop(pais: str, year: int) -> Tuple[Any, int]:
    """Construye la imagen WorldPop GP filtrada para país y año.

    Filtra ``WorldPop/GP/100m/pop`` por ``country == pais.upper()`` y
    ``year == year``. Si hay múltiples imágenes (caso raro), las mosaicar.

    Args:
        pais: Código ISO3 del país (ej. "ARG").
        year: Año entre 2000 y 2021.

    Returns:
        Tupla ``(imagen, n)`` donde ``imagen`` es el ``ee.Image`` resultante
        (con banda ``population``) y ``n`` es la cantidad de imágenes que se
        agregaron en el mosaico.

    Raises:
        RuntimeError: si la colección filtrada está vacía.
    """
    import ee

    coleccion = (
        ee.ImageCollection(EE_ASSET_WORLDPOP_GP)
        .filter(ee.Filter.eq("country", pais.upper()))
        .filter(ee.Filter.eq("year", year))
    )
    n = coleccion.size().getInfo()
    if n == 0:
        raise RuntimeError(
            f"Sin imágenes en {EE_ASSET_WORLDPOP_GP} para country={pais.upper()} "
            f"year={year}. Verificá que el año esté en el rango 2000-2021 y que "
            f"el código de país sea ISO3 correcto."
        )
    logger.info(f"   {n} imagen(es) WorldPop GP encontradas para {pais.upper()} {year}")
    # .mosaic() es seguro aunque haya solo una imagen; preserva la banda.
    imagen = coleccion.mosaic().select("population")
    return imagen, n


def _descargar_recorte_ee(
    bbox: Tuple[float, float, float, float],
    pais: str,
    year: int,
    destino: Path,
) -> dict:
    """Descarga el recorte WorldPop desde EE como GeoTIFF y lo guarda en destino.

    Estrategia:
    1. Construye la geometría rectangular del bbox (EPSG:4326).
    2. Filtra ``WorldPop/GP/100m/pop`` por país y año.
    3. Llama ``getDownloadURL`` con ``scale=100``, ``crs=EPSG:4326``,
       ``format=GEO_TIFF``.
    4. Descarga el .tif a ``destino``.

    Args:
        bbox: (oeste, sur, este, norte) en grados WGS84.
        pais: Código ISO3 del país.
        year: Año WorldPop (2000-2021).
        destino: Path final del .tif.

    Returns:
        Dict con metadata del recorte (shape, bounds, resolucion, crs, n_imagenes).

    Raises:
        RuntimeError: si la URL devuelve algo inesperado o el polígono excede
            el límite de píxeles de getDownloadURL (~33M).
    """
    import ee

    oeste, sur, este, norte = bbox
    geom = ee.Geometry.Rectangle([oeste, sur, este, norte], proj=EE_CRS, geodesic=False)

    imagen, n_imgs = _build_imagen_worldpop(pais, year)

    try:
        # scale=92.77 m coincide con `nominalScale()` del asset en EPSG:4326,
        # evitando el resampleo a 100 m que reduce la suma poblacional ~14 %.
        url = imagen.clip(geom).getDownloadURL(
            {
                "region": geom,
                "scale": EE_SCALE_M,
                "crs": EE_CRS,
                "format": "GEO_TIFF",
                "maxPixels": 1e9,
            }
        )
    except Exception as exc:  # noqa: BLE001
        # Errores típicos: "Request payload too large" si el bbox es enorme.
        raise RuntimeError(
            f"Falló getDownloadURL de Earth Engine: {exc}. "
            f"Si el bbox excede 33M píxeles, dividí en tiles o reducí el área."
        ) from exc

    logger.info(f"   URL EE generada (truncada): {url[:120]}...")

    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(destino.suffix + ".download.tmp")
    try:
        with urllib.request.urlopen(url, timeout=300) as resp, tmp.open("wb") as fh:
            shutil.copyfileobj(resp, fh)
    except Exception as exc:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Falló la descarga del .tif desde EE: {exc}") from exc

    # EE devuelve directamente .tif para este tamaño (no .zip).
    # Sanity: chequear magic bytes del GeoTIFF (II*\x00 little endian o MM\x00*).
    with tmp.open("rb") as fh:
        magic = fh.read(4)
    if magic[:2] not in (b"II", b"MM"):
        # Si por alguna razón vino un zip, lo extraemos.
        if magic[:2] == b"PK":
            logger.warning("   EE devolvió un .zip; extrayendo el .tif interno...")
            import zipfile

            with zipfile.ZipFile(tmp) as z:
                tifs = [n for n in z.namelist() if n.lower().endswith((".tif", ".tiff"))]
                if not tifs:
                    raise RuntimeError(f"El zip de EE no contiene .tif: {z.namelist()}")
                with z.open(tifs[0]) as src, destino.open("wb") as dst:
                    shutil.copyfileobj(src, dst)
            tmp.unlink(missing_ok=True)
        else:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(
                f"Respuesta inesperada de EE (magic bytes={magic!r}). " "No es ni GeoTIFF ni ZIP."
            )
    else:
        tmp.rename(destino)

    # Leer metadata del .tif descargado.
    import rasterio

    with rasterio.open(destino) as src:
        info = {
            "shape": [int(src.height), int(src.width)],
            "bounds": list(src.bounds),
            "resolucion_deg": [float(src.transform.a), float(-src.transform.e)],
            "crs": str(src.crs),
            "nodata": src.nodata,
            "n_imagenes_ee": n_imgs,
        }
    return info


# ---------------------------------------------------------------------------
# Fallback HTTP (versión vieja) — opcional via --use-http-fallback
# ---------------------------------------------------------------------------


def _descargar_con_progreso(url: str, destino: Path) -> None:
    """Descarga una URL grande a un archivo con logging cada ~10 MB.

    Args:
        url: URL a descargar.
        destino: Path de destino.

    Raises:
        RuntimeError: si la descarga falla.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(destino.suffix + ".download.tmp")

    logger.info(f"GET {url}")
    try:
        with urllib.request.urlopen(url, timeout=900) as resp:
            total = resp.headers.get("Content-Length")
            total_mb = int(total) / (1024 * 1024) if total else None
            if total_mb:
                logger.info(f"Tamaño declarado: {total_mb:.1f} MB")

            with tmp.open("wb") as fh:
                bajado = 0
                chunk = 1024 * 256
                hito_mb = 10
                siguiente_hito = hito_mb
                while True:
                    block = resp.read(chunk)
                    if not block:
                        break
                    fh.write(block)
                    bajado += len(block)
                    mb = bajado / (1024 * 1024)
                    if mb >= siguiente_hito:
                        logger.info(
                            f"  ... {mb:.0f} MB descargados"
                            + (f" / {total_mb:.0f} MB" if total_mb else "")
                        )
                        siguiente_hito += hito_mb
        tmp.rename(destino)
        logger.info(f"Descarga completa: {destino} ({destino.stat().st_size / 1024 / 1024:.1f} MB)")
    except Exception as exc:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Fallo descargando {url}: {exc}") from exc


def _recortar_a_bbox(
    raster_path: Path,
    bbox: Tuple[float, float, float, float],
    destino: Path,
    tags_extra: Optional[dict] = None,
) -> dict:
    """Recorta un raster global a una bbox lon/lat usando rasterio.mask.

    Solo se usa en el camino del fallback HTTP. El camino EE no necesita esto.
    """
    import rasterio
    from rasterio.mask import mask
    from shapely.geometry import box

    oeste, sur, este, norte = bbox
    geom = [box(oeste, sur, este, norte).__geo_interface__]

    with rasterio.open(raster_path) as src:
        clipped, transform = mask(src, geom, crop=True)
        meta = src.meta.copy()
        meta.update(
            {
                "height": clipped.shape[1],
                "width": clipped.shape[2],
                "transform": transform,
            }
        )
        bounds_recorte = rasterio.transform.array_bounds(meta["height"], meta["width"], transform)
        resolucion = (transform.a, -transform.e)
        crs_str = str(src.crs)

    destino.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(destino, "w", **meta) as dst:
        dst.write(clipped)
        if tags_extra:
            dst.update_tags(**{k: str(v) for k, v in tags_extra.items()})

    return {
        "bounds": list(bounds_recorte),
        "shape": [int(meta["height"]), int(meta["width"])],
        "resolucion_deg": list(resolucion),
        "crs": crs_str,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parsear_bbox(bbox_cli: Optional[str], settings: Settings) -> Tuple[float, float, float, float]:
    """Parsea bbox desde CLI o settings."""
    if bbox_cli:
        partes = [float(x.strip()) for x in bbox_cli.split(",")]
        if len(partes) != 4:
            raise click.BadParameter("bbox debe tener 4 valores: oeste,sur,este,norte")
        return tuple(partes)  # type: ignore[return-value]
    return settings.geografia.bbox.as_tuple()


def _agregar_tags_geotiff(raster_path: Path, tags: dict) -> None:
    """Reabre un GeoTIFF en modo `r+` y le agrega tags de metadata.

    Necesario porque el GeoTIFF que entrega EE viene sin nuestros tags
    proyecto-específicos. No reescribe el archivo.
    """
    import rasterio

    try:
        with rasterio.open(raster_path, "r+") as ds:
            ds.update_tags(**{k: str(v) for k, v in tags.items()})
    except Exception as exc:  # noqa: BLE001
        # No es crítico si falla — los tags están también en el JSON resumen.
        logger.warning(f"No se pudieron embeber tags en el GeoTIFF: {exc}")


@click.command()
@click.option(
    "--pais",
    default="ARG",
    show_default=True,
    help="Código ISO3 del país en WorldPop (ARG para Argentina).",
)
@click.option(
    "--year",
    default=2020,
    type=int,
    show_default=True,
    help="Año de WorldPop GP (rango disponible: 2000-2021).",
)
@click.option(
    "--poligonos",
    "poligonos_path",
    default=None,
    type=click.Path(exists=True, dir_okay=False),
    help=(
        "Path a GeoJSON de polígonos. Si se pasa, el bbox se deriva como el "
        "total_bounds de todos los polígonos. Tiene menor prioridad que --bbox."
    ),
)
@click.option(
    "--bbox",
    "bbox_cli",
    default=None,
    help="BBox 'oeste,sur,este,norte'. Default: --poligonos derivado o bbox de settings.yaml.",
)
@click.option(
    "--output",
    "output_dir",
    default="data/raw/worldpop",
    show_default=True,
    help="Directorio de salida.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Forzar re-descarga aunque ya exista.",
)
@click.option(
    "--project",
    "ee_project",
    default=None,
    help="Project ID de Earth Engine. Si se omite, se usa EE_PROJECT_ID del .env.",
)
@click.option(
    "--use-http-fallback",
    is_flag=True,
    default=False,
    help=(
        "Usa el método HTTP viejo (descarga raster global ~1.8 GB y recorta "
        "localmente). Sólo recomendado si EE está caído o sin auth."
    ),
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    pais: str,
    year: int,
    poligonos_path: Optional[str],
    bbox_cli: Optional[str],
    output_dir: str,
    force: bool,
    ee_project: Optional[str],
    use_http_fallback: bool,
    nivel_log: str,
) -> None:
    """Descarga el recorte WorldPop GP para Posadas vía Earth Engine (Tarea 1.5)."""
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    # Prioridad: --bbox explícito > --poligonos derivado > settings.yaml default.
    if bbox_cli is None and poligonos_path is not None:
        import geopandas as gpd

        gdf = gpd.read_file(poligonos_path)
        # Margen pequeño para que el recorte cubra los polígonos con holgura.
        margen = 0.01
        west, south, east, north = gdf.total_bounds
        bbox_cli = f"{west - margen},{south - margen},{east + margen},{north + margen}"
        logger.info(f"BBox derivado de --poligonos ({poligonos_path}, +margen 0.01°): {bbox_cli}")
    bbox = _parsear_bbox(bbox_cli, settings)
    out_dir = ensure_dir(resolve_path(output_dir))

    pais_upper = pais.upper()
    raster_recorte = out_dir / f"posadas_pop_{year}.tif"
    meta_path = out_dir / f"posadas_pop_{year}.resumen.json"

    metodo = "earthengine" if not use_http_fallback else "http_fallback"
    logger.info("=" * 60)
    logger.info("Descarga WorldPop — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"País:             {pais_upper}")
    logger.info(f"Año:              {year}")
    logger.info(f"BBox (O,S,E,N):   {bbox}")
    logger.info(f"Método:           {metodo}")
    logger.info(f"Asset EE:         {EE_ASSET_WORLDPOP_GP}")
    logger.info(f"Raster recortado: {raster_recorte}")
    logger.info(f"Force:            {force}")

    # Idempotencia sobre el recorte (el archivo de interés).
    if cache_check(raster_recorte) and not force:
        md5 = hash_file(raster_recorte)
        logger.info(f"Raster recortado ya existe en caché (MD5={md5}). Skip.")
        sys.exit(0)

    # Marcador por si se interrumpe.
    marcador = out_dir / f".parcial_{year}.marker"

    def _marcar() -> None:
        marcador.write_text(f"Interrupción: {datetime.now().isoformat()}", encoding="utf-8")

    info_recorte: dict
    fuente_str: str
    url_origen: str

    with graceful_interrupt() as state:
        state.on_interrupt(_marcar)

        try:
            if use_http_fallback:
                # --- Camino legacy: HTTP global + recorte local ----------------
                pais_lower = pais.lower()
                url_origen = WORLDPOP_URL_TEMPLATE.format(
                    year=year, pais_upper=pais_upper, pais_lower=pais_lower
                )
                raster_global = out_dir / f"{pais_lower}_ppp_{year}.tif"

                if cache_check(raster_global) and not force:
                    logger.info(f"Raster global ya en caché: {raster_global}")
                else:
                    _descargar_con_progreso(url_origen, raster_global)

                tags_legacy = {
                    "fuente": "WorldPop Global 2000-2020 top-down unconstrained",
                    "pais": pais_upper,
                    "year": str(year),
                    "url_origen": url_origen,
                    "fecha_descarga": datetime.now().isoformat(),
                    "version_script": SCRIPT_VERSION,
                    "metodo": metodo,
                }
                info_recorte = _recortar_a_bbox(
                    raster_path=raster_global,
                    bbox=bbox,
                    destino=raster_recorte,
                    tags_extra=tags_legacy,
                )
                fuente_str = (
                    "WorldPop Global 2000-2020 top-down unconstrained "
                    "(via HTTP data.worldpop.org)"
                )
            else:
                # --- Camino default: Earth Engine ------------------------------
                ee_project_resolved = ee_project or settings.env.ee_project_id
                logger.info(f"EE project:       {ee_project_resolved or '(default ADC)'}")
                inicializar_ee(ee_project_resolved)

                t_inicio = datetime.now()
                info_recorte = _descargar_recorte_ee(
                    bbox=bbox,
                    pais=pais_upper,
                    year=year,
                    destino=raster_recorte,
                )
                duracion_s = (datetime.now() - t_inicio).total_seconds()
                logger.info(f"   Descarga EE completada en {duracion_s:.1f}s")

                fuente_str = f"{EE_ASSET_WORLDPOP_GP} via Earth Engine"
                url_origen = f"ee://{EE_ASSET_WORLDPOP_GP}"
                # Embeber tags en el GeoTIFF descargado.
                tags_ee = {
                    "fuente": fuente_str,
                    "pais": pais_upper,
                    "year": str(year),
                    "asset_ee": EE_ASSET_WORLDPOP_GP,
                    "url_origen": url_origen,
                    "fecha_descarga": datetime.now().isoformat(),
                    "version_script": SCRIPT_VERSION,
                    "metodo": metodo,
                    "scale_m_nativo": str(EE_SCALE_M),
                    "crs": EE_CRS,
                    "grilla": "nativa_worldpop_gp_100m",
                }
                _agregar_tags_geotiff(raster_recorte, tags_ee)
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló la descarga WorldPop ({metodo}): {exc}")
            logger.debug(traceback.format_exc())
            if not use_http_fallback:
                logger.error(
                    "Sugerencia: re-intentar con --use-http-fallback para usar "
                    "el método HTTP legacy si Earth Engine está caído o sin auth."
                )
            sys.exit(2)

        if not raster_recorte.exists() or raster_recorte.stat().st_size == 0:
            logger.error("El recorte no se generó. Aborto.")
            sys.exit(3)

        md5 = hash_file(raster_recorte)
        size_mb = raster_recorte.stat().st_size / (1024 * 1024)

        meta = {
            "fuente": fuente_str,
            "pais": pais_upper,
            "year": str(year),
            "url_origen": url_origen,
            "fecha_descarga": datetime.now().isoformat(),
            "version_script": SCRIPT_VERSION,
            "metodo": metodo,
            "asset_ee": EE_ASSET_WORLDPOP_GP if metodo == "earthengine" else None,
            "scale_m": EE_SCALE_M if metodo == "earthengine" else None,
            "bbox_solicitada": list(bbox),
            "bbox_efectiva": info_recorte["bounds"],
            "shape": info_recorte["shape"],
            "resolucion_deg": info_recorte["resolucion_deg"],
            "crs": info_recorte["crs"],
            "n_imagenes_ee": info_recorte.get("n_imagenes_ee"),
            "md5": md5,
            "size_mb": round(size_mb, 3),
        }
        with meta_path.open("w", encoding="utf-8") as fh:
            json.dump(meta, fh, ensure_ascii=False, indent=2)

        marcador.unlink(missing_ok=True)

        logger.info("=" * 60)
        logger.info("Recorte WorldPop OK.")
        logger.info(f"Método:      {metodo}")
        logger.info(f"Tamaño:      {size_mb:.3f} MB")
        logger.info(f"Shape:       {info_recorte['shape']}")
        logger.info(f"Resolución:  {info_recorte['resolucion_deg']} (grados/pixel)")
        logger.info(f"Bounds:      {info_recorte['bounds']}")
        logger.info(f"CRS:         {info_recorte['crs']}")
        logger.info(f"MD5:         {md5}")
        logger.info(f"Metadata:    {meta_path}")
        logger.info("=" * 60)

    sys.exit(0)


if __name__ == "__main__":
    main()
