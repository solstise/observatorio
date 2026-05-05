"""Dos análisis complementarios al de OSM (que dio sólo 5 radios cubribles):

1. RENABAP — Registro Nacional de Barrios Populares (gobierno argentino).
   Asentamientos informales con polígonos oficiales. Vemos cuántos caen
   dentro del depto Capital Misiones y cuántos radios huérfanos cubren.

2. Clustering espacial de radios huérfanos — agrupar radios INDEC contiguos
   en manchas conexas para evaluar cuántos polígonos sintéticos haría falta
   crear si llenamos los huecos por geografía.
"""

from __future__ import annotations

import json
from pathlib import Path

import geopandas as gpd
import requests
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
PATH_RADIOS = ROOT / "data/raw/indec/radios_censales_capital_misiones.geojson"
PATH_POLIGONOS = ROOT / "config/poligonos.geojson"
PATH_RENABAP = ROOT / "data/raw/renabap/renabap_capital_misiones.geojson"

# RENABAP: capa pública del Ministerio de Desarrollo Social, vía la API de
# datos abiertos del gobierno argentino. Hay varios endpoints; el más
# estable es el WFS del IGN-ARBA y el ArcGIS REST del Ministerio.
# https://datosabiertos.desarrollosocial.gob.ar/dataset/registro-nacional-de-barrios-populares
RENABAP_URL = (
    "https://services5.arcgis.com/CGcKjBeoAzRgVXLR/ArcGIS/rest/services/"
    "Barrios_Populares_Vista_p%C3%BAblica/FeatureServer/0/query"
)


def fetch_renabap() -> gpd.GeoDataFrame | None:
    if PATH_RENABAP.exists():
        print(f"Cache hit: {PATH_RENABAP}")
        return gpd.read_file(PATH_RENABAP)

    print("Descargando RENABAP (ArcGIS REST)...")
    PATH_RENABAP.parent.mkdir(parents=True, exist_ok=True)
    # Query por bbox geográfica (más robusto que filtrar por strings).
    bbox = "-56.10,-27.55,-55.80,-27.30"  # xmin,ymin,xmax,ymax (lon,lat)
    params = {
        "where": "1=1",
        "geometry": bbox,
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "inSR": "4326",
        "outFields": "*",
        "outSR": "4326",
        "f": "geojson",
        "returnGeometry": "true",
    }
    headers = {"User-Agent": "observatorio-posadas/1.0 (audit)"}
    try:
        r = requests.get(RENABAP_URL, params=params, headers=headers, timeout=120)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  ERROR RENABAP: {e}")
        return None
    feats = data.get("features", [])
    print(f"  features bbox Posadas: {len(feats)}")
    if not feats:
        return None
    PATH_RENABAP.write_text(json.dumps(data), encoding="utf-8")
    return gpd.read_file(PATH_RENABAP)


