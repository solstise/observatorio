"""Carga de datos del Observatorio Urbano Posadas.

Lee los archivos GeoJSON y CSV emitidos por el pipeline en data/outputs/.
Ubicacion por defecto: ../../data/outputs/ respecto a este archivo (repo raiz).
Se puede sobreescribir con la variable de entorno DATA_ROOT.

Si un archivo falta, el endpoint correspondiente debe devolver HTTP 503.
"""

from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator


# Columnas con casteo explicito por dataset.
_NUMERIC_INT_COLUMNS = {
    "anio",
    "poblacion_estimada",
    "edificios_total",
    "edificios_2018",
    "edificios_2026",
    "anio_referencia",
}

_NUMERIC_FLOAT_COLUMNS = {
    "score_expansion",
    "superficie_km2",
    "superficie_construida_km2",
    "superficie_vegetacion_km2",
    "densidad_hab_km2",
    "confianza_inferior",
    "confianza_superior",
    "cobertura_pct",
    "indice_vulnerabilidad",
    "carencia_servicios",
    "riesgo_inundacion",
    "accesibilidad_salud",
    "accesibilidad_educacion",
}


@dataclass(frozen=True)
class DataPaths:
    """Paths resueltos hacia los datasets publicados."""

    root: Path
    poligonos_geojson: Path
    serie_temporal: Path
    poblacion: Path
    servicios: Path
    vulnerabilidad: Path
    reportes_dir: Path
    imagenes_dir: Path
    timelapses_dir: Path

    def exists(self) -> bool:
        """Verifica que exista el archivo critico de poligonos."""
        return self.poligonos_geojson.exists()


def _default_data_root() -> Path:
    """Devuelve data/outputs/ del repo raiz (dos niveles arriba de este archivo)."""
    here = Path(__file__).resolve()
    # webapp/backend/data_loader.py -> webapp/backend -> webapp -> observatorio
    observatorio_root = here.parent.parent.parent
    return observatorio_root / "data" / "outputs"


def resolve_paths() -> DataPaths:
    """Resuelve los paths a partir de DATA_ROOT o el default."""
    env = os.getenv("DATA_ROOT")
    root = Path(env).expanduser().resolve() if env else _default_data_root()
    return DataPaths(
        root=root,
        poligonos_geojson=root / "poligonos.geojson",
        serie_temporal=root / "serie_temporal.csv",
        poblacion=root / "poblacion.csv",
        servicios=root / "servicios.csv",
        vulnerabilidad=root / "vulnerabilidad.csv",
        reportes_dir=root / "reportes",
        imagenes_dir=root / "imagenes",
        timelapses_dir=root / "timelapses",
    )


class DataNotAvailableError(RuntimeError):
    """Se eleva cuando un dataset requerido no existe en disco."""


def _cast_value(key: str, raw: str) -> Any:
    """Castea un valor de CSV al tipo esperado segun el nombre de columna."""
    if raw == "" or raw is None:
        return None
    if key in _NUMERIC_INT_COLUMNS:
        try:
            return int(float(raw))
        except ValueError:
            return None
    if key in _NUMERIC_FLOAT_COLUMNS:
        try:
            return float(raw)
        except ValueError:
            return None
    return raw


def _read_csv(path: Path) -> Iterator[dict[str, Any]]:
    """Itera filas del CSV salteando comentarios (lineas que empiezan con #)."""
    if not path.exists():
        raise DataNotAvailableError(
            f"No se encontro el dataset en {path}. "
            "Corre el pipeline de data/outputs/ primero."
        )
    with path.open("r", encoding="utf-8", newline="") as fh:
        # Saltamos lineas de comentario antes de pasarle el handle al DictReader.
        cleaned: list[str] = []
        for line in fh:
            if line.lstrip().startswith("#"):
                continue
            cleaned.append(line)
    reader = csv.DictReader(cleaned)
    for row in reader:
        yield {k: _cast_value(k, (v or "").strip()) for k, v in row.items()}


def load_poligonos() -> dict[str, Any]:
    """Carga la FeatureCollection completa de poligonos."""
    paths = resolve_paths()
    if not paths.poligonos_geojson.exists():
        raise DataNotAvailableError(
            "Falta poligonos.geojson. Corre el pipeline del observatorio."
        )
    with paths.poligonos_geojson.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def load_serie_temporal(poligono_id: str | None = None) -> list[dict[str, Any]]:
    """Carga serie temporal, opcionalmente filtrada por poligono."""
    paths = resolve_paths()
    rows = list(_read_csv(paths.serie_temporal))
    if poligono_id:
        rows = [r for r in rows if r.get("poligono_id") == poligono_id]
    return rows


def load_poblacion(poligono_id: str | None = None) -> list[dict[str, Any]]:
    """Carga poblacion, opcionalmente filtrada por poligono."""
    paths = resolve_paths()
    rows = list(_read_csv(paths.poblacion))
    if poligono_id:
        rows = [r for r in rows if r.get("poligono_id") == poligono_id]
    return rows


def load_servicios(poligono_id: str | None = None) -> list[dict[str, Any]]:
    """Carga servicios, opcionalmente filtrada por poligono."""
    paths = resolve_paths()
    rows = list(_read_csv(paths.servicios))
    if poligono_id:
        rows = [r for r in rows if r.get("poligono_id") == poligono_id]
    return rows


def load_vulnerabilidad(poligono_id: str | None = None) -> list[dict[str, Any]]:
    """Carga vulnerabilidad, opcionalmente filtrada por poligono."""
    paths = resolve_paths()
    if not paths.vulnerabilidad.exists():
        return []
    rows = list(_read_csv(paths.vulnerabilidad))
    if poligono_id:
        rows = [r for r in rows if r.get("poligono_id") == poligono_id]
    return rows


def find_poligono(poligono_id: str) -> dict[str, Any] | None:
    """Devuelve el Feature GeoJSON correspondiente o None."""
    collection = load_poligonos()
    for feature in collection.get("features", []):
        props = feature.get("properties", {}) or {}
        if props.get("id") == poligono_id:
            return feature
    return None


def report_path(poligono_id: str) -> Path | None:
    """Path al PDF del poligono si existe."""
    paths = resolve_paths()
    candidate = paths.reportes_dir / f"{poligono_id}.pdf"
    return candidate if candidate.exists() else None


def image_path(poligono_id: str, fecha_ym: str) -> Path | None:
    """Path a imagen mensual PNG si existe."""
    paths = resolve_paths()
    candidate = paths.imagenes_dir / poligono_id / f"{fecha_ym}.png"
    return candidate if candidate.exists() else None


def timelapse_path(poligono_id: str, kind: str) -> Path | None:
    """Path a timelapse (kind: 'gif' o 'mp4') si existe."""
    if kind not in ("gif", "mp4"):
        return None
    paths = resolve_paths()
    candidate = paths.timelapses_dir / f"{poligono_id}.{kind}"
    return candidate if candidate.exists() else None
