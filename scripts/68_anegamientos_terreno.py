"""Por dónde corre el agua en una tormenta, según el terreno, y obras pluviales del municipio.

Terreno: Copernicus GLO-30 (2021), un modelo de superficie de 30 m que incluye edificios y
árboles, con error vertical de 2 a 4 m. Cauces: red de arroyos oficial de la Municipalidad
(IDE Posadas), marcada 3 m más abajo en el terreno para que el agua siga los cauces reales
aunque el modelo de superficie tenga puentes o edificios encima. Después se rellenan las
depresiones con prioridad (Barnes, Lehman y Mulla 2014, con épsilon para que los planos
drenen), se asigna la dirección de máxima pendiente (D8) y se suma el área de aporte.

Un camino del agua es una celda que recibe agua de al menos 10 ha. Los que no siguen un
arroyo oficial son los que interesan: valles y calles por donde baja el agua en una
tormenta. No es un modelo hidráulico: no conoce los desagües pluviales (el municipio no
publica esa red) ni cuánta agua cabe en cada calle.

Validación: las obras hidráulicas que publica el municipio (2019-2025) se comparan con los
edificios de la ciudad: si los caminos del agua tienen sentido, las obras deberían estar
más cerca de ellos que una casa cualquiera.

Ejecutar desde la raíz: python scripts/68_anegamientos_terreno.py
"""

import heapq
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
import rasterio
import requests
import shapely
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.vrt import WarpedVRT
from rasterio.warp import transform_bounds

DEM = ROOT / "data/raw/dem/posadas_dem_nino.tif"
EDIFICIOS = ROOT / "data/raw/buildings_merge/posadas_merged_buildings.csv"
IDE = ROOT / "data/raw/ide_posadas"
SALIDA = ROOT / "data/outputs"
WFS = (
    "https://www.ide.posadas.gob.ar/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature"
    "&typeName=geonode:{capa}&outputFormat=application/json&srsName=EPSG:4326"
)
CAPAS = {
    "arroyos": "Arroyos_Posadas00",
    "cuencas": "cuencas_hidrograficas_posadas10",
    "obras_puntos": "obras_hidraulicos_Ejecutadas_gestion",
    "obras_lineas": "obras_hidraulicas_Ejecutadas_linea",
}
CRS = "EPSG:32721"
PIXEL = 30.0
QUEMADO_M = 3.0
APORTE_MIN_HA = 10
CLASES_HA = [(200, "grande"), (50, "medio"), (APORTE_MIN_HA, "chico")]
SOBRE_ARROYO_M = 90  # tres celdas: el cauce del terreno puede correrse del trazado oficial
CERCA_M = 60
VECINOS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def capa_ide(clave, sesion):
    """GeoJSON de la IDE Posadas, guardado con su metadato la primera vez."""
    IDE.mkdir(parents=True, exist_ok=True)
    destino = IDE / f"{CAPAS[clave]}.geojson"
    if not destino.exists():
        url = WFS.format(capa=CAPAS[clave])
        respuesta = sesion.get(url, timeout=180)
        respuesta.raise_for_status()
        datos = respuesta.json()
        destino.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
        (IDE / f"{CAPAS[clave]}.json").write_text(
            json.dumps(
                {
                    "fuente": "IDE Posadas (Municipalidad de Posadas, Dirección de SIG e IDE)",
                    "url": url,
                    "licencia": "No especificada en el servicio",
                    "fecha_descarga": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "n_features": len(datos["features"]),
                },
                ensure_ascii=False,
                indent=1,
            ),
            encoding="utf-8",
        )
    return json.loads(destino.read_text(encoding="utf-8"))


def geometrias_utm(fc):
    a_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    geoms = [shapely.geometry.shape(f["geometry"]) for f in fc["features"] if f.get("geometry")]
    return [
        shapely.transform(g, lambda xy: np.column_stack(a_utm.transform(xy[:, 0], xy[:, 1])))
        for g in geoms
    ]


def terreno():
    """Copernicus GLO-30 en una grilla UTM de 30 m."""
    with rasterio.open(DEM) as src:
        izq, abajo, der, arriba = transform_bounds(src.crs, CRS, *src.bounds)
        x0, y1 = np.ceil(izq / PIXEL) * PIXEL, np.floor(arriba / PIXEL) * PIXEL
        ancho = int((np.floor(der / PIXEL) * PIXEL - x0) / PIXEL)
        alto = int((y1 - np.ceil(abajo / PIXEL) * PIXEL) / PIXEL)
        transform = from_origin(x0, y1, PIXEL, PIXEL)
        with WarpedVRT(
            src,
            crs=CRS,
            transform=transform,
            width=ancho,
            height=alto,
            resampling=Resampling.bilinear,
        ) as vrt:
            z = vrt.read(1).astype("float64")
    z[z < -100] = np.nan
    return z, transform


