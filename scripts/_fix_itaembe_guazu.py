"""Reemplaza la geometría de itaembe_guazu con OSM admin_level=10 4860758.

El barrio crece al oeste (asentamientos) y norte. La geometría INDEC
inicial se quedó corta por el bbox legacy. La relation OSM admin_level=10
es la fuente "vecinal" oficial (operator I.Pro.D.Ha.) y coincide con la
percepción del usuario.

Estrategia:
1. Descargar OSM relation 4860758, ensamblar polygon vía linemerge+polygonize.
2. Reemplazar geometría de itaembe_guazu con esa.
3. Para mantener mutual-exclusivity, restar la intersección con cualquier
   otro polígono adyacente (priority a itaembe_guazu si solapa).
4. Backup automático.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import LineString, MultiLineString, shape
from shapely.ops import linemerge, polygonize, unary_union

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
SRC = Path("config/poligonos.geojson")
TARGET_ID = "itaembe_guazu"
OSM_REL = 4860758


def fetch_osm_relation_geom(rel_id: int) -> dict:
    print(f"Descargando OSM relation {rel_id}…")
    query = f"[out:json][timeout:60];relation({rel_id});out geom;"
    r = requests.get(
        OVERPASS_URL,
        params={"data": query},
        headers={"User-Agent": "Observatorio-Posadas/0.4"},
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    elements = data.get("elements", [])
    if not elements:
        raise RuntimeError("OSM Overpass devolvió 0 elementos")

    rel = elements[0]
    members = rel.get("members", [])
    outer_lines = []
    for m in members:
        if m.get("role") != "outer":
            continue
        pts = [(g["lon"], g["lat"]) for g in m.get("geometry", [])]
        if pts:
            outer_lines.append(pts)
    if not outer_lines:
        raise RuntimeError("Sin outer rings")

    lines = [LineString(pts) for pts in outer_lines if len(pts) >= 2]
    merged = linemerge(MultiLineString(lines))
    polys = list(polygonize([merged] if not hasattr(merged, "geoms") else list(merged.geoms)))
    if not polys:
        raise RuntimeError("polygonize devolvió 0")
    geom = unary_union(polys)
    print(f"  geometría OSM: {geom.geom_type}, área {geom.area * 111 * 111:.2f} km² aprox")
    return json.loads(gpd.GeoSeries([geom], crs="EPSG:4326").to_json())["features"][0]["geometry"]


def main() -> None:
    g = gpd.read_file(SRC)
    print(f"Polígonos cargados: {len(g)}")

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = SRC.parent / f"{SRC.stem}.bak.{timestamp}{SRC.suffix}"
    shutil.copy2(SRC, bak)
    print(f"Backup → {bak}")

    target_idx = g.index[g["id"] == TARGET_ID]
    if len(target_idx) == 0:
        raise RuntimeError(f"No encontré polígono {TARGET_ID}")
    target_idx = target_idx[0]

    old_geom = g.at[target_idx, "geometry"]
    old_area = old_geom.area * 111 * 111
    print(f"\nGeometría actual {TARGET_ID}: {old_geom.geom_type}, área ≈ {old_area:.2f} km²")

    new_geom_dict = fetch_osm_relation_geom(OSM_REL)
    new_geom = shape(new_geom_dict)
    new_area = new_geom.area * 111 * 111
    print(f"Geometría OSM nueva: {new_geom.geom_type}, área ≈ {new_area:.2f} km²")

    # Asegurar mutual-exclusivity: restar overlap con vecinos.
    # Política: itaembe_guazu (más autoritativo por OSM admin_level=10)
    # tiene prioridad. Los polígonos vecinos pierden la zona compartida.
    print("\nVerificando overlaps con vecinos…")
    overlaps_modificados = []
    for i in g.index:
        if i == target_idx:
            continue
        other = g.at[i, "geometry"]
        if not other.intersects(new_geom):
            continue
        inter = other.intersection(new_geom)
        inter_area = inter.area * 111 * 111
        if inter_area < 0.001:  # < 1000 m², ignorar
            continue
        # Excluir posadas_completa de la lógica (es referencia, no se modifica)
        oid = g.at[i, "id"]
        if oid == "posadas_completa":
            continue
        # Restar a `other` la intersección
        new_other = other.difference(new_geom)
        if new_other.is_empty:
            print(f"  ⚠ {oid} quedaría vacío, saltando (no modifico)")
            continue
        g.at[i, "geometry"] = new_other
        overlaps_modificados.append(
            {
                "id": oid,
                "overlap_km2": round(inter_area, 3),
                "area_antes_km2": round(other.area * 111 * 111, 3),
                "area_despues_km2": round(new_other.area * 111 * 111, 3),
            }
        )
        print(f"  - {oid}: -{inter_area:.3f} km² (overlap removido)")

    # Asignar nueva geometría
    g.at[target_idx, "geometry"] = new_geom
    g.at[target_idx, "_geom_source"] = f"OSM admin_level=10 relation {OSM_REL}"

    # Guardar
    g.to_file(SRC, driver="GeoJSON")
    print(f"\n{SRC} reescrito.")
    print(f"itaembe_guazu: {old_area:.2f} → {new_area:.2f} km² ({new_area/old_area:.1%})")
    print(f"Vecinos modificados: {len(overlaps_modificados)}")
    for m in overlaps_modificados:
        print(f"  {m}")


if __name__ == "__main__":
    main()
