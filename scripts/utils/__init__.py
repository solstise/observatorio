"""Paquete de utilidades compartidas del Observatorio Urbano Posadas.

Reúne configuración, logging, manejo de paths, I/O geoespacial y
captura de interrupciones. Todos los scripts de Fase 1 importan desde acá.
"""

from scripts.utils.config import Settings, load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import (
    ensure_dir,
    project_root,
    resolve_path,
)

__all__ = [
    "Settings",
    "load_settings",
    "setup_logger",
    "ensure_dir",
    "project_root",
    "resolve_path",
]
