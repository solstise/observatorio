"""Amplía config/poligonos.geojson con nuevos barrios de Posadas.

Contexto: el observatorio arrancó con 5 polígonos (itaembe_guazu, itaembe_mini,
chacra_32, villa_cabello, el_brete). Este script AGREGA 7-10 barrios más,
manteniendo los existentes intactos.

Reglas de construcción (igual que regenerar_poligonos.py):
- Si el barrio tiene polígono OSM de tamaño razonable (<10 km²) → usarlo directo.
- Si sólo hay nodo, o el polígono OSM es demasiado chico (<0.5 km²) o
  demasiado grande (>10 km²) → construir cuadrado 2×2 km centrado en el nodo.
- Si no hay nodo ni polígono → saltar ese candidato con warning.

Idempotencia: si un ID ya existe en el GeoJSON, se saltea (no lo pisa).

Salida: sobrescribe config/poligonos.geojson con todos los features
(originales + nuevos agregados).

Uso:
    python scripts/setup/ampliar_observatorio.py
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

HEADERS = {"User-Agent": "ObservatorioUrbanoPosadas/0.1 (contacto: fundile@gmail.com)"}

RAIZ = Path(__file__).resolve().parent.parent.parent
GEOJSON = RAIZ / "config" / "poligonos.geojson"
FECHA_CREACION = "2026-04-24"

# Umbral: polígono OSM con menos área lo reemplazamos por cuadrado 2x2.
AREA_MIN_POLIGONO_KM2 = 0.5
# Umbral: polígono OSM con más área lo reemplazamos por cuadrado 2x2.
AREA_MAX_POLIGONO_KM2 = 10.0


@dataclass
class Candidato:
    poligono_id: str
    nombre: str
    descripcion: str
    categoria: str
    prioridad: int
    publicar: bool
    sensible: bool
    # Opción A: polígono OSM directo.
    osm_relation_id: Optional[int] = None
    # Opción B: construir cuadrado en centro dado (lat, lon).
    centro: Optional[tuple[float, float]] = None
    # Consulta de respaldo para Nominatim si hay que resolver centro.
    query_nominatim: Optional[str] = None


CANDIDATOS: list[Candidato] = [
    # -----------------------------------------------------------------
    # 1. Miguel Lanús - delegación municipal completa (polígono oficial OSM).
    # ~1.98 km², al SE de Posadas, consolidado con crecimiento.
    Candidato(
        poligono_id="miguel_lanus",
        nombre="Miguel Lanús",
        descripcion="Delegación municipal al SE de Posadas. Polígono OSM oficial (relation/3511484).",
        categoria="consolidado_crecimiento",
        prioridad=2,
        publicar=True,
        sensible=False,
        osm_relation_id=3511484,
    ),
    # -----------------------------------------------------------------
    # 2. Villa Sarita - barrio ribereño cerca del puerto. 0.59 km² es chico
    # pero razonable. Lo usamos directo.
    Candidato(
        poligono_id="villa_sarita",
        nombre="Villa Sarita",
        descripcion="Barrio ribereño cerca del puerto. Polígono OSM (relation/4833951).",
        categoria="zona_sensible",
        prioridad=2,
        publicar=True,
        sensible=True,
        osm_relation_id=4833951,
    ),
    # -----------------------------------------------------------------
    # 3. Nemesio Parma - hamlet ribereño al NO del centro (lat -27.3558,
    # lon -56.0181). Solo hay node (place=hamlet, pop=323). Cuadrado 2×2 km.
    Candidato(
        poligono_id="nemesio_parma",
        nombre="Nemesio Parma",
        descripcion="Hamlet ribereño al NO del casco urbano (place=hamlet, node 2660636202). Cuadrado 2×2 km centrado en el nodo.",
        categoria="asentamiento_crecimiento_rapido",
        prioridad=1,
        publicar=True,
        sensible=False,
        centro=(-27.3558054, -56.0180622),
    ),
    # -----------------------------------------------------------------
    # 4. Itaembé Porá - polígono OSM es 0.08 km² (muy chico, solo manzana
    # delimitada). Usamos cuadrado 2×2 km en el centro del polígono pequeño.
    Candidato(
        poligono_id="itaembe_pora",
        nombre="Itaembé Porá",
        descripcion="Subbarrio al oeste de Itaembé Miní. Cuadrado 2×2 km en el centro del polígono OSM (relation/4822010 es solo una manzana).",
        categoria="asentamiento_crecimiento_rapido",
        prioridad=1,
        publicar=True,
        sensible=False,
        centro=(-27.4191866, -55.9591252),
    ),
    # -----------------------------------------------------------------
    # 5. Villa Urquiza - barrio homónimo dentro de la delegación. OSM tiene
    # el barrio chico (relation/4843702) de 0.70 km² — razonable para usar
    # directo.
    Candidato(
        poligono_id="villa_urquiza",
        nombre="Villa Urquiza",
        descripcion="Barrio al SE, dentro de la delegación municipal homónima. Polígono OSM (relation/4843702).",
        categoria="consolidado_crecimiento",
        prioridad=2,
        publicar=True,
        sensible=False,
        osm_relation_id=4843702,
    ),
    # -----------------------------------------------------------------
    # 6. Aguas Corrientes - polígono OSM es 0.28 km² (muy chico). Cuadrado
    # 2×2 km al centro. Cerca de Villa Urquiza.
    Candidato(
        poligono_id="aguas_corrientes",
        nombre="Aguas Corrientes",
        descripcion="Barrio al SE de Posadas dentro de la delegación Villa Urquiza. Cuadrado 2×2 km en el centro del polígono pequeño OSM.",
        categoria="consolidado_crecimiento",
        prioridad=3,
        publicar=True,
        sensible=False,
        centro=(-27.3740190, -55.9041124),
    ),
    # -----------------------------------------------------------------
    # 7. Centro - área central / casco céntrico, 2.07 km². Polígono OSM
    # oficial (relation/5501263) es razonable.
    Candidato(
        poligono_id="centro",
        nombre="Centro",
        descripcion="Microcentro / casco histórico de Posadas. Polígono OSM oficial (relation/5501263).",
        categoria="control_consolidado",
        prioridad=3,
        publicar=True,
        sensible=False,
        osm_relation_id=5501263,
    ),
    # -----------------------------------------------------------------
    # 8. Bajada Vieja - polígono OSM es 0.06 km² (un par de calles).
    # Cuadrado 2×2 km para cubrir la zona ribereña histórica.
    Candidato(
        poligono_id="bajada_vieja",
        nombre="Bajada Vieja",
        descripcion="Zona histórica ribereña junto al Paraná (relation/4833948 es muy chico). Cuadrado 2×2 km para cubrir el sector.",
        categoria="zona_sensible",
        prioridad=2,
        publicar=True,
        sensible=True,
        centro=(-27.3606468, -55.8892290),
    ),
    # -----------------------------------------------------------------
    # 9. Villa Bonita - 0.41 km² polígono OSM (< AREA_MIN). Rescate via
    # cuadrado 2×2 km en el centro del polígono. Al SE, sector Miguel Lanús.
    Candidato(
        poligono_id="villa_bonita",
        nombre="Villa Bonita",
        descripcion="Barrio al SE de Posadas dentro de la delegación Miguel Lanús. Cuadrado 2×2 km en el centro del polígono OSM (relation/3983541 era sólo 0.41 km²).",
        categoria="consolidado_crecimiento",
        prioridad=3,
        publicar=True,
        sensible=False,
        centro=(-27.4551378, -55.8663660),
    ),
]


def bbox_cuadrado_km(centro_lat: float, centro_lon: float, lado_km: float) -> list[list[float]]:
    """Construye un cuadrado cerrado centrado en (lat, lon)."""
    half = lado_km / 2.0
    delta_lat = half / 111.32
    cos_lat = math.cos(math.radians(centro_lat))
    delta_lon = half / (111.32 * cos_lat)
    oeste = centro_lon - delta_lon
    este = centro_lon + delta_lon
    sur = centro_lat - delta_lat
    norte = centro_lat + delta_lat
    return [
        [oeste, sur],
        [este, sur],
        [este, norte],
        [oeste, norte],
        [oeste, sur],
    ]


def traer_poligono_osm_relation(relation_id: int) -> tuple[dict, float]:
    """Obtiene geometría GeoJSON + área en km² de un relation OSM."""
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

    try:
        from pyproj import Geod
        from shapely.geometry import shape

        geod = Geod(ellps="WGS84")
        geom_obj = shape(geom)
        area_m2 = abs(geod.geometry_area_perimeter(geom_obj)[0])
        area_km2 = area_m2 / 1_000_000
    except Exception:
        area_km2 = -1.0

    return geom, area_km2


def construir_feature_desde_candidato(c: Candidato) -> tuple[dict | None, str]:
    """Devuelve (feature_dict, razon_log). feature_dict=None si se descarta."""
    # Preferencia: usar polígono OSM directo si viene y está dentro del rango.
    if c.osm_relation_id is not None:
        try:
            geom, area_km2 = traer_poligono_osm_relation(c.osm_relation_id)
        except Exception as exc:
            return None, f"FALLO al traer OSM relation/{c.osm_relation_id}: {exc}"

        if AREA_MIN_POLIGONO_KM2 <= area_km2 <= AREA_MAX_POLIGONO_KM2:
            fuente = f"OSM Nominatim relation/{c.osm_relation_id}"
            feat = _mk_feature(c, geom, fuente)
            return feat, f"OK polígono OSM {area_km2:.2f} km²"

        # Demasiado chico o grande → necesitamos centro.
        if c.centro is None:
            return None, (
                f"FALLO: polígono OSM area={area_km2:.2f} km² fuera de rango "
                f"[{AREA_MIN_POLIGONO_KM2}, {AREA_MAX_POLIGONO_KM2}] y sin "
                f"centro de respaldo"
            )
        # Cae al caso centro abajo.

    if c.centro is None:
        return None, "FALLO: sin osm_relation_id ni centro"

    lat, lon = c.centro
    coords = bbox_cuadrado_km(lat, lon, lado_km=2.0)
    geometry = {"type": "Polygon", "coordinates": [coords]}
    fuente = "buffer 2x2 km centro OSM"
    feat = _mk_feature(c, geometry, fuente)
    return feat, f"OK cuadrado 2×2 km en ({lat:.4f}, {lon:.4f})"


def _mk_feature(c: Candidato, geometry: dict, fuente: str) -> dict:
    return {
        "type": "Feature",
        "properties": {
            "id": c.poligono_id,
            "nombre": c.nombre,
            "descripcion": c.descripcion,
            "categoria": c.categoria,
            "prioridad": c.prioridad,
            "publicar_en_sitio": c.publicar,
            "sensible": c.sensible,
            "fecha_creacion_poligono": FECHA_CREACION,
            "fuente_poligono": fuente,
        },
        "geometry": geometry,
    }


def main() -> None:
    if not GEOJSON.exists():
        raise SystemExit(f"No existe {GEOJSON}. Correr regenerar_poligonos.py primero.")

    fc = json.loads(GEOJSON.read_text(encoding="utf-8"))
    features: list[dict] = fc.get("features", [])
    existentes = {f["properties"]["id"] for f in features}
    print(f"Polígonos existentes ({len(existentes)}): {sorted(existentes)}")

    nuevos = 0
    descartados: list[tuple[str, str]] = []

    for c in CANDIDATOS:
        if c.poligono_id in existentes:
            print(f"SKIP {c.poligono_id}: ya existe (idempotencia)")
            continue

        feat, razon = construir_feature_desde_candidato(c)
        if feat is None:
            print(f"DESCARTADO {c.poligono_id}: {razon}")
            descartados.append((c.poligono_id, razon))
            time.sleep(1.1)
            continue

        features.append(feat)
        nuevos += 1
        print(f"AGREGADO {c.poligono_id} [{c.categoria}] ({razon})")
        # Rate limit OSM si hicimos request.
        if c.osm_relation_id is not None:
            time.sleep(1.1)

    fc["features"] = features
    GEOJSON.write_text(json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print(f"Total features: {len(features)}")
    print(f"Nuevos agregados: {nuevos}")
    if descartados:
        print(f"Descartados: {len(descartados)}")
        for pid, razon in descartados:
            print(f"  - {pid}: {razon}")


if __name__ == "__main__":
    main()
