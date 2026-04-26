"""Audit de geometrías: detectar polígonos fragmentados, agujeros y cobertura."""
from __future__ import annotations
import geopandas as gpd
import json
from shapely.ops import unary_union

g = gpd.read_file("config/poligonos.geojson")
gm = g.to_crs("EPSG:32721")

print("=" * 70)
print("AUDIT GEOMETRÍAS — config/poligonos.geojson")
print("=" * 70)
print(f"Total polígonos: {len(g)}")
print()

# 1. Detectar MultiPolygons (fragmentados) y agujeros
print("1) Polígonos fragmentados (MultiPolygon con >1 parte) o con agujeros:")
problemas = []
for i, row in gm.iterrows():
    geom = row.geometry
    if geom.geom_type == "MultiPolygon":
        n_parts = len(geom.geoms)
        if n_parts > 1:
            areas = sorted([p.area / 1e6 for p in geom.geoms], reverse=True)
            ratio = areas[1] / areas[0] if areas[0] > 0 else 0
            problemas.append({
                "id": row["id"],
                "tipo": "multipolygon",
                "n_parts": n_parts,
                "area_total_km2": round(geom.area / 1e6, 3),
                "areas_partes": [round(a, 3) for a in areas],
                "ratio_segundo_primero": round(ratio, 3),
            })
    if hasattr(geom, "interiors"):
        n_holes = len(list(geom.interiors)) if geom.geom_type == "Polygon" else sum(len(list(p.interiors)) for p in geom.geoms)
        if n_holes > 0:
            problemas.append({
                "id": row["id"],
                "tipo": "agujeros",
                "n_agujeros": n_holes,
                "area_total_km2": round(geom.area / 1e6, 3),
            })

if problemas:
    for p in problemas:
        print(f"  - {p}")
else:
    print("  (ninguno)")

# 2. Cobertura: cuánto del bbox urbano de Posadas NO está cubierto
print()
print("2) Cobertura espacial:")
bbox_oeste, bbox_sur, bbox_este, bbox_norte = -56.05, -27.51, -55.80, -27.30
from shapely.geometry import box
bbox_poly = box(bbox_oeste, bbox_sur, bbox_este, bbox_norte)
bbox_gdf = gpd.GeoDataFrame([{"geometry": bbox_poly}], crs="EPSG:4326").to_crs("EPSG:32721")
bbox_area_km2 = bbox_gdf.geometry.iloc[0].area / 1e6

union_pol = unary_union(gm.geometry)
cubierta_km2 = union_pol.area / 1e6
print(f"  bbox proyecto: {bbox_area_km2:.1f} km²")
print(f"  Área unión polígonos: {cubierta_km2:.1f} km²")
print(f"  Cobertura: {cubierta_km2 / bbox_area_km2 * 100:.1f}%")

# 3. Estadísticas
print()
print("3) Estadísticas de área (km²):")
gm["area_km2"] = gm.geometry.area / 1e6
print(gm["area_km2"].describe().round(2).to_string())

# 4. Polígonos sospechosamente chicos (<0.05 km² o 50_000 m²)
print()
print("4) Polígonos muy chicos (<0.1 km², 100_000 m²):")
chicos = gm[gm["area_km2"] < 0.1][["id", "area_km2"]].sort_values("area_km2")
if len(chicos) > 0:
    print(chicos.to_string(index=False))
else:
    print("  (ninguno)")

print()
print("=" * 70)
