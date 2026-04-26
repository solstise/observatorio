"""Entrenamiento del U-Net ResNet34 para detección de edificios sobre NICFI.

Tarea 2.2 — Fase 2, segundo paso.

Arquitectura
------------
- U-Net con encoder ``resnet34`` pre-entrenado en ImageNet,
  vía ``segmentation_models_pytorch`` (SMP). Balance robusto entre
  capacidad y velocidad: 24M params, entrena bien en una sola GPU
  con 256×256 y batch 8 sobre RTX 3080 (10GB).
- Salida: 1 canal, activación sigmoide, binary segmentation.

Loss y métricas
---------------
- Combinación ``0.5 * BCE + 0.5 * Dice``. La BCE estabiliza al inicio,
  Dice premia mejor solapamiento cuando el desbalance clase-fondo es alto.
- Métricas: IoU y F1 (dice coefficient) por batch.

Augmentation
------------
- Flip horizontal y vertical
- Rotación 90°
- Brillo/contraste aleatorio (ligero, para no romper color de techos)
- Ruido gaussiano leve
Todo con ``albumentations``.

Hardware
--------
Pensado para RTX 3080 con 10 GB de VRAM. Con batch 8, tile 256, tarda
**~6-12 h** a 30 epochs en un dataset de 500-1000 tiles. Si OOM,
bajar ``--batch-size`` a 4 o el ``tile-size`` a 192. Si no hay GPU,
el script corre en CPU pero tarda **días**: se recomienda cloud.

Uso
---
    python scripts/training/train_unet.py \\
        --data data/training \\
        --epochs 30 \\
        --batch-size 8 \\
        --lr 1e-4 \\
        --output models/edificios_v1.pt

Genera además ``models/edificios_v1.log.csv`` con métricas por epoch.
Si ``tensorboard`` está instalado y se pasa ``--tensorboard``, también
escribe eventos a ``models/runs/<timestamp>/``.
"""

from __future__ import annotations

import csv
import signal
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Tuple

import click
import numpy as np
from loguru import logger

try:
    import albumentations as A  # type: ignore
    import segmentation_models_pytorch as smp  # type: ignore
    import torch  # type: ignore
    import torch.nn as nn  # type: ignore
    from albumentations.pytorch import ToTensorV2  # type: ignore
    from PIL import Image  # type: ignore
    from torch.utils.data import DataLoader, Dataset  # type: ignore
except ImportError:  # pragma: no cover
    torch = None
    nn = None
    DataLoader = None
    Dataset = None
    A = None
    ToTensorV2 = None
    Image = None
    smp = None

try:
    from torch.utils.tensorboard import SummaryWriter  # type: ignore
except ImportError:  # pragma: no cover
    SummaryWriter = None

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

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path

_INTERRUPTED = False


def _install_sigint_handler() -> None:
    def _handler(signum, frame):  # noqa: ANN001
        global _INTERRUPTED
        _INTERRUPTED = True
        logger.warning("Ctrl+C recibido — terminando epoch actual y saliendo.")

    signal.signal(signal.SIGINT, _handler)


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


class BuildingTilesDataset(Dataset):  # type: ignore[misc]
    """Lee tiles PNG + máscaras PNG de la estructura ``data/training``."""

    def __init__(self, root: Path, split_file: Path, transform=None):
        self.root = root
        self.images_dir = root / "images"
        self.masks_dir = root / "masks"
        with split_file.open("r", encoding="utf-8") as fh:
            self.ids = [line.strip() for line in fh if line.strip()]
        self.transform = transform

    def __len__(self) -> int:
        return len(self.ids)

    def __getitem__(self, idx: int):
        tid = self.ids[idx]
        img_path = self.images_dir / f"{tid}.png"
        mask_path = self.masks_dir / f"{tid}.png"
        image = np.array(Image.open(img_path).convert("RGB"))
        mask = np.array(Image.open(mask_path).convert("L"))
        mask = (mask > 127).astype(np.float32)
        if self.transform is not None:
            out = self.transform(image=image, mask=mask)
            image = out["image"]
            mask = out["mask"]
        else:
            image = torch.from_numpy(image.transpose(2, 0, 1)).float() / 255.0
            mask = torch.from_numpy(mask).float()
        return image, mask.unsqueeze(0) if mask.dim() == 2 else mask


