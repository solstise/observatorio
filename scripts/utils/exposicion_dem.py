"""Alturas muestreadas del raster, sin interpolar ni ampliar el radio de drenaje."""

import numpy as np
import shapely
from pyproj import Transformer
from rasterio.features import geometry_mask
from rasterio.mask import mask
from scipy.spatial import cKDTree
from shapely.geometry import box


def population_total(dataset, polygon):
    """Solo suma si el polígono está cubierto y sus celdas tienen datos válidos."""
    if not box(*dataset.bounds).covers(polygon):
        return None, "fuera_de_cobertura"
    data, transform = mask(dataset, [polygon.__geo_interface__], crop=True, filled=False)
    inside = geometry_mask(
        [polygon.__geo_interface__], out_shape=data.shape[1:], transform=transform, invert=True
    )
    if not inside.any():
        return None, "sin_celdas"
    values = data[0]
    if (np.ma.getmaskarray(values) & inside).any():
        return None, "nodata_en_poligono"
    raw = values.data[inside]
    if not np.isfinite(raw).all() or (raw < 0).any():
        return None, "valores_invalidos"
    return float(raw.sum(dtype=np.float64)), "completa"


def sample_dem(dataset, coords, source_crs="EPSG:32721"):
    coords = np.asarray(coords, dtype=float)
    if len(coords) == 0:
        return np.array([], dtype=float)
    transformer = Transformer.from_crs(source_crs, dataset.crs, always_xy=True)
    x, y = transformer.transform(coords[:, 0], coords[:, 1])
    values = np.ma.vstack(list(dataset.sample(zip(x, y), masked=True))).astype(float)
    result = values.filled(np.nan)[:, 0]
    result[~np.isfinite(result)] = np.nan
    return result


class DrainageHeightSampler:
    def __init__(self, dataset, waterways):
        self.dataset = dataset
        self.waterways = np.asarray(waterways, dtype=object)
        self.tree = shapely.STRtree(self.waterways)
        points = [
            line.interpolate(d)
            for line in self.waterways
            for d in np.arange(0, line.length + 30, 30)
        ]
        self.coords = np.array([(p.x, p.y) for p in points])
        self.water_z = sample_dem(dataset, self.coords)
        self.kd = cKDTree(self.coords)

    def measure(self, points):
        points = np.asarray(points, dtype=object)
        if len(points) == 0:
            return np.array([]), np.array([]), {}
        coords = np.array([(p.x, p.y) for p in points])
        indices, ds = self.tree.query_nearest(points, return_distance=True, all_matches=False)
        distances = np.full(len(points), np.inf)
        nearest_line = np.zeros(len(points), dtype=int)
        distances[indices[0]] = ds
        nearest_line[indices[0]] = indices[1]
        terrain = sample_dem(self.dataset, coords)
        inside = distances <= 300
        exact_z = np.full(len(points), np.nan)
        if inside.any():
            connectors = shapely.shortest_line(points[inside], self.waterways[nearest_line[inside]])
            projected = shapely.get_point(connectors, -1)
            exact_z[inside] = sample_dem(self.dataset, shapely.get_coordinates(projected))
        heights = np.full(len(points), np.nan)
        missing_drainage = np.zeros(len(points), dtype=bool)
        edge_resolved = np.zeros(len(points), dtype=bool)
        candidates = self.kd.query_ball_point(coords, 300)
        for i in np.flatnonzero(inside):
            zs = self.water_z[candidates[i]]
            # Si faltan cotas del curso dentro del radio, no se adivina su mínimo.
            if not np.isfinite(exact_z[i]) or not np.isfinite(zs).all():
                missing_drainage[i] = True
                continue
            if np.isfinite(terrain[i]):
                minimum = min(exact_z[i], zs.min()) if len(zs) else exact_z[i]
                heights[i] = max(0, terrain[i] - minimum)
                edge_resolved[i] = len(zs) == 0
        return (
            distances,
            heights,
            {
                "sin_altura_terreno": ~np.isfinite(terrain),
                "sin_altura_drenaje": missing_drainage,
                "borde_muestreo_resuelto": edge_resolved,
            },
        )
