"""Extiende config/poligonos.geojson con barrios oficiales de Posadas (OSM).

Procesa barrios_processed.json (output de _build_polygons_step.py) y mergea
con los polígonos existentes preservando los 14 originales intactos.

Estrategia:
1. Lee config/poligonos.geojson actual y registra IDs existentes.
2. Lee data/raw/osm/barrios_processed.json (geometrías validadas Shapely).
3. Selecciona barrios:
   - Lista white-list de nombres prioritarios (cobertura N/S/E/W/Centro).
   - Excluye los que ya están en el GeoJSON actual (por slug).
4. Asigna `categoria` heurísticamente:
   - asentamiento_crecimiento_rapido: barrios periféricos / nuevos.
   - consolidado_crecimiento: barrios establecidos en expansión.
   - control_consolidado: barrios consolidados centrales.
   - zona_sensible: ribereños o áreas inundables.
5. Escribe el GeoJSON ampliado y un changelog Markdown.
"""
from __future__ import annotations

import json
import unicodedata
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXISTING = ROOT / "config" / "poligonos.geojson"
PROCESSED = ROOT / "data" / "raw" / "osm" / "barrios_processed.json"
OUT = ROOT / "config" / "poligonos.geojson"
CHANGELOG = ROOT / "config" / "poligonos_changelog.md"


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().strip()
    out = []
    for c in s:
        if c.isalnum():
            out.append(c)
        elif out and out[-1] != "_":
            out.append("_")
    return "".join(out).strip("_")


# -------- Selección --------
# Mapa nombre OSM -> (categoria, sensible, descripcion_sufijo, prioridad)
# Nombres tomados textualmente de relation['tags']['name']
SELECCION: dict[str, dict] = {
    # ZONA OESTE / SUR-OESTE (expansión rápida)
    "Itaembé Porá": None,  # ya existe (itaembe_pora) - skip
    "A4 - Nueva Esperanza": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Asentamiento al oeste de Itaembé Miní, expansión informal sobre A4.",
        "prioridad": 1,
    },
    "Colonia Laosiana": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Colonia agrícola al SO, en proceso de urbanización paulatina.",
        "prioridad": 2,
    },
    # ZONA SUR (Itaembé / Garupá)
    "Federal": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Barrio del extremo sur de Posadas (límite con Garupá), gran superficie residencial.",
        "prioridad": 1,
    },
    "Norte": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio Norte (delegación municipal Villa Lanús), zona en consolidación.",
        "prioridad": 2,
    },
    "Complejo Gervasio Artigas": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Complejo habitacional de gran escala en el sur.",
        "prioridad": 1,
    },
    # ZONA SUR-ESTE (Miguel Lanús / Villa Bonita / Garupá)
    "Ñu Porá": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Barrio del SE en consolidación reciente (delegación Miguel Lanús).",
        "prioridad": 1,
    },
    "Don Santiago": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Barrio del SE entre Garupá y Miguel Lanús, vivienda social en expansión.",
        "prioridad": 1,
    },
    "Fátima#10760518": {  # Posadas (Miguel Lanús), no rel/11810324 (Encarnación)
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio Fátima, zona consolidada del SE de Posadas (Miguel Lanús).",
        "prioridad": 2,
    },
    "Santa Helena": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Barrio del SE, sector en expansión sobre ruta nacional 12.",
        "prioridad": 2,
    },
    "Lomas de Garupá": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Barrio del límite SE con Garupá, fuerte expansión 2018-2025.",
        "prioridad": 1,
    },
    "Complejo Habitacional Vírgen de Fátima": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Complejo habitacional Virgen de Fátima, vivienda colectiva de los 90.",
        "prioridad": 2,
    },
    # ZONA OESTE / NORTE-OESTE (Villa Cabello / Itaembé Miní zona alta)
    "San Isidro": {  # rel/3790694 (Posadas, no Encarnación)
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio San Isidro al oeste, zona consolidada con expansión norte.",
        "prioridad": 2,
    },
    "Cima del Sol": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Barrio nuevo al SO, loteos recientes 2020-2025.",
        "prioridad": 1,
    },
    # ZONA NORTE (cerca de costanera / centro extendido)
    "El Laurel": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio del norte, zona costanera extendida hacia Tiro Federal.",
        "prioridad": 2,
    },
    "Yacyretá": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio Yacyretá, vivienda construida por la EBY.",
        "prioridad": 2,
    },
    "Rocamora": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio Rocamora, zona céntrica norte, residencial consolidado.",
        "prioridad": 3,
    },
    "Monseñor Kemerer": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio del centro-oeste, residencial.",
        "prioridad": 3,
    },
    # ZONA CENTRO-OESTE / SAN ANTONIO
    "San Lucas": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio del oeste, residencial de clase media.",
        "prioridad": 3,
    },
    "Luis Piedrabuena": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio centro-oeste, residencial consolidado.",
        "prioridad": 3,
    },
    "San Martín#7740064": {  # rel/7740064 (Posadas, no rel/6759932 que es Garupá)
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio San Martín, zona céntrica norte.",
        "prioridad": 3,
    },
    "Santa Rita": {  # rel/4852077 (Posadas)
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio Santa Rita, residencial consolidado.",
        "prioridad": 3,
    },
    # San Cayetano: omitido, OSM lo solapa 100%% con Yacyretá (rel/7740469 vs rel/5283273).
    "Alta Gracia": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio del oeste, residencial.",
        "prioridad": 3,
    },
    "El Palomar": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio céntrico-este, residencial.",
        "prioridad": 3,
    },
    "Villa Mola": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio Villa Mola, costanera norte (cerca del Paraná).",
        "prioridad": 2,
    },
    "Las Dolores": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio Las Dolores, residencial.",
        "prioridad": 3,
    },
    "San Marcos": {  # rel/3599517
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio San Marcos, zona oeste de la ciudad.",
        "prioridad": 3,
    },
    "San Jorge": {  # rel/3599714
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio San Jorge, zona oeste.",
        "prioridad": 3,
    },
    "A-3-2 Sector B": {
        "cat": "asentamiento_crecimiento_rapido",
        "sensible": False,
        "desc": "Sector B del A-3-2, expansión planificada al SE.",
        "prioridad": 2,
    },
    # Villa Blosset: omitido, 100%% inside Bajada Vieja (only 0.10 km², redundant).
    # ZONA NORTE LEJOS (San Antonio / Apóstoles eje)
    "23 de Septiembre": {
        "cat": "consolidado_crecimiento",
        "sensible": False,
        "desc": "Barrio del centro-norte, residencial.",
        "prioridad": 3,
    },
}


