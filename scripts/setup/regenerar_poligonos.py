"""Regenera config/poligonos.geojson con polígonos correctos.

Problema: los polígonos iniciales fueron inventados a ojo y no coincidían con
los barrios reales (ej. Itaembé Guazú dibujado 4 km al oeste de su ubicación).

Solución:
- `itaembe_guazu` → polígono OSM oficial (relation 4860758)
- `itaembe_mini`, `chacra_32`, `villa_cabello` → cuadrado 2×2 km centrado en
  el nodo OSM del barrio (enfoque en el núcleo denso)
- `el_brete` → polígono angosto siguiendo la costanera desde cerca del
  balneario (cota inundable del Paraná)

Este script es idempotente: pisás el GeoJSON existente.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import requests

HEADERS = {"User-Agent": "ObservatorioUrbanoPosadas/0.1 (contacto: fundile@gmail.com)"}

# Centros OSM confirmados por la query de Nominatim (fase de diagnóstico 2026-04-23).
CENTROS = {
    "itaembe_mini": (-27.4117, -55.9563),  # place=suburb, node 2006158237
    "chacra_32": (-27.3982, -55.9076),  # promedio bbox node 3994246457 (zona Chacra 32/Cristo Rey)
    "villa_cabello": (-27.3674, -55.9489),  # place=suburb, node 1754063011
}

# Para El Brete hacemos un polígono angosto siguiendo la costanera.
# El anfiteatro El Brete está en (-27.3559, -55.9123). Hacemos un rectángulo
# angosto de ~2 km de largo × 500 m de ancho, siguiendo la ribera del Paraná
# hacia el oeste/suroeste.
EL_BRETE_POLIGONO = [
    # lon, lat
    [-55.921, -27.360],  # O-S
    [-55.900, -27.354],  # E-S
    [-55.895, -27.351],  # E-N (cerca del anfiteatro)
    [-55.918, -27.356],  # O-N
    [-55.921, -27.360],  # cierra
]

# Relación OSM del polígono oficial de Itaembé Guazú.
OSM_RELATION_ITAEMBE_GUAZU = 4860758


def bbox_cuadrado_km(centro_lat: float, centro_lon: float, lado_km: float) -> list[list[float]]:
    """Construye un cuadrado de `lado_km × lado_km` centrado en (lat,lon).

    Returns list of [lon, lat] pairs en orden horario cerrado.
    """
    half = lado_km / 2.0
    # 1 grado lat ≈ 111.32 km en todas las latitudes.
    delta_lat = half / 111.32
    # 1 grado lon ≈ 111.32 × cos(lat) km. En -27.4°, cos ≈ 0.888.
    cos_lat = math.cos(math.radians(centro_lat))
    delta_lon = half / (111.32 * cos_lat)

    oeste = centro_lon - delta_lon
    este = centro_lon + delta_lon
    sur = centro_lat - delta_lat
    norte = centro_lat + delta_lat

    # GeoJSON: [lon, lat], sentido antihorario (pero aceptan cualquiera).
    return [
        [oeste, sur],
        [este, sur],
        [este, norte],
        [oeste, norte],
        [oeste, sur],
    ]


def traer_poligono_osm_relation(relation_id: int) -> dict:
    """Obtiene la geometría GeoJSON de un relation de OSM vía Nominatim."""
    url = (
        f"https://nominatim.openstreetmap.org/lookup?"
        f"osm_ids=R{relation_id}&format=json&polygon_geojson=1"
    )
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    if not data:
        raise RuntimeError(f"OSM relation {relation_id} sin respuesta")
    geom = data[0].get("geojson")
    if not geom:
        raise RuntimeError(f"OSM relation {relation_id} sin geojson")
    return geom


def feature(
    poligono_id: str,
    nombre: str,
    descripcion: str,
    categoria: str,
    prioridad: int,
    publicar: bool,
    sensible: bool,
    geometry: dict,
) -> dict:
    return {
        "type": "Feature",
        "properties": {
            "id": poligono_id,
            "nombre": nombre,
            "descripcion": descripcion,
            "categoria": categoria,
            "prioridad": prioridad,
            "publicar_en_sitio": publicar,
            "sensible": sensible,
            "fecha_creacion_poligono": "2026-04-23",
            "fuente_poligono": (
                "OSM Nominatim" if "relation" in descripcion.lower() else "buffer 2x2 km centro OSM"
            ),
        },
        "geometry": geometry,
    }


def main() -> None:
    raiz = Path(__file__).resolve().parent.parent.parent
    output = raiz / "config" / "poligonos.geojson"

    features = []

    # 1. Itaembé Guazú - polígono OSM oficial.
    print(f"Consultando OSM relation {OSM_RELATION_ITAEMBE_GUAZU} (Itaembé Guazú)...")
    geom_guazu = traer_poligono_osm_relation(OSM_RELATION_ITAEMBE_GUAZU)
    features.append(
        feature(
            "itaembe_guazu",
            "Itaembé Guazú",
            f"Barrio del sur de Posadas en expansión. Polígono oficial OSM relation/{OSM_RELATION_ITAEMBE_GUAZU}.",
            "asentamiento_crecimiento_rapido",
            1,
            True,
            False,
            geom_guazu,
        )
    )

    # 2-4. Cuadrados 2x2 km en centros OSM.
    cuadrados = {
        "itaembe_mini": (
            "Itaembé Miní",
            "Barrio de expansión rápida en el sur de Posadas. Cuadrado 2×2 km en centro OSM (place=suburb).",
            "asentamiento_crecimiento_rapido",
            1,
            True,
            False,
        ),
        "chacra_32": (
            "Chacra 32",
            "Zona de chacras subdivididas sector Cristo Rey. Cuadrado 2×2 km en centro OSM.",
            "consolidado_crecimiento",
            2,
            True,
            False,
        ),
        "villa_cabello": (
            "Villa Cabello",
            "Barrio consolidado, usado como control para validar el modelo. Cuadrado 2×2 km en centro OSM (place=suburb).",
            "control_consolidado",
            3,
            True,
            False,
        ),
    }
    for pid, (nombre, desc, cat, pri, pub, sen) in cuadrados.items():
        lat, lon = CENTROS[pid]
        coords = bbox_cuadrado_km(lat, lon, lado_km=2.0)
        features.append(
            feature(
                pid,
                nombre,
                desc,
                cat,
                pri,
                pub,
                sen,
                {"type": "Polygon", "coordinates": [coords]},
            )
        )
        print(f"  {pid}: cuadrado 2×2 km centrado en ({lat}, {lon})")

    # 5. El Brete - polígono angosto siguiendo costanera.
    features.append(
        feature(
            "el_brete",
            "El Brete",
            "Zona costera de Posadas con tensión por inundabilidad. Polígono angosto siguiendo la ribera del Paraná.",
            "zona_sensible",
            2,
            False,  # publicar_en_sitio = False por sensibilidad
            True,  # sensible = True
            {"type": "Polygon", "coordinates": [EL_BRETE_POLIGONO]},
        )
    )

    fc = {
        "type": "FeatureCollection",
        "name": "poligonos_observatorio_posadas",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "features": features,
    }

    output.write_text(json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nEscribí {output}")
    print(f"Features: {len(features)}")
    for f in features:
        pid = f["properties"]["id"]
        tipo = f["geometry"]["type"]
        coords = f["geometry"]["coordinates"]
        if tipo == "Polygon":
            n = len(coords[0])
        elif tipo == "MultiPolygon":
            n = sum(len(r[0]) for r in coords)
        else:
            n = "-"
        print(f"  {pid}: {tipo} con {n} vértices")


if __name__ == "__main__":
    main()