def _tfm_train(tile_size: int):
    return A.Compose(
        [
            A.HorizontalFlip(p=0.5),
            A.VerticalFlip(p=0.5),
            A.RandomRotate90(p=0.5),
            A.RandomBrightnessContrast(p=0.3, brightness_limit=0.1, contrast_limit=0.1),
            A.GaussNoise(p=0.15),
            A.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
            ToTensorV2(),
        ]
    )


def _tfm_eval():
    return A.Compose(
        [
            A.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
            ToTensorV2(),
        ]
    )


# ---------------------------------------------------------------------------
# Loss y métricas
# ---------------------------------------------------------------------------


class BCEDiceLoss(nn.Module):  # type: ignore[misc]
    """0.5 * BCE + 0.5 * Dice, con logits."""

    def __init__(self, bce_weight: float = 0.5):
        super().__init__()
        self.bce = nn.BCEWithLogitsLoss()
        self.bce_weight = bce_weight

    def forward(self, logits, target):
        bce = self.bce(logits, target)
        probs = torch.sigmoid(logits)
        num = 2.0 * (probs * target).sum(dim=(1, 2, 3))
        den = probs.sum(dim=(1, 2, 3)) + target.sum(dim=(1, 2, 3)) + 1e-6
        dice = (1.0 - num / den).mean()
        return self.bce_weight * bce + (1.0 - self.bce_weight) * dice


def _iou_f1(logits, target, thr: float = 0.5) -> Tuple[float, float]:
    probs = torch.sigmoid(logits)
    pred = (probs > thr).float()
    inter = (pred * target).sum()
    union = ((pred + target) > 0).float().sum()
    iou = float(inter / (union + 1e-6))
    dice = float(2 * inter / (pred.sum() + target.sum() + 1e-6))
    return iou, dice


# ---------------------------------------------------------------------------
# Loops
# ---------------------------------------------------------------------------


