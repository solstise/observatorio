"""Inferencia U-Net sobre una imagen grande → GeoJSON de edificios.

Tarea 2.2 — Fase 2, tercer paso.

Pipeline
--------
1. Carga el checkpoint (``--model``) producido por ``train_unet.py``.
2. Abre la imagen (``--input``, GeoTIFF georreferenciado).
3. Recorre el raster con una **ventana deslizante** de ``tile_size``
   y solapamiento configurable (``--overlap``), prediciendo en batches
   para aprovechar la GPU.
4. Ensambla la máscara global promediando las probabilidades en las
   zonas de overlap (reduce efecto bordes).
5. Binariza con ``--threshold`` y vectoriza con
   ``rasterio.features.shapes``. Filtra polígonos por área mínima.
6. Guarda GeoJSON con propiedades ``score`` (media de prob en el
   polígono) y ``area_m2`` (en el CRS métrico configurado en settings).

Uso
---
    python scripts/training/predict.py \\
        --model models/edificios_v1.pt \\
        --input data/raw/planet_nicfi/2024-08/<quad>.tif \\
        --output data/processed/edificios_predichos.geojson
"""

from __future__ import annotations

import json
import signal
import sys
from pathlib import Path
from typing import List, Optional, Tuple

import click
import numpy as np
from loguru import logger
from tqdm import tqdm

try:
    import torch  # type: ignore
    import segmentation_models_pytorch as smp  # type: ignore
    import rasterio  # type: ignore
    from rasterio.features import shapes  # type: ignore
    from rasterio.windows import Window  # type: ignore
    import geopandas as gpd  # type: ignore
    from shapely.geometry import shape as shp_shape  # type: ignore
except ImportError:  # pragma: no cover
    torch = None
    smp = None
    rasterio = None
    shapes = None
    Window = None
    gpd = None
    shp_shape = None

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

from scripts.utils.config import load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path

_INTERRUPTED = False


def _install_sigint_handler() -> None:
    def _handler(signum, frame):  # noqa: ANN001
        global _INTERRUPTED
        _INTERRUPTED = True
        logger.warning("Ctrl+C recibido — terminando tras el batch actual.")

    signal.signal(signal.SIGINT, _handler)


# ---------------------------------------------------------------------------
# Preprocesado
# ---------------------------------------------------------------------------


def _normalize(arr: np.ndarray, mean: List[float], std: List[float]) -> np.ndarray:
    """Normaliza RGB uint8 (C, H, W) → float32."""
    arr = arr.astype(np.float32) / 255.0
    mean_arr = np.array(mean, dtype=np.float32).reshape(-1, 1, 1)
    std_arr = np.array(std, dtype=np.float32).reshape(-1, 1, 1)
    return (arr - mean_arr) / std_arr


def _prepare_rgb(window_data: np.ndarray) -> Optional[np.ndarray]:
    """Toma un array (bands, H, W) del raster y produce RGB uint8 (3, H, W)."""
    if window_data.shape[0] < 3:
        return None
    rgb = window_data[:3].astype(np.float32)
    if rgb.max() > 300:
        p2, p98 = np.percentile(rgb, [2.0, 98.0])
        if p98 > p2:
            rgb = np.clip((rgb - p2) / (p98 - p2), 0.0, 1.0) * 255.0
    return rgb.astype(np.uint8)


def _ventanas(
    width: int, height: int, tile_size: int, overlap: int
) -> List[Tuple[int, int]]:
    """Lista (col, row) tope-izq de las ventanas, con overlap simétrico."""
    step = tile_size - overlap
    cols = list(range(0, max(1, width - tile_size), step)) + [max(0, width - tile_size)]
    rows = list(range(0, max(1, height - tile_size), step)) + [max(0, height - tile_size)]
    cols = sorted(set(c for c in cols if c >= 0))
    rows = sorted(set(r for r in rows if r >= 0))
    return [(c, r) for r in rows for c in cols]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option("--model", default="models/edificios_v1.pt", type=click.Path(exists=True))
