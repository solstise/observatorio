"""Exposición estática agregada. Usa DEM Copernicus existente y footprints combinados.

Ejecutar desde la raíz: python scripts/61_exposicion_hidrica.py
No publica puntos de edificios. Las zonas son una grilla de 60 m disuelta.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import requests
import shapely
import yaml
from pyproj import Transformer
from rasterio.mask import mask
from scipy.spatial import cKDTree
from shapely.geometry import LineString, box

from scripts.nino_model import agregar_exposicion

CRS = "EPSG:32721"


def osm_cached(endpoint):
    path = ROOT / "data/raw/osm/nino_overpass.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    bbox = yaml.safe_load((ROOT / "config/settings.yaml").read_text(encoding="utf-8"))["geografia"]["bbox"]
    b = f"{bbox['sur']},{bbox['oeste']},{bbox['norte']},{bbox['este']}"
    query = f'[out:json][timeout:60];way[waterway~"^(stream|river|canal|drain|ditch)$"]({b});out geom;'
    # Una consulta cacheada. Sin reintentos agresivos ni descargas por barrio.
    response = requests.get(endpoint, params={"data": query},
                             headers={"User-Agent": "ObservatorioPosadas-exposicion/1.0"}, timeout=150)
    response.raise_for_status()
    payload = response.json()
    if payload.get("remark"):
        raise ValueError(f"Overpass incompleto: {payload['remark']}")
    payload["downloaded_at"] = datetime.now(timezone.utc).isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload


def clasificar(distances, heights):
    result = np.full(len(distances), "no_expuesto", dtype=object)
    unknown = (distances <= 300) & ~np.isfinite(heights)
    result[unknown] = "a_verificar"
    result[(distances < 100) | (heights < 4)] = "expuesto"
    result[(distances < 50) & (heights < 2)] = "muy_expuesto"
    return result


def export_kml(zones, path):
    ns = "http://www.opengis.net/kml/2.2"
    ET.register_namespace("", ns)
    root = ET.Element(f"{{{ns}}}kml")
    doc = ET.SubElement(root, f"{{{ns}}}Document")
    for row in zones.itertuples():
        pm = ET.SubElement(doc, f"{{{ns}}}Placemark")
        ET.SubElement(pm, f"{{{ns}}}name").text = row.nombre
        multi = ET.SubElement(pm, f"{{{ns}}}MultiGeometry")
        polys = list(row.geometry.geoms) if row.geometry.geom_type == "MultiPolygon" else [row.geometry]
        for poly in polys:
            if poly.geom_type != "Polygon":
                continue
            el = ET.SubElement(multi, f"{{{ns}}}Polygon")
            for label, rings in (("outerBoundaryIs", [poly.exterior]), ("innerBoundaryIs", poly.interiors)):
                for ring in rings:
                    boundary = ET.SubElement(el, f"{{{ns}}}{label}")
                    linear = ET.SubElement(boundary, f"{{{ns}}}LinearRing")
                    ET.SubElement(linear, f"{{{ns}}}coordinates").text = " ".join(f"{x},{y},0" for x, y in ring.coords)
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def export_facilities(endpoint):
    cached = ROOT / "data/raw/osm/nino_equipamientos.json"
    if cached.exists():
        data = json.loads(cached.read_text(encoding="utf-8"))
    else:
        b = yaml.safe_load((ROOT / "config/settings.yaml").read_text(encoding="utf-8"))["geografia"]["bbox"]
        bbox = f"{b['sur']},{b['oeste']},{b['norte']},{b['este']}"
        q = f'[out:json][timeout:60];(nwr[amenity~"school|hospital|clinic|doctors|community_centre"]({bbox});nwr[leisure=sports_centre]({bbox});nwr[name~"CAV|Centro de Atenci",i]({bbox}););out center;'
        r = requests.get(endpoint, params={"data": q}, headers={"User-Agent": "ObservatorioPosadas-exposicion/1.0"}, timeout=100)
        r.raise_for_status()
        data = r.json()
        if data.get("remark"):
            raise ValueError("Consulta de equipamientos incompleta")
        data["downloaded_at"] = datetime.now(timezone.utc).isoformat()
        cached.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    features = []
    labels = {"school": "Escuela", "hospital": "Hospital", "clinic": "Centro de salud", "doctors": "Atención de salud", "community_centre": "Centro comunitario", "sports_centre": "Centro deportivo"}
    for el in data["elements"]:
        pos = el.get("center", el)
        if "lat" not in pos:
            continue
        tags = el.get("tags", {})
        kind = tags.get("amenity", tags.get("leisure", "CAV"))
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [pos["lon"], pos["lat"]]},
                         "properties": {"nombre": tags.get("name", labels.get(kind, "Equipamiento sin nombre")),
                                        "tipo": labels.get(kind, "CAV"),
                                        "osm_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}"}})
    target = ROOT / "data/outputs/equipamientos_nino.geojson"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"type": "FeatureCollection", "generated_at": data["downloaded_at"], "features": features}, ensure_ascii=False), encoding="utf-8")
    print(f"Equipamientos públicos OSM: {len(features)}")


def main(endpoint):
    payload = osm_cached(endpoint)
    lines, facilities = [], []
    for el in payload["elements"]:
        tags = el.get("tags", {})
        if tags.get("waterway") and len(el.get("geometry", [])) >= 2:
            lines.append(LineString([(p["lon"], p["lat"]) for p in el["geometry"]]))
        elif tags.get("amenity") or tags.get("leisure") or "CAV" in tags.get("name", ""):
            center = el.get("center", el)
            if "lat" in center and "lon" in center:
                # Solo nombre público y tipo, nunca teléfonos/contactos de personas.
                facilities.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [center["lon"], center["lat"]]},
                                   "properties": {"nombre": tags.get("name", "Equipamiento sin nombre"),
                                                  "tipo": tags.get("amenity", tags.get("leisure", "CAV")),
                                                  "osm_url": f"https://www.openstreetmap.org/{el['type']}/{el['id']}"}})
    if not lines:
        raise ValueError("Red OSM vacía: no se puede estimar exposición")
    water = gpd.GeoSeries(lines, crs=4326).to_crs(CRS)
    tree = shapely.STRtree(water.values)
    samples = []
    for line in water:
        samples.extend(line.interpolate(d) for d in np.arange(0, line.length + 30, 30))
    xy = np.array([(p.x, p.y) for p in samples])
    to_dem = Transformer.from_crs(CRS, 4326, always_xy=True)
    with rasterio.open(ROOT / "data/raw/dem/posadas_dem.tif") as dem:
        if dem.crs != rasterio.crs.CRS.from_epsg(4326):
            to_dem = Transformer.from_crs(CRS, dem.crs, always_xy=True)

        def elevations(coords):
            xs, ys = to_dem.transform(coords[:, 0], coords[:, 1])
            a = np.array([v[0] for v in dem.sample(zip(xs, ys), masked=True)], dtype=float)
            if dem.nodata is not None:
                a[a == dem.nodata] = np.nan
            return a

        water_z = elevations(xy)
        valid = np.isfinite(water_z)
        xy, water_z = xy[valid], water_z[valid]
        if not len(xy):
            raise ValueError("DEM sin cobertura de la red OSM")
        kd = cKDTree(xy)

        def classify_points(points):
            coords = np.array([(p.x, p.y) for p in points])
            indices, nearest_dist = tree.query_nearest(points, return_distance=True, all_matches=False)
            distances = np.full(len(points), np.inf)
            distances[indices[0]] = nearest_dist
            terrain = elevations(coords)
            heights = np.full(len(points), np.nan)
            near = kd.query_ball_point(coords, 300)
            for i, candidates in enumerate(near):
                if candidates and np.isfinite(terrain[i]):
                    heights[i] = max(0, terrain[i] - water_z[candidates].min())
            return clasificar(distances, heights)

        print("Leyendo footprints combinados", flush=True)
        buildings = pd.read_csv(ROOT / "data/raw/buildings_merge/posadas_merged_buildings.csv", usecols=["lat", "lon"])
        points = gpd.GeoDataFrame(geometry=gpd.points_from_xy(buildings.lon, buildings.lat), crs=4326).to_crs(CRS)
        points["clase"] = classify_points(points.geometry.values)
        barrios = gpd.read_file(ROOT / "config/poligonos.geojson")
        barrios = barrios[(barrios["id"] != "posadas_completa") & (barrios["categoria"] != "ciudad_completa")].to_crs(CRS)
        joined = gpd.sjoin(points, barrios[["id", "geometry"]], how="inner", predicate="intersects")
        # Si hay solapamientos de polígonos, asignación estable una sola vez.
        duplicates = int(joined.index.duplicated().sum())
        joined = joined.sort_values("id").loc[lambda d: ~d.index.duplicated()]
        output = []
        with rasterio.open(ROOT / "data/raw/worldpop/posadas_pop_2020.tif") as pop:
            for row in barrios.itertuples():
                geom = gpd.GeoSeries([row.geometry], crs=CRS).to_crs(pop.crs).iloc[0]
                try:
                    a, _ = mask(pop, [geom.__geo_interface__], crop=True, filled=False)
                    total_pop = float(a[a >= 0].sum())
                    if not np.isfinite(total_pop) or total_pop <= 0:
                        total_pop = None
                except ValueError:
                    total_pop = None
                classes = joined.loc[joined["id"] == row.id, "clase"].tolist()
                output.append({"poligono_id": row.id, "nombre": row.nombre,
                               **agregar_exposicion(classes, total_pop)})
        print("Generando zonas agregadas de 60 m", flush=True)
        bounds = barrios.total_bounds
        xs = np.arange(bounds[0], bounds[2], 60)
        ys = np.arange(bounds[1], bounds[3], 60)
        xx, yy = np.meshgrid(xs, ys)
        cells = gpd.GeoDataFrame(geometry=gpd.points_from_xy(xx.ravel() + 30, yy.ravel() + 30), crs=CRS)
        # Limitar a 300 m de drenajes: fuera de ese radio HAND es indefinido.
        indices, nearest_dist = tree.query_nearest(cells.geometry.values, return_distance=True, all_matches=False)
        dist = np.full(len(cells), np.inf)
        dist[indices[0]] = nearest_dist
        cells = cells[dist <= 300].copy()
        cells["clase"] = classify_points(cells.geometry.values)
        cells = cells[cells.clase.isin(["expuesto", "muy_expuesto"])].copy()
        cells.geometry = [box(p.x - 30, p.y - 30, p.x + 30, p.y + 30) for p in cells.geometry]
        union = shapely.union_all(cells.geometry.values)
        zones = barrios[["id", "nombre", "geometry"]].copy()
        zones.geometry = zones.geometry.intersection(union)
        zones = zones[~zones.geometry.is_empty].to_crs(4326)
    out = ROOT / "data/outputs"
    out.mkdir(parents=True, exist_ok=True)
    result = {"generated_at": datetime.now(timezone.utc).isoformat(), "barrios": output,
              "metodo": "Altura relativa aproximada: cota de centroide menos mínima cota de drenajes OSM muestreados cada 30 m dentro de 300 m. No es HAND hidrológico.",
              "dem": "Copernicus GLO-30 existente (script 46); no es SRTM 2000",
              "poblacion": "WorldPop 2020 prorrateado por proporción de footprints expuestos; banda ±20% orientativa, no intervalo estadístico",
              "viviendas": "Footprints Google + Microsoft como proxy: un edificio no equivale necesariamente a una vivienda",
              "zonas": "Grilla 60 m disuelta por barrio, sin edificios individuales",
              "osm_downloaded_at": payload["downloaded_at"], "duplicados_por_solapamiento": duplicates,
              "n_cursos_osm": len(lines)}
    (out / "exposicion_hidrica.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    zones.to_file(out / "exposicion_hidrica.geojson", driver="GeoJSON")
    export_kml(zones, out / "exposicion_hidrica.kml")
    print(f"Exposición: {len(output)} barrios, {len(lines)} cursos, {len(facilities)} equipamientos", flush=True)
    export_facilities(endpoint)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overpass-url", default="https://overpass-api.de/api/interpreter")
    parser.add_argument("--equipamientos", action="store_true")
    args = parser.parse_args()
    if args.equipamientos:
        export_facilities(args.overpass_url)
    else:
        main(args.overpass_url)
