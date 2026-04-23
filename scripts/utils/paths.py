"""Helpers para manejo de paths absolutos y creación idempotente de directorios.

Usa pathlib.Path exclusivamente. Resuelve la raíz del proyecto subiendo
dos niveles desde este archivo (scripts/utils/paths.py → raíz). Funciones
chicas que cualquier script del pipeline puede reusar sin depender de
settings.yaml.

Ejemplo:
    from scripts.utils.paths import project_root, ensure_dir, resolve_path

    raw_dir = ensure_dir(project_root() / "data" / "raw" / "sentinel2")
    cfg = resolve_path("config/poligonos.geojson")
"""

from __future__ import annotations

from pathlib import Path
from typing import Union

PathLike = Union[str, Path]


def project_root() -> Path:
    """Devuelve la ruta absoluta a la raíz del proyecto.

    La raíz se infiere subiendo dos niveles desde este archivo
    (scripts/utils/paths.py → scripts/ → raíz del proyecto).

    Returns:
        Path absoluto a la raíz del repositorio.
    """
    return Path(__file__).resolve().parents[2]


def resolve_path(path: PathLike) -> Path:
    """Convierte una ruta relativa a absoluta tomando como base la raíz del proyecto.

    Si la ruta ya es absoluta, la devuelve tal cual (resuelta).

    Args:
        path: Ruta relativa a la raíz o ruta absoluta.

    Returns:
        Path absoluto resuelto.
    """
    p = Path(path)
    if p.is_absolute():
        return p.resolve()
    return (project_root() / p).resolve()


def ensure_dir(path: PathLike) -> Path:
    """Asegura que el directorio exista; lo crea (con padres) si hace falta.

    Args:
        path: Ruta al directorio (relativa o absoluta).

    Returns:
        Path absoluto al directorio asegurado.
    """
    p = resolve_path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def ensure_parent(path: PathLike) -> Path:
    """Asegura que el directorio padre de un archivo exista.

    Útil antes de escribir un archivo en una subcarpeta que puede no existir.

    Args:
        path: Ruta al archivo (no al directorio).

    Returns:
        Path absoluto al archivo (con el padre ya creado).
    """
    p = resolve_path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p
