"""Rasters sintéticos y geometría real: cobertura, máscaras y borde de 300 m."""

import numpy as np
import pytest
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin
from shapely.geometry import LineString, Point, box

from scripts.utils.exposicion_dem import DrainageHeightSampler, population_total, sample_dem


@pytest.fixture
def dem():
    data = np.full((40, 40), 120, dtype="float32")
    data[30, :] = 100  # y=300: curso a 100 m, terreno a 120 m
    with MemoryFile() as file:
        with file.open(
            driver="GTiff",
            height=40,
            width=40,
            count=1,
            dtype="float32",
            crs="EPSG:32721",
            transform=from_origin(0, 1200, 30, 30),
            nodata=-9999,
        ) as ds:
            ds.write(data, 1)
            yield ds


def test_real_nearest_point_resolves_sampling_edge_without_expanding_radius(dem):
    water = [LineString([(100, 300), (700, 300)])]
    sampler = DrainageHeightSampler(dem, water)
    points = [Point(115, 599.9), Point(115, 600.1)]
    distances, heights, quality = sampler.measure(points)
    assert sampler.kd.query_ball_point([[115, 599.9]], 300, return_length=True)[0] == 0
    assert distances == pytest.approx([299.9, 300.1])
    assert heights[0] == 20
    assert quality["borde_muestreo_resuelto"][0]
    assert np.isnan(heights[1])  # No se amplía el radio para completar resultados


def test_missing_terrain_is_never_filled(dem):
    data = dem.read(1)
    data[20, 3] = -9999
    dem.write(data, 1)
    sampler = DrainageHeightSampler(dem, [LineString([(100, 300), (700, 300)])])
    _, heights, quality = sampler.measure([Point(115, 599.9)])
    assert np.isnan(heights[0])
    assert quality["sin_altura_terreno"][0]


def test_missing_drainage_is_never_filled(dem):
    data = dem.read(1)
    data[30, :] = -9999
    dem.write(data, 1)
    sampler = DrainageHeightSampler(dem, [LineString([(100, 300), (700, 300)])])
    _, heights, quality = sampler.measure([Point(115, 599.9)])
    assert np.isnan(heights[0])
    assert quality["sin_altura_drenaje"][0]


def test_partial_drainage_nodata_is_not_silently_discarded(dem):
    data = dem.read(1)
    data[30, 10] = -9999
    dem.write(data, 1)
    sampler = DrainageHeightSampler(dem, [LineString([(100, 300), (700, 300)])])
    _, heights, quality = sampler.measure([Point(115, 500)])
    assert np.isnan(heights[0])
    assert quality["sin_altura_drenaje"][0]


def test_zero_is_valid_and_outside_extent_is_unknown(dem):
    data = dem.read(1)
    data[20, 3] = 0
    dem.write(data, 1)
    values = sample_dem(dem, [[115, 599.9], [-5, 599.9]])
    assert values[0] == 0
    assert np.isnan(values[1])


def test_population_partial_coverage_is_not_reported_as_total(dem):
    total, reason = population_total(dem, box(-10, 500, 100, 600))
    assert total is None
    assert reason == "fuera_de_cobertura"


def test_population_nodata_and_zero_are_distinct(dem):
    data = dem.read(1)
    data[20, 3] = -9999
    dem.write(data, 1)
    assert population_total(dem, box(90, 570, 120, 600)) == (None, "nodata_en_poligono")
    data[20, 3] = 0
    dem.write(data, 1)
    assert population_total(dem, box(90, 570, 120, 600)) == (0.0, "completa")