def main() -> None:
    radios = gpd.read_file(PATH_RADIOS).to_crs(4326)
    polig = gpd.read_file(PATH_POLIGONOS).to_crs(4326)

    urb = radios[radios["tro"].isin(["U", "M"])].copy()
    polig_real = polig[polig["nombre"] != "Posadas (toda la ciudad)"].copy()

    METRIC = 22195
    urb_m = urb.to_crs(METRIC)
    polig_real_m = polig_real.to_crs(METRIC)
    urb_m["centroid"] = urb_m.geometry.representative_point()
    union_legacy = unary_union(polig_real_m.geometry)
    urb_m["asignado"] = urb_m["centroid"].within(union_legacy)
    huerf_m = urb_m[~urb_m["asignado"]].copy()
    print(f"Radios huérfanos: {len(huerf_m)}\n")

    # ── 1. RENABAP ─────────────────────────────────────────────────────────
    print("=" * 70)
    print("RENABAP")
    print("=" * 70)
    rena = fetch_renabap()
    if rena is None or len(rena) == 0:
        print("  RENABAP no disponible o vacío para Capital Misiones.")
    else:
        print(f"  Barrios populares en Capital Misiones: {len(rena)}")
        print(f"  Columnas: {list(rena.columns)[:8]}...")
        rena_m = rena.to_crs(METRIC)
        # Cuántos radios huérfanos caen en algún barrio RENABAP.
        huerf_centroids = huerf_m.set_geometry("centroid")
        n_cubre = 0
        for _, r in rena_m.iterrows():
            n_cubre += huerf_centroids.geometry.within(r.geometry).sum()
        print(f"  Radios huérfanos cubiertos por RENABAP: ~{n_cubre}")
        if "nombre_barrio" in rena.columns:
            print("\n  Barrios RENABAP en el área:")
            for nm in sorted(rena["nombre_barrio"].dropna().unique()):
                print(f"    - {nm}")

    # ── 2. CLUSTERING ESPACIAL ─────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("CLUSTERING DE RADIOS HUÉRFANOS")
    print("=" * 70)

    # Estrategia: componentes conexas. Dos radios pertenecen al mismo cluster
    # si comparten un borde (touch) o si están a < 50 m. Esto detecta
    # naturalmente las "manchas" de territorio sin polígono.
    huerf_g = huerf_m.geometry.tolist()
    n = len(huerf_g)
    print(f"\nN huérfanos: {n}")

    # Buffer pequeño para tolerar gaps mínimos entre radios que en realidad
    # son contiguos pero la geometría INDEC tiene un slack de 1-5 m.
    BUFFER_M = 25
    print(f"Buffer de adyacencia: {BUFFER_M} m")
    geoms_buf = [g.buffer(BUFFER_M) for g in huerf_g]

    # Union-find naive (n=229 ⇒ O(n^2) está bien).
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # Spatial index para evitar O(n^2) real.
    sindex = gpd.GeoSeries(geoms_buf, crs=METRIC).sindex
    for i, gb in enumerate(geoms_buf):
        for j in sindex.intersection(gb.bounds):
            if j <= i:
                continue
            if geoms_buf[j].intersects(gb):
                union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(n):
        r = find(i)
        clusters.setdefault(r, []).append(i)

    # Ordenamos por tamaño (n radios) descendente.
    cluster_list = sorted(clusters.values(), key=len, reverse=True)

    print(f"\nManchas conexas detectadas: {len(cluster_list)}")
    print(f"\nTop 15 manchas (por n radios + km²):")
    print(f"{'#':>3s} {'n_radios':>9s} {'area_km2':>9s} {'centroide_lonlat'}")
    huerf_4326 = huerf.to_crs(4326) if False else huerf_m.to_crs(4326)
    for idx, cluster_indices in enumerate(cluster_list[:15]):
        ar = sum(huerf_g[i].area for i in cluster_indices) / 1e6
        union_m = unary_union([huerf_g[i] for i in cluster_indices])
        c = gpd.GeoSeries([union_m], crs=METRIC).to_crs(4326).iloc[0].centroid
        print(f"{idx + 1:>3d} {len(cluster_indices):>9d} {ar:>9.2f}  {c.x:.4f}, {c.y:.4f}")

    # Tamaños: cuántos radios cubren los top-K clusters.
    sizes = sorted([len(c) for c in cluster_list], reverse=True)
    cum = 0
    print(f"\nCobertura acumulada por cantidad de polígonos sintéticos:")
    for k in [5, 10, 15, 20, 30, 50]:
        cum_k = sum(sizes[:k])
        print(f"  Top {k:>3d} manchas → {cum_k} radios huérfanos ({cum_k / n:.0%})")

    # Volcamos clusters a geojson para visualizar.
    out_clusters = ROOT / "data/raw/indec/clusters_huerfanos.geojson"
    rows = []
    for idx, cluster_indices in enumerate(cluster_list):
        union_m = unary_union([huerf_g[i] for i in cluster_indices])
        rows.append(
            {
                "cluster_id": idx,
                "n_radios": len(cluster_indices),
                "area_km2": round(union_m.area / 1e6, 3),
                "geometry": union_m,
            }
        )
    gdf_clu = gpd.GeoDataFrame(rows, crs=METRIC).to_crs(4326)
    gdf_clu.to_file(out_clusters, driver="GeoJSON")
    print(f"\nGuardado clusters: {out_clusters}")


if __name__ == "__main__":
    main()
