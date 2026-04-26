"""Pulido final de geometrías:

1. Para multipolygons: si la parte secundaria es <20% del total, descartar.
   Si la parte secundaria es ≥20% se mantiene (legítimo, ej. san_jorge 50/50).
2. Agregar un polígono especial `posadas_completa` con la geometría
   oficial OSM admin_level=8 (relation 3082669), marcado con
   `categoria: "ciudad_completa"` para que el frontend lo filtre fuera del
   ranking político (es referencia, no un barrio).

Backup automático en config/poligonos.geojson.bak.YYYYMMDD-HHMMSS.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import shape
from shapely.ops import unary_union

SRC = Path("config/poligonos.geojson")
RATIO_DESCARTE = 0.20  # parte secundaria < 20% del total → descartar
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Posadas: OSM relation 2294383 (admin_level=8, ciudad de Posadas)
# Vía Nominatim search "city=Posadas, country=Argentina".
POSADAS_REL = 2294383
POSADAS_QUERY = f"""
[out:json][timeout:60];
relation({POSADAS_REL});
out geom;
"""


def fetch_posadas_geom() -> dict:
    """Descarga la geometría oficial de Posadas via Overpass."""
    print(f"Descargando geometría oficial Posadas (OSM relation {POSADAS_REL})…")
    r = requests.get(
        OVERPASS_URL,
        params={"data": POSADAS_QUERY},
        headers={"User-Agent": "Observatorio-Posadas/0.4"},
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    elements = data.get("elements", [])
    if not elements:
        raise RuntimeError("OSM Overpass devolvió 0 elementos para relation 3082669")

    rel = elements[0]
    members = rel.get("members", [])
    outer_lines = []
    for m in members:
        if m.get("role") != "outer":
            continue
        pts = [(g["lon"], g["lat"]) for g in m.get("geometry", [])]
        if pts:
            outer_lines.append(pts)

    # Construir polígonos a partir de las líneas exteriores
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import linemerge, polygonize

    if not outer_lines:
        raise RuntimeError("No hay outer rings en la relation")

    lines = [LineString(pts) for pts in outer_lines if len(pts) >= 2]
    merged = linemerge(MultiLineString(lines))
    polys = list(polygonize([merged] if not hasattr(merged, "geoms") else list(merged.geoms)))
    if not polys:
        raise RuntimeError("polygonize devolvió 0 polígonos")

    # Tomar la unión (puede haber varios anillos exteriores)
    geom = unary_union(polys)
    print(f"  geometría: {geom.geom_type}, área {geom.area * 111 * 111:.1f} km² aprox")
    return json.loads(gpd.GeoSeries([geom], crs="EPSG:4326").to_json())["features"][0]["geometry"]


def main() -> None:
    g = gpd.read_file(SRC)
    print(f"Polígonos cargados: {len(g)}")

    # Backup
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = SRC.parent / f"{SRC.stem}.bak.{timestamp}{SRC.suffix}"
    shutil.copy2(SRC, bak)
    print(f"Backup → {bak}")

    # 1) Limpiar multipolygons
    n_simplificados = 0
    for i in g.index:
        geom = g.at[i, "geometry"]
        if geom.geom_type != "MultiPolygon":
            continue
        partes = sorted(geom.geoms, key=lambda p: p.area, reverse=True)
        principal_area = partes[0].area
        if principal_area == 0:
            continue
        partes_a_mantener = [partes[0]]
        for p in partes[1:]:
            ratio = p.area / principal_area
            if ratio >= RATIO_DESCARTE:
                partes_a_mantener.append(p)
            else:
                pid = g.at[i, "id"]
                area_descartada = p.area * 111 * 111  # rough km²
                print(
                    f"  [{pid}] descartar fragmento {ratio:.2%} ({area_descartada:.3f} km² aprox)"
                )
                n_simplificados += 1
        if len(partes_a_mantener) == 1:
            g.at[i, "geometry"] = partes_a_mantener[0]
        else:
            from shapely.geometry import MultiPolygon

            g.at[i, "geometry"] = MultiPolygon(partes_a_mantener)

    print(f"Fragmentos descartados: {n_simplificados}")

    # 2) Agregar Posadas completa
    if "posadas_completa" in g["id"].values:
        print("posadas_completa ya existe — actualizando geometría")
        g = g[g["id"] != "posadas_completa"].copy()

    geom_posadas = shape(fetch_posadas_geom())
    posadas_feature = {
        "id": "posadas_completa",
        "nombre": "Posadas (toda la ciudad)",
        "categoria": "ciudad_completa",
        "descripcion": (
            "Límite municipal oficial de Posadas (OSM relation 3082669, "
            "admin_level=8). Es una capa de referencia, no un barrio: úsese "
            "para totales agregados (no entra en rankings)."
        ),
        "sensible": False,
        "publicar_en_sitio": True,
        "prioridad": 0,
        "_es_total_ciudad": True,
        "geometry": geom_posadas,
    }
    g = gpd.GeoDataFrame(
        list(g.to_dict("records")) + [posadas_feature],
        crs=g.crs,
    )
    print(f"posadas_completa agregado, área {g.iloc[-1].geometry.area * 111 * 111:.1f} km² aprox")

    # Guardar
    g.to_file(SRC, driver="GeoJSON")
    print(f"\n{SRC} reescrito con {len(g)} polígonos.")


if __name__ == "__main__":
    main()
