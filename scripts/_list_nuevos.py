"""Lista los polígonos nuevos (sin datos completos en serie/poblacion)."""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd

EXISTING = {
    "itaembe_guazu",
    "itaembe_mini",
    "chacra_32",
    "villa_cabello",
    "el_brete",
    "miguel_lanus",
    "villa_sarita",
    "nemesio_parma",
    "itaembe_pora",
    "villa_urquiza",
    "aguas_corrientes",
    "centro",
    "bajada_vieja",
    "villa_bonita",
}

g = gpd.read_file("config/poligonos.geojson")
new = g[~g["id"].isin(EXISTING)].copy()
print(f"Total: {len(g)} polygons")
print(f"Existentes (con datos): {len(EXISTING)}")
print(f"Nuevos sin datos: {len(new)}")
print()
ids = [row["id"] for _, row in new.iterrows()]
print("IDs:", json.dumps(ids))
print()
for _, row in new.iterrows():
    nombre = row.get("nombre", "?")
    sup = row.geometry.area * 111 * 111  # rough km² in degrees
    print(f"  - {row['id']:<35s} {nombre}")

Path("data/raw/_nuevos_ids.json").write_text(json.dumps(ids), encoding="utf-8")
print("\nIDs guardados en data/raw/_nuevos_ids.json")
