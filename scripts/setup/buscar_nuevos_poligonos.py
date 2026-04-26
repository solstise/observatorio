"""Consulta Nominatim para los barrios candidatos nuevos de Posadas.

Uso:
    python scripts/setup/buscar_nuevos_poligonos.py

Misma lógica que buscar_poligonos_osm.py pero apuntando a la segunda tanda
de barrios (ampliación del observatorio a ~12 polígonos).

Cada barrio: imprime tipo de geometría, bbox, área aproximada si hay
polígono, y un resumen de qué enfoque usar (polígono OSM directo vs
cuadrado 2×2 km en el centro del nodo).
"""

from __future__ import annotations

import time
from urllib.parse import quote

import requests

BARRIOS = [
    "Miguel Lanús, Posadas",
    "Villa Sarita, Posadas",
    "Nemesio Parma, Posadas",
    "Itaembé Porá, Posadas",
    "Villa Lanús, Posadas",
    "Villa Urquiza, Posadas",
    "Aguas Corrientes, Posadas",
    "Tacuaruzú, Posadas",
    "Centro, Posadas, Misiones",
    "Microcentro, Posadas",
    "Villa Cabello Norte, Posadas",
    "Bajada Vieja, Posadas",
]

HEADERS = {"User-Agent": "ObservatorioUrbanoPosadas/0.1 (contacto: fundile@gmail.com)"}


def buscar(nombre: str) -> list[dict]:
    url = (
        "https://nominatim.openstreetmap.org/search?"
        f"q={quote(nombre)}"
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
        cls = r.get("class", "-")
        typ = r.get("type", "-")
        display = r.get("display_name", "")[:100]
        lat = r.get("lat")
        lon = r.get("lon")
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
        extra = f" | area={area_km2:.2f}km²" if area_km2 else ""
        print(f"  [{osm_type}/{osm_id}] tipo={tipo} class={cls}/{typ}{extra}")
        print(f"    centro=({lat}, {lon})  bbox={bbox}")
        print(f"    {display}")


def main() -> None:
    for barrio in BARRIOS:
        try:
            resultados = buscar(barrio)
            resumir(barrio, resultados)
        except Exception as exc:
            print(f"  FALLO {barrio}: {exc}")
        time.sleep(1.1)


if __name__ == "__main__":
    main()
