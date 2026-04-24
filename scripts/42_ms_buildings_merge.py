"""Descarga Microsoft Building Footprints (Argentina) y mergea con Google Open Buildings.

Complemento opcional a la Tarea 1.5. Microsoft publica ~2.8M footprints
actualizados de Argentina generados con ML (modelo de Bing Maps). Al
cruzarlos con los ~116k de Google Open Buildings v3 descargados
previamente, ganamos **recall** (edificios que Google no detectó) a
costa de riesgo de falsos positivos.

Fuente
------
Global ML Building Footprints (activamente mantenido, enero 2025):

    https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv

Estructura: archivos ``.csv.gz`` particionados por ``RegionName`` y
``quadkey`` (tile Bing a zoom 9). Cada fila del CSV index tiene columnas
``Location, QuadKey, Url, Size, UploadDate``. El contenido de cada
``.csv.gz`` es GeoJSONL (una línea = una feature/geometry GeoJSON).

Se elige este endpoint sobre:
  - ``legacy/southamerica/Argentina.geojsonl.zip``: NO cubre Misiones
    (rango longitudinal -70.27 a -57.56, Posadas está en -55.90).
  - Planetary Computer STAC: requiere ``adlfs`` / tokens Azure.

Repositorio con metadata:
    https://github.com/microsoft/GlobalMLBuildingFootprints

Honestidad metodológica
-----------------------
* Microsoft Building Footprints y Google Open Buildings son ambos
  pseudo-ground-truth derivados de modelos de segmentación sobre
  imágenes satelitales. Ninguno es un catastro oficial.
* El merge mejora **recall** (detecta más edificios reales) pero NO
  mejora **precision**: un falso positivo de cualquiera de las dos
  fuentes sobrevive al merge.
* El threshold de IoU 0.3 es deliberadamente conservador (preferimos
  mantener duplicados dudosos a perder edificios reales). Con 0.3, dos
  polígonos que compartan ~30% de área se colapsan en uno. Si se busca
  mayor conservadurismo (menos deduplicación), subir a 0.5 o 0.7.
* Los IDs sintéticos ``building_id`` del merge NO son estables entre
  corridas: dependen del orden de aparición. Para joins estables usar
  ``geometry_wkt`` o el ``building_id`` original de la fuente.
* El quadkey tile a z=9 cubre ~78 x 78 km a la latitud de Posadas, más
  que suficiente para toda el área urbana. Si la bbox se extiende a
  zonas más amplias, el script detecta y baja múltiples tiles.

Ejemplo de uso
--------------
    python scripts/42_ms_buildings_merge.py
    python scripts/42_ms_buildings_merge.py --iou-threshold 0.5 --force
    python scripts/42_ms_buildings_merge.py --poligonos config/poligonos.geojson
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import shutil
import sys
import traceback
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import click
import mercantile
from loguru import logger
from tqdm import tqdm

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
import sys as _sys
from pathlib import Path as _Path
_p = _Path(__file__).resolve().parent
while _p != _p.parent:
    if (_p / "pyproject.toml").exists():
        if str(_p) not in _sys.path:
            _sys.path.insert(0, str(_p))
        break
    _p = _p.parent
# --- fin del parche ---------------------------------------------------------

from scripts.utils.config import Settings, load_settings
from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.io_geo import (
    EPSG_UTM_POSADAS,
    cache_check,
    hash_file,
    reproject_to_utm,
)
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, ensure_parent, resolve_path


SCRIPT_VERSION = "0.2.0"

# Endpoint oficial del Global ML Building Footprints — mantenido, actualizado 2025.
# El CSV index mapea RegionName + QuadKey → URL directo de shard .csv.gz.
MS_DATASET_LINKS_URL = (
    "https://minedbuildings.z5.web.core.windows.net/"
    "global-buildings/dataset-links.csv"
)

# Zoom del esquema de quadkeys usado por MS para particionar los shards.
# Level 9 → tiles de ~78 × 78 km a -27° de latitud.
MS_QUADKEY_ZOOM = 9

# Path por defecto al GeoJSON de Google ya descargado por scripts/03_descarga_buildings.py.
GOOGLE_GEOJSON_DEFAULT = "data/raw/google_buildings/posadas_buildings.geojson"

# Chunk size para descarga streaming.
_DOWNLOAD_CHUNK_BYTES = 1024 * 1024  # 1 MiB

# Países sudamericanos candidatos cuando la bbox cruza fronteras (Posadas está
# pegada a Paraguay). Priorizamos Argentina; el filtrado por bbox descartará
# features de otros países si no están dentro del AOI.
MS_COUNTRIES_SUDAMERICA = (
    "Argentina",
    "Paraguay",
    "Brazil",
    "Uruguay",
    "Bolivia",
    "Chile",
)


# ---------------------------------------------------------------------------
# Bbox y selección
# ---------------------------------------------------------------------------


def _parsear_bbox(
    bbox_cli: Optional[str], settings: Settings
) -> Tuple[float, float, float, float]:
    """Parsea bbox desde CLI o settings. Devuelve (oeste, sur, este, norte).

    Args:
        bbox_cli: String ``"oeste,sur,este,norte"`` o None para usar settings.yaml.
        settings: Settings cargado.

    Returns:
        Tupla (oeste, sur, este, norte) en grados decimales.
    """
    if bbox_cli:
        partes = [float(x.strip()) for x in bbox_cli.split(",")]
        if len(partes) != 4:
            raise click.BadParameter("bbox debe tener 4 valores: oeste,sur,este,norte")
        return tuple(partes)  # type: ignore[return-value]
    return settings.geografia.bbox.as_tuple()


def _bbox_desde_poligonos(poligonos_path: Path) -> Tuple[float, float, float, float]:
    """Deriva bbox (oeste, sur, este, norte) a partir de un GeoJSON de polígonos.

    Args:
        poligonos_path: Path al GeoJSON.

    Returns:
        Tupla (oeste, sur, este, norte) = total_bounds.
    """
    import geopandas as gpd

    gdf = gpd.read_file(poligonos_path)
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    oeste, sur, este, norte = gdf.total_bounds
    return float(oeste), float(sur), float(este), float(norte)


# ---------------------------------------------------------------------------
# Descarga y filtro de shards Microsoft (vía quadkeys)
# ---------------------------------------------------------------------------


def _descargar_stream(url: str, destino: Path, desc: Optional[str] = None) -> None:
    """Descarga un URL a un archivo en streaming, con progreso via tqdm.

    Args:
        url: URL a descargar.
        destino: Path destino (directorio padre ya debe existir).
        desc: Descripción opcional para tqdm (default: nombre del archivo).
    """
    req = urllib.request.Request(url, headers={"User-Agent": "observatorio-posadas/0.2"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        total = int(resp.headers.get("Content-Length", 0) or 0)
        with destino.open("wb") as fh, tqdm(
            total=total,
            unit="B",
            unit_scale=True,
            unit_divisor=1024,
            desc=desc or f"Descargando {destino.name}",
            leave=False,
        ) as pbar:
            while True:
                chunk = resp.read(_DOWNLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                fh.write(chunk)
                pbar.update(len(chunk))


def _quadkeys_para_bbox(
    bbox: Tuple[float, float, float, float],
    zoom: int = MS_QUADKEY_ZOOM,
) -> List[str]:
    """Calcula la lista de quadkeys Bing que cubren el bbox al zoom dado.

    Args:
        bbox: (oeste, sur, este, norte) en WGS84.
        zoom: Nivel de zoom del esquema de tiles (9 para MS Global Buildings).

    Returns:
        Lista de quadkeys (strings) ordenados por (x, y) del tile.
    """
    oeste, sur, este, norte = bbox
    tiles = list(mercantile.tiles(oeste, sur, este, norte, zooms=[zoom]))
    quadkeys = [mercantile.quadkey(t) for t in tiles]
    return quadkeys


def _descargar_dataset_links(destino: Path, force: bool = False) -> Path:
    """Descarga el CSV index ``dataset-links.csv`` de MS (o usa caché).

    Args:
        destino: Path donde cachear el CSV.
        force: Si True, re-descarga aunque exista.

    Returns:
        Path al CSV cacheado.
    """
    if cache_check(destino) and not force:
        logger.info(f"dataset-links.csv en caché ({destino.stat().st_size / 1e6:.1f} MB). Skip.")
        return destino
    logger.info(f"Descargando {MS_DATASET_LINKS_URL}")
    ensure_parent(destino)
    _descargar_stream(MS_DATASET_LINKS_URL, destino, desc="dataset-links.csv")
    return destino


def _resolver_shards_mss(
    dataset_links_csv: Path,
    quadkeys: Sequence[str],
    countries: Sequence[str] = MS_COUNTRIES_SUDAMERICA,
) -> List[Tuple[str, str, str, str]]:
    """Busca en el CSV index las rows que matchean con los quadkeys buscados.

    Args:
        dataset_links_csv: Path al CSV index descargado.
        quadkeys: Lista de quadkeys a buscar (strings).
        countries: Lista de RegionName a considerar. Por default sudamericanas.

    Returns:
        Lista de tuplas (country, quadkey, url, size_str) — una por shard match.
    """
    qk_set = set(quadkeys)
    country_set = set(countries)
    matches: List[Tuple[str, str, str, str]] = []
    with dataset_links_csv.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            if row.get("QuadKey") in qk_set and row.get("Location") in country_set:
                matches.append(
                    (
                        row["Location"],
                        row["QuadKey"],
                        row["Url"],
                        row.get("Size", ""),
                    )
                )
    return matches


def _procesar_shard_csvgz(
    shard_path: Path,
    bbox: Tuple[float, float, float, float],
    out_fh,
    primero_ref: List[bool],
) -> Tuple[int, int]:
    """Lee un shard ``.csv.gz`` de MS y escribe features dentro del bbox al GeoJSON abierto.

    El contenido de cada ``.csv.gz`` es un CSV de 1+ columnas donde la columna
    de geometría (``geometry``) tiene un GeoJSON Polygon/MultiPolygon string.
    Alternativamente, algunos shards traen directamente ``geojson`` como string.

    Args:
        shard_path: Path al shard descargado (.csv.gz).
        bbox: (oeste, sur, este, norte) filtro espacial.
        out_fh: File handle abierto donde se va escribiendo el GeoJSON resultante.
        primero_ref: Lista con un bool mutable. Se usa para saber si la siguiente
            feature es la primera (no poner coma delante) o no.

    Returns:
        Tupla (features_en_shard_procesados, features_dentro_de_bbox).
    """
    oeste, sur, este, norte = bbox
    n_total = 0
    n_match = 0

    with gzip.open(shard_path, "rt", encoding="utf-8", newline="") as fh:
        # Los shards MS pueden venir como:
        #   (a) CSV con header (columnas típicas: geometry,type,...).
        #   (b) GeoJSONL "disfrazado" de CSV (cada línea es un JSON).
        # Probamos leer la primera línea para detectar.
        first_line = fh.readline()
        if not first_line:
            return 0, 0

        first_stripped = first_line.strip()
        is_json_first = first_stripped.startswith("{")

        if is_json_first:
            # GeoJSONL puro. Procesamos la primera línea también.
            linea = first_stripped
            while linea is not None:
                n_total += 1
                match, feat_json = _linea_a_feature_si_intersecta(
                    linea, oeste, sur, este, norte
                )
                if match and feat_json:
                    if not primero_ref[0]:
                        out_fh.write(",")
                    out_fh.write(feat_json)
                    primero_ref[0] = False
                    n_match += 1
                linea = fh.readline()
                if not linea:
                    break
                linea = linea.strip()
                if not linea:
                    linea = ""
        else:
            # CSV con header. Buscamos la columna geometry.
            fh.seek(0)
            reader = csv.DictReader(fh)
            geom_col = _detectar_columna_geometria(reader.fieldnames or [])
            if geom_col is None:
                logger.warning(
                    f"Shard {shard_path.name}: no encontré columna de geometría. "
                    f"Campos: {reader.fieldnames}"
                )
                return 0, 0
            for row in reader:
                n_total += 1
                linea = row.get(geom_col, "")
                if not linea:
                    continue
                match, feat_json = _linea_a_feature_si_intersecta(
                    linea, oeste, sur, este, norte
                )
                if match and feat_json:
                    if not primero_ref[0]:
                        out_fh.write(",")
                    out_fh.write(feat_json)
                    primero_ref[0] = False
                    n_match += 1

    return n_total, n_match


def _detectar_columna_geometria(fields: Iterable[str]) -> Optional[str]:
    """Detecta la columna que contiene geometría GeoJSON en un shard CSV.

    Args:
        fields: Nombres de columnas del CSV.

    Returns:
        Nombre de la columna de geometría o None si no se detecta.
    """
    # Orden de preferencia.
    candidatos = ["geometry", "geojson", "the_geom"]
    fields_lower = {f.lower(): f for f in fields}
    for c in candidatos:
        if c in fields_lower:
            return fields_lower[c]
    return None


def _linea_a_feature_si_intersecta(
    linea: str,
    oeste: float,
    sur: float,
    este: float,
    norte: float,
) -> Tuple[bool, Optional[str]]:
    """Parsea una línea JSON (Feature o Geometry) y chequea intersección con bbox.

    Args:
        linea: Contenido JSON (trimmed).
        oeste, sur, este, norte: Filtro bbox.

    Returns:
        Tupla (intersecta, feature_json_str). Si no matchea o no parsea,
        devuelve (False, None).
    """
    try:
        obj = json.loads(linea)
    except json.JSONDecodeError:
        return False, None
    tipo = obj.get("type")
    if tipo == "Feature":
        geom = obj.get("geometry")
        feat_json = linea
    elif tipo in ("Polygon", "MultiPolygon"):
        geom = obj
        feat_json = json.dumps(
            {"type": "Feature", "geometry": obj, "properties": {}},
            ensure_ascii=False,
        )
    else:
        return False, None
    if not geom:
        return False, None
    bounds = _bounds_from_geojson_geom(geom)
    if bounds is None:
        return False, None
    gx0, gy0, gx1, gy1 = bounds
    if gx1 < oeste or gx0 > este or gy1 < sur or gy0 > norte:
        return False, None
    return True, feat_json


def _descargar_y_filtrar_shards(
    shards: Sequence[Tuple[str, str, str, str]],
    bbox: Tuple[float, float, float, float],
    shards_dir: Path,
    output_geojson: Path,
    keep_shards: bool,
) -> int:
    """Descarga cada shard, filtra por bbox y compone un GeoJSON resultante.

    Args:
        shards: Lista de tuplas (country, quadkey, url, size_str) a bajar.
        bbox: Filtro espacial (oeste, sur, este, norte).
        shards_dir: Directorio donde cachear los .csv.gz.
        output_geojson: Path de salida del GeoJSON filtrado.
        keep_shards: Si True, no borra los .csv.gz tras procesar.

    Returns:
        Cantidad total de features que quedaron dentro del bbox.
    """
    ensure_dir(shards_dir)
    ensure_parent(output_geojson)
    total_in_bbox = 0
    total_seen = 0

    with output_geojson.open("w", encoding="utf-8") as out:
        out.write('{"type":"FeatureCollection","name":"ms_buildings_posadas",')
        out.write('"crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}},')
        out.write('"features":[')
        primero_ref: List[bool] = [True]

        for country, qk, url, size_str in tqdm(shards, desc="Shards MS"):
            shard_filename = f"{country}_{qk}.csv.gz"
            shard_path = shards_dir / shard_filename
            if not cache_check(shard_path):
                try:
                    _descargar_stream(
                        url,
                        shard_path,
                        desc=f"{country} quadkey={qk} ({size_str})",
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        f"Falló descarga de shard {country}/{qk}: {exc}. Continuo con el resto."
                    )
                    continue
            try:
                n_seen, n_match = _procesar_shard_csvgz(shard_path, bbox, out, primero_ref)
            except Exception as exc:  # noqa: BLE001
                logger.error(f"Error procesando shard {country}/{qk}: {exc}")
                continue
            total_seen += n_seen
            total_in_bbox += n_match
            logger.info(
                f"Shard {country}/{qk}: {n_seen:,} features leídas, {n_match:,} en bbox"
            )
            if not keep_shards and shard_path.exists():
                shard_path.unlink()

        out.write("]}")

    logger.info(
        f"MS Buildings: {total_in_bbox:,} features dentro del bbox "
        f"(de {total_seen:,} leídas en {len(shards)} shards)"
    )
    return total_in_bbox


def _bounds_from_geojson_geom(geom: dict) -> Optional[Tuple[float, float, float, float]]:
    """Calcula (minx, miny, maxx, maxy) de una geometría GeoJSON sin shapely.

    Soporta Polygon y MultiPolygon (los únicos tipos que aparecen en MS
    Building Footprints). Devuelve None si la estructura es inesperada.

    Args:
        geom: Dict con claves ``type`` y ``coordinates``.

    Returns:
        Tupla con bbox o None si no se pudo calcular.
    """
    tipo = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return None
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    try:
        if tipo == "Polygon":
            rings = coords
        elif tipo == "MultiPolygon":
            # Aplanamos todos los polígonos.
            rings = [ring for poly in coords for ring in poly]
        else:
            return None
        for ring in rings:
            for pt in ring:
                x, y = pt[0], pt[1]
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
    except (TypeError, ValueError, IndexError):
        return None
    if minx == float("inf"):
        return None
    return minx, miny, maxx, maxy


# ---------------------------------------------------------------------------
# Merge con Google Open Buildings
# ---------------------------------------------------------------------------


def _cargar_google(geojson_path: Path):
    """Carga el GeoJSON de Google Open Buildings y normaliza columnas al schema merge.

    Args:
        geojson_path: Path al archivo de Google.

    Returns:
        GeoDataFrame con columnas: geometry, area_m2, confidence_google, source.
    """
    import geopandas as gpd

    logger.info(f"Cargando Google Open Buildings desde {geojson_path}")
    gdf = gpd.read_file(geojson_path)
    logger.info(f"Google: {len(gdf):,} edificios")

    # Normalizamos. `03_descarga_buildings.py` guarda columnas:
    # building_id, lat, lon, area_m2, confidence, geometry.
    if "confidence" in gdf.columns:
        gdf = gdf.rename(columns={"confidence": "confidence_google"})
    else:
        gdf["confidence_google"] = None
    if "area_m2" not in gdf.columns:
        gdf["area_m2"] = None
    gdf["source"] = "google"
    return gdf


def _cargar_microsoft(geojson_path: Path):
    """Carga el GeoJSON recortado de MS y normaliza columnas al schema merge.

    Args:
        geojson_path: Path al GeoJSON recortado por bbox.

    Returns:
        GeoDataFrame con columnas: geometry, area_m2, confidence_google, source.
    """
    import geopandas as gpd

    logger.info(f"Cargando Microsoft Buildings desde {geojson_path}")
    gdf = gpd.read_file(geojson_path)
    logger.info(f"Microsoft: {len(gdf):,} edificios")

    # MS no trae confidence explícita en la export legacy. Dejamos None.
    gdf["confidence_google"] = None
    # MS trae campo "height" a veces, pero no "area". Lo calculamos en UTM.
    if "area_m2" not in gdf.columns:
        gdf["area_m2"] = None
    gdf["source"] = "microsoft"
    return gdf


def _merge_por_iou(
    gdf_google,
    gdf_ms,
    iou_threshold: float,
):
    """Merge espacial de dos GeoDataFrames con deduplicación por IoU en EPSG:32721.

    Estrategia:
        1. Reproyectar ambos a EPSG:32721 (UTM 21S) para cálculos métricos.
        2. Calcular área de cada polígono.
        3. Hacer un spatial join ``google ↔ ms`` con predicado ``intersects``.
        4. Para cada par candidato, calcular IoU = inter/union.
        5. Si IoU >= threshold: es el mismo edificio → source = "both".
        6. El "ganador" (el que queda con su geometría) es el de mayor
           ``confidence_google`` si existe, si no el de mayor área.
        7. Los MS que no matchean con ningún Google son "microsoft" (nuevos).
        8. Los Google que no matchean con ningún MS son "google" (ya estaban).

    Args:
        gdf_google: GeoDataFrame de Google (normalizado).
        gdf_ms: GeoDataFrame de Microsoft (normalizado).
        iou_threshold: Umbral IoU para considerar match (default 0.3).

    Returns:
        GeoDataFrame mergeado con columnas:
            building_id, source, lat, lon, area_m2, confidence_google, geometry_wkt, geometry.
    """
    import geopandas as gpd
    import pandas as pd

    logger.info("Reproyectando a EPSG:32721 para cálculos métricos...")
    g_utm = reproject_to_utm(gdf_google.copy(), epsg=EPSG_UTM_POSADAS)
    m_utm = reproject_to_utm(gdf_ms.copy(), epsg=EPSG_UTM_POSADAS)

    g_utm["__idx_g"] = range(len(g_utm))
    m_utm["__idx_m"] = range(len(m_utm))

    # Áreas métricas siempre recomputadas en UTM (las que trae Google son compatibles
    # pero MS las calculamos nosotros).
    g_utm["area_m2"] = g_utm.geometry.area
    m_utm["area_m2"] = m_utm.geometry.area

    logger.info(
        f"Spatial join (intersects) — Google={len(g_utm):,} × MS={len(m_utm):,}"
    )
    # Spatial index-accelerated join. Devuelve 1 fila por par intersectante.
    pares = gpd.sjoin(
        g_utm[["__idx_g", "geometry"]],
        m_utm[["__idx_m", "geometry"]],
        how="inner",
        predicate="intersects",
    )
    logger.info(f"Pares candidatos (intersects): {len(pares):,}")

    # Reset name collisions: pandas agrega 'index_right' en sjoin.
    if "index_right" in pares.columns:
        pares = pares.drop(columns=["index_right"])

    # Calculamos IoU por par. Usamos el geometry del lado izquierdo (Google)
    # y el geometry del ms por índice. Sin Python loop: vectorizamos con geopandas.
    logger.info("Calculando IoU por par (puede tardar)...")
    pares = pares.reset_index(drop=True)
    geom_g = g_utm.set_index("__idx_g").geometry
    geom_m = m_utm.set_index("__idx_m").geometry

    # Alinear geometrías por índice.
    left_geoms = geom_g.loc[pares["__idx_g"].values].reset_index(drop=True)
    right_geoms = geom_m.loc[pares["__idx_m"].values].reset_index(drop=True)

    # shapely vectorizado: intersection/union area.
    inter_areas = left_geoms.intersection(right_geoms, align=False).area
    union_areas = left_geoms.union(right_geoms, align=False).area
    # Evitamos div/0 (poco probable pero por si hay geom degenerada).
    iou = inter_areas / union_areas.replace(0, 1e-9)
    pares["iou"] = iou.values

    match_mask = pares["iou"] >= iou_threshold
    pares_match = pares[match_mask].copy()
    logger.info(
        f"Pares con IoU >= {iou_threshold}: {len(pares_match):,} "
        f"(descartados {int((~match_mask).sum()):,} por IoU bajo)"
    )

    # Resolución many-to-many: un Google puede matchear con varios MS y viceversa.
    # Política: cada edificio fuente (google o ms) sólo puede aparecer en UN match.
    # Para cada lado, nos quedamos con el match de mayor IoU.
    pares_match = pares_match.sort_values("iou", ascending=False)
    pares_match = pares_match.drop_duplicates(subset="__idx_g", keep="first")
    pares_match = pares_match.drop_duplicates(subset="__idx_m", keep="first")
    logger.info(
        f"Matches 1:1 resueltos (greedy por IoU): {len(pares_match):,}"
    )

    idx_g_matched = set(pares_match["__idx_g"].tolist())
    idx_m_matched = set(pares_match["__idx_m"].tolist())

    # --- Registros finales ---------------------------------------------------
    filas: List[dict] = []

    # 1) Google+MS matched ("both"). Ganador = mayor confidence, desempate = mayor área.
    logger.info("Armando registros para matches 'both'...")
    for _, row in tqdm(
        pares_match.iterrows(), total=len(pares_match), desc="matches both"
    ):
        gi = int(row["__idx_g"])
        mi = int(row["__idx_m"])
        g_row = g_utm.iloc[gi]
        m_row = m_utm.iloc[mi]

        conf_g = g_row.get("confidence_google")
        conf_g_val = float(conf_g) if conf_g is not None and not _es_nan(conf_g) else None
        area_g = float(g_row["area_m2"])
        area_m = float(m_row["area_m2"])

        # Ganador: el que tenga mayor confidence (Google la tiene, MS no).
        # Si MS eventualmente trajera confidence, se compararía. Con MS=None,
        # Google siempre gana por su confidence. Si Google no tiene confidence
        # (raro), desempatamos por área.
        if conf_g_val is not None:
            geom_winner = g_row.geometry
            area_winner = area_g
        elif area_g >= area_m:
            geom_winner = g_row.geometry
            area_winner = area_g
        else:
            geom_winner = m_row.geometry
            area_winner = area_m

        filas.append(
            {
                "source": "both",
                "confidence_google": conf_g_val,
                "area_m2": area_winner,
                "geometry": geom_winner,
            }
        )

    # 2) Google solo.
    logger.info("Armando registros para 'google' únicos...")
    g_unicos = g_utm[~g_utm["__idx_g"].isin(idx_g_matched)]
    for _, g_row in tqdm(
        g_unicos.iterrows(), total=len(g_unicos), desc="google únicos"
    ):
        conf_g = g_row.get("confidence_google")
        conf_g_val = float(conf_g) if conf_g is not None and not _es_nan(conf_g) else None
        filas.append(
            {
                "source": "google",
                "confidence_google": conf_g_val,
                "area_m2": float(g_row["area_m2"]),
                "geometry": g_row.geometry,
            }
        )

    # 3) Microsoft solo.
    logger.info("Armando registros para 'microsoft' únicos...")
    m_unicos = m_utm[~m_utm["__idx_m"].isin(idx_m_matched)]
    for _, m_row in tqdm(
        m_unicos.iterrows(), total=len(m_unicos), desc="microsoft únicos"
    ):
        filas.append(
            {
                "source": "microsoft",
                "confidence_google": None,
                "area_m2": float(m_row["area_m2"]),
                "geometry": m_row.geometry,
            }
        )

    logger.info(f"Total filas pre-merge: {len(filas):,}")

    # Armamos GeoDataFrame en UTM y reproyectamos a WGS84 para output.
    gdf_merge_utm = gpd.GeoDataFrame(filas, geometry="geometry", crs=f"EPSG:{EPSG_UTM_POSADAS}")
    # building_id sintético estable por orden (no estable entre corridas, documentado en docstring).
    gdf_merge_utm["building_id"] = [f"b_{i:08d}" for i in range(len(gdf_merge_utm))]

    # Centroides calculados en UTM (CRS métrico, resultado correcto) y luego reproyectados.
    centroides_utm = gdf_merge_utm.geometry.centroid
    centroides_wgs = centroides_utm.to_crs(epsg=4326)

    gdf_merge_wgs = gdf_merge_utm.to_crs(epsg=4326)
    gdf_merge_wgs["lon"] = centroides_wgs.x.values
    gdf_merge_wgs["lat"] = centroides_wgs.y.values

    # geometry_wkt para joins externos estables (independiente del formato de salida).
    gdf_merge_wgs["geometry_wkt"] = gdf_merge_wgs.geometry.apply(lambda g: g.wkt)

    # Ordenamos columnas.
    cols = [
        "building_id",
        "source",
        "lat",
        "lon",
        "area_m2",
        "confidence_google",
        "geometry_wkt",
        "geometry",
    ]
    gdf_merge_wgs = gdf_merge_wgs[cols]
    return gdf_merge_wgs, len(pares_match), len(g_unicos), len(m_unicos)


def _es_nan(v) -> bool:
    """True si el valor es NaN float (pandas suele poner NaN en lugar de None)."""
    try:
        return v != v  # truco clásico: NaN != NaN
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Output principal
# ---------------------------------------------------------------------------


def _escribir_outputs(
    gdf_merge,
    out_dir: Path,
    resumen: dict,
) -> Tuple[Path, Path, Path]:
    """Escribe GeoJSON + CSV sidecar + resumen JSON.

    Args:
        gdf_merge: GeoDataFrame final (WGS84).
        out_dir: Directorio de salida.
        resumen: Dict de metadata/contadores.

    Returns:
        Tupla (geojson_path, csv_path, resumen_path).
    """
    import pandas as pd

    ensure_dir(out_dir)
    geojson_path = out_dir / "posadas_merged_buildings.geojson"
    csv_path = out_dir / "posadas_merged_buildings.csv"
    resumen_path = out_dir / "posadas_merged_buildings.resumen.json"

    logger.info(f"Escribiendo {geojson_path} ({len(gdf_merge):,} features)...")
    gdf_merge.to_file(geojson_path, driver="GeoJSON")

    logger.info(f"Escribiendo CSV sidecar {csv_path}...")
    df_csv = gdf_merge.drop(columns=["geometry"]).copy()
    df_csv.to_csv(csv_path, index=False)

    resumen["md5_geojson"] = hash_file(geojson_path)
    resumen["md5_csv"] = hash_file(csv_path)
    with resumen_path.open("w", encoding="utf-8") as fh:
        json.dump(resumen, fh, ensure_ascii=False, indent=2, default=str)

    return geojson_path, csv_path, resumen_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--poligonos",
    "poligonos_path",
    default=None,
    type=click.Path(exists=True, dir_okay=False),
    help=(
        "Path a GeoJSON de polígonos. Si se pasa, el bbox se deriva de total_bounds. "
        "Menor prioridad que --bbox."
    ),
)
@click.option(
    "--bbox",
    "bbox_cli",
    default=None,
    help="BBox 'oeste,sur,este,norte'. Si se omite, usa settings.yaml.",
)
@click.option(
    "--google-geojson",
    "google_path",
    default=GOOGLE_GEOJSON_DEFAULT,
    show_default=True,
    help="Path al GeoJSON de Google Open Buildings (output de 03_descarga_buildings.py).",
)
@click.option(
    "--ms-cache",
    "ms_cache_path",
    default="data/raw/ms_buildings/posadas_ms_buildings.geojson",
    show_default=True,
    help="Path donde cachear el GeoJSON recortado de Microsoft.",
)
@click.option(
    "--ms-shards-dir",
    "ms_shards_dir",
    default="data/raw/ms_buildings/shards/",
    show_default=True,
    help="Directorio donde cachear los shards .csv.gz descargados (Country_quadkey.csv.gz).",
)
@click.option(
    "--ms-dataset-links",
    "ms_dataset_links_path",
    default="data/raw/ms_buildings/dataset-links.csv",
    show_default=True,
    help="Path donde cachear el CSV index de MS (~3 MB).",
)
@click.option(
    "--ms-countries",
    "ms_countries_csv",
    default=",".join(MS_COUNTRIES_SUDAMERICA),
    show_default=True,
    help=(
        "Países MS a considerar (CSV). Por default sudamericanos; Argentina "
        "prioritario pero shards de Paraguay/Brasil también son útiles si la "
        "bbox incluye zona de frontera."
    ),
)
@click.option(
    "--output-dir",
    "output_dir",
    default="data/raw/buildings_merge/",
    show_default=True,
    help="Directorio de salida para el merge.",
)
@click.option(
    "--iou-threshold",
    "iou_threshold",
    default=0.3,
    show_default=True,
    type=float,
    help="Umbral de IoU (intersection/union) para considerar dos polígonos el mismo edificio.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Forzar re-descarga y re-merge aunque existan archivos en caché.",
)
@click.option(
    "--keep-shards",
    is_flag=True,
    default=False,
    help="Conservar los shards .csv.gz descargados (por default se borran tras filtrar).",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    poligonos_path: Optional[str],
    bbox_cli: Optional[str],
    google_path: str,
    ms_cache_path: str,
    ms_shards_dir: str,
    ms_dataset_links_path: str,
    ms_countries_csv: str,
    output_dir: str,
    iou_threshold: float,
    force: bool,
    keep_shards: bool,
    log_level: str,
) -> None:
    """Descarga MS Building Footprints y mergea con Google Open Buildings."""
    setup_logger(nivel=log_level.upper())
    settings = load_settings()

    # --- Resolver bbox: --bbox > --poligonos > settings.yaml -----------------
    if bbox_cli is None and poligonos_path is not None:
        oeste, sur, este, norte = _bbox_desde_poligonos(Path(poligonos_path))
        bbox_cli = f"{oeste},{sur},{este},{norte}"
        logger.info(f"BBox derivado de --poligonos: {bbox_cli}")
    bbox = _parsear_bbox(bbox_cli, settings)

    google_geojson = resolve_path(google_path)
    ms_geojson = ensure_parent(resolve_path(ms_cache_path))
    ms_shards = ensure_dir(resolve_path(ms_shards_dir))
    dataset_links_csv = ensure_parent(resolve_path(ms_dataset_links_path))
    out_dir = ensure_dir(resolve_path(output_dir))
    merged_geojson = out_dir / "posadas_merged_buildings.geojson"

    countries = tuple(c.strip() for c in ms_countries_csv.split(",") if c.strip())

    logger.info("=" * 60)
    logger.info("Merge MS Buildings + Google Open Buildings — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"BBox (O,S,E,N):      {bbox}")
    logger.info(f"Google GeoJSON:      {google_geojson}")
    logger.info(f"MS cache recortado:  {ms_geojson}")
    logger.info(f"MS shards dir:       {ms_shards}")
    logger.info(f"MS dataset-links:    {dataset_links_csv}")
    logger.info(f"MS countries:        {countries}")
    logger.info(f"Output dir:          {out_dir}")
    logger.info(f"IoU threshold:       {iou_threshold}")
    logger.info(f"Force:               {force}")

    # --- Idempotencia global (si todo el merge ya existe) -------------------
    if cache_check(merged_geojson) and not force:
        logger.info(
            f"El merge ya existe en {merged_geojson}. Skip (usá --force para rehacer)."
        )
        md5 = hash_file(merged_geojson)
        logger.info(f"MD5 merge existente: {md5}")
        sys.exit(0)

    if not google_geojson.exists():
        logger.error(
            f"No existe el GeoJSON de Google: {google_geojson}. "
            f"Corré primero scripts/03_descarga_buildings.py."
        )
        sys.exit(2)

    with graceful_interrupt() as state:
        marker = merged_geojson.with_suffix(".parcial.marker")

        def _marcar_parcial() -> None:
            ensure_parent(marker)
            marker.write_text(
                f"Interrupción: {datetime.now().isoformat()}", encoding="utf-8"
            )

        state.on_interrupt(_marcar_parcial)

        # --- Paso 1: descargar CSV index de MS -----------------------------
        try:
            _descargar_dataset_links(dataset_links_csv, force=force)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló descarga de dataset-links.csv: {exc}")
            logger.debug(traceback.format_exc())
            sys.exit(3)

        # --- Paso 2: calcular quadkeys del bbox y filtrar el CSV index -----
        quadkeys = _quadkeys_para_bbox(bbox, zoom=MS_QUADKEY_ZOOM)
        logger.info(f"Quadkeys @ z={MS_QUADKEY_ZOOM} que cubren el bbox: {quadkeys}")
        shards = _resolver_shards_mss(
            dataset_links_csv, quadkeys, countries=countries
        )
        logger.info(f"Shards MS a descargar: {len(shards)}")
        for s in shards:
            logger.info(f"  - {s[0]} / quadkey={s[1]} / size={s[3]}")
        if not shards:
            logger.warning(
                "No se encontraron shards MS para el bbox. El merge quedará sólo con Google."
            )

        # --- Paso 3: descargar shards y filtrar por bbox -------------------
        if cache_check(ms_geojson) and not force:
            logger.info(f"GeoJSON MS recortado ya existe en caché. Skip filtrado.")
        else:
            try:
                n_ms = _descargar_y_filtrar_shards(
                    shards, bbox, ms_shards, ms_geojson, keep_shards
                )
            except Exception as exc:  # noqa: BLE001
                logger.error(f"Falló descarga/filtrado de shards MS: {exc}")
                logger.debug(traceback.format_exc())
                sys.exit(4)
            logger.info(f"Features MS en bbox: {n_ms:,}")

        # --- Paso 4: cargar ambos datasets ---------------------------------
        try:
            gdf_g = _cargar_google(google_geojson)
            gdf_m = _cargar_microsoft(ms_geojson)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló carga de datasets: {exc}")
            logger.debug(traceback.format_exc())
            sys.exit(5)

        n_google = len(gdf_g)
        n_microsoft = len(gdf_m)

        # --- Paso 5: merge espacial con dedup IoU --------------------------
        try:
            gdf_merge, n_both, n_g_unicos, n_m_unicos = _merge_por_iou(
                gdf_g, gdf_m, iou_threshold
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló merge IoU: {exc}")
            logger.debug(traceback.format_exc())
            sys.exit(6)

        # --- Paso 6: escribir outputs --------------------------------------
        resumen = {
            "version_script": SCRIPT_VERSION,
            "timestamp": datetime.now().isoformat(),
            "bbox": list(bbox),
            "iou_threshold": iou_threshold,
            "fuente_google": str(google_geojson),
            "fuente_microsoft": MS_DATASET_LINKS_URL,
            "ms_quadkeys": quadkeys,
            "ms_shards": [
                {"country": c, "quadkey": q, "url": u, "size": s}
                for (c, q, u, s) in shards
            ],
            "total_google": n_google,
            "total_microsoft": n_microsoft,
            "overlap_both": n_both,
            "google_unicos": n_g_unicos,
            "microsoft_unicos": n_m_unicos,
            "total_merged": len(gdf_merge),
            "nota_metodologica": (
                "El merge mejora recall (detecta más edificios reales) pero NO "
                "mejora precision: falsos positivos de cualquiera de las dos "
                "fuentes sobreviven. IoU 0.3 es conservador."
            ),
        }

        try:
            geojson_path, csv_path, resumen_path = _escribir_outputs(
                gdf_merge, out_dir, resumen
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló escritura de outputs: {exc}")
            logger.debug(traceback.format_exc())
            sys.exit(7)

        # Limpiamos callbacks de interrupt — la corrida fue exitosa, no hay
        # estado parcial que persistir en atexit.
        state.callbacks.clear()
        marker.unlink(missing_ok=True)

        # --- Reporte final -------------------------------------------------
        logger.info("=" * 60)
        logger.info("Merge completado.")
        logger.info(f"Google (total en bbox):         {n_google:,}")
        logger.info(f"Microsoft (total en bbox):      {n_microsoft:,}")
        logger.info(f"Overlap (IoU >= {iou_threshold}):         {n_both:,}")
        logger.info(f"Únicos Google:                  {n_g_unicos:,}")
        logger.info(f"Únicos Microsoft (nuevos):      {n_m_unicos:,}")
        logger.info(f"Total post-merge:               {len(gdf_merge):,}")
        logger.info("-" * 60)
        logger.info(f"GeoJSON: {geojson_path}")
        logger.info(f"CSV:     {csv_path}")
        logger.info(f"Resumen: {resumen_path}")
        logger.info(f"MD5 GeoJSON: {resumen['md5_geojson']}")
        logger.info("=" * 60)

    sys.exit(0)


if __name__ == "__main__":
    main()
