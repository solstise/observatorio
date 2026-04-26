"""Construye geometrias Shapely a partir del Overpass body dump.

Solo se ejecuta una vez al expandir config/poligonos.geojson. No es parte del
pipeline. Imprime: nombre, area km2, vertices, bbox.

Uso:
    python scripts/_build_polygons_step.py
"""

from __future__ import annotations

import json
import math
import unicodedata
from pathlib import Path

from shapely.geometry import (
    LineString,
    MultiPolygon,
    Polygon,
    mapping,
)
from shapely.ops import linemerge, polygonize, unary_union

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "osm" / "barrios_posadas_overpass.json"


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().strip()
    out = []
    for c in s:
        if c.isalnum():
            out.append(c)
        elif out and out[-1] != "_":
            out.append("_")
    res = "".join(out).strip("_")
    return res


def build_geom(rel, ways_by_id, nodes_by_id):
    """Reconstruye Polygon/MultiPolygon a partir de members outer/inner."""
    outer_lines = []
    inner_lines = []
    for m in rel.get("members", []):
        if m.get("type") != "way":
            continue
        role = m.get("role", "outer") or "outer"
        way = ways_by_id.get(m["ref"])
        if not way:
            continue
        coords = []
        for nid in way.get("nodes", []):
            n = nodes_by_id.get(nid)
            if n and "lat" in n and "lon" in n:
                coords.append((n["lon"], n["lat"]))
        if len(coords) < 2:
            continue
        line = LineString(coords)
        if role == "inner":
            inner_lines.append(line)
        else:
            outer_lines.append(line)

    if not outer_lines:
        return None

    # Merge contiguous lines and polygonize
    merged = unary_union(outer_lines)
    if merged.geom_type == "MultiLineString":
        merged = linemerge(merged)
    if merged.geom_type == "LineString":
        polys_out = list(polygonize([merged]))
    elif merged.geom_type == "MultiLineString":
        polys_out = list(polygonize(merged))
    else:
        polys_out = []

    if not polys_out:
        # Some relations have a single closed way already
        for ln in outer_lines:
            if ln.is_ring:
                polys_out.append(Polygon(ln.coords))
        if not polys_out:
            return None

    if inner_lines:
        inner_merged = unary_union(inner_lines)
        if inner_merged.geom_type == "MultiLineString":
            inner_merged = linemerge(inner_merged)
        if inner_merged.geom_type == "LineString":
            merged_inner = list(polygonize([inner_merged]))
        elif inner_merged.geom_type == "MultiLineString":
            merged_inner = list(polygonize(inner_merged))
        else:
            merged_inner = []
    else:
        merged_inner = []

    if len(polys_out) == 1:
        if merged_inner:
            polys_out = [
                Polygon(
                    polys_out[0].exterior.coords,
                    [p.exterior.coords for p in merged_inner],
                )
            ]
        return polys_out[0]
    return MultiPolygon(polys_out)


def shapely_area_km2(geom) -> float:
    # Approx: latitude-based projection
    if geom is None:
        return 0.0
    centroid = geom.centroid
    lat0 = centroid.y
    cos = math.cos(math.radians(lat0))
    # Project to local meters (very rough)
    if geom.geom_type == "Polygon":
        polys = [geom]
    elif geom.geom_type == "MultiPolygon":
        polys = list(geom.geoms)
    else:
        return 0.0
    total = 0.0
    for p in polys:
        coords = list(p.exterior.coords)
        xs = [(c[0]) * 111000 * cos for c in coords]
        ys = [(c[1]) * 111000 for c in coords]
        # Shoelace
        a = 0.0
        for i in range(len(xs)):
            j = (i + 1) % len(xs)
            a += xs[i] * ys[j] - xs[j] * ys[i]
        total += abs(a) / 2
    return total / 1_000_000  # m2 -> km2


def main():
    data = json.loads(RAW.read_text())
    elements = data["elements"]
    nodes_by_id = {e["id"]: e for e in elements if e["type"] == "node"}
    ways_by_id = {e["id"]: e for e in elements if e["type"] == "way"}
    rels = [
        e
        for e in elements
        if e["type"] == "relation" and e.get("tags", {}).get("admin_level") == "10"
    ]

    results = []
    for rel in rels:
        name = rel.get("tags", {}).get("name", f"rel_{rel['id']}")
        if name == "???":
            continue
        geom = build_geom(rel, ways_by_id, nodes_by_id)
        if geom is None:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
            if not geom.is_valid:
                continue
        area = shapely_area_km2(geom)
        c = geom.centroid
        results.append((rel["id"], name, area, geom, c.x, c.y))

    # Filter to Posadas core bbox
    def in_core(lat, lon):
        return -27.50 <= lat <= -27.31 and -56.00 <= lon <= -55.83

    results.sort(key=lambda x: -x[2])
    print(f"{'area_km2':>9} {'rel_id':>10} {'lat':>9} {'lon':>9}  name")
    n_in = 0
    for rid, name, area, geom, lon, lat in results:
        if not in_core(lat, lon):
            continue
        n_in += 1
        if n_in <= 80:
            print(f"{area:>9.3f} rel/{rid:>8} {lat:>9.4f} {lon:>9.4f}  {name}")
    print(f"\nTotal admin_level=10 en core Posadas: {n_in}")

    # Save processed
    OUT = ROOT / "data" / "raw" / "osm" / "barrios_processed.json"
    payload = []
    for rid, name, area, geom, lon, lat in results:
        if not in_core(lat, lon):
            continue
        payload.append(
            {
                "id": slugify(name),
                "name": name,
                "rel_id": rid,
                "area_km2": round(area, 4),
                "centroid_lat": lat,
                "centroid_lon": lon,
                "geometry": mapping(geom),
            }
        )
    OUT.write_text(json.dumps(payload, ensure_ascii=False))
    print(f"Saved processed -> {OUT} ({len(payload)} barrios)")


if __name__ == "__main__":
    main()