def main() -> None:
    base = json.loads(EXISTING.read_text(encoding="utf-8"))
    existing_ids = {f["properties"]["id"] for f in base["features"]}
    print(f"Existentes: {len(existing_ids)} polígonos")

    processed = json.loads(PROCESSED.read_text(encoding="utf-8"))
    # Indexed by name AND by name#rel_id for disambiguation
    by_key: dict[str, dict] = {}
    for p in processed:
        # Default: last wins for plain name (legacy compat)
        by_key[p["name"]] = p
        by_key[f"{p['name']}#{p['rel_id']}"] = p

    # Build new features
    today = date.today().isoformat()
    added: list[tuple[str, dict, dict]] = []

    for key, meta in SELECCION.items():
        if meta is None:
            continue
        if key not in by_key:
            print(f"  WARN: {key} no aparece en barrios_processed.json -> SKIP")
            continue
        proc = by_key[key]
        # Use real OSM name (without #rel_id suffix)
        name = proc["name"]
        slug = slugify(name)
        if slug in existing_ids:
            print(f"  SKIP {slug} (ya existe)")
            continue
        feature = {
            "type": "Feature",
            "properties": {
                "id": slug,
                "nombre": name,
                "descripcion": (
                    f"{meta['desc']} Polígono OSM admin_level=10 "
                    f"(relation/{proc['rel_id']})."
                ),
                "categoria": meta["cat"],
                "prioridad": meta["prioridad"],
                "publicar_en_sitio": not meta["sensible"],
                "sensible": meta["sensible"],
                "fecha_creacion_poligono": today,
                "fuente_poligono": f"OSM Overpass relation/{proc['rel_id']}",
                "personas_por_vivienda_estimado": 3.6,
                "area_km2_aprox": proc["area_km2"],
            },
            "geometry": proc["geometry"],
        }
        added.append((name, feature, proc))

    print(f"\nNuevos a agregar: {len(added)}")

    # Merge
    new_collection = {
        "type": "FeatureCollection",
        "name": base["name"],
        "crs": base["crs"],
        "features": base["features"] + [f for _, f, _ in added],
    }

    OUT.write_text(
        json.dumps(new_collection, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"-> Escrito {OUT} con {len(new_collection['features'])} features")

    # Changelog
    md = ["# Changelog config/poligonos.geojson", ""]
    md.append(f"_Generado_: {today}")
    md.append("")
    md.append(
        f"Total polígonos: **{len(new_collection['features'])}** "
        f"({len(existing_ids)} existentes + {len(added)} nuevos)."
    )
    md.append("")
    md.append("## Barrios existentes (no modificados)")
    md.append("")
    md.append("| ID | Nombre | Categoría | Fuente |")
    md.append("|----|--------|-----------|--------|")
    for f in base["features"]:
        p = f["properties"]
        md.append(
            f"| `{p['id']}` | {p['nombre']} | {p['categoria']} | "
            f"{p.get('fuente_poligono','-')} |"
        )
    md.append("")
    md.append("## Barrios agregados")
    md.append("")
    md.append("| ID | Nombre | Categoría | OSM rel/id | Área km² | Prioridad |")
    md.append("|----|--------|-----------|-----------|---------:|----------:|")
    for name, feature, proc in added:
        p = feature["properties"]
        md.append(
            f"| `{p['id']}` | {name} | {p['categoria']} | "
            f"[rel/{proc['rel_id']}](https://www.openstreetmap.org/relation/{proc['rel_id']}) | "
            f"{proc['area_km2']:.3f} | {p['prioridad']} |"
        )
    md.append("")
    md.append("## Procedencia de las geometrías nuevas")
    md.append("")
    md.append(
        "Todas las geometrías nuevas provienen de **OpenStreetMap "
        "`admin_level=10`** (límites de barrio oficiales de Posadas), "
        "extraídas vía Overpass API el "
        f"{today} con `scripts/get_barrios_osm.py`. Las geometrías son "
        "polígonos reales (no buffers) ensambladas a partir de los `outer ways` "
        "de cada relación con Shapely (`linemerge` + `polygonize`)."
    )
    md.append("")
    md.append("Atribución obligatoria: © OpenStreetMap contributors, ODbL.")
    md.append("")
    md.append("## Cobertura")
    md.append("")
    total_km2 = sum(
        feature["properties"].get("area_km2_aprox", 0)
        for _, feature, _ in added
    )
    md.append(f"Área total nuevos: ~**{total_km2:.1f} km²**.")
    md.append("")

    CHANGELOG.write_text("\n".join(md), encoding="utf-8")
    print(f"-> Changelog {CHANGELOG}")


if __name__ == "__main__":
    main()
