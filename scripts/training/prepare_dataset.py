"""Genera dataset supervisado de tiles NICFI + máscara de edificios.

Tarea 2.2 — Fase 2, primer paso para entrenar un U-Net propio de detección
de edificios sobre Planet NICFI.

Pseudo-ground-truth
-------------------
Las máscaras se construyen rasterizando los polígonos de **Google Open
Buildings** que caen dentro de cada tile. Esto significa que el modelo
resultante **aprende los patrones de Open Buildings**, incluyendo sus
errores: falsos positivos sobre techos metálicos reflectantes, falsos
negativos sobre casillas precarias sin sombra clara, etc. Documentamos
esto para evitar sobre-interpretación: un U-Net entrenado así **no es
mejor que Open Buildings**, pero sí es **aplicable a cualquier imagen
nueva** (mientras que Open Buildings es un snapshot estático ~2023).

Salidas
-------
::

    data/training/
        images/00000.png ...  (RGB uint8, 256×256)
        masks/00000.png  ...  (binaria uint8 {0,255})
        train.txt / val.txt / test.txt   (split 80/10/10 por defecto)
        metadata.json  (bbox, rng seed, conteo, split)

Uso
---
    python scripts/training/prepare_dataset.py \\
        --n-tiles 500 \\
        --tile-size 256 \\
        --nicfi-dir data/raw/planet_nicfi \\
        --buildings data/raw/google_buildings/posadas_buildings.geojson
"""

from __future__ import annotations

import json
import random
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import click
import numpy as np
from loguru import logger
from tqdm import tqdm

try:
    import geopandas as gpd  # type: ignore
    import rasterio  # type: ignore
    from rasterio.features import rasterize  # type: ignore
    from rasterio.windows import Window, from_bounds  # type: ignore
    from PIL import Image  # type: ignore
    from shapely.geometry import box  # type: ignore
except ImportError:  # pragma: no cover
    gpd = None
    rasterio = None
    rasterize = None
    Window = None
    from_bounds = None
    Image = None
    box = None

from scripts.utils.config import load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


@dataclass
class Tile:
    """Representa un tile muestreado listo para exportar."""

    idx: int
    image: np.ndarray  # (H, W, 3) uint8
    mask: np.ndarray  # (H, W) uint8 {0,255}
    bounds: Tuple[float, float, float, float]
    source_tif: str


def _listar_nicfi_tifs(nicfi_dir: Path) -> List[Path]:
    """Lista GeoTIFFs de NICFI recursivamente. Prefiere los meses más recientes."""
    tifs = sorted(nicfi_dir.rglob("*.tif"), reverse=True)
    logger.info(f"Encontrados {len(tifs)} GeoTIFFs NICFI en {nicfi_dir}.")
    return tifs


def _sample_posicion(
    src, tile_size: int, rng: random.Random
) -> Optional[Tuple[int, int]]:
    """Muestrea una (col, row) válida dentro del raster (margen por tile_size)."""
    if src.width < tile_size or src.height < tile_size:
        return None
    col = rng.randint(0, src.width - tile_size - 1)
    row = rng.randint(0, src.height - tile_size - 1)
    return col, row


def _leer_tile_rgb(src, col: int, row: int, tile_size: int) -> Optional[np.ndarray]:
    """Lee un tile RGB (bandas 1-3) como ``uint8`` (H, W, 3).

    Si NICFI trae 4 bandas (RGB+NIR), usamos 1-2-3. Si la banda es 16-bit,
    la escalamos al percentil 2-98 para sacar mejor contraste.
    """
    window = Window(col, row, tile_size, tile_size)
    try:
        arr = src.read(window=window, out_dtype="float32")
    except (rasterio.errors.RasterioIOError, Exception) as exc:  # noqa: BLE001
        logger.warning(f"No pude leer tile ({col},{row}): {exc}")
        return None
    if arr.shape[0] < 3:
        return None
    rgb = arr[:3]  # (3, H, W)

    # Si los valores están en el rango 0-10000 (Sentinel-style) o 0-65535 (NICFI 16-bit),
    # escalamos a 0-255 vía percentiles.
    if rgb.max() > 300:  # heurística simple: si hay valores > 255 hay que escalar
        p2 = np.percentile(rgb, 2.0)
        p98 = np.percentile(rgb, 98.0)
        if p98 > p2:
            rgb = np.clip((rgb - p2) / (p98 - p2), 0.0, 1.0) * 255.0
    rgb_u8 = rgb.astype(np.uint8)
    return np.transpose(rgb_u8, (1, 2, 0))  # (H, W, 3)


