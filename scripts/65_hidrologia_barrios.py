"""Capas hidrológicas estáticas para la sala El Niño: escurrimiento por barrio y arroyos.

Escurrimiento: método del número de curva (SCS, USDA-NRCS TR-55, 1986). Para cada
barrio se calcula un rango de número de curva en condición de humedad normal
(AMC II), porque no hay un mapa de grupos hidrológicos de suelo ni de superficie
impermeable para Posadas:

- Extremo bajo: suelo grupo B (pasto en buen estado, CN 61) e impermeable igual a
  la proporción de techos (huellas de edificios Google + Microsoft).
- Extremo alto: suelo grupo C (CN 74) e impermeable según el tamaño medio de lote
  (TR-55, tabla 2-2a). El lote se estima como superficie construida de Dynamic
  World dividida por la cantidad de edificios. Dynamic World no se usa directo
  como impermeable porque su clase "built" incluye patios y veredas.

CN compuesto = CN permeable + impermeable × (98 − CN permeable) (TR-55, fig. 2-3).
La página ajusta ese rango con la lluvia medida de los últimos 5 días (AMC I/III).

Arroyos: cursos de agua OSM ya cacheados por el script 61. OSM dibuja los cursos en
el sentido de la corriente, por eso la animación del mapa indica hacia dónde corre.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely import transform
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

POLIGONOS = ROOT / "webapp/frontend/public/data/poligonos.geojson"
EDIFICIOS = ROOT / "data/raw/buildings_merge/posadas_merged_buildings.csv"
OVERPASS = ROOT / "data/raw/osm/nino_overpass.json"
SALIDA = ROOT / "data/outputs"
CN_PERMEABLE = {"B": 61, "C": 74}  # TR-55, tabla 2-2a: espacios abiertos en buen estado
CN_IMPERMEABLE = 98
# TR-55, tabla 2-2a: % impermeable de zonas residenciales según tamaño de lote (m²).
# Por debajo de 1/8 de acre se interpola hasta 85 % (zonas comerciales) en 150 m².
LOTE_IMPERMEABLE = [
    (150, 0.85),
    (506, 0.65),
    (1012, 0.38),
    (1349, 0.30),
    (2023, 0.25),
    (4047, 0.20),
    (8094, 0.12),
]


def impermeable_por_lote(lote_m2):
    """Interpolación en escala logarítmica del lote; fuera de la tabla se usa el extremo."""
    lotes, fracciones = zip(*LOTE_IMPERMEABLE)
    return float(np.interp(np.log(lote_m2), np.log(lotes), fracciones))


def cn_compuesto(cn_permeable, impermeable):
    impermeable = min(1.0, max(0.0, impermeable))
    return round(cn_permeable + impermeable * (CN_IMPERMEABLE - cn_permeable), 1)


def _utm(a_utm, coords):
    x, y = a_utm(coords[:, 0], coords[:, 1])
    return np.column_stack([x, y])


def construido_por_barrio(path):
    """Proporción de píxeles con probabilidad 'built' ≥ 0,5, último período con imágenes."""
    if not path or not Path(path).exists():
        return {}
    tabla = pd.read_csv(path)
    # El archivo trae períodos futuros sin imágenes (valor vacío): se descartan.
    tabla = tabla[(tabla.n_imagenes > 0) & tabla.dw_built_pct_ge_50.notna()]
    tabla = tabla.sort_values("fecha").groupby("poligono_id").tail(1)
    return {
        row.poligono_id: float(row.dw_built_pct_ge_50)
        for row in tabla.itertuples()
        if pd.notna(row.dw_built_pct_ge_50)
    }


def escurrimiento(dynamic_world):
    a_utm = Transformer.from_crs("EPSG:4326", "EPSG:32721", always_xy=True).transform
    poligonos = json.loads(POLIGONOS.read_text(encoding="utf-8"))["features"]
    barrios = [
        f for f in poligonos if f["properties"].get("categoria_original") != "ciudad_completa"
    ]
    formas = [transform(shape(f["geometry"]), lambda xy: _utm(a_utm, xy)) for f in barrios]
    arbol = STRtree(formas)
    techos = [0.0] * len(barrios)
    cantidad = [0] * len(barrios)
    # Cada edificio suma su área al barrio que contiene su centroide.
    for chunk in pd.read_csv(EDIFICIOS, usecols=["lat", "lon", "area_m2"], chunksize=50_000):
        for lat, lon, area in chunk.itertuples(index=False):
            punto = Point(a_utm(lon, lat))
            for i in arbol.query(punto, predicate="within"):
                techos[i] += area
                cantidad[i] += 1
    construido = construido_por_barrio(dynamic_world)
    filas = []
    for f, forma, techo, n in zip(barrios, formas, techos, cantidad):
        props = f["properties"]
        area = forma.area
        frac_techos = techo / area if area else None
        frac_construido = construido.get(props["id"])
        # Lote medio = superficie construida / edificios. Sin Dynamic World o sin
        # edificios, el extremo alto usa los techos: el rango se achica, no se inventa.
        lote = area * frac_construido / n if frac_construido and n else None
        por_lote = impermeable_por_lote(lote) if lote else None
        # El % del lote vale solo para la parte urbanizada del polígono.
        alto = max(frac_techos or 0, (frac_construido or 0) * (por_lote or 0))
        filas.append(
            {
                "poligono_id": props["id"],
                "nombre": props["nombre"],
                "area_m2": round(area),
                "edificios": n,
                "techos_frac": round(frac_techos, 4) if frac_techos is not None else None,
                "construido_frac": (
                    round(frac_construido, 4) if frac_construido is not None else None
                ),
                "lote_medio_m2": round(lote) if lote else None,
                "impermeable_alto": round(alto, 3),
                "cn_ii_min": cn_compuesto(CN_PERMEABLE["B"], frac_techos or 0),
                "cn_ii_max": cn_compuesto(CN_PERMEABLE["C"], alto),
            }
        )
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metodo": "Número de curva SCS (USDA-NRCS TR-55), rango suelo B–C",
        "cn_permeable": CN_PERMEABLE,
        "fuentes": [
            "Google Open Buildings + Microsoft Building Footprints (techos)",
            "Dynamic World, probabilidad built ≥ 0,5 (superficie construida)",
        ],
        "barrios": filas,
    }


def arroyos():
    elementos = json.loads(OVERPASS.read_text(encoding="utf-8"))["elements"]
    features = []
    for el in elementos:
        tags = el.get("tags") or {}
        geometria = el.get("geometry") or []
        if not tags.get("waterway") or len(geometria) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"nombre": tags.get("name"), "tipo": tags["waterway"]},
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[round(p["lon"], 5), round(p["lat"], 5)] for p in geometria],
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dynamic-world", help="CSV de Dynamic World por barrio (rama data)")
    args = parser.parse_args()
    SALIDA.mkdir(parents=True, exist_ok=True)
    datos = escurrimiento(args.dynamic_world)
    (SALIDA / "escurrimiento_barrios.json").write_text(
        json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    cursos = arroyos()
    (SALIDA / "arroyos_nino.geojson").write_text(
        json.dumps(cursos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    sin_dw = sum(1 for b in datos["barrios"] if b["construido_frac"] is None)
    print(
        f"Escurrimiento: {len(datos['barrios'])} barrios ({sin_dw} sin Dynamic World). "
        f"Arroyos: {len(cursos['features'])} tramos."
    )


if __name__ == "__main__":
    main()
