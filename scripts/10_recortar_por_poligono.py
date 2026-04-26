"""Utility reusable — recorta un raster grande en sub-rasters por polígono.

Dado un raster (GeoTIFF) y un GeoJSON de polígonos, genera un .tif por
polígono recortado a la geometría correspondiente. Preserva CRS, nodata y
metadata. Si el raster y los polígonos están en CRS distintos, reproyecta
las geometrías al CRS del raster antes de recortar (es más barato
computacionalmente que reproyectar el raster).

Forma parte del pipeline de Fase 1 como paso genérico: se usa típicamente
sobre el raster de WorldPop recortado a bbox Posadas, para obtener
sub-rasters por barrio.

Ejemplo de uso:
    python scripts/10_recortar_por_poligono.py \\
        --raster data/raw/worldpop/posadas_pop_2020.tif \\
        --poligonos config/poligonos.geojson \\
        --output-dir data/processed/recortes/worldpop

Output: `{poligono_id}_{raster_basename}.tif` en --output-dir.
"""

from __future__ import annotations

import json
import sys

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
import sys as _sys
import traceback
from datetime import datetime
from pathlib import Path
from pathlib import Path as _Path
from typing import Dict, List, Optional

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

from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.io_geo import hash_file, load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"


def _recortar_uno(
    raster_path: Path,
    geom_geojson: dict,
    poligono_id: str,
    destino: Path,
    raster_basename: str,
    raster_crs: str,
    polygons_crs_epsg: Optional[int],
) -> Optional[Dict]:
    """Recorta un raster a una geometría y lo guarda.

    Args:
        raster_path: Ruta al raster fuente.
        geom_geojson: Geometría del polígono en su CRS original.
        poligono_id: ID del polígono para logging.
        destino: Path destino del .tif recortado.
        raster_basename: Nombre base del raster, para tags.
        raster_crs: CRS del raster (str).
        polygons_crs_epsg: EPSG de los polígonos (int o None).

    Returns:
        Dict con metadata del recorte, o None si no hubo intersección.
    """
    import pyproj
    import rasterio
    from rasterio.mask import mask
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform

    geom = shape(geom_geojson)

    # Si los CRS difieren, reproyectamos la geometría al CRS del raster.
    with rasterio.open(raster_path) as src:
        raster_crs_obj = src.crs
        if polygons_crs_epsg and raster_crs_obj and raster_crs_obj.to_epsg() != polygons_crs_epsg:
            logger.debug(
                f"[{poligono_id}] Reproyectando polígono {polygons_crs_epsg} → "
                f"{raster_crs_obj.to_epsg()}"
            )
            transformer = pyproj.Transformer.from_crs(
                f"EPSG:{polygons_crs_epsg}", raster_crs_obj, always_xy=True
            )
            geom = shp_transform(transformer.transform, geom)

        try:
            clipped, transform = mask(src, [geom.__geo_interface__], crop=True, filled=True)
        except ValueError as exc:
            # Puede levantar "Input shapes do not overlap raster" si no hay intersección.
            logger.warning(f"[{poligono_id}] Sin intersección con el raster: {exc}")
            return None

        meta = src.meta.copy()
        meta.update(
            {
                "height": clipped.shape[1],
                "width": clipped.shape[2],
                "transform": transform,
            }
        )
        bounds = rasterio.transform.array_bounds(meta["height"], meta["width"], transform)

    destino.parent.mkdir(parents=True, exist_ok=True)
    tags = {
        "fuente_raster": raster_basename,
        "poligono_id": poligono_id,
        "fecha_recorte": datetime.now().isoformat(),
        "version_script": SCRIPT_VERSION,
        "crs": str(raster_crs),
    }
    with rasterio.open(destino, "w", **meta) as dst:
        dst.write(clipped)
        dst.update_tags(**{k: str(v) for k, v in tags.items()})

    return {
        "poligono_id": poligono_id,
        "destino": str(destino),
        "shape": [int(meta["height"]), int(meta["width"])],
        "bounds": list(bounds),
        "crs": str(raster_crs),
    }


