"""Lista TODOS los barrios OSM admin_level=10 dentro del ejido de Posadas y
compara contra los 44 polígonos del observatorio.

Identifica:
  * Barrios OSM que NO están en config/poligonos.geojson (candidatos a sumar).
  * Barrios OSM que SÍ están (verificación de cobertura).

Cuántos radios INDEC huérfanos cubriría cada candidato OSM, ordenado por
"radios huérfanos cubiertos" descendente.

No modifica nada. Solo reporta.
"""

from __future__ import annotations

import json
import time
import unicodedata
from pathlib import Path

import geopandas as gpd
import requests
from shapely.geometry import shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
PATH_RADIOS = ROOT / "data/raw/indec/radios_censales_capital_misiones.geojson"
PATH_POLIGONOS = ROOT / "config/poligonos.geojson"
PATH_OSM_OUT = ROOT / "data/raw/osm/posadas_admin_level_10.geojson"

# Bbox aproximada del depto Capital de Misiones (cubre Posadas + Garupá + ejido).
BBOX = (-27.55, -56.10, -27.30, -55.80)  # (south, west, north, east)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

OVERPASS_QUERY = f"""
[out:json][timeout:90];
(
  // Barrios formales OSM (admin_level 9 y 10).
  rel["admin_level"="10"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  rel["admin_level"="9"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  // place=neighbourhood y place=suburb son alternativas comunes en OSM-AR.
  way["place"~"neighbourhood|suburb|quarter"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  rel["place"~"neighbourhood|suburb|quarter"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  // landuse=residential explícito (chacras, conjuntos habitacionales).
  way["landuse"="residential"]["name"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
  rel["landuse"="residential"]["name"]({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
);
out geom;
"""