def rellenar(z):
    """Relleno de depresiones con prioridad y épsilon, desde el borde de la grilla."""
    alto, ancho = z.shape
    lleno = np.full_like(z, np.nan)
    visto = ~np.isfinite(z)
    cola = []
    for i in range(alto):
        for j in (0, ancho - 1):
            if not visto[i, j]:
                visto[i, j] = True
                lleno[i, j] = z[i, j]
                heapq.heappush(cola, (z[i, j], i, j))
    for j in range(1, ancho - 1):
        for i in (0, alto - 1):
            if not visto[i, j]:
                visto[i, j] = True
                lleno[i, j] = z[i, j]
                heapq.heappush(cola, (z[i, j], i, j))
    while cola:
        h, i, j = heapq.heappop(cola)
        for a, b in VECINOS:
            y, x = i + a, j + b
            if 0 <= y < alto and 0 <= x < ancho and not visto[y, x]:
                visto[y, x] = True
                lleno[y, x] = max(z[y, x], h + 1e-4)
                heapq.heappush(cola, (lleno[y, x], y, x))
    return lleno


def direcciones(lleno):
    """Índice de la celda vecina con máxima pendiente (D8); -1 en bordes y sumideros."""
    alto, ancho = lleno.shape
    indice = np.arange(alto * ancho).reshape(alto, ancho)
    destino = np.full(lleno.shape, -1, dtype=np.int64)
    mejor = np.zeros(lleno.shape)
    for a, b in VECINOS:
        vecino = np.full(lleno.shape, np.nan)
        idx = np.full(lleno.shape, -1, dtype=np.int64)
        origen = (slice(max(a, 0), alto + min(a, 0)), slice(max(b, 0), ancho + min(b, 0)))
        aca = (slice(max(-a, 0), alto + min(-a, 0)), slice(max(-b, 0), ancho + min(-b, 0)))
        vecino[aca] = lleno[origen]
        idx[aca] = indice[origen]
        pendiente = np.nan_to_num((lleno - vecino) / (np.hypot(a, b) * PIXEL), nan=-1)
        usar = pendiente > mejor
        mejor[usar] = pendiente[usar]
        destino[usar] = idx[usar]
    return destino


def aporte_ha(lleno, destino):
    orden = np.argsort(-np.nan_to_num(lleno, nan=-1e9).ravel())
    celdas = np.ones(lleno.size)
    abajo = destino.ravel()
    for c in orden:
        if abajo[c] >= 0:
            celdas[abajo[c]] += celdas[c]
    return (celdas * PIXEL * PIXEL / 1e4).reshape(lleno.shape)


def caminos(aporte, destino, transform, tierra, arroyos):
    """Tramos entre centros de celda con aporte ≥ 10 ha, unidos por clase."""
    ancho = aporte.shape[1]
    xs = transform.c + (np.arange(aporte.size) % ancho + 0.5) * PIXEL
    ys = transform.f - (np.arange(aporte.size) // ancho + 0.5) * PIXEL
    planos = aporte.ravel()
    abajo = destino.ravel()
    adentro = tierra.ravel()
    red = shapely.union_all(arroyos).buffer(SOBRE_ARROYO_M)
    por_clase = {(clase, sobre): [] for _, clase in CLASES_HA for sobre in (False, True)}
    for c in np.flatnonzero((planos >= APORTE_MIN_HA) & adentro & (abajo >= 0)):
        d = abajo[c]
        if not adentro[d]:
            continue
        tramo = shapely.LineString([(xs[c], ys[c]), (xs[d], ys[d])])
        clase = next(nombre for minimo, nombre in CLASES_HA if planos[c] >= minimo)
        por_clase[(clase, red.contains(tramo.centroid))].append(tramo)
    a_wgs = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    features, sin_arroyo = [], []
    for (clase, sobre), tramos in por_clase.items():
        if not tramos:
            continue
        unidas = shapely.line_merge(shapely.union_all(tramos)).simplify(PIXEL / 3)
        for linea in getattr(unidas, "geoms", [unidas]):
            if not sobre:
                sin_arroyo.append(linea)
            wgs = shapely.transform(
                linea, lambda xy: np.column_stack(a_wgs.transform(xy[:, 0], xy[:, 1]))
            )
            features.append(
                {
                    "type": "Feature",
                    "properties": {"clase": clase, "sobre_arroyo": sobre},
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[round(x, 5), round(y, 5)] for x, y in wgs.coords],
                    },
                }
            )
    # Las líneas fuera de arroyos, en UTM, son las que se validan contra las obras.
    return features, sin_arroyo