def _rasterizar_mask(
    src, col: int, row: int, tile_size: int, buildings_gdf
) -> np.ndarray:
    """Rasteriza los polígonos de edificios que caen en el tile."""
    window = Window(col, row, tile_size, tile_size)
    transform = rasterio.windows.transform(window, src.transform)
    bounds = rasterio.windows.bounds(window, src.transform)
    tile_bbox = box(*bounds)

    # Reproyectar buildings si hace falta
    if buildings_gdf.crs != src.crs:
        gdf = buildings_gdf.to_crs(src.crs)
    else:
        gdf = buildings_gdf

    # Spatial index para eficiencia
    sindex = gdf.sindex
    posibles = list(sindex.intersection(bounds))
    if not posibles:
        return np.zeros((tile_size, tile_size), dtype=np.uint8)
    sub = gdf.iloc[posibles]
    sub = sub[sub.geometry.intersects(tile_bbox)]
    if sub.empty:
        return np.zeros((tile_size, tile_size), dtype=np.uint8)

    shapes = [(g, 1) for g in sub.geometry.values if g and not g.is_empty]
    mask = rasterize(
        shapes=shapes,
        out_shape=(tile_size, tile_size),
        transform=transform,
        fill=0,
        dtype="uint8",
    )
    return (mask * 255).astype(np.uint8)


def _guardar_tile(tile: Tile, images_dir: Path, masks_dir: Path) -> None:
    """Escribe PNGs de imagen y máscara."""
    name = f"{tile.idx:05d}.png"
    Image.fromarray(tile.image).save(images_dir / name, format="PNG")
    Image.fromarray(tile.mask).save(masks_dir / name, format="PNG")


