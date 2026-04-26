"""Setup centralizado de loguru para todo el pipeline.

Cada script importa `setup_logger()` y obtiene un logger que:
- Imprime a consola con color.
- Escribe a archivo `logs/observatorio_YYYYMMDD.log`.
- Rota al alcanzar 10 MB (configurable).
- Usa timestamp, nivel y mensaje en español rioplatense.

Uso:
    from scripts.utils.logger import setup_logger
    from loguru import logger

    setup_logger()
    logger.info("Arrancando descarga Sentinel-2...")
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

from loguru import logger

from scripts.utils.paths import ensure_dir, project_root

_CONFIGURED: bool = False


def _formato_consola() -> str:
    """Formato con colores para consola (loguru lo interpreta con <tags>)."""
    return (
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> "
        "<level>{level: <8}</level> "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> "
        "- <level>{message}</level>"
    )


def _formato_archivo() -> str:
    """Formato sin colores para archivo — parsable por humanos y grep."""
    return "{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | " "{name}:{function}:{line} - {message}"


def setup_logger(
    nivel: str = "INFO",
    log_dir: Optional[Path] = None,
    rotacion: str = "10 MB",
    retencion: str = "30 days",
    force: bool = False,
) -> None:
    """Configura loguru con sinks para consola y archivo.

    Es idempotente: llamarlo múltiples veces no duplica los sinks salvo que
    se pase `force=True`, que limpia y reconfigura.

    Args:
        nivel: Nivel mínimo (DEBUG, INFO, WARNING, ERROR, CRITICAL).
        log_dir: Directorio donde viven los .log. Default: <raíz>/logs.
        rotacion: Tamaño tras el cual loguru rota el archivo (ej. "10 MB").
        retencion: Cuánto tiempo conservar archivos rotados (ej. "30 days").
        force: Si True, reinicializa aunque ya estuviera configurado.
    """
    global _CONFIGURED
    if _CONFIGURED and not force:
        return

    # Limpio handlers previos (loguru trae uno default a stderr).
    logger.remove()

    # Consola con color.
    logger.add(
        sys.stderr,
        level=nivel,
        format=_formato_consola(),
        colorize=True,
        backtrace=True,
        diagnose=False,  # diagnose=True filtra variables privadas; lo dejamos off por defecto
        enqueue=False,
    )

    # Archivo con rotación.
    if log_dir is None:
        log_dir = project_root() / "logs"
    log_dir = ensure_dir(log_dir)

    fecha = datetime.now().strftime("%Y%m%d")
    log_file = log_dir / f"observatorio_{fecha}.log"

    logger.add(
        log_file,
        level=nivel,
        format=_formato_archivo(),
        rotation=rotacion,
        retention=retencion,
        encoding="utf-8",
        enqueue=True,  # thread-safe para loops con tqdm
        backtrace=True,
        diagnose=False,
    )

    _CONFIGURED = True
    logger.debug(f"Logger configurado | nivel={nivel} | archivo={log_file}")


def get_logger(name: Optional[str] = None):
    """Shim de compatibilidad.

    Algunos scripts del pipeline se escribieron esperando `get_logger(__name__)`
    al estilo de `logging.getLogger`. Como loguru tiene un logger global y
    detecta el módulo llamador automáticamente, acá ignoramos `name` y
    retornamos el logger global después de asegurar que esté configurado.

    Args:
        name: Ignorado. Se acepta por compatibilidad con el patrón stdlib.

    Returns:
        El `logger` global de loguru, ya configurado.
    """
    if not _CONFIGURED:
        setup_logger()
    return logger


__all__ = ["setup_logger", "get_logger", "logger"]
