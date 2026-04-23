"""Muestra áreas y bbox de config/poligonos.geojson."""
from pathlib import Path
import geopandas as gpd

raiz = Path(__file__).resolve().parent.parent.parent
g = gpd.read_file(raiz / "config" / "poligonos.geojson")
g_m = g.to_crs("EPSG:32721")

print(f"{'ID':15s}  {'Nombre':20s}  Área km²  Vértices  Tipo")
print("-" * 70)
for (_, r), (_, rm) in zip(g.iterrows(), g_m.iterrows()):
    geom = r.geometry
    tipo = geom.geom_type
    if tipo == "Polygon":
        n_vert = len(geom.exterior.coords)
    elif tipo == "MultiPolygon":
        n_vert = sum(len(p.exterior.coords) for p in geom.geoms)
    else:
        n_vert = "-"
    print(f"{r['id']:15s}  {r['nombre']:20s}  {rm.geometry.area/1e6:6.2f}    {n_vert:4}     {tipo}")

print()
west, south, east, north = g.total_bounds
print(f"Bbox total (O,S,E,N): {west:.4f}, {south:.4f}, {east:.4f}, {north:.4f}")
print(f"Dimensiones: {(east-west)*111.32*0.888:.1f} km O-E × {(north-south)*111.32:.1f} km S-N")