def slug(s: str) -> str:
    """ASCII slug para comparación de nombres."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip().replace(" ", "_")


def fetch_osm() -> dict:
    if PATH_OSM_OUT.exists():
        print(f"Cache hit: {PATH_OSM_OUT}")
        return json.loads(PATH_OSM_OUT.read_text(encoding="utf-8"))

    print("Descargando OSM Overpass...")
    PATH_OSM_OUT.parent.mkdir(parents=True, exist_ok=True)
    # Algunos mirrors devuelven 406 si no mandamos UA. Probamos hasta 3
    # endpoints conocidos y rotamos si falla.
    endpoints = [
        OVERPASS_URL,
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.openstreetmap.fr/api/interpreter",
    ]
    headers = {"User-Agent": "observatorio-posadas/1.0 (audit)"}
    last_err = None
    for url in endpoints:
        try:
            r = requests.post(
                url, data={"data": OVERPASS_QUERY}, headers=headers, timeout=180
            )
            r.raise_for_status()
            break
        except Exception as e:
            print(f"  fallo en {url}: {e}")
            last_err = e
            time.sleep(2)
    else:
        raise last_err
    data = r.json()
    print(f"  elements: {len(data.get('elements', []))}")
    PATH_OSM_OUT.write_text(json.dumps(data), encoding="utf-8")
    return data


def overpass_to_geojson(data: dict) -> gpd.GeoDataFrame:
    """Convierte la respuesta cruda de Overpass a GeoDataFrame.

    Solo conserva relations + ways cerrados con tag `name`.
    """
    feats = []
    for el in data.get("elements", []):
        tags = el.get("tags", {}) or {}
        name = tags.get("name") or tags.get("name:es")
        if not name:
            continue

        # Construir geometría según el tipo de elemento.
        geom = None
        if el["type"] == "way" and el.get("geometry"):
            coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
            if len(coords) >= 4 and coords[0] == coords[-1]:
                geom = shape(
                    {"type": "Polygon", "coordinates": [coords]}
                )
        elif el["type"] == "relation":
            outers = []
            inners = []
            for m in el.get("members", []):
                if m.get("type") != "way" or not m.get("geometry"):
                    continue
                coords = [(p["lon"], p["lat"]) for p in m["geometry"]]
                if len(coords) < 2:
                    continue
                if m.get("role") == "outer":
                    outers.append(coords)
                elif m.get("role") == "inner":
                    inners.append(coords)
            # Construcción simple: une los outers en un MultiPolygon vía
            # Shapely. No reconstruimos topología completa (suficiente para
            # análisis de cobertura, no para producción).
            from shapely.geometry import MultiPolygon, Polygon

            outer_polys = []
            for ring in outers:
                if len(ring) >= 4 and ring[0] == ring[-1]:
                    try:
                        outer_polys.append(Polygon(ring))
                    except Exception:
                        pass
            if outer_polys:
                geom = unary_union(outer_polys)

        if geom is None or geom.is_empty:
            continue

        feats.append(
            {
                "osm_id": el["id"],
                "osm_type": el["type"],
                "name": name,
                "admin_level": tags.get("admin_level"),
                "place": tags.get("place"),
                "landuse": tags.get("landuse"),
                "geometry": geom,
            }
        )

    gdf = gpd.GeoDataFrame(feats, crs=4326)
    return gdf


def main() -> None:
    radios = gpd.read_file(PATH_RADIOS).to_crs(4326)
    polig = gpd.read_file(PATH_POLIGONOS).to_crs(4326)

    urb = radios[radios["tro"].isin(["U", "M"])].copy()
    polig_real = polig[polig["nombre"] != "Posadas (toda la ciudad)"].copy()

    # Asignación huérfanos.
    METRIC = 22195
    urb_m = urb.to_crs(METRIC)
    polig_real_m = polig_real.to_crs(METRIC)
    urb_m["centroid"] = urb_m.geometry.representative_point()
    union_legacy = unary_union(polig_real_m.geometry)
    urb_m["asignado"] = urb_m["centroid"].within(union_legacy)
    huerf_m = urb_m[~urb_m["asignado"]].copy()
    print(f"Radios huérfanos: {len(huerf_m)}\n")

    # OSM.
    osm_raw = fetch_osm()
    osm = overpass_to_geojson(osm_raw)
    print(f"Barrios OSM con nombre encontrados: {len(osm)}\n")

    # Filtramos OSM por intersección con la mancha urbana INDEC para descartar
    # ruido fuera del ejido.
    union_indec_urb = unary_union(urb.geometry)
    osm = osm[osm.geometry.intersects(union_indec_urb)].copy()
    print(f"OSM dentro de la mancha urbana INDEC: {len(osm)}\n")

    # Slug de nombres existentes (para detectar duplicados con los 44 actuales).
    nombres_existentes = {slug(n) for n in polig_real["nombre"].tolist()}
    nombres_existentes_id = set(polig_real["id"].tolist())

    print(f"Nombres polígonos actuales (slug): {sorted(nombres_existentes)[:10]}...\n")

    # Para cada OSM, ver si su nombre ya está. Y cuántos radios huérfanos
    # cubre (centroide del radio dentro del polígono OSM).
    osm_m = osm.to_crs(METRIC)
    huerf_centroids_m = huerf_m.set_geometry("centroid")

    candidatos = []
    for _, row in osm_m.iterrows():
        s = slug(row["name"])
        ya_existe = s in nombres_existentes or s in nombres_existentes_id

        # Radios huérfanos cuyo centroide cae en este OSM.
        n_huerf_dentro = huerf_centroids_m.geometry.within(row.geometry).sum()
        area_km2 = row.geometry.area / 1e6

        candidatos.append(
            {
                "osm_id": row["osm_id"],
                "osm_type": row["osm_type"],
                "name": row["name"],
                "slug": s,
                "admin_level": row["admin_level"],
                "place": row["place"],
                "landuse": row["landuse"],
                "ya_existe": ya_existe,
                "n_huerf_dentro": int(n_huerf_dentro),
                "area_km2": round(area_km2, 3),
            }
        )

    candidatos.sort(key=lambda c: c["n_huerf_dentro"], reverse=True)

    print("=== TOP 30 BARRIOS OSM CANDIDATOS (por radios huérfanos cubiertos) ===")
    print(f"{'name':40s} {'al':>4s} {'place':16s} {'huerf':>6s} {'km²':>7s} {'existe':>7s}")
    for c in candidatos[:30]:
        al = c["admin_level"]
        al_s = "-" if al is None or (isinstance(al, float) and al != al) else str(al)
        place = c["place"]
        place_s = "-" if place is None or (isinstance(place, float) and place != place) else str(place)
        print(
            f"{c['name'][:40]:40s} "
            f"{al_s:>4s} "
            f"{place_s:16s} "
            f"{c['n_huerf_dentro']:>6d} "
            f"{c['area_km2']:>7.2f} "
            f"{'YES' if c['ya_existe'] else 'NO':>7s}"
        )

    # Resumen agregado: si sumamos todos los OSM "NO existentes", ¿cuántos
    # radios huérfanos podríamos cubrir y cuánta área?
    no_existentes = [c for c in candidatos if not c["ya_existe"]]
    huerf_cubribles = sum(c["n_huerf_dentro"] for c in no_existentes if c["n_huerf_dentro"] > 0)

    # Para el área, hacer una unión real (no sumar — los OSM se solapan).
    osm_no_exist_m = osm_m[
        ~osm_m["name"].apply(lambda n: slug(n) in nombres_existentes)
    ]
    union_osm_no_exist = unary_union(osm_no_exist_m.geometry)
    area_osm_no_exist_km2 = union_osm_no_exist.area / 1e6

    print(f"\n=== RESUMEN ===")
    print(f"Barrios OSM nuevos (no existentes): {len(no_existentes)}")
    print(f"  con ≥1 radio huérfano dentro: {sum(1 for c in no_existentes if c['n_huerf_dentro'] > 0)}")
    print(f"Radios huérfanos cubribles por OSM: ~{huerf_cubribles} de {len(huerf_m)}")
    print(f"Área OSM no existente (unión): {area_osm_no_exist_km2:.2f} km²")

    # Volcamos JSON con candidatos.
    out_json = ROOT / "data/raw/osm/candidatos_barrios_nuevos.json"
    out_json.write_text(
        json.dumps([c for c in candidatos if not c["ya_existe"]], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nGuardado: {out_json}")

    # GeoJSON con los candidatos OSM no existentes (para visualizar).
    out_gj = ROOT / "data/raw/osm/candidatos_barrios_nuevos.geojson"
    osm_no_exist = osm[
        ~osm["name"].apply(lambda n: slug(n) in nombres_existentes)
    ].copy()
    osm_no_exist["n_huerf_dentro"] = [
        next(
            (c["n_huerf_dentro"] for c in candidatos if c["osm_id"] == oid and c["osm_type"] == otype),
            0,
        )
        for oid, otype in zip(osm_no_exist["osm_id"], osm_no_exist["osm_type"])
    ]
    osm_no_exist.to_file(out_gj, driver="GeoJSON")
    print(f"Guardado: {out_gj}")


if __name__ == "__main__":
    main()
