"""Descarga WorldPop (versión Fase 1 básica) y recorta a bbox de Posadas.

Corresponde a la parte Fase 1 de la Tarea 1.5/Tarea 3.2 (Fase 2 la
mejora otro agente con INDEC/factores de corrección).

Fuente oficial: WorldPop Global 2000-2020 constrained / top-down.
URL pattern documentada: https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/ARG/arg_ppp_2020.tif

El raster está en grilla regular a 100m, proyección geográfica WGS84,
densidad de personas por pixel. Para Posadas, el archivo completo de
Argentina pesa ~100-150 MB; lo bajamos una vez, cachemeamos con MD5, y
recortamos a la bbox de interés con `rasterio.mask`.

Ejemplo de uso:
    # defaults
    python scripts/05_descarga_worldpop.py

    # año distinto (solo 2000-2020 disponibles en URL estándar)
    python scripts/05_descarga_worldpop.py --year 2020

Notas:
    - WorldPop subestima poblaciones en zonas de cambio rápido (asentamientos
      nuevos). Por eso Fase 2 aplica factor de corrección con edificios.
    - El raster recortado queda en data/raw/worldpop/posadas_pop_{año}.tif.
"""

from __future__ import annotations

import json
import shutil
import sys
import traceback
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

import click
from loguru import logger

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
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

from scripts.utils.config import Settings, load_settings
from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.io_geo import cache_check, hash_file
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, ensure_parent, resolve_path


SCRIPT_VERSION = "0.1.0"

# URL pattern oficial — hay variantes "constrained" (mejor en urbano) y "unconstrained".
# Usamos el "top-down unconstrained" que es el más directo para descarga.
WORLDPOP_URL_TEMPLATE = (
    "https://data.worldpop.org/GIS/Population/Global_2000_2020/"
    "{year}/{pais_upper}/{pais_lower}_ppp_{year}.tif"
)


def _parsear_bbox(bbox_cli: Optional[str], settings: Settings) -> Tuple[float, float, float, float]:
    """Parsea bbox desde CLI o settings."""
    if bbox_cli:
        partes = [float(x.strip()) for x in bbox_cli.split(",")]
        if len(partes) != 4:
            raise click.BadParameter("bbox debe tener 4 valores: oeste,sur,este,norte")
        return tuple(partes)  # type: ignore[return-value]
    return settings.geografia.bbox.as_tuple()


def _descargar_con_progreso(url: str, destino: Path) -> None:
    """Descarga una URL a un archivo con logging de progreso cada ~10 MB.

    No usamos tqdm acá porque es un único archivo grande: logueamos hitos.

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
                chunk = 1024 * 256  # 256 KB
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
    """Recorta un raster a una bbox (lon/lat WGS84) usando rasterio.mask.

    Args:
        raster_path: Raster de entrada.
        bbox: (oeste, sur, este, norte) en grados.
        destino: .tif recortado de salida.
        tags_extra: Tags a embeber.

    Returns:
        Dict con metadata del recorte (bounds, shape, resolucion, nodata).
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
        bounds_recorte = rasterio.transform.array_bounds(
            meta["height"], meta["width"], transform
        )
        resolucion = (transform.a, -transform.e)  # (px_x, px_y) en unidades del CRS
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
    help="Año de WorldPop (2000-2020 disponibles en URL estándar).",
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
    nivel_log: str,
) -> None:
    """Descarga WorldPop para el país y recorta a bbox de Posadas (Tarea 1.5 Fase 1)."""
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    # Prioridad: --bbox explícito > --poligonos derivado > settings.yaml default.
    if bbox_cli is None and poligonos_path is not None:
        import geopandas as gpd
        gdf = gpd.read_file(poligonos_path)
        west, south, east, north = gdf.total_bounds
        bbox_cli = f"{west},{south},{east},{north}"
        logger.info(
            f"BBox derivado de --poligonos ({poligonos_path}): {bbox_cli}"
        )
    bbox = _parsear_bbox(bbox_cli, settings)
    out_dir = ensure_dir(resolve_path(output_dir))

    pais_upper = pais.upper()
    pais_lower = pais.lower()
    url = WORLDPOP_URL_TEMPLATE.format(year=year, pais_upper=pais_upper, pais_lower=pais_lower)

    raster_global = out_dir / f"{pais_lower}_ppp_{year}.tif"
    raster_recorte = out_dir / f"posadas_pop_{year}.tif"
    meta_path = out_dir / f"posadas_pop_{year}.resumen.json"

    logger.info("=" * 60)
    logger.info("Descarga WorldPop — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"País:             {pais_upper}")
    logger.info(f"Año:              {year}")
    logger.info(f"BBox (O,S,E,N):   {bbox}")
    logger.info(f"URL:              {url}")
    logger.info(f"Raster global:    {raster_global}")
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
        marcador.write_text(
            f"Interrupción: {datetime.now().isoformat()}", encoding="utf-8"
        )

    with graceful_interrupt() as state:
        state.on_interrupt(_marcar)

        # 1) Descargar raster global si falta.
        if cache_check(raster_global) and not force:
            logger.info(f"Raster global ya en caché: {raster_global}")
        else:
            try:
                _descargar_con_progreso(url, raster_global)
            except Exception as exc:  # noqa: BLE001
                logger.error(f"Falló la descarga de WorldPop: {exc}")
                logger.error(
                    "Verificá manualmente que la URL siga vigente. WorldPop a veces "
                    "reorganiza paths. Alternativa: https://hub.worldpop.org/"
                )
                logger.debug(traceback.format_exc())
                sys.exit(2)

        # Info del raster global.
        try:
            import rasterio

            with rasterio.open(raster_global) as src:
                logger.info(
                    f"Raster global: CRS={src.crs} | shape={src.shape} | "
                    f"bounds={src.bounds} | nodata={src.nodata}"
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"No pude leer metadata del raster global: {exc}")

        # 2) Recortar a bbox Posadas.
        tags = {
            "fuente": "WorldPop Global 2000-2020 top-down unconstrained",
            "pais": pais_upper,
            "year": str(year),
            "url_origen": url,
            "fecha_descarga": datetime.now().isoformat(),
            "version_script": SCRIPT_VERSION,
        }
        try:
            info_recorte = _recortar_a_bbox(
                raster_path=raster_global,
                bbox=bbox,
                destino=raster_recorte,
                tags_extra=tags,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló el recorte: {exc}")
            logger.debug(traceback.format_exc())
            sys.exit(3)

        md5 = hash_file(raster_recorte)
        size_mb = raster_recorte.stat().st_size / (1024 * 1024)

        meta = {
            **tags,
            "bbox_solicitada": list(bbox),
            "bbox_efectiva": info_recorte["bounds"],
            "shape": info_recorte["shape"],
            "resolucion_deg": info_recorte["resolucion_deg"],
            "crs": info_recorte["crs"],
            "md5": md5,
            "size_mb": round(size_mb, 3),
        }
        with meta_path.open("w", encoding="utf-8") as fh:
            json.dump(meta, fh, ensure_ascii=False, indent=2)

        marcador.unlink(missing_ok=True)

        logger.info("=" * 60)
        logger.info("Recorte WorldPop OK.")
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
