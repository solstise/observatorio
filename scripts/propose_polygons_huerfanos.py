"""Propone polígonos NUEVOS que cubren los radios INDEC huérfanos
(no asignados a ninguno de los 44 polígonos legacy del observatorio).

NO TOCA config/poligonos.geojson. Genera un preview en
``config/poligonos_propuestos_huerfanos.geojson`` para revisión visual.

Estrategia
----------
1. Detectar los 229 radios INDEC urbanos+mixtos sin polígono legacy.
2. Encontrar manchas conexas (componentes de adyacencia con buffer 25 m).
3. Sub-dividir manchas grandes con K-means: target ~12-18 radios por
   sub-cluster. Eso da polígonos sintéticos del tamaño promedio de los
   actuales (~12 radios INDEC por barrio actual).
4. Polígono final = unary_union de los radios del sub-cluster.
5. Naming: reverse geocoding sobre el centroide via Nominatim. Si falla,
   nombre genérico ``zona_<orientacion>_<idx>``.
6. Validación: el preview NO solapa con los 44 actuales (verificación final
   con audit_overlaps).

Uso
---
    python scripts/propose_polygons_huerfanos.py

Para mergear al config principal después de revisar:
    python scripts/merge_polygons_huerfanos.py   (NO incluido — manual decision)
"""

from __future__ import annotations

import json
import math
import time
import unicodedata
from pathlib import Path

import geopandas as gpd
import numpy as np
import requests
from shapely.geometry import shape
from shapely.ops import unary_union
from sklearn.cluster import KMeans

ROOT = Path(__file__).resolve().parent.parent
PATH_RADIOS = ROOT / "data/raw/indec/radios_censales_capital_misiones.geojson"
PATH_POLIGONOS = ROOT / "config/poligonos.geojson"
PATH_OUT = ROOT / "config/poligonos_propuestos_huerfanos.geojson"
PATH_OUT_REPORT = ROOT / "config/poligonos_propuestos_huerfanos_reporte.md"

# Target de radios INDEC por sub-cluster. Los 44 actuales tienen mediana
# ~12 radios; queremos consistencia de tamaño.
TARGET_RADIOS_POR_SUBCLUSTER = 14
# Si una mancha ya tiene <= MIN_SIN_SUBDIVIDIR radios, no se subdivide.
MIN_SIN_SUBDIVIDIR = 8
# Buffer de adyacencia para manchas conexas (m).
BUFFER_M = 25
# Buffer de seguridad al clipar contra legacy: 2m. Evita slivers minúsculos
# entre nuevo y legacy sin perder cobertura significativa.
CLIP_BUFFER_M = 2
# Polígonos con densidad de radios baja se marcan publicar_en_sitio=false:
# son zonas periurbanas / rurales que distorsionan el mapa.
DENSIDAD_MIN_RADIOS_KM2 = 1.0
# CRS métrico (POSGAR zona 5).
METRIC = 22195

# Acortamientos de prefijos largos de Nominatim → mejora UX en el dashboard.
PREFIJOS_ACORTAR = [
    ("Delegación Municipal", "DM"),
    ("Delegacion Municipal", "DM"),
    ("Centro de Integración Territorial", "CIT"),
    ("Centro de Integracion Territorial", "CIT"),
]


def acortar_nombre(s: str) -> str:
    for pref_largo, pref_corto in PREFIJOS_ACORTAR:
        if s.startswith(pref_largo):
            return pref_corto + s[len(pref_largo) :]
    return s

# Centro geográfico de Posadas (≈ Plaza 9 de Julio) — para clasificar
# orientación cardinal y evitar que el naming geográfico colapse cuando
# el reverse-geocoding falla.
CENTRO_POSADAS = (-55.8961, -27.3671)  # lon, lat

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"


def slug(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    out = []
    for ch in s.lower().strip():
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "/", "_"):
            out.append("_")
    res = "".join(out)
    while "__" in res:
        res = res.replace("__", "_")
    return res.strip("_")