def _split_ids(
    ids: List[int], ratios: Tuple[float, float, float], rng: random.Random
) -> Tuple[List[int], List[int], List[int]]:
    """Divide una lista de IDs en train/val/test con ratios dados."""
    shuffled = ids[:]
    rng.shuffle(shuffled)
    n = len(shuffled)
    n_train = int(n * ratios[0])
    n_val = int(n * ratios[1])
    train = shuffled[:n_train]
    val = shuffled[n_train : n_train + n_val]
    test = shuffled[n_train + n_val :]
    return train, val, test


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option("--n-tiles", default=500, type=int, help="Cantidad total de tiles.")
@click.option("--tile-size", default=256, type=int, help="Lado del tile en px.")
@click.option(
    "--nicfi-dir",
    default="data/raw/planet_nicfi",
    type=click.Path(),
    help="Directorio con GeoTIFFs NICFI (recursivo).",
)
@click.option(
    "--buildings",
    default="data/raw/google_buildings/posadas_buildings.geojson",
    type=click.Path(),
    help="GeoJSON de Google Open Buildings para el área.",
)
@click.option(
    "--output",
    default="data/training",
    type=click.Path(),
    help="Directorio de salida del dataset.",
)
@click.option(
    "--seed",
    default=42,
    type=int,
    help="Semilla del RNG para reproducibilidad.",
)
@click.option(
    "--min-positivos",
    default=0.02,
    type=float,
    help=(
        "Fracción mínima de píxeles positivos en el tile para aceptarlo. "
        "0.0 desactiva el filtro."
    ),
)
@click.option(
    "--ratios",
    default="0.8,0.1,0.1",
    help="Train/val/test ratios, coma-separados.",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    n_tiles: int,
    tile_size: int,
    nicfi_dir: str,
    buildings: str,
    output: str,
    seed: int,
    min_positivos: float,
    ratios: str,
    log_level: str,
) -> None:
    """Genera dataset supervisado tiles→máscara para entrenar el U-Net."""
    setup_logger(nivel=log_level)
    if any(x is None for x in (gpd, rasterio, rasterize, Image, box)):
        logger.error(
            "Faltan dependencias. Agregá: "
            "pip install geopandas rasterio pillow shapely"
        )
        sys.exit(1)

    settings = load_settings()
    rng = random.Random(seed)
    np.random.seed(seed)

    nicfi_dir_p = resolve_path(nicfi_dir)
    tifs = _listar_nicfi_tifs(nicfi_dir_p)
    if not tifs:
        logger.error(
            f"No hay GeoTIFFs NICFI en {nicfi_dir_p}. Correr primero 02_descarga_nicfi.py."
        )
        sys.exit(1)

    buildings_path = resolve_path(buildings)
    if not buildings_path.exists():
        logger.error(
            f"No existe {buildings_path}. Correr primero el script 03 de descarga "
            "de Google Open Buildings."
        )
        sys.exit(1)
    logger.info(f"Cargando Open Buildings desde {buildings_path}.")
    buildings_gdf = gpd.read_file(buildings_path)
    logger.info(f"Open Buildings: {len(buildings_gdf)} polígonos.")

    ratios_tup = tuple(float(x) for x in ratios.split(","))
    if len(ratios_tup) != 3 or abs(sum(ratios_tup) - 1.0) > 1e-3:
        raise click.BadParameter("--ratios debe ser 3 floats que sumen 1.0")

    output_p = ensure_dir(resolve_path(output))
    images_dir = ensure_dir(output_p / "images")
    masks_dir = ensure_dir(output_p / "masks")

    tiles_generados: List[int] = []
    intentos = 0
    MAX_INTENTOS = n_tiles * 20  # techo de seguridad

    pbar = tqdm(total=n_tiles, desc="tiles")
    while len(tiles_generados) < n_tiles and intentos < MAX_INTENTOS:
        intentos += 1
        tif = rng.choice(tifs)
        try:
            with rasterio.open(tif) as src:
                pos = _sample_posicion(src, tile_size, rng)
                if pos is None:
                    continue
                col, row = pos
                img = _leer_tile_rgb(src, col, row, tile_size)
                if img is None:
                    continue
                # Descarto tiles casi todos negros (nodata)
                if img.mean() < 5:
                    continue
                mask = _rasterizar_mask(src, col, row, tile_size, buildings_gdf)
                if min_positivos > 0:
                    frac = float(mask.mean()) / 255.0
                    if frac < min_positivos:
                        continue

                idx = len(tiles_generados)
                window = Window(col, row, tile_size, tile_size)
                bounds = rasterio.windows.bounds(window, src.transform)
                tile = Tile(
                    idx=idx,
                    image=img,
                    mask=mask,
                    bounds=bounds,
                    source_tif=str(tif),
                )
                _guardar_tile(tile, images_dir, masks_dir)
                tiles_generados.append(idx)
                pbar.update(1)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Fallo tile en {tif.name}: {exc}")
            continue
    pbar.close()

    logger.info(
        f"Generados {len(tiles_generados)} tiles en {intentos} intentos "
        f"(tasa {len(tiles_generados)/max(1,intentos):.2%})."
    )

    # Splits
    train, val, test = _split_ids(tiles_generados, ratios_tup, rng)
    for nombre, ids in (("train", train), ("val", val), ("test", test)):
        with (output_p / f"{nombre}.txt").open("w", encoding="utf-8") as fh:
            for i in ids:
                fh.write(f"{i:05d}\n")
    logger.info(f"Split: train={len(train)} val={len(val)} test={len(test)}")

    metadata = {
        "n_tiles": len(tiles_generados),
        "tile_size": tile_size,
        "seed": seed,
        "ratios": list(ratios_tup),
        "nicfi_dir": str(nicfi_dir_p),
        "buildings": str(buildings_path),
        "min_positivos": min_positivos,
        "bbox_area": {
            "oeste": settings.geografia.bbox.oeste,
            "sur": settings.geografia.bbox.sur,
            "este": settings.geografia.bbox.este,
            "norte": settings.geografia.bbox.norte,
        },
        "disclaimer": (
            "Masks derivadas de Google Open Buildings como pseudo-ground-truth. "
            "El modelo entrenado está acotado por los errores de OB."
        ),
    }
    with (output_p / "metadata.json").open("w", encoding="utf-8") as fh:
        json.dump(metadata, fh, ensure_ascii=False, indent=2)

    logger.info(f"Dataset listo en {output_p}.")


if __name__ == "__main__":
    main()
