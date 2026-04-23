"""Tests de geometrías de polígonos (Tarea 2.8).

Validan la integridad y semántica del archivo `config/poligonos.geojson`.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pytest
import yaml
from shapely.geometry import box

# Ruta al geojson real del proyecto
RUTA_POLIGONOS = Path(__file__).parent.parent / "config" / "poligonos.geojson"
RUTA_SETTINGS = Path(__file__).parent.parent / "config" / "settings.yaml"

# Categorías permitidas según el dominio del proyecto
CATEGORIAS_VALIDAS = {
    "asentamiento_crecimiento_rapido",
    "consolidado_crecimiento",
    "control_consolidado",
    "zona_sensible",
}

PROPERTIES_REQUERIDAS = {"id", "nombre", "categoria", "prioridad"}


# ---------------------------------------------------------------------------
# Fixtures locales que cargan los archivos reales (si existen)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def gdf_poligonos() -> gpd.GeoDataFrame:
    if not RUTA_POLIGONOS.exists():
        pytest.skip(f"{RUTA_POLIGONOS} no existe")
    return gpd.read_file(RUTA_POLIGONOS)


@pytest.fixture(scope="module")
def settings_dict() -> dict:
    if not RUTA_SETTINGS.exists():
        pytest.skip(f"{RUTA_SETTINGS} no existe")
    with RUTA_SETTINGS.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_poligonos_validos(gdf_poligonos: gpd.GeoDataFrame):
    """Todas las geometrías son topológicamente válidas."""
    assert gdf_poligonos.geometry.is_valid.all(), (
        "Hay geometrías inválidas en poligonos.geojson: "
        f"{gdf_poligonos[~gdf_poligonos.geometry.is_valid]['id'].tolist()}"
    )


def test_poligonos_dentro_bbox_posadas(
    gdf_poligonos: gpd.GeoDataFrame, settings_dict: dict
):
    """Todos los polígonos intersectan el bbox de Posadas (settings.yaml)."""
    bbox_cfg = settings_dict["geografia"]["bbox"]
    bbox_posadas = box(
        bbox_cfg["oeste"],
        bbox_cfg["sur"],
        bbox_cfg["este"],
        bbox_cfg["norte"],
    )
    for _, fila in gdf_poligonos.iterrows():
        assert fila.geometry.intersects(bbox_posadas), (
            f"Polígono {fila['id']} no intersecta el bbox de Posadas"
        )


def test_poligonos_no_solapan(gdf_poligonos: gpd.GeoDataFrame):
    """Ningún polígono solapa con otro más de 5% de su área.

    Aceptamos solapamientos chicos (fronteras compartidas) pero no
    duplicación significativa de territorio.
    """
    n = len(gdf_poligonos)
    filas = list(gdf_poligonos.itertuples(index=False))
    fallos = []
    for i in range(n):
        for j in range(i + 1, n):
            geom_i = filas[i].geometry
            geom_j = filas[j].geometry
            if not geom_i.intersects(geom_j):
                continue
            inter_area = geom_i.intersection(geom_j).area
            frac_i = inter_area / geom_i.area if geom_i.area > 0 else 0
            frac_j = inter_area / geom_j.area if geom_j.area > 0 else 0
            if frac_i > 0.05 or frac_j > 0.05:
                fallos.append(
                    (filas[i].id, filas[j].id, round(frac_i, 3), round(frac_j, 3))
                )
            # Idénticos = geometría duplicada -> siempre falla
            assert not geom_i.equals(geom_j), (
                f"Polígonos {filas[i].id} y {filas[j].id} son idénticos"
            )
    assert not fallos, f"Solapamientos significativos: {fallos}"


def test_poligonos_ids_unicos(gdf_poligonos: gpd.GeoDataFrame):
    """Los IDs son únicos dentro del GeoDataFrame."""
    ids = gdf_poligonos["id"].tolist()
    assert len(ids) == len(set(ids)), (
        f"IDs duplicados en poligonos.geojson: {[i for i in ids if ids.count(i) > 1]}"
    )


def test_poligonos_properties_requeridas(gdf_poligonos: gpd.GeoDataFrame):
    """Cada feature tiene id, nombre, categoria, prioridad."""
    faltantes = PROPERTIES_REQUERIDAS - set(gdf_poligonos.columns)
    assert not faltantes, f"Properties faltantes: {faltantes}"
    for req in PROPERTIES_REQUERIDAS:
        nulos = gdf_poligonos[req].isna().sum()
        assert nulos == 0, f"Property {req} tiene {nulos} nulos"


def test_categorias_validas(gdf_poligonos: gpd.GeoDataFrame):
    """La categoría pertenece al vocabulario controlado."""
    categorias_encontradas = set(gdf_poligonos["categoria"].unique())
    desconocidas = categorias_encontradas - CATEGORIAS_VALIDAS
    assert not desconocidas, (
        f"Categorías desconocidas: {desconocidas}. "
        f"Válidas: {CATEGORIAS_VALIDAS}"
    )