@click.option("--input", "input_path", required=True, type=click.Path(exists=True))
@click.option(
    "--output",
    default="data/processed/edificios_predichos.geojson",
    type=click.Path(),
)
@click.option("--tile-size", default=256, type=int)
@click.option("--overlap", default=32, type=int)
@click.option("--batch-size", default=8, type=int)
@click.option("--threshold", default=0.5, type=float)
@click.option(
    "--min-area-m2",
    default=10.0,
    type=float,
    help="Descarta polígonos con área menor a este valor (m² en CRS métrico).",
)
@click.option(
    "--device",
    default=None,
    help="'cuda' / 'cpu'. Default: auto.",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    model: str,
    input_path: str,
    output: str,
    tile_size: int,
    overlap: int,
    batch_size: int,
    threshold: float,
    min_area_m2: float,
    device: Optional[str],
    log_level: str,
) -> None:
    """Aplica U-Net a un GeoTIFF y vectoriza la máscara resultante."""
    setup_logger(nivel=log_level)
    _install_sigint_handler()

    if any(x is None for x in (torch, smp, rasterio, shapes, gpd)):
        logger.error("Faltan dependencias torch/rasterio/segmentation-models-pytorch/geopandas.")
        sys.exit(1)

    settings = load_settings()
    crs_metrico = settings.geografia.crs_metrico

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Device: {device}")

    ckpt = torch.load(resolve_path(model), map_location=device)
    arch = ckpt.get("arch", "unet_resnet34")
    classes = int(ckpt.get("classes", 1))
    in_ch = int(ckpt.get("in_channels", 3))
    norm_mean = ckpt.get("normalize_mean", [0.485, 0.456, 0.406])
    norm_std = ckpt.get("normalize_std", [0.229, 0.224, 0.225])

    if arch != "unet_resnet34":
        logger.warning(f"Arch '{arch}' no reconocida explícitamente — intento igual.")
    net = smp.Unet(
        encoder_name="resnet34",
        encoder_weights=None,
        in_channels=in_ch,
        classes=classes,
    ).to(device)
    net.load_state_dict(ckpt["model_state_dict"])
    net.eval()
    logger.info(f"Modelo cargado ({arch}, IoU val={ckpt.get('val_iou','?')}).")

    input_p = resolve_path(input_path)
    output_p = resolve_path(output)
    ensure_parent(output_p)

    with rasterio.open(input_p) as src:
        logger.info(
            f"Raster: {src.width}x{src.height} {src.count}b CRS={src.crs}"
        )
        prob_sum = np.zeros((src.height, src.width), dtype=np.float32)
        count = np.zeros((src.height, src.width), dtype=np.uint16)

        windows = _ventanas(src.width, src.height, tile_size, overlap)
        batch_imgs: List[np.ndarray] = []
        batch_meta: List[Tuple[int, int]] = []

        def _flush():
            nonlocal batch_imgs, batch_meta
            if not batch_imgs:
                return
            stack = np.stack(batch_imgs)  # (B, 3, H, W)
            t = torch.from_numpy(stack).to(device)
            with torch.no_grad():
                logits = net(t)
                probs = torch.sigmoid(logits).cpu().numpy()  # (B, 1, H, W)
            for (col, row), p in zip(batch_meta, probs):
                prob_sum[row : row + tile_size, col : col + tile_size] += p[0]
                count[row : row + tile_size, col : col + tile_size] += 1
            batch_imgs = []
            batch_meta = []

        for col, row in tqdm(windows, desc="sliding windows"):
            if _INTERRUPTED:
                break
            window = Window(col, row, tile_size, tile_size)
            data = src.read(window=window)
            if data.shape[1] != tile_size or data.shape[2] != tile_size:
                # último tile puede ser menor: lo paddeamos a la derecha/abajo
                pad_h = tile_size - data.shape[1]
                pad_w = tile_size - data.shape[2]
                data = np.pad(
                    data, ((0, 0), (0, pad_h), (0, pad_w)), mode="edge"
                )
            rgb = _prepare_rgb(data)
            if rgb is None:
                continue
            x = _normalize(rgb, norm_mean, norm_std)
            batch_imgs.append(x)
            batch_meta.append((col, row))
            if len(batch_imgs) >= batch_size:
                _flush()
        _flush()

        if _INTERRUPTED:
            logger.warning("Inferencia interrumpida — salida parcial.")

        prob = np.divide(
            prob_sum, np.maximum(count, 1), where=(count > 0)
        ).astype(np.float32)
        mask = (prob >= threshold).astype(np.uint8)
        logger.info(
            f"Máscara: {mask.sum()} píxeles positivos de {mask.size} "
            f"({100 * mask.mean():.2f}%)"
        )

        # Vectorización
        feats = []
        for geom, value in shapes(mask, mask=mask.astype(bool), transform=src.transform):
            if int(value) != 1:
                continue
            poly = shp_shape(geom)
            if poly.is_empty:
                continue
            feats.append(poly)

        if not feats:
            logger.warning("No hay polígonos detectados.")
            gdf = gpd.GeoDataFrame({"score": [], "area_m2": []}, geometry=[], crs=src.crs)
            gdf.to_file(output_p, driver="GeoJSON")
            return

        gdf = gpd.GeoDataFrame(geometry=feats, crs=src.crs)
        gdf_m = gdf.to_crs(crs_metrico)
        gdf["area_m2"] = gdf_m.geometry.area.values
        gdf = gdf[gdf["area_m2"] >= min_area_m2].reset_index(drop=True)

        # Score medio por polígono
        scores: List[float] = []
        from rasterio.features import rasterize as _rasterize  # type: ignore

        for g in gdf.geometry:
            ras = _rasterize(
                [(g, 1)],
                out_shape=prob.shape,
                transform=src.transform,
                fill=0,
                dtype="uint8",
            )
            m = ras.astype(bool)
            if m.sum() == 0:
                scores.append(float("nan"))
            else:
                scores.append(float(prob[m].mean()))
        gdf["score"] = scores
        gdf = gdf.to_crs("EPSG:4326")
        gdf.to_file(output_p, driver="GeoJSON")
        logger.info(f"Guardado {output_p} con {len(gdf)} polígonos.")


if __name__ == "__main__":
    main()