@click.command()
@click.option(
    "--raster",
    "raster_path_str",
    required=True,
    help="Path al raster fuente (.tif).",
)
@click.option(
    "--poligonos",
    "poligonos_path",
    required=True,
    help="Path al GeoJSON de polígonos.",
)
@click.option(
    "--output-dir",
    "output_dir",
    required=True,
    help="Directorio de salida para los recortes.",
)
@click.option(
    "--prefix",
    default=None,
    help="Prefijo opcional del archivo de salida (default: basename del raster).",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    raster_path_str: str,
    poligonos_path: str,
    output_dir: str,
    prefix: Optional[str],
    nivel_log: str,
) -> None:
    """Recorta un raster por cada polígono de un GeoJSON."""
    setup_logger(nivel=nivel_log.upper())

    raster_path = resolve_path(raster_path_str)
    out_dir = ensure_dir(resolve_path(output_dir))
    if not raster_path.exists():
        logger.error(f"Raster no existe: {raster_path}")
        sys.exit(2)

    raster_basename = raster_path.stem
    prefix = prefix or raster_basename

    logger.info("=" * 60)
    logger.info("Recorte de raster por polígono — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"Raster:      {raster_path}")
    logger.info(f"Polígonos:   {poligonos_path}")
    logger.info(f"Output dir:  {out_dir}")
    logger.info(f"Prefix:      {prefix}")

    gdf = load_geojson(poligonos_path)
    if "id" not in gdf.columns:
        logger.error("El GeoJSON no tiene columna 'id'. No se puede continuar.")
        sys.exit(2)

    polygons_crs_epsg = gdf.crs.to_epsg() if gdf.crs is not None else 4326

    # Info del raster.
    try:
        import rasterio

        with rasterio.open(raster_path) as src:
            raster_crs = str(src.crs)
            logger.info(f"Raster CRS: {raster_crs} | shape={src.shape} | bounds={src.bounds}")
    except Exception as exc:  # noqa: BLE001
        logger.error(f"No pude abrir el raster: {exc}")
        sys.exit(3)

    resumen: List[dict] = []
    resumen_path = out_dir / f"_recortes_{prefix}.resumen.json"

    def _guardar_resumen() -> None:
        try:
            with resumen_path.open("w", encoding="utf-8") as fh:
                json.dump(resumen, fh, ensure_ascii=False, indent=2)
            logger.info(f"Resumen guardado → {resumen_path}")
        except Exception as exc:  # noqa: BLE001
            logger.error(f"No pude guardar resumen: {exc}")

    with graceful_interrupt() as state:
        state.on_interrupt(_guardar_resumen)

        pbar = tqdm(total=len(gdf), desc="Recortando", unit="poli")
        try:
            for _, row in gdf.iterrows():
                poligono_id = str(row["id"])
                destino = out_dir / f"{poligono_id}_{prefix}.tif"
                try:
                    info = _recortar_uno(
                        raster_path=raster_path,
                        geom_geojson=row.geometry.__geo_interface__,
                        poligono_id=poligono_id,
                        destino=destino,
                        raster_basename=raster_basename,
                        raster_crs=raster_crs,
                        polygons_crs_epsg=polygons_crs_epsg,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.error(f"[{poligono_id}] Falló recorte: {exc}")
                    logger.debug(traceback.format_exc())
                    resumen.append(
                        {
                            "poligono_id": poligono_id,
                            "status": "error",
                            "error": str(exc),
                        }
                    )
                    pbar.update(1)
                    continue

                if info is None:
                    resumen.append({"poligono_id": poligono_id, "status": "sin_interseccion"})
                else:
                    try:
                        md5 = hash_file(destino)
                    except Exception:  # noqa: BLE001
                        md5 = None
                    info["md5"] = md5
                    info["status"] = "ok"
                    resumen.append(info)
                    logger.info(
                        f"[{poligono_id}] OK → {destino.name} "
                        f"shape={info['shape']} md5={md5[:8] if md5 else 'NA'}"
                    )
                pbar.update(1)
        finally:
            pbar.close()

    _guardar_resumen()

    ok = sum(1 for r in resumen if r.get("status") == "ok")
    sin_int = sum(1 for r in resumen if r.get("status") == "sin_interseccion")
    err = sum(1 for r in resumen if r.get("status") == "error")

    logger.info("=" * 60)
    logger.info("Resumen recortes")
    logger.info("=" * 60)
    logger.info(f"Total polígonos:     {len(gdf)}")
    logger.info(f"Recortes OK:         {ok}")
    logger.info(f"Sin intersección:    {sin_int}")
    logger.info(f"Errores:             {err}")
    logger.info(f"Resumen JSON:        {resumen_path}")

    sys.exit(0 if err == 0 else 4)


if __name__ == "__main__":
    main()
