"""I/O geoespacial y helpers de caché para el Observatorio Urbano Posadas.

Funciones chicas, sin estado, reutilizables en los scripts de descarga
y procesamiento. Todo basado en geopandas + shapely + pyproj.

Funciones:
    - load_geojson / save_geojson: leer y escribir FeatureCollections.
    - reproject_to_utm: reproyectar a EPSG:32721 (UTM 21S) para cálculos métricos.
    - hash_file: MD5 de un archivo (streaming, no carga todo en memoria).
    - cache_check: saber si un archivo ya existe (y opcionalmente validar su hash).
    - bbox_from_gdf: bounding box agregado de un GeoDataFrame.
    - split_polygon_into_tiles: dividir polígonos grandes en tiles para EE export.
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path
from typing import List, Optional, Tuple, Union

import geopandas as gpd
from shapely.geometry import Polygon, box

from scripts.utils.paths import ensure_parent, resolve_path

PathLike = Union[str, Path]

# EPSG oficial del proyecto para cálculos métricos (UTM 21S, WGS84).
EPSG_UTM_POSADAS = 32721


# ---------------------------------------------------------------------------
# Carga / guardado
# ---------------------------------------------------------------------------


def load_geojson(path: PathLike) -> gpd.GeoDataFrame:
    """Carga un GeoJSON como GeoDataFrame.

    Args:
        path: Ruta al .geojson (relativa o absoluta).

    Returns:
        GeoDataFrame con CRS correcto (por default EPSG:4326 si no viene declarado).

    Raises:
        FileNotFoundError: si el archivo no existe.
    """
    p = resolve_path(path)
    if not p.exists():
        raise FileNotFoundError(f"No se encontró el GeoJSON: {p}")
    gdf = gpd.read_file(p)
    # Si el GeoJSON no declaró CRS, asumimos WGS84 (convención OGC).
    if gdf.crs is None:
        gdf.set_crs(epsg=4326, inplace=True)
    return gdf


def save_geojson(
    gdf: gpd.GeoDataFrame,
    path: PathLike,
    driver: str = "GeoJSON",
) -> Path:
    """Guarda un GeoDataFrame como GeoJSON (EPSG:4326 por convención).

    Args:
        gdf: GeoDataFrame a serializar.
        path: Ruta destino.
        driver: Driver de fiona/pyogrio. Default GeoJSON.

    Returns:
        Path absoluto del archivo escrito.
    """
    p = ensure_parent(path)
    # GeoJSON estándar es en WGS84. Reproyectamos si hace falta.
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    gdf.to_file(p, driver=driver)
    return p


# ---------------------------------------------------------------------------
# Reproyección
# ---------------------------------------------------------------------------


def reproject_to_utm(
    gdf: gpd.GeoDataFrame,
    epsg: int = EPSG_UTM_POSADAS,
) -> gpd.GeoDataFrame:
    """Reproyecta un GeoDataFrame a un CRS métrico (default UTM 21S).

    Necesario para cálculos de área, distancia o buffer en metros.

    Args:
        gdf: GeoDataFrame a reproyectar.
        epsg: Código EPSG destino. Default 32721 (UTM zona 21S — Posadas).

    Returns:
        GeoDataFrame reproyectado (nuevo objeto, no in-place).
    """
    if gdf.crs is None:
        # Asumimos WGS84 si no declara nada. Si no, to_crs falla.
        gdf = gdf.set_crs(epsg=4326)
    return gdf.to_crs(epsg=epsg)


# ---------------------------------------------------------------------------
# Hashing y cache
# ---------------------------------------------------------------------------


def hash_file(path: PathLike, algo: str = "md5", chunk_size: int = 8192) -> str:
    """Calcula el hash hexadecimal de un archivo en streaming.

    Args:
        path: Ruta al archivo.
        algo: Algoritmo (md5, sha256...). Default md5 — suficiente para cache.
        chunk_size: Tamaño del buffer de lectura.

    Returns:
        Digest hexadecimal en minúsculas.

    Raises:
        FileNotFoundError: si el archivo no existe.
    """
    p = resolve_path(path)
    if not p.exists():
        raise FileNotFoundError(f"No existe el archivo para hashear: {p}")
    h = hashlib.new(algo)
    with p.open("rb") as fh:
        for block in iter(lambda: fh.read(chunk_size), b""):
            h.update(block)
    return h.hexdigest()


def cache_check(
    path: PathLike,
    expected_hash: Optional[str] = None,
    algo: str = "md5",
) -> bool:
    """Chequea si un archivo está en caché (existe) y opcionalmente valida su hash.

    Args:
        path: Ruta al archivo a verificar.
        expected_hash: Si se pasa, se valida el MD5 contra este valor.
        algo: Algoritmo a usar si se pasa expected_hash.

    Returns:
        True si el archivo existe (y matchea hash si se pidió). False caso contrario.
    """
    p = resolve_path(path)
    if not p.exists() or p.stat().st_size == 0:
        return False
    if expected_hash is None:
        return True
    try:
        return hash_file(p, algo=algo).lower() == expected_hash.lower()
    except Exception:
        # Si falla el hash, tratamos como cache miss (conservador).
        return False


# ---------------------------------------------------------------------------
# Geometrías y tiling
# ---------------------------------------------------------------------------


def bbox_from_gdf(gdf: gpd.GeoDataFrame) -> Tuple[float, float, float, float]:
    """Devuelve el bounding box total del GeoDataFrame en su CRS actual.

    Args:
        gdf: GeoDataFrame.

    Returns:
        Tupla (minx, miny, maxx, maxy).
    """
    minx, miny, maxx, maxy = gdf.total_bounds
    return float(minx), float(miny), float(maxx), float(maxy)


def estimate_pixels(
    polygon: Polygon,
    resolution_m: float = 10.0,
    epsg_metric: int = EPSG_UTM_POSADAS,
    polygon_crs_epsg: int = 4326,
) -> int:
    """Estima la cantidad de pixeles que cubriría un polígono a cierta resolución.

    Útil para decidir si usar `getDownloadURL` (límite ~33M pixeles) o exportar
    en tiles. Reproyecta a CRS métrico, calcula el área del bbox y divide por
    resolución al cuadrado.

    Args:
        polygon: Polígono en CRS polygon_crs_epsg.
        resolution_m: Resolución en metros/pixel. Sentinel-2 RGB = 10.
        epsg_metric: CRS métrico para el cálculo.
        polygon_crs_epsg: CRS de entrada del polígono.

    Returns:
        Estimación de cantidad de pixeles.
    """
    gdf = gpd.GeoDataFrame(geometry=[polygon], crs=f"EPSG:{polygon_crs_epsg}")
    gdf_m = gdf.to_crs(epsg=epsg_metric)
    minx, miny, maxx, maxy = gdf_m.total_bounds
    width_m = maxx - minx
    height_m = maxy - miny
    return int(math.ceil(width_m / resolution_m) * math.ceil(height_m / resolution_m))


def split_polygon_into_tiles(
    polygon: Polygon,
    max_pixels: int = 30_000_000,
    resolution_m: float = 10.0,
    polygon_crs_epsg: int = 4326,
    epsg_metric: int = EPSG_UTM_POSADAS,
) -> List[Polygon]:
    """Divide un polígono en tiles que no excedan `max_pixels` por tile.

    Si el polígono es chico, devuelve una lista de un solo elemento.
    Usa grid uniforme sobre el bbox reproyectado a métrico y devuelve cada
    celda intersectada con el polígono original. Los tiles se devuelven en CRS
    de entrada (polygon_crs_epsg) para que EE los acepte directamente.

    Args:
        polygon: Polígono en CRS polygon_crs_epsg.
        max_pixels: Techo de pixeles por tile (default 30M < límite EE 33M).
        resolution_m: Metros por pixel.
        polygon_crs_epsg: CRS del polígono de entrada.
        epsg_metric: CRS métrico para cálculos.

    Returns:
        Lista de polígonos (tiles) en el CRS de entrada.
    """
    total = estimate_pixels(polygon, resolution_m, epsg_metric, polygon_crs_epsg)
    if total <= max_pixels:
        return [polygon]

    # Cuántas divisiones hacemos por lado (grid cuadrado aproximado).
    n_tiles = math.ceil(total / max_pixels)
    n_side = math.ceil(math.sqrt(n_tiles))

    # Reproyecto a métrico para cortar de forma uniforme.
    gdf = gpd.GeoDataFrame(geometry=[polygon], crs=f"EPSG:{polygon_crs_epsg}")
    gdf_m = gdf.to_crs(epsg=epsg_metric)
    minx, miny, maxx, maxy = gdf_m.total_bounds

    step_x = (maxx - minx) / n_side
    step_y = (maxy - miny) / n_side

    tiles_m: List[Polygon] = []
    poly_m = gdf_m.geometry.iloc[0]
    for i in range(n_side):
        for j in range(n_side):
            x0 = minx + i * step_x
            y0 = miny + j * step_y
            x1 = x0 + step_x
            y1 = y0 + step_y
            cell = box(x0, y0, x1, y1)
            inter = cell.intersection(poly_m)
            if not inter.is_empty:
                # Solo tiles no triviales.
                if inter.area > 0:
                    tiles_m.append(inter)

    # Reproyecto los tiles de vuelta al CRS de entrada.
    tiles_gdf = gpd.GeoDataFrame(geometry=tiles_m, crs=f"EPSG:{epsg_metric}")
    tiles_back = tiles_gdf.to_crs(epsg=polygon_crs_epsg)
    return list(tiles_back.geometry)


__all__ = [
    "EPSG_UTM_POSADAS",
    "bbox_from_gdf",
    "cache_check",
    "estimate_pixels",
    "hash_file",
    "load_geojson",
    "reproject_to_utm",
    "save_geojson",
    "split_polygon_into_tiles",
]
