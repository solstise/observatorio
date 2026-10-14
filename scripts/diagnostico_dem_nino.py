"""Diagnóstico reproducible agregado de las alturas faltantes, sin publicar centroides."""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import shapely
from pyproj import Transformer
from scipy.spatial import cKDTree
from shapely.geometry import LineString


def diagnosticar():
    payload = json.loads((ROOT / "data/raw/osm/nino_overpass.json").read_text(encoding="utf-8"))
    lines = [
        LineString([(p["lon"], p["lat"]) for p in el["geometry"]])
        for el in payload["elements"]
        if el.get("tags", {}).get("waterway") and len(el.get("geometry", [])) >= 2
    ]
    water = gpd.GeoSeries(lines, crs=4326).to_crs(32721)
    tree = shapely.STRtree(water.values)
    samples = [line.interpolate(d) for line in water for d in np.arange(0, line.length + 30, 30)]
    xy = np.array([(p.x, p.y) for p in samples])
    buildings = pd.read_csv(
        ROOT / "data/raw/buildings_merge/posadas_merged_buildings.csv", usecols=["lat", "lon"]
    )
    points = gpd.GeoDataFrame(
        geometry=gpd.points_from_xy(buildings.lon, buildings.lat), crs=4326
    ).to_crs(32721)
    coords = np.column_stack((points.geometry.x, points.geometry.y))
    indices, ds = tree.query_nearest(
        points.geometry.values, return_distance=True, all_matches=False
    )
    dist = np.full(len(points), np.inf)
    dist[indices[0]] = ds
    with rasterio.open(ROOT / "data/raw/dem/posadas_dem.tif") as dem:
        transform = Transformer.from_crs(32721, dem.crs, always_xy=True)

        def sample(coords):
            x, y = transform.transform(coords[:, 0], coords[:, 1])
            return np.ma.vstack(list(dem.sample(zip(x, y), masked=True))).filled(np.nan)[:, 0]

        wz = sample(xy)
        terrain = sample(coords)
        kd = cKDTree(xy[np.isfinite(wz)])
        near = kd.query_ball_point(coords, 300, return_length=True)
        heights_missing = (~np.isfinite(terrain)) | (near == 0)
        unknown = (dist >= 100) & (dist <= 300) & heights_missing
        points["sin_altura_terreno"] = unknown & ~np.isfinite(terrain)
        points["sin_muestra_drenaje"] = unknown & (near == 0)
        points["solo_terreno"] = unknown & ~np.isfinite(terrain) & (near > 0)
        points["solo_drenaje"] = unknown & np.isfinite(terrain) & (near == 0)
        points["ambos"] = unknown & ~np.isfinite(terrain) & (near == 0)
        points["a_verificar"] = unknown
        points["distancia"] = dist
        points["muestra_mas_cercana"] = kd.query(coords)[0]
        raster = dem.read(1, masked=True)
        raster_info = {
            "crs": str(dem.crs),
            "bounds": list(dem.bounds),
            "shape": list(dem.shape),
            "nodata": dem.nodata,
            "pixeles_sin_dato": int(np.ma.getmaskarray(raster).sum()),
        }
    barrios = gpd.read_file(ROOT / "config/poligonos.geojson").to_crs(32721)
    barrios = barrios[(barrios.id != "posadas_completa") & (barrios.categoria != "ciudad_completa")]
    joined = gpd.sjoin(points, barrios[["id", "geometry"]], how="inner", predicate="intersects")
    joined = joined.sort_values("id").loc[lambda d: ~d.index.duplicated()]
    out = []
    for pid, group in joined.groupby("id"):
        missing = group[group.a_verificar]
        out.append(
            {
                "poligono_id": pid,
                "a_verificar": int(group.a_verificar.sum()),
                "sin_altura_terreno": int(group.sin_altura_terreno.sum()),
                "sin_muestra_drenaje": int(group.sin_muestra_drenaje.sum()),
                "distancia_min": float(missing.distancia.min()) if len(missing) else None,
                "distancia_max": float(missing.distancia.max()) if len(missing) else None,
                "muestra_mas_cercana_max": (
                    float(missing.muestra_mas_cercana.max()) if len(missing) else None
                ),
            }
        )
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "version": "Diagnóstico del raster y algoritmo PREVIOS; no describe la cobertura corregida",
        "raster": raster_info,
        "barrios": out,
        "totales": {
            k: int(joined[k].sum())
            for k in [
                "a_verificar",
                "sin_altura_terreno",
                "sin_muestra_drenaje",
                "solo_terreno",
                "solo_drenaje",
                "ambos",
            ]
        },
    }
    output = ROOT / "data/outputs/diagnostico_dem_nino.json"
    output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "raster": raster_info,
                "totales": result["totales"],
                "barrios_afectados": sum(r["a_verificar"] > 0 for r in out),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    diagnosticar()