def validar(caminos_utm, obras, tierra_poligono):
    """Proporción de obras y de edificios a menos de 60 m de un camino que no es arroyo."""
    zona = shapely.union_all(caminos_utm).buffer(CERCA_M)
    shapely.prepare(zona)
    obras = [o for o in obras if tierra_poligono.contains(o)]
    edificios = pd.read_csv(EDIFICIOS, usecols=["lat", "lon"])
    a_utm = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
    x, y = a_utm.transform(edificios.lon.values, edificios.lat.values)
    casas = shapely.points(x, y)
    casas = casas[shapely.contains(tierra_poligono, casas)]
    p_obras = float(np.mean(shapely.contains(zona, obras))) if obras else None
    p_casas = float(np.mean(shapely.contains(zona, casas)))
    return {
        "obras": len(obras),
        "edificios": int(len(casas)),
        "obras_cerca_pct": round(100 * p_obras, 1) if p_obras is not None else None,
        "edificios_cerca_pct": round(100 * p_casas, 1),
        "razon": round(p_obras / p_casas, 2) if p_obras and p_casas else None,
    }


def obras_geojson(puntos, lineas):
    features = []
    for f in puntos["features"]:
        p = f["properties"]
        if f.get("geometry") and "idr" in str(p.get("Tipo", "")).lower():
            features.append(
                {
                    "type": "Feature",
                    "properties": {"anio": p.get("A_o"), "lugar": p.get("ubicaci_n")},
                    "geometry": f["geometry"],
                }
            )
    for f in lineas["features"]:
        if f.get("geometry"):
            features.append(
                {
                    "type": "Feature",
                    "properties": {"anio": f["properties"].get("Name")},
                    "geometry": f["geometry"],
                }
            )
    return {"type": "FeatureCollection", "features": features}


def main():
    sesion = requests.Session()
    ide = {clave: capa_ide(clave, sesion) for clave in CAPAS}
    arroyos = geometrias_utm(ide["arroyos"])
    cuencas = shapely.union_all(geometrias_utm(ide["cuencas"]))
    z, transform = terreno()
    cauce = rasterize(
        ((g, 1) for g in arroyos), out_shape=z.shape, transform=transform, all_touched=True
    )
    lleno = rellenar(np.where(cauce == 1, z - QUEMADO_M, z))
    destino = direcciones(lleno)
    aporte = aporte_ha(lleno, destino)
    # Solo el ejido: la unión de las cuencas oficiales deja afuera el río y Encarnación.
    tierra = rasterize([(cuencas, 1)], out_shape=z.shape, transform=transform).astype(bool)
    features, sin_arroyo = caminos(aporte, destino, transform, tierra, arroyos)
    obras = obras_geojson(ide["obras_puntos"], ide["obras_lineas"])
    puntos_obras = [shapely.centroid(g) for g in geometrias_utm(obras)]
    validacion = validar(sin_arroyo, puntos_obras, cuencas)
    SALIDA.mkdir(parents=True, exist_ok=True)
    (SALIDA / "anegamientos_terreno.geojson").write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    (SALIDA / "obras_pluviales.geojson").write_text(
        json.dumps(obras, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metodo": "Relleno de depresiones con prioridad (Barnes et al. 2014), D8 y área de aporte",
        "terreno": "Copernicus GLO-30 2021 (modelo de superficie, 30 m)",
        "cauces": "Arroyos oficiales de la IDE Posadas, marcados 3 m más abajo",
        "aporte_minimo_ha": APORTE_MIN_HA,
        "clases_ha": {nombre: minimo for minimo, nombre in CLASES_HA},
        "validacion_obras": validacion,
        "fuentes": [
            "Copernicus DEM GLO-30 (ESA / Airbus)",
            "IDE Posadas: Arroyos_Posadas00, cuencas_hidrograficas_posadas10, "
            "obras_hidraulicos_Ejecutadas_gestion, obras_hidraulicas_Ejecutadas_linea",
            "Google Open Buildings + Microsoft Building Footprints",
        ],
    }
    (SALIDA / "anegamientos_terreno.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    n_sin = sum(1 for f in features if not f["properties"]["sobre_arroyo"])
    print(
        f"Caminos del agua: {len(features)} líneas ({n_sin} fuera de arroyos). Obras pluviales: "
        f"{len(obras['features'])}. Validación: {validacion}"
    )


if __name__ == "__main__":
    main()
