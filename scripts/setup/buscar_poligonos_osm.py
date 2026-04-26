"""Consulta Nominatim para obtener los polígonos oficiales de los barrios de Posadas.

Uso:
    python scripts/setup/buscar_poligonos_osm.py

Hace una consulta por barrio con User-Agent respetuoso y rate limit de 1 req/s
(política pública de Nominatim). Imprime para cada barrio: nombre, tipo de
geometría devuelta (Polygon, MultiPolygon, Point), bounding box, y área
aproximada en km² si hay polígono.

El objetivo es decidir si podemos reemplazar los polígonos hechos a mano en
config/poligonos.geojson por los polígonos reales de OSM.
"""

from __future__ import annotations

import time
from urllib.parse import quote

import requests

BARRIOS = [
    "Itaembé Guazú",
    "Itaembé Miní",
    "Villa Cabello",
    "Miguel Lanús",
    "Villa Sarita",
    "Chacra 32",
    "El Brete",
    "Nemesio Parma",
    "Itaembé Porá",
]

HEADERS = {"User-Agent": "ObservatorioUrbanoPosadas/0.1 (contacto: fundile@gmail.com)"}


def buscar(nombre: str) -> list[dict]:
    url = (
        "https://nominatim.openstreetmap.org/search?"
        f"q={quote(nombre + ', Posadas, Misiones, Argentina')}"
        "&format=json&polygon_geojson=1&addressdetails=1&limit=3"
    )
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def resumir(nombre: str, resultados: list[dict]) -> None:
    print(f"\n=== {nombre} ===")
    if not resultados:
        print("  (sin resultados)")
        return
    for r in resultados:
        geom = r.get("geojson") or {}
        tipo = geom.get("type", "-")
        bbox = r.get("boundingbox", "-")
        osm_type = r.get("osm_type", "-")
        osm_id = r.get("osm_id", "-")
        display = r.get("display_name", "")[:90]
        # Calculamos área aproximada en km² si es polígono.
        area_km2 = None
        if tipo in ("Polygon", "MultiPolygon"):
            try:
                from pyproj import Geod
                from shapely.geometry import shape

                geod = Geod(ellps="WGS84")
                geom_obj = shape(geom)
                area_m2 = abs(geod.geometry_area_perimeter(geom_obj)[0])
                area_km2 = area_m2 / 1_000_000
            except Exception:
                pass
        extra = f" | area≈{area_km2:.2f}km²" if area_km2 else ""
        print(f"  [{osm_type}/{osm_id}] tipo={tipo}{extra}")
        print(f"    bbox={bbox}")
        print(f"    {display}")


def main() -> None:
    for barrio in BARRIOS:
        try:
            resultados = buscar(barrio)
            resumir(barrio, resultados)
        except Exception as exc:
            print(f"  FALLO {barrio}: {exc}")
        time.sleep(1.1)  # Rate limit Nominatim


if __name__ == "__main__":
    main()