def orientacion(lon: float, lat: float) -> str:
    """Devuelve N/S/E/O/NE/NO/SE/SO según el ángulo respecto al centro."""
    dx = lon - CENTRO_POSADAS[0]
    dy = lat - CENTRO_POSADAS[1]
    ang = math.degrees(math.atan2(dy, dx))  # -180..180
    # 0° = E, 90° = N, ±180° = O, -90° = S.
    if -22.5 <= ang < 22.5:
        return "este"
    if 22.5 <= ang < 67.5:
        return "noreste"
    if 67.5 <= ang < 112.5:
        return "norte"
    if 112.5 <= ang < 157.5:
        return "noroeste"
    if ang >= 157.5 or ang < -157.5:
        return "oeste"
    if -157.5 <= ang < -112.5:
        return "suroeste"
    if -112.5 <= ang < -67.5:
        return "sur"
    return "sureste"


def reverse_geocode(lat: float, lon: float, retries: int = 2) -> dict | None:
    """Nominatim reverse para nombrar una zona por su calle/avenida más cercana.
    Devuelve None si falla o si no hay datos útiles."""
    headers = {"User-Agent": "observatorio-posadas/1.0 (build-polygons)"}
    params = {
        "lat": lat,
        "lon": lon,
        "format": "json",
        "zoom": 17,
        "addressdetails": 1,
        "accept-language": "es",
    }
    for attempt in range(retries):
        try:
            r = requests.get(NOMINATIM_URL, params=params, headers=headers, timeout=20)
            if r.status_code == 200:
                return r.json()
        except Exception as e:  # noqa: BLE001
            print(f"  geocode error attempt {attempt + 1}: {e}")
        time.sleep(1.2)  # respetar rate limit (1 req/s)
    return None


def nombre_desde_geocode(geo: dict | None, fallback: str) -> str:
    """Extrae un nombre legible de la respuesta de Nominatim.

    Prioridad: suburb > neighbourhood > residential > road > fallback.
    """
    if not geo:
        return fallback
    addr = geo.get("address", {}) or {}
    for k in ("suburb", "neighbourhood", "quarter", "residential", "village"):
        v = addr.get(k)
        if v:
            return str(v)
    rd = addr.get("road")
    if rd:
        return f"Sector {rd}"
    name = geo.get("name")
    if name:
        return str(name)
    return fallback


