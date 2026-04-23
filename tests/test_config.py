"""Tests de configuración — valida settings.yaml.

Extras al plan de tarea 2.8.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

RUTA_SETTINGS = Path(__file__).parent.parent / "config" / "settings.yaml"


@pytest.fixture(scope="module")
def settings_dict() -> dict:
    if not RUTA_SETTINGS.exists():
        pytest.skip(f"{RUTA_SETTINGS} no existe")
    with RUTA_SETTINGS.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def test_settings_yaml_parsea(settings_dict: dict):
    """`settings.yaml` parsea sin error y retorna un dict no vacío."""
    assert isinstance(settings_dict, dict)
    assert settings_dict, "settings.yaml está vacío"


def test_settings_tiene_campos_requeridos(settings_dict: dict):
    """`settings.yaml` declara las secciones clave del pipeline."""
    requeridos = {"paths", "geografia", "sentinel2", "edificios"}
    faltantes = requeridos - set(settings_dict.keys())
    assert not faltantes, f"Faltan secciones en settings.yaml: {faltantes}"


def test_settings_bbox_posadas_coherente(settings_dict: dict):
    """Bbox tiene los 4 lados y oeste < este, sur < norte."""
    bbox = settings_dict["geografia"]["bbox"]
    for lado in ("norte", "sur", "este", "oeste"):
        assert lado in bbox, f"Falta {lado} en bbox"
    assert bbox["oeste"] < bbox["este"], "oeste debe ser < este"
    assert bbox["sur"] < bbox["norte"], "sur debe ser < norte"


def test_settings_fechas_target_son_9(settings_dict: dict):
    """Fase 1 declara 9 fechas target (2018-2026)."""
    fechas = settings_dict["sentinel2"]["fechas_target"]
    assert len(fechas) == 9, f"Se esperaban 9 fechas, hay {len(fechas)}"
    # Formato YYYY-MM
    for f in fechas:
        assert len(f) == 7 and f[4] == "-", f"Formato inválido: {f}"


def test_settings_confidence_threshold_razonable(settings_dict: dict):
    """confidence_threshold entre 0 y 1 (no por debajo de 0.5 para OB)."""
    ct = settings_dict["edificios"]["confidence_threshold"]
    assert 0.5 <= ct <= 1.0, f"confidence_threshold fuera de rango sano: {ct}"