def _run_epoch(
    model,
    loader,
    criterion,
    optimizer=None,
    device: str = "cuda",
    train: bool = True,
) -> Tuple[float, float, float]:
    model.train(train)
    total_loss = 0.0
    total_iou = 0.0
    total_f1 = 0.0
    n = 0
    ctx = torch.enable_grad() if train else torch.no_grad()
    with ctx:
        for images, masks in loader:
            if _INTERRUPTED:
                break
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True).float()
            logits = model(images)
            loss = criterion(logits, masks)
            if train and optimizer is not None:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
            iou, f1 = _iou_f1(logits.detach(), masks.detach())
            bs = images.size(0)
            total_loss += float(loss.item()) * bs
            total_iou += iou * bs
            total_f1 += f1 * bs
            n += bs
    if n == 0:
        return float("nan"), float("nan"), float("nan")
    return total_loss / n, total_iou / n, total_f1 / n


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option("--data", default="data/training", type=click.Path())
@click.option("--epochs", default=30, type=int)
@click.option("--batch-size", default=8, type=int)
@click.option("--lr", default=1e-4, type=float)
@click.option("--output", default="models/edificios_v1.pt", type=click.Path())
@click.option("--tile-size", default=256, type=int)
@click.option("--num-workers", default=2, type=int)
@click.option("--tensorboard", is_flag=True, default=False)
@click.option(
    "--early-stop-patience",
    default=8,
    type=int,
    help="Epochs sin mejora en val IoU antes de detener.",
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
    data: str,
    epochs: int,
    batch_size: int,
    lr: float,
    output: str,
    tile_size: int,
    num_workers: int,
    tensorboard: bool,
    early_stop_patience: int,
    device: Optional[str],
    log_level: str,
) -> None:
    """Entrena U-Net ResNet34 para detección de edificios."""
    setup_logger(nivel=log_level)
    _install_sigint_handler()

    if any(x is None for x in (torch, smp, A)):
        logger.error(
            "Faltan dependencias. Agregá: "
            "pip install torch torchvision albumentations segmentation-models-pytorch pillow"
        )
        sys.exit(1)

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Device: {device}")
    if device == "cpu":
        logger.warning("Entrenando en CPU — esto tarda días. Se recomienda GPU (RTX 3080 OK).")

    data_p = resolve_path(data)
    output_p = resolve_path(output)
    ensure_parent(output_p)
    log_csv = output_p.with_suffix(".log.csv")

    tfm_tr = _tfm_train(tile_size)
    tfm_ev = _tfm_eval()
    ds_train = BuildingTilesDataset(data_p, data_p / "train.txt", tfm_tr)
    ds_val = BuildingTilesDataset(data_p, data_p / "val.txt", tfm_ev)

    if len(ds_train) == 0:
        logger.error(f"Dataset train vacío en {data_p}.")
        sys.exit(1)

    logger.info(f"Train tiles: {len(ds_train)} | Val tiles: {len(ds_val)}")

    loader_train = DataLoader(
        ds_train,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=(device == "cuda"),
        drop_last=True,
    )
    loader_val = DataLoader(
        ds_val,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=(device == "cuda"),
    )

    model = smp.Unet(
        encoder_name="resnet34",
        encoder_weights="imagenet",
        in_channels=3,
        classes=1,
    ).to(device)

    criterion = BCEDiceLoss().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, mode="max", factor=0.5, patience=3
    )

    writer = None
    if tensorboard:
        if SummaryWriter is None:
            logger.warning("tensorboard no disponible — desactivado.")
        else:
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            writer = SummaryWriter(log_dir=str(output_p.parent / "runs" / stamp))

    best_iou = -1.0
    epochs_sin_mejora = 0

    with log_csv.open("w", encoding="utf-8", newline="") as fh:
        csvw = csv.writer(fh)
        csvw.writerow(
            [
                "epoch",
                "train_loss",
                "train_iou",
                "train_f1",
                "val_loss",
                "val_iou",
                "val_f1",
                "lr",
                "duracion_s",
            ]
        )

        for epoch in range(1, epochs + 1):
            if _INTERRUPTED:
                break
            t0 = time.time()
            tr_loss, tr_iou, tr_f1 = _run_epoch(
                model, loader_train, criterion, optimizer, device, train=True
            )
            val_loss, val_iou, val_f1 = _run_epoch(
                model, loader_val, criterion, device=device, train=False
            )
            dt = time.time() - t0
            lr_now = optimizer.param_groups[0]["lr"]
            logger.info(
                f"Epoch {epoch:3d}/{epochs} | "
                f"train loss={tr_loss:.4f} iou={tr_iou:.3f} f1={tr_f1:.3f} | "
                f"val loss={val_loss:.4f} iou={val_iou:.3f} f1={val_f1:.3f} | "
                f"lr={lr_now:.2e} | {dt:.1f}s"
            )
            csvw.writerow([epoch, tr_loss, tr_iou, tr_f1, val_loss, val_iou, val_f1, lr_now, dt])
            fh.flush()

            if writer is not None:
                writer.add_scalar("loss/train", tr_loss, epoch)
                writer.add_scalar("loss/val", val_loss, epoch)
                writer.add_scalar("iou/train", tr_iou, epoch)
                writer.add_scalar("iou/val", val_iou, epoch)
                writer.add_scalar("f1/val", val_f1, epoch)
                writer.add_scalar("lr", lr_now, epoch)

            scheduler.step(val_iou)

            if val_iou > best_iou:
                best_iou = val_iou
                epochs_sin_mejora = 0
                payload = {
                    "model_state_dict": model.state_dict(),
                    "arch": "unet_resnet34",
                    "in_channels": 3,
                    "classes": 1,
                    "tile_size": tile_size,
                    "epoch": epoch,
                    "val_iou": val_iou,
                    "val_f1": val_f1,
                    "normalize_mean": [0.485, 0.456, 0.406],
                    "normalize_std": [0.229, 0.224, 0.225],
                }
                torch.save(payload, output_p)
                logger.info(f"Checkpoint mejorado → {output_p} (IoU={val_iou:.3f})")
            else:
                epochs_sin_mejora += 1
                if epochs_sin_mejora >= early_stop_patience:
                    logger.info(f"Early stopping: {epochs_sin_mejora} epochs sin mejora.")
                    break

    if writer is not None:
        writer.close()
    logger.info(f"Entrenamiento finalizado. Mejor val IoU: {best_iou:.3f}")


if __name__ == "__main__":
    main()
