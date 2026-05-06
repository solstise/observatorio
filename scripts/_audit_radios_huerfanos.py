"""Audit de cobertura: ¿qué radios INDEC urbanos quedan SIN polígono asignado?

Output: tabla con n_radios urbanos huérfanos, área km² huérfana, sample de
cod_indec, y bounding box. Útil para decidir cuántos polígonos nuevos hace
falta crear para cubrir la mancha urbana de Posadas que hoy queda en negro.

No modifica nada. Solo reporta.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
PATH_RADIOS = ROOT / "data/raw/indec/radios_censales_capital_misiones.geojson"
PATH_POLIGONOS = ROOT / "config/poligonos.geojson"


def main() -> None:
    radios = gpd.read_file(PATH_RADIOS).to_crs(4326)
    polig = gpd.read_file(PATH_POLIGONOS).to_crs(4326)

    print(f"Total radios INDEC: {len(radios)}")
    print(f"  Urbanos (tro=U): {(radios['tro'] == 'U').sum()}")
    print(f"  Mixtos  (tro=M): {(radios['tro'] == 'M').sum()}")
    print(f"  Rurales (tro=R): {(radios['tro'] == 'R').sum()}")
    print(f"Total polígonos legacy: {len(polig)}")

    # Trabajamos solo con urbanos+mixtos (la pipeline original descarta R).
    urb = radios[radios["tro"].isin(["U", "M"])].copy()
    print(f"\nUrbanos+mixtos a evaluar: {len(urb)}")

    # Polígonos que NO son "Posadas (toda la ciudad)" — ese es un total que
    # se solapa con todos y rompería la asignación.
    polig_real = polig[polig["nombre"] != "Posadas (toda la ciudad)"].copy()
    print(f"Polígonos efectivos (sin total ciudad): {len(polig_real)}")

    # Reproyectamos a métrico (POSGAR / EPSG:5347 o web mercator). Para áreas
    # locales <100 km² Mercator funciona razonable. Usamos 22195 (POSGAR
    # zona 5) que es el oficial argentino para esta longitud.
    METRIC = 22195
    urb_m = urb.to_crs(METRIC)
    polig_real_m = polig_real.to_crs(METRIC)

    # Centroide robusto (representative_point garantiza estar dentro del
    # polígono incluso para formas no convexas).
    urb_m["centroid"] = urb_m.geometry.representative_point()

    # Asignación: para cada radio, ¿cae su centroide en algún polígono?
    union_legacy = unary_union(polig_real_m.geometry)

    urb_m["asignado"] = urb_m["centroid"].within(union_legacy)

    asignados = urb_m["asignado"].sum()
    huerfanos = (~urb_m["asignado"]).sum()
    area_huerfana_km2 = urb_m[~urb_m["asignado"]].geometry.area.sum() / 1e6
    area_total_km2 = urb_m.geometry.area.sum() / 1e6

    print("\n=== COBERTURA ===")
    print(
        f"  Radios urbanos+mixtos asignados:  {asignados} / {len(urb_m)}  ({asignados / len(urb_m):.1%})"
    )
    print(
        f"  Radios urbanos+mixtos HUÉRFANOS:  {huerfanos} / {len(urb_m)}  ({huerfanos / len(urb_m):.1%})"
    )
    print(f"  Área urbana TOTAL: {area_total_km2:.2f} km²")
    print(
        f"  Área urbana HUÉRFANA: {area_huerfana_km2:.2f} km² ({area_huerfana_km2 / area_total_km2:.1%})"
    )

    # Bounding box de los radios huérfanos para entender dónde están.
    huerf = urb_m[~urb_m["asignado"]].to_crs(4326)
    if len(huerf) > 0:
        bbox = huerf.total_bounds
        print("\n=== BBOX HUÉRFANOS (lat/lon) ===")
        print(f"  Lon: {bbox[0]:.4f} → {bbox[2]:.4f}")
        print(f"  Lat: {bbox[1]:.4f} → {bbox[3]:.4f}")

    # Áreas individuales: ¿cómo se distribuyen?
    areas_huerf_km2 = sorted(urb_m[~urb_m["asignado"]].geometry.area.values / 1e6, reverse=True)
    print("\n=== TAMAÑOS HUÉRFANOS (top 10 km²) ===")
    for a in areas_huerf_km2[:10]:
        print(f"  {a:.3f} km²")
    print(f"  ... mediana: {sorted(areas_huerf_km2)[len(areas_huerf_km2) // 2]:.3f} km²")

    # Volcamos el resultado a un geojson para inspección visual rápida.
    out_path = ROOT / "data/raw/indec/radios_huerfanos.geojson"
    out_gdf = urb[~urb_m["asignado"].values].copy()
    out_gdf["centroid_lon"] = urb_m[~urb_m["asignado"]].centroid.to_crs(4326).x.values
    out_gdf["centroid_lat"] = urb_m[~urb_m["asignado"]].centroid.to_crs(4326).y.values
    out_gdf.to_file(out_path, driver="GeoJSON")
    print(f"\nGuardado para inspección: {out_path}")
    print("  → abrir en geojson.io / qgis para ver el mapa de huecos.")


if __name__ == "__main__":
    main()
