"""Fixtures compartidas para los tests del Observatorio Posadas.

Todas las fixtures son sintéticas — no dependen de datos reales descargados.
Esto permite que los tests corran en CI sin credenciales de EE, Planet, etc.
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest
from shapely.geometry import Point, Polygon

# BBox aproximado de Posadas (coherente con settings.yaml)
_POSADAS_BBOX = {
    "norte": -27.30,
    "sur": -27.50,
    "este": -55.80,
    "oeste": -56.00,
}


@pytest.fixture
def tmp_output_dir(tmp_path: Path) -> Path:
    """Directorio temporal para outputs. Wrapper sobre tmp_path."""
    out = tmp_path / "outputs"
    out.mkdir(parents=True, exist_ok=True)
    return out


@pytest.fixture
def sample_polygon_gdf():
    """GeoDataFrame con 2 polígonos sintéticos (rectángulos en Posadas).

    Ambos están dentro del bbox de Posadas y no se solapan.
    """
    import geopandas as gpd

    poligonos = [
        {
            "id": "test_poligono_a",
            "nombre": "Polígono Test A",
            "categoria": "asentamiento_crecimiento_rapido",
            "prioridad": 1,
            "descripcion": "Polígono sintético A para tests.",
            "geometry": Polygon(
                [
                    (-55.97, -27.43),
                    (-55.95, -27.43),
                    (-55.95, -27.41),
                    (-55.97, -27.41),
                    (-55.97, -27.43),
                ]
            ),
        },
        {
            "id": "test_poligono_b",
            "nombre": "Polígono Test B",
            "categoria": "control_consolidado",
            "prioridad": 3,
            "descripcion": "Polígono sintético B (zona de control) para tests.",
            "geometry": Polygon(
                [
                    (-55.89, -27.375),
                    (-55.87, -27.375),
                    (-55.87, -27.360),
                    (-55.89, -27.360),
                    (-55.89, -27.375),
                ]
            ),
        },
    ]
    gdf = gpd.GeoDataFrame(poligonos, crs="EPSG:4326")
    return gdf


@pytest.fixture
def sample_buildings_gdf(sample_polygon_gdf):
    """100 points sintéticos distribuidos random dentro de los polígonos.

    Cada edificio tiene:
    - area_m2: gamma(k=2, theta=40) -> promedio ~80 m² (casa típica en Posadas).
    - confidence: beta(alpha=8, beta=2) -> sesgado hacia valores altos, como OB.
    """
    import geopandas as gpd

    rng = np.random.default_rng(42)
    records = []
    edificio_id = 0
    for _, poligono in sample_polygon_gdf.iterrows():
        minx, miny, maxx, maxy = poligono.geometry.bounds
        generados = 0
        # Reintentamos hasta completar 50 puntos dentro del polígono.
        while generados < 50:
            lon = rng.uniform(minx, maxx)
            lat = rng.uniform(miny, maxy)
            punto = Point(lon, lat)
            if not poligono.geometry.contains(punto):
                continue
            records.append(
                {
                    "edificio_id": f"edif_{edificio_id:04d}",
                    "poligono_id": poligono["id"],
                    "area_m2": float(rng.gamma(shape=2.0, scale=40.0)),
                    "confidence": float(rng.beta(8.0, 2.0)),
                    "geometry": punto,
                }
            )
            edificio_id += 1
            generados += 1
    gdf = gpd.GeoDataFrame(records, crs="EPSG:4326")
    return gdf


@pytest.fixture
def sample_serie_temporal_df() -> pd.DataFrame:
    """Serie temporal sintética con 2 polígonos × 9 años y crecimiento monotónico.

    Columnas: poligono_id, fecha, n_edificios_min, n_edificios_estimado, n_edificios_max.
    """
    fechas = [
        "2018-07",
        "2019-07",
        "2020-07",
        "2021-07",
        "2022-07",
        "2023-07",
        "2024-07",
        "2025-07",
        "2026-07",
    ]
    # Crecimiento: polígono A crece fuerte (100 -> 300), B casi estable.
    crecimiento = {
        "test_poligono_a": [100, 120, 145, 175, 210, 240, 265, 285, 300],
        "test_poligono_b": [500, 505, 510, 512, 515, 518, 520, 522, 525],
    }
    filas = []
    for poligono_id, counts in crecimiento.items():
        for fecha, n in zip(fechas, counts):
            filas.append(
                {
                    "poligono_id": poligono_id,
                    "fecha": fecha,
                    "n_edificios_min": int(n * 0.85),
                    "n_edificios_estimado": int(n),
                    "n_edificios_max": int(n * 1.15),
                }
            )
    return pd.DataFrame(filas)


@pytest.fixture
def mock_ee_session(monkeypatch) -> Iterator[MagicMock]:
    """Mockea ee.Initialize como no-op y ee.ImageCollection como MagicMock.

    Usar en tests que instancian algo que importa `ee` pero no deberían
    contactar el servicio real.
    """
    try:
        import ee  # type: ignore
    except ImportError:
        pytest.skip("earthengine-api no instalado")

    fake_col = MagicMock()
    fake_col.size.return_value.getInfo.return_value = 0
    fake_col.filterBounds.return_value = fake_col
    fake_col.filterDate.return_value = fake_col
    fake_col.filter.return_value = fake_col
    fake_col.select.return_value = fake_col
    fake_col.median.return_value = MagicMock()

    monkeypatch.setattr(ee, "Initialize", lambda *a, **kw: None)
    monkeypatch.setattr(ee, "ImageCollection", lambda *a, **kw: fake_col)
    yield fake_col


@pytest.fixture
def mock_requests():
    """Fixture con `responses` library para mockear requests HTTP.

    Uso:

        def test_algo(mock_requests):
            mock_requests.add(mock_requests.GET, 'https://api.planet.com/...', ...)
    """
    try:
        import responses
    except ImportError:
        pytest.skip("responses library no instalada")

    with responses.RequestsMock() as rsps:
        yield rsps