def main() -> None:
    radios = gpd.read_file(PATH_RADIOS).to_crs(4326)
    polig = gpd.read_file(PATH_POLIGONOS).to_crs(4326)

    urb = radios[radios["tro"].isin(["U", "M"])].copy()
    polig_real = polig[polig["nombre"] != "Posadas (toda la ciudad)"].copy()
    nombres_existentes = {slug(n) for n in polig_real["nombre"].tolist()}
    ids_existentes = set(polig_real["id"].tolist())

    urb_m = urb.to_crs(METRIC).copy()
    polig_real_m = polig_real.to_crs(METRIC)
    urb_m["centroid_m"] = urb_m.geometry.representative_point()
    union_legacy = unary_union(polig_real_m.geometry)
    urb_m["asignado"] = urb_m["centroid_m"].within(union_legacy)
    huerf_m = urb_m[~urb_m["asignado"]].copy().reset_index(drop=True)
    print(f"Radios huérfanos: {len(huerf_m)}")

    # ── Paso 1: manchas conexas (componentes de adyacencia + buffer) ───────
    geoms_buf = [g.buffer(BUFFER_M) for g in huerf_m.geometry]
    n = len(geoms_buf)
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

    sindex = gpd.GeoSeries(geoms_buf, crs=METRIC).sindex
    for i, gb in enumerate(geoms_buf):
        for j in sindex.intersection(gb.bounds):
            if j <= i:
                continue
            if geoms_buf[j].intersects(gb):
                union(i, j)
    manchas: dict[int, list[int]] = {}
    for i in range(n):
        manchas.setdefault(find(i), []).append(i)
    manchas_list = sorted(manchas.values(), key=len, reverse=True)
    print(f"Manchas conexas: {len(manchas_list)}")

    # ── Paso 2: sub-clustering K-means dentro de cada mancha ───────────────
    # Coordenadas de centroides INDEC en el CRS métrico para el K-means.
    coords_m = np.array(
        [(p.x, p.y) for p in huerf_m["centroid_m"]]
    )
    sub_clusters: list[list[int]] = []
    for idx_mancha, mancha_idx in enumerate(manchas_list):
        n_radios = len(mancha_idx)
        if n_radios <= MIN_SIN_SUBDIVIDIR:
            sub_clusters.append(mancha_idx)
            continue
        k = max(2, round(n_radios / TARGET_RADIOS_POR_SUBCLUSTER))
        print(
            f"  mancha #{idx_mancha + 1}: {n_radios} radios → K-means k={k}"
        )
        X = coords_m[mancha_idx]
        km = KMeans(n_clusters=k, random_state=42, n_init=10)
        labels = km.fit_predict(X)
        for cl in range(k):
            sub = [mancha_idx[i] for i, lab in enumerate(labels) if lab == cl]
            if sub:
                sub_clusters.append(sub)
    print(f"Sub-clusters totales: {len(sub_clusters)}")

    # ── Paso 3: geometría final = unary_union de los radios − legacy ──────
    # Restamos la unión legacy (con buffer pequeño) para garantizar zero
    # overlap. Es defensivo: en teoría los radios huérfanos no deberían
    # solapar con legacy porque su centroide cae afuera, pero la geometría
    # del radio puede tener un ala que invade un polígono vecino.
    union_legacy_m = polig_real.to_crs(METRIC).geometry.union_all()
    union_legacy_m_buf = union_legacy_m.buffer(CLIP_BUFFER_M)

    nuevos_features: list[dict] = []
    print("\nReverse-geocoding (Nominatim, 1 req/s)...")
    for idx_sub, sub_idx in enumerate(sub_clusters):
        radios_sub = huerf_m.iloc[sub_idx]
        geom_m_raw = unary_union(radios_sub.geometry.tolist())
        # Clip contra legacy.
        geom_m = geom_m_raw.difference(union_legacy_m_buf)
        if geom_m.is_empty:
            print(
                f"  [SKIP] sub-cluster {idx_sub} quedó vacío tras clipar "
                f"contra legacy ({len(sub_idx)} radios)."
            )
            continue
        geom_4326 = (
            gpd.GeoSeries([geom_m], crs=METRIC).to_crs(4326).iloc[0]
        )
        centroide_4326 = (
            gpd.GeoSeries([geom_m.centroid], crs=METRIC).to_crs(4326).iloc[0]
        )
        lon, lat = centroide_4326.x, centroide_4326.y
        ori = orientacion(lon, lat)
        fallback_nombre = f"Zona {ori} {idx_sub + 1}"

        geo = reverse_geocode(lat, lon)
        nombre_base = nombre_desde_geocode(geo, fallback_nombre)
        # Acortamos prefijos largos como "Delegación Municipal" → "DM".
        nombre_base = acortar_nombre(nombre_base)
        # Si el nombre coincide exactamente con un polígono existente (ej.
        # OSM también llama "Centro" a un sub-cluster), agregamos sufijo.
        s = slug(nombre_base)
        if s in nombres_existentes or s in ids_existentes:
            s_sufijo = f"{s}_{ori}"
            nombre_base = f"{nombre_base} ({ori})"
            s = s_sufijo
        # Asegurar unicidad ante choque entre sub-clusters.
        n_try = 1
        s_orig = s
        while s in nombres_existentes or s in ids_existentes:
            n_try += 1
            s = f"{s_orig}_{n_try}"
        ids_existentes.add(s)
        nombres_existentes.add(s)

        cod_indec_lista = sorted(radios_sub["cod_indec"].tolist())

        # Densidad: radios / km² post-clip. Si es muy baja (< umbral) marca
        # publicar_en_sitio=false porque visualmente domina el mapa con un
        # bloque enorme casi vacío y distorsiona la lectura.
        area_km2_clip = geom_m.area / 1e6
        densidad = len(sub_idx) / area_km2_clip if area_km2_clip > 0.01 else 0
        publicar = densidad >= DENSIDAD_MIN_RADIOS_KM2

        feat = {
            "type": "Feature",
            "properties": {
                "id": s,
                "nombre": nombre_base,
                "categoria": "consolidado_crecimiento",  # default conservador (vocabulario test_geometrias)
                "categoria_original": "zona_sin_barrio_oficial",
                "prioridad": 3,  # default ranking, se ajusta luego
                "descripcion": (
                    f"Zona sintética generada para cubrir territorio sin barrio "
                    f"OSM o INDEC asignado. Construida a partir de "
                    f"{len(sub_idx)} radios INDEC contiguos "
                    f"(cod_indec: {cod_indec_lista[0]}…{cod_indec_lista[-1]}). "
                    f"Naming via Nominatim reverse-geocoding sobre el "
                    f"centroide; las 'Delegaciones Municipales' (DM) y "
                    f"'Centros de Integración Territorial' (CIT) son "
                    f"divisiones administrativas oficiales del Municipio "
                    f"de Posadas."
                ),
                "n_radios": float(len(sub_idx)),
                "cod_indec_radios": ",".join(cod_indec_lista),
                "fuente_geometria": (
                    "INDEC radios censales 2022 — clustering K-means de radios "
                    "huérfanos. Nominatim reverse para naming."
                ),
                "sensible": None,
                "publicar_en_sitio": publicar,
                "_es_total_ciudad": None,
                "_geom_source": "synthetic_kmeans_huerfanos_2026-05-05",
                # Lat/lon centroide para auditoría.
                "_centroid_lon": round(lon, 6),
                "_centroid_lat": round(lat, 6),
                "_orientacion": ori,
                "_densidad_radios_km2": round(densidad, 2),
                "_geocode_match": (
                    geo.get("address", {}).get("suburb")
                    or geo.get("address", {}).get("neighbourhood")
                    or geo.get("address", {}).get("road")
                    or None
                )
                if geo
                else None,
            },
            "geometry": json.loads(
                gpd.GeoSeries([geom_4326], crs=4326).to_json()
            )["features"][0]["geometry"],
        }
        nuevos_features.append(feat)
        flag = "  " if publicar else "✗ "
        print(
            f"{flag}[{idx_sub + 1:>2d}] id={s:42s} "
            f"radios={len(sub_idx):>3d} "
            f"area_km2={area_km2_clip:>6.2f} "
            f"densidad={densidad:>5.2f} "
            f"nombre={nombre_base!r}"
        )
        time.sleep(1.1)  # rate limit Nominatim

    # ── Paso 4: validación de no-solape contra los 44 actuales ─────────────
    print("\nValidando no-solape contra los 44 polígonos legacy...")
    union_legacy_m2 = polig_real.to_crs(METRIC).geometry.union_all()
    overlaps = 0
    for f in nuevos_features:
        g = shape(f["geometry"])
        gm = gpd.GeoSeries([g], crs=4326).to_crs(METRIC).iloc[0]
        inter = gm.intersection(union_legacy_m2)
        # Tolerancia 100 m² (slivers numéricos en bordes).
        if not inter.is_empty and inter.area > 100.0:
            overlaps += 1
            print(
                f"  ⚠ overlap: {f['properties']['id']} con legacy "
                f"({inter.area / 1e6:.4f} km²)"
            )
    if overlaps == 0:
        print("  ✓ Cero solapamientos con los 44 polígonos actuales.")

    # ── Paso 5: salida ─────────────────────────────────────────────────────
    fc = {
        "type": "FeatureCollection",
        "name": "poligonos_propuestos_huerfanos",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": nuevos_features,
    }
    PATH_OUT.write_text(
        json.dumps(fc, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"\nGuardado preview: {PATH_OUT}")
    print(f"  → {len(nuevos_features)} polígonos nuevos propuestos.")
    print(f"  → Cobertura: {sum(len(s) for s in sub_clusters)} radios huérfanos")
    print(f"  → Los 44 polígonos legacy NO se modifican.")

    # Reporte markdown.
    publicables = [f for f in nuevos_features if f["properties"]["publicar_en_sitio"]]
    no_publicables = [f for f in nuevos_features if not f["properties"]["publicar_en_sitio"]]

    lines = [
        "# Propuesta: polígonos nuevos para zonas huérfanas",
        "",
        f"Generado: 2026-05-05",
        f"",
        f"- **Radios huérfanos detectados**: {len(huerf_m)}",
        f"- **Sub-clusters generados**: {len(sub_clusters)}",
        f"- **Polígonos válidos tras clip y reverse-geocode**: {len(nuevos_features)}",
        f"- **A publicar en sitio**: {len(publicables)}",
        f"- **Marcados publicar_en_sitio=false** (densidad < {DENSIDAD_MIN_RADIOS_KM2} radios/km²): {len(no_publicables)}",
        f"- **Solapamientos contra los 44 legacy**: {overlaps}",
        "",
        "## Polígonos a publicar",
        "",
        "| ID | Nombre | Radios | km² | Densidad | Orientación |",
        "|---|---|---:|---:|---:|---|",
    ]
    for f in publicables:
        p = f["properties"]
        # Recalculamos km² del geom final clipeado para reportar exacto.
        gm = shape(f["geometry"])
        gm_m = gpd.GeoSeries([gm], crs=4326).to_crs(METRIC).iloc[0]
        ar = gm_m.area / 1e6
        lines.append(
            f"| `{p['id']}` | {p['nombre']} | "
            f"{int(p['n_radios'])} | {ar:.2f} | "
            f"{p['_densidad_radios_km2']:.2f} | {p['_orientacion']} |"
        )
    if no_publicables:
        lines.extend(
            [
                "",
                "## Polígonos descartados (`publicar_en_sitio=false`)",
                "",
                "Zonas con muy baja densidad de radios INDEC — son periurbanos o "
                "rurales donde el monitoreo a escala de barrio no aporta. Se conservan "
                "en el config para auditoría pero no se renderizan en el mapa.",
                "",
                "| ID | Nombre | Radios | km² | Densidad |",
                "|---|---|---:|---:|---:|",
            ]
        )
        for f in no_publicables:
            p = f["properties"]
            gm = shape(f["geometry"])
            gm_m = gpd.GeoSeries([gm], crs=4326).to_crs(METRIC).iloc[0]
            ar = gm_m.area / 1e6
            lines.append(
                f"| `{p['id']}` | {p['nombre']} | "
                f"{int(p['n_radios'])} | {ar:.2f} | "
                f"{p['_densidad_radios_km2']:.2f} |"
            )
    lines.append("")
    lines.append("## Naming")
    lines.append("")
    lines.append(
        "Las **Delegaciones Municipales (DM)** y **Centros de Integración "
        "Territorial (CIT)** son divisiones administrativas oficiales del "
        "Municipio de Posadas, capturadas por OpenStreetMap. El reverse-"
        "geocoding las elige automáticamente cuando el centroide del cluster "
        "cae en una de ellas — es la mejor fuente de naming porque es la "
        "estructura formal con la que ya razona el Municipio."
    )
    lines.append("")
    lines.append("## Cómo aplicar")
    lines.append("")
    lines.append(
        "1. Abrir `config/poligonos_propuestos_huerfanos.geojson` en QGIS o "
        "geojson.io para revisión visual.\n"
        "2. Renombrar manualmente los IDs/nombres genéricos (ej. "
        "`Sector Avenida Quaranta` → `chacras_uno_uno`) si querés algo más "
        "vernacular.\n"
        "3. Si conforma: correr el script de merge (a crear) que appendea "
        "estos features al `config/poligonos.geojson` principal sin tocar "
        "los 44 originales.\n"
    )
    PATH_OUT_REPORT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Reporte: {PATH_OUT_REPORT}")


if __name__ == "__main__":
    main()
