"""Verifica datos de producción del observatorio."""
import json
import sys
from urllib.request import urlopen

data = json.loads(urlopen("https://observatorio.sistemaswinter.com/data/poligonos.geojson", timeout=15).read())

for f in data["features"]:
    p = f["properties"]
    geom = f["geometry"]
    n_vert = (
        len(geom["coordinates"][0]) if geom["type"] == "Polygon"
        else sum(len(r[0]) for r in geom["coordinates"])
    )
    print(f"{p['id']:15s}  {p['superficie_km2']:5.2f} km²  "
          f"edif: {p['edificios_2018']:>5} -> {p['edificios_2026']:>5}  "
          f"pob: {p['poblacion_estimada']:>5}  vert: {n_vert}")

updated = urlopen("https://observatorio.sistemaswinter.com/data/updated_at.txt", timeout=10).read().decode().strip()
print(f"\nActualizado: {updated}")
