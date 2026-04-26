"""Amplía el polígono de Itaembé Guazú para incluir el sector suroeste.

El polígono OSM oficial (relation 4860758) cubre ~7.65 km² pero deja afuera
la zona al oeste donde están Hipódromo General Belgrano, Ferretería Leo,
Mi dulce wawa. Google Maps muestra que toda esa extensión también es parte
del barrio según el usuario.

Solución: union shapely del polígono OSM actual con un rectángulo que cubre
la zona faltante. Después simplificamos para no explotar la cantidad de
vertices.

Coordenadas del rectángulo de extensión (deducidas del screenshot de Google
Maps que mandó el usuario):
- Oeste: -56.012  (más allá del Hipódromo General Belgrano)
- Este:  -55.996  (se solapa con el polígono OSM)
- Sur:   -27.428  (llega hasta Parque Rural)
- Norte: -27.388  (llega hasta Escuela 967)
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import Polygon, mapping, shape
from shapely.ops import unary_union

RAIZ = Path(__file__).resolve().parent.parent.parent
GEOJSON = RAIZ / "config" / "poligonos.geojson"

EXTENSION_OESTE = Polygon(
    [
        (-56.012, -27.428),
        (-55.996, -27.428),
        (-55.996, -27.388),
        (-56.012, -27.388),
        (-56.012, -27.428),
    ]
)


def main() -> None:
    fc = json.loads(GEOJSON.read_text(encoding="utf-8"))

    for feat in fc["features"]:
        if feat["properties"]["id"] != "itaembe_guazu":
            continue

        original = shape(feat["geometry"])
        ampliado = unary_union([original, EXTENSION_OESTE])

        # Simplificamos con tolerancia chica (~5 m en grados ≈ 5e-5).
        # Preserve_topology=True evita polígonos auto-intersectados.
        simplificado = ampliado.simplify(5e-5, preserve_topology=True)

        # Shapely puede devolver MultiPolygon o Polygon.
        geom_geojson = mapping(simplificado)

        feat["geometry"] = geom_geojson
        feat["properties"]["descripcion"] = (
            "Barrio del sur de Posadas en expansión. Polígono OSM oficial "
            "(relation/4860758) ampliado manualmente al oeste para incluir "
            "el sector Hipódromo General Belgrano / Ferretería Leo, que la "
            "comunidad identifica como parte del barrio aunque OSM lo omita."
        )
        feat["properties"]["fuente_poligono"] = "OSM Nominatim + extensión manual"
        feat["properties"]["fecha_creacion_poligono"] = "2026-04-24"

        # Tamaño del polígono nuevo en km² (UTM 21S).
        import geopandas as gpd

        gdf = gpd.GeoDataFrame(geometry=[simplificado], crs="EPSG:4326")
        area_km2 = gdf.to_crs("EPSG:32721").geometry.area.iloc[0] / 1e6

        # Cantidad de vertices
        if geom_geojson["type"] == "Polygon":
            n_vert = len(geom_geojson["coordinates"][0])
        elif geom_geojson["type"] == "MultiPolygon":
            n_vert = sum(len(poly[0]) for poly in geom_geojson["coordinates"])
        else:
            n_vert = "?"

        print("Polígono itaembe_guazu ampliado:")
        print(f"  tipo: {geom_geojson['type']}")
        print(f"  vertices: {n_vert}")
        print(f"  área: {area_km2:.2f} km² (antes: 7.64 km²)")
        break

    GEOJSON.write_text(json.dumps(fc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nEscrito {GEOJSON}")


if __name__ == "__main__":
    main()
