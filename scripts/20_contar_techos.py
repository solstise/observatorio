"""Conteo de techos e inferencia de fecha de aparición (Tarea 1.6).

Corazón técnico del Observatorio. Para cada edificio detectado por Google Open
Buildings v3 que caiga dentro de alguno de los polígonos de interés, infiere la
primera fecha en la que ese edificio aparece construido en las imágenes
Sentinel-2 históricas.

Algoritmo:

1. Cargar polígonos de interés desde ``config/poligonos.geojson``.
2. Cargar footprints de Google Open Buildings desde
   ``data/raw/google_buildings/posadas_buildings.geojson`` y filtrar por
   ``confidence >= --confidence-min``.
3. Para cada polígono, seleccionar los edificios cuyo centroide cae adentro
   (centroid within).
4. Para cada edificio y cada fecha histórica, abrir el GeoTIFF multiespectral
   ``data/raw/sentinel2/{poligono_id}_{YYYYMM}_multi.tif`` y extraer un parche
   de 3x3 píxeles (~30x30 m a 10 m/pixel) alrededor del centroide.
5. Calcular NDBI = (B11 - B8) / (B11 + B8) y NDVI = (B8 - B4) / (B8 + B4),
   ambos promediados sobre el parche.
6. Se considera "construido" cuando NDBI > --ndbi-threshold Y NDVI <
   --ndvi-threshold. El default (0.0 / 0.3) viene de Zha et al. 2003 y
   literatura de Sentinel-2 para detección urbana en zonas subtropicales.
7. ``fecha_aparicion`` = primera fecha donde se detecta construido, aplicando
   monotonicidad creciente para robustez frente a sombras y variación de
   iluminación (si aparece en T, se asume presente en T+1, T+2, ...).
8. Casos especiales: detectado en la fecha más antigua -> ``"<2018"``; nunca
   detectado -> ``"desconocida"`` y se excluye del conteo temporal.

Honestidad metodológica:

- La precisión de este método cruzado (Open Buildings + NDBI/NDVI Sentinel-2)
  oscila entre 80% y 85% según la literatura publicada (Zhao et al. 2022,
  Sirko et al. 2021). Aplicamos banda ±15% al conteo final.
- El umbral de NDBI es sensible a la estación del año. Para Posadas usamos
  composites de invierno seco (jun-ago), que minimizan el sesgo por vegetación
  estival pero no lo eliminan.
- Suelo desnudo recién desmontado puede dar NDBI alto y NDVI bajo igual que
  una construcción. La mitigación es la intersección con los footprints de
  Open Buildings (que ya son polígonos-edificio detectados por red neuronal).
- Se recomienda siempre validar visualmente una muestra con
  ``notebooks/01_validacion_fase1.ipynb`` antes de publicar cifras.

Salidas:

- ``data/processed/conteos/edificios_con_fecha.csv``
- ``data/processed/conteos/serie_temporal.csv``

Ejemplo de uso::

    python scripts/20_contar_techos.py \\
        --poligonos config/poligonos.geojson \\
        --buildings data/raw/google_buildings/posadas_buildings.geojson \\
        --sentinel-dir data/raw/sentinel2 \\
        --output-dir data/processed/conteos \\
        --ndbi-threshold 0.0 --ndvi-threshold 0.3 --confidence-min 0.70
"""

from __future__ import annotations

import logging
import math
import multiprocessing as mp
import os
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import click
import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.windows import Window
from tqdm import tqdm

# --- Integración con utils del proyecto (si existen) -------------------------

try:
    from scripts.utils.logger import get_logger  # type: ignore
except Exception:  # pragma: no cover - fallback cuando utils todavía no existe
    try:
        from scripts.utils.logger import setup_logger as _setup

        def get_logger(name: str) -> logging.Logger:
            return _setup(name) if callable(_setup) else logging.getLogger(name)

    except Exception:

        def get_logger(name: str) -> logging.Logger:
            logging.basicConfig(
                level=logging.INFO,
                format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
            )
            return logging.getLogger(name)


try:
    from scripts.utils.config import load_settings  # type: ignore
except Exception:  # pragma: no cover

    def load_settings():  # type: ignore
        return None


logger = get_logger(__name__)


# --- Constantes --------------------------------------------------------------

# Orden de bandas en GeoTIFF multiespectral exportado por 01_descarga_sentinel.
# Convención: ["B2", "B3", "B4", "B8", "B11", "B12"] (ver settings.yaml).
BAND_INDEX = {"B2": 1, "B3": 2, "B4": 3, "B8": 4, "B11": 5, "B12": 6}

PATCH_RADIUS_PX = 1  # radio 1 -> ventana 3x3 (3x3 @ 10m = 30x30 m)
CHECKPOINT_EVERY = 50
FECHA_PRE_2018 = "<2018"
FECHA_DESCONOCIDA = "desconocida"
BANDA_ERROR_PCT = 0.15  # ±15% como margen de error declarado


# --- Estructuras -------------------------------------------------------------


@dataclass
class BuildingRecord:
    """Resultado por edificio tras aplicar la regla de aparición."""

    edificio_id: str
    poligono_id: str
    lat: float
    lon: float
    area_m2: float
    fecha_aparicion: str
    confianza_open_buildings: float
    ndbi_max: float
    ndvi_min: float


# --- Utilidades geométricas / IO --------------------------------------------


def _listar_fechas_disponibles(sentinel_dir: Path, poligono_id: str) -> list[str]:
    """Devuelve la lista ordenada de ``YYYYMM`` disponibles para un polígono.

    Busca archivos ``{poligono_id}_{YYYYMM}_multi.tif`` y extrae la fecha.
    """
    prefix = f"{poligono_id}_"
    fechas: list[str] = []
    if not sentinel_dir.exists():
        return fechas
    for archivo in sentinel_dir.glob(f"{prefix}*_multi.tif"):
        stem = archivo.stem  # {poligono}_{YYYYMM}_multi
        partes = stem.split("_")
        # El formato es [..., YYYYMM, "multi"] — buscamos el último token numérico
        # de 6 dígitos antes de "multi".
        if len(partes) >= 3 and partes[-1] == "multi":
            candidato = partes[-2]
            if len(candidato) == 6 and candidato.isdigit():
                fechas.append(candidato)
    return sorted(set(fechas))


def _yyyymm_a_iso(yyyymm: str) -> str:
    """Convierte '202407' -> '2024-07'."""
    return f"{yyyymm[:4]}-{yyyymm[4:6]}"


def _cargar_poligonos(path: Path) -> gpd.GeoDataFrame:
    """Carga polígonos de interés en EPSG:4326."""
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        logger.warning("poligonos.geojson sin CRS — asumiendo EPSG:4326")
        gdf = gdf.set_crs(epsg=4326)
    else:
        gdf = gdf.to_crs(epsg=4326)
    if "id" not in gdf.columns:
        raise ValueError("config/poligonos.geojson debe tener property 'id' en cada feature")
    return gdf


def _cargar_buildings(path: Path, confidence_min: float) -> gpd.GeoDataFrame:
    """Carga footprints de Open Buildings filtrados por confianza."""
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(epsg=4326)
    else:
        gdf = gdf.to_crs(epsg=4326)

    col_conf = None
    for cand in ("confidence", "confianza", "conf"):
        if cand in gdf.columns:
            col_conf = cand
            break
    if col_conf is None:
        logger.warning("No se encontró columna de confianza en buildings; no se filtra por score")
        gdf["confidence"] = np.nan
        col_conf = "confidence"
    else:
        n_antes = len(gdf)
        gdf = gdf[gdf[col_conf].fillna(0) >= confidence_min].copy()
        logger.info(
            f"Filtro confianza >= {confidence_min:.2f}: " f"{n_antes} -> {len(gdf)} edificios"
        )

    # Aseguramos un ID estable.
    col_id = None
    for cand in ("full_plus_code", "building_id", "id", "fid"):
        if cand in gdf.columns:
            col_id = cand
            break
    if col_id is None:
        gdf = gdf.reset_index(drop=True)
        gdf["edificio_id"] = gdf.index.astype(str)
    else:
        gdf["edificio_id"] = gdf[col_id].astype(str)

    gdf = gdf.rename(columns={col_conf: "confianza_open_buildings"})

    # Calculamos area_m2 si no vino del dataset original.
    if "area_in_meters" in gdf.columns:
        gdf["area_m2"] = gdf["area_in_meters"].astype(float)
    elif "area_m2" not in gdf.columns:
        gdf_metric = gdf.to_crs(epsg=32721)
        gdf["area_m2"] = gdf_metric.geometry.area
    return gdf


def _filtrar_edificios_en_poligono(buildings: gpd.GeoDataFrame, poligono_geom) -> gpd.GeoDataFrame:
    """Devuelve los edificios cuyo centroide cae dentro del polígono."""
    centroides = buildings.geometry.centroid
    mascara = centroides.within(poligono_geom)
    subset = buildings.loc[mascara].copy()
    subset["_centroid"] = centroides.loc[mascara]
    subset["lon"] = subset["_centroid"].x
    subset["lat"] = subset["_centroid"].y
    return subset


# --- Extracción de parches y decisión ---------------------------------------


def _leer_parche(
    dataset: rasterio.io.DatasetReader, lon: float, lat: float, radius_px: int
) -> np.ndarray | None:
    """Lee un parche (2*radius+1)^2 píxeles alrededor de (lon, lat).

    Devuelve None si el centroide cae fuera del raster.
    """
    try:
        fila, col = dataset.index(lon, lat)
    except Exception:
        return None
    fila_ini = fila - radius_px
    col_ini = col - radius_px
    ancho = 2 * radius_px + 1
    if (
        fila_ini < 0
        or col_ini < 0
        or fila_ini + ancho > dataset.height
        or col_ini + ancho > dataset.width
    ):
        return None
    window = Window(col_off=col_ini, row_off=fila_ini, width=ancho, height=ancho)
    return dataset.read(window=window)  # shape: (bands, h, w)


def _calcular_indices(parche: np.ndarray) -> tuple[float, float]:
    """Devuelve (ndbi, ndvi) promediados sobre el parche.

    Asume orden de bandas ``[B2, B3, B4, B8, B11, B12]``.
    Maneja valores de reflectancia Sentinel-2 (0-10000 raw o 0-1 escalados).
    Tolera NaN / ceros.
    """
    # Ajuste a float.
    patch = parche.astype(np.float64)
    b4 = patch[BAND_INDEX["B4"] - 1]
    b8 = patch[BAND_INDEX["B8"] - 1]
    b11 = patch[BAND_INDEX["B11"] - 1]

    with np.errstate(divide="ignore", invalid="ignore"):
        ndbi_arr = (b11 - b8) / (b11 + b8)
        ndvi_arr = (b8 - b4) / (b8 + b4)
    ndbi_arr = np.where(np.isfinite(ndbi_arr), ndbi_arr, np.nan)
    ndvi_arr = np.where(np.isfinite(ndvi_arr), ndvi_arr, np.nan)

    ndbi = float(np.nanmean(ndbi_arr)) if np.any(np.isfinite(ndbi_arr)) else float("nan")
    ndvi = float(np.nanmean(ndvi_arr)) if np.any(np.isfinite(ndvi_arr)) else float("nan")
    return ndbi, ndvi


def _procesar_poligono_worker(args: dict) -> list[dict]:
    """Worker para ``multiprocessing.Pool``. Retorna registros por edificio.

    Abre los GeoTIFFs una sola vez por fecha y procesa todos los edificios
    del polígono secuencialmente dentro del worker; así evitamos abrir y
    cerrar el mismo raster N veces.
    """
    poligono_id: str = args["poligono_id"]
    edificios: list[dict] = args["edificios"]
    fechas_yyyymm: list[str] = args["fechas"]
    sentinel_dir: Path = Path(args["sentinel_dir"])
    ndbi_thr: float = args["ndbi_threshold"]
    ndvi_thr: float = args["ndvi_threshold"]

    registros: list[dict] = []
    if not edificios or not fechas_yyyymm:
        return registros

    # Pre-indexamos NDBI/NDVI por edificio y fecha.
    # matriz[fecha_idx][edif_idx] -> (ndbi, ndvi) | None
    n_fechas = len(fechas_yyyymm)
    n_edif = len(edificios)
    ndbi_mat = np.full((n_fechas, n_edif), np.nan, dtype=np.float64)
    ndvi_mat = np.full((n_fechas, n_edif), np.nan, dtype=np.float64)

    for f_idx, yyyymm in enumerate(fechas_yyyymm):
        tif = sentinel_dir / f"{poligono_id}_{yyyymm}_multi.tif"
        if not tif.exists():
            continue
        try:
            with rasterio.open(tif) as ds:
                if ds.count < max(BAND_INDEX.values()):
                    # Si faltan bandas (raster incompleto), se deja NaN.
                    continue
                for e_idx, edif in enumerate(edificios):
                    parche = _leer_parche(ds, edif["lon"], edif["lat"], PATCH_RADIUS_PX)
                    if parche is None:
                        continue
                    ndbi, ndvi = _calcular_indices(parche)
                    ndbi_mat[f_idx, e_idx] = ndbi
                    ndvi_mat[f_idx, e_idx] = ndvi
        except Exception as exc:  # noqa: BLE001
            # Log desde worker con print porque el logger puede estar en otro proceso.
            print(
                f"[worker {poligono_id}] error leyendo {tif.name}: {exc}",
                file=sys.stderr,
            )
            continue

    # Decisión: para cada edificio, buscar primera fecha con NDBI>thr y NDVI<thr,
    # aplicando monotonicidad creciente.
    for e_idx, edif in enumerate(edificios):
        detectado_por_fecha = (ndbi_mat[:, e_idx] > ndbi_thr) & (ndvi_mat[:, e_idx] < ndvi_thr)
        # Monotonicidad: cualquier True propaga hacia adelante.
        detectado_mono = np.maximum.accumulate(detectado_por_fecha.astype(np.int8)).astype(bool)

        if not np.any(detectado_mono):
            fecha_aparicion = FECHA_DESCONOCIDA
        else:
            primer_idx = int(np.argmax(detectado_mono))  # primer True
            yyyymm = fechas_yyyymm[primer_idx]
            anio = int(yyyymm[:4])
            if primer_idx == 0 and anio <= 2018:
                fecha_aparicion = FECHA_PRE_2018
            else:
                fecha_aparicion = _yyyymm_a_iso(yyyymm)

        ndbi_max_val = (
            float(np.nanmax(ndbi_mat[:, e_idx]))
            if np.any(np.isfinite(ndbi_mat[:, e_idx]))
            else float("nan")
        )
        ndvi_min_val = (
            float(np.nanmin(ndvi_mat[:, e_idx]))
            if np.any(np.isfinite(ndvi_mat[:, e_idx]))
            else float("nan")
        )

        registros.append(
            {
                "edificio_id": edif["edificio_id"],
                "poligono_id": poligono_id,
                "lat": edif["lat"],
                "lon": edif["lon"],
                "area_m2": edif["area_m2"],
                "fecha_aparicion": fecha_aparicion,
                "confianza_open_buildings": edif["confianza_open_buildings"],
                "ndbi_max": ndbi_max_val,
                "ndvi_min": ndvi_min_val,
            }
        )

    return registros


# --- Serie temporal ----------------------------------------------------------


def _construir_serie_temporal(
    edificios_df: pd.DataFrame, fechas_por_poligono: dict[str, list[str]]
) -> pd.DataFrame:
    """Genera serie temporal acumulada por polígono con banda de error ±15%.

    Reglas:
    - "<2018" cuenta desde la primera fecha.
    - "desconocida" se excluye del conteo.
    """
    filas: list[dict] = []
    for poligono_id, fechas_yyyymm in fechas_por_poligono.items():
        subset = edificios_df[edificios_df["poligono_id"] == poligono_id]
        if subset.empty:
            continue
        for yyyymm in fechas_yyyymm:
            fecha_iso = _yyyymm_a_iso(yyyymm)
            umbral_iso = fecha_iso
            mask_pre = subset["fecha_aparicion"] == FECHA_PRE_2018
            mask_desc = subset["fecha_aparicion"] == FECHA_DESCONOCIDA
            mask_fecha = (~mask_pre) & (~mask_desc) & (subset["fecha_aparicion"] <= umbral_iso)
            n_estimado = int(mask_pre.sum() + mask_fecha.sum())
            n_min = int(math.floor(n_estimado * (1 - BANDA_ERROR_PCT)))
            n_max = int(math.ceil(n_estimado * (1 + BANDA_ERROR_PCT)))
            filas.append(
                {
                    "poligono_id": poligono_id,
                    "fecha": fecha_iso,
                    "n_edificios_min": n_min,
                    "n_edificios_estimado": n_estimado,
                    "n_edificios_max": n_max,
                }
            )
    return pd.DataFrame(filas)


# --- Checkpointing -----------------------------------------------------------


class _EstadoParcial:
    """Persiste resultados parciales cada CHECKPOINT_EVERY items o cada 60s."""

    def __init__(self, path_csv: Path):
        self.path = path_csv
        self.buffer: list[dict] = []
        self.ultimo_dump = time.time()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def agregar(self, registros: list[dict]) -> None:
        self.buffer.extend(registros)
        ahora = time.time()
        if len(self.buffer) >= CHECKPOINT_EVERY or (ahora - self.ultimo_dump) > 60:
            self.volcar()

    def volcar(self) -> None:
        if not self.buffer:
            return
        df = pd.DataFrame(self.buffer)
        header = not self.path.exists()
        df.to_csv(self.path, mode="a", header=header, index=False, encoding="utf-8")
        self.buffer.clear()
        self.ultimo_dump = time.time()


# --- CLI ---------------------------------------------------------------------


@click.command(
    help=(
        "Infiere la fecha de aparición de cada edificio y genera "
        "edificios_con_fecha.csv y serie_temporal.csv"
    )
)
@click.option(
    "--poligonos",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=Path("config/poligonos.geojson"),
    show_default=True,
)
@click.option(
    "--buildings",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    # Preferimos el merge Google + MS (script 42) porque cubre 100% del bbox
    # con 217k edificios, mientras que `google_buildings/` históricamente
    # quedaba acotado al cuadrante NW (cuando se descargó con bbox chico).
    # Si el merge no existe, fallback al raw de Google.
    default=Path("data/raw/buildings_merge/posadas_merged_buildings.geojson"),
    show_default=True,
)
@click.option(
    "--sentinel-dir",
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    default=Path("data/raw/sentinel2"),
    show_default=True,
)
@click.option(
    "--output-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("data/processed/conteos"),
    show_default=True,
)
@click.option("--ndbi-threshold", type=float, default=0.0, show_default=True)
@click.option("--ndvi-threshold", type=float, default=0.3, show_default=True)
@click.option("--confidence-min", type=float, default=0.70, show_default=True)
@click.option(
    "--workers",
    type=int,
    default=0,
    help="Cantidad de workers (0 = auto = cpu_count-1)",
)
@click.option(
    "--skip-cache",
    is_flag=True,
    default=False,
    help="Ignora edificios_con_fecha.csv preexistente y rehace todo",
)
def cli(
    poligonos: Path,
    buildings: Path,
    sentinel_dir: Path,
    output_dir: Path,
    ndbi_threshold: float,
    ndvi_threshold: float,
    confidence_min: float,
    workers: int,
    skip_cache: bool,
) -> None:
    """Entry point CLI — ver docstring del módulo para detalles."""
    t0 = time.time()
    logger.info("=" * 60)
    logger.info("Observatorio Posadas — Conteo de techos (Tarea 1.6)")
    logger.info("=" * 60)
    logger.info("Parámetros:")
    logger.info(f"  poligonos       = {poligonos}")
    logger.info(f"  buildings       = {buildings}")
    logger.info(f"  sentinel_dir    = {sentinel_dir}")
    logger.info(f"  output_dir      = {output_dir}")
    logger.info(f"  ndbi_threshold  = {ndbi_threshold:.3f}")
    logger.info(f"  ndvi_threshold  = {ndvi_threshold:.3f}")
    logger.info(f"  confidence_min  = {confidence_min:.2f}")
    logger.info(f"  workers         = {workers or 'auto'}")
    logger.info("Honestidad: precisión ~80-85%% según literatura, aplicamos banda ±15%% al conteo.")

    output_dir.mkdir(parents=True, exist_ok=True)
    out_edificios = output_dir / "edificios_con_fecha.csv"
    out_serie = output_dir / "serie_temporal.csv"

    if out_edificios.exists() and not skip_cache:
        logger.info(
            f"Encontrado cache {out_edificios} — rehacemos la serie temporal "
            f"a partir de él. Usá --skip-cache para forzar recomputo completo."
        )
        try:
            edificios_df = pd.read_csv(out_edificios)
            fechas_por_pol_cache: dict[str, list[str]] = {}
            for pol_id in edificios_df["poligono_id"].unique():
                fechas_por_pol_cache[pol_id] = _listar_fechas_disponibles(sentinel_dir, pol_id)
            serie_df = _construir_serie_temporal(edificios_df, fechas_por_pol_cache)
            serie_df.to_csv(out_serie, index=False, encoding="utf-8")
            logger.info(
                f"Serie temporal regenerada desde cache: {len(serie_df)} filas " f"-> {out_serie}"
            )
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Falló la lectura de cache ({exc}). Se recomputa todo.")

    # Si hay cache previo pero queremos recomputar, limpiamos para no appendear.
    # Windows/WSL a veces bloquea unlink por Defender / procesos que abrieron
    # el CSV — hacemos retry + truncate como fallback para no abortar.
    if out_edificios.exists():
        import time as _time

        for _intento in range(3):
            try:
                out_edificios.unlink()
                break
            except PermissionError:
                _time.sleep(0.5)
        else:
            # Truncate in-place si unlink seguía fallando.
            with out_edificios.open("w", encoding="utf-8") as _fh:
                _fh.truncate(0)
            logger.warning(f"No pude hacer unlink de {out_edificios}, lo vacié con truncate.")

    # --- Cargar polígonos y edificios ---
    try:
        poligonos_gdf = _cargar_poligonos(poligonos)
        buildings_gdf = _cargar_buildings(buildings, confidence_min=confidence_min)
    except Exception as exc:
        logger.exception(f"Error cargando inputs: {exc}")
        sys.exit(1)

    # Construimos jobs.
    jobs: list[dict] = []
    fechas_por_pol: dict[str, list[str]] = {}
    total_edif = 0
    for _, fila_pol in poligonos_gdf.iterrows():
        pol_id = str(fila_pol["id"])
        pol_geom = fila_pol.geometry
        subset = _filtrar_edificios_en_poligono(buildings_gdf, pol_geom)
        fechas_pol = _listar_fechas_disponibles(sentinel_dir, pol_id)
        if not fechas_pol:
            logger.warning(
                f"Polígono '{pol_id}' no tiene GeoTIFFs multi en {sentinel_dir} — se salta"
            )
            continue
        fechas_por_pol[pol_id] = fechas_pol
        edificios_lista = [
            {
                "edificio_id": str(r["edificio_id"]),
                "lat": float(r["lat"]),
                "lon": float(r["lon"]),
                "area_m2": float(r.get("area_m2", 0.0) or 0.0),
                "confianza_open_buildings": float(r.get("confianza_open_buildings", 0.0) or 0.0),
            }
            for _, r in subset.iterrows()
        ]
        total_edif += len(edificios_lista)
        jobs.append(
            {
                "poligono_id": pol_id,
                "edificios": edificios_lista,
                "fechas": fechas_pol,
                "sentinel_dir": str(sentinel_dir),
                "ndbi_threshold": ndbi_threshold,
                "ndvi_threshold": ndvi_threshold,
            }
        )
        logger.info(
            f"Polígono '{pol_id}': {len(edificios_lista)} edificios, "
            f"{len(fechas_pol)} fechas disponibles"
        )

    if not jobs:
        logger.error("No hay jobs para procesar. Verificá polígonos y GeoTIFFs.")
        sys.exit(1)

    logger.info(f"Total edificios a procesar: {total_edif} sobre {len(jobs)} polígonos")

    # --- Paralelización ---
    n_workers = workers if workers and workers > 0 else max(1, (os.cpu_count() or 2) - 1)
    logger.info(f"Workers = {n_workers}")

    estado = _EstadoParcial(out_edificios)

    def _handler(signum, frame):  # noqa: ANN001
        logger.warning(f"Interrupción ({signum}) — volcando estado parcial y saliendo.")
        estado.volcar()
        sys.exit(130)

    signal.signal(signal.SIGINT, _handler)
    try:
        signal.signal(signal.SIGTERM, _handler)
    except Exception:  # pragma: no cover - Windows console edge cases
        pass

    try:
        if n_workers == 1:
            # Ejecución serial, útil para debugging.
            for job in tqdm(jobs, desc="Procesando polígonos"):
                registros = _procesar_poligono_worker(job)
                estado.agregar(registros)
        else:
            with mp.Pool(processes=n_workers) as pool:
                for registros in tqdm(
                    pool.imap_unordered(_procesar_poligono_worker, jobs),
                    total=len(jobs),
                    desc="Procesando polígonos",
                ):
                    estado.agregar(registros)
    finally:
        estado.volcar()

    # --- Relectura + serie temporal ---
    if not out_edificios.exists():
        logger.error("No se generó ningún resultado. Aborto.")
        sys.exit(2)

    edificios_df = pd.read_csv(out_edificios)
    logger.info(f"Edificios con fecha: {len(edificios_df)} filas -> {out_edificios}")

    n_pre = int((edificios_df["fecha_aparicion"] == FECHA_PRE_2018).sum())
    n_desc = int((edificios_df["fecha_aparicion"] == FECHA_DESCONOCIDA).sum())
    n_datados = len(edificios_df) - n_pre - n_desc
    logger.info(
        f"Desglose: {n_pre} preexistentes (<2018), {n_desc} desconocidos "
        f"(excluidos), {n_datados} datados"
    )
    if n_desc and len(edificios_df):
        pct_desc = 100.0 * n_desc / len(edificios_df)
        if pct_desc > 20:
            logger.warning(
                f"{pct_desc:.1f}% edificios marcados 'desconocida' — revisá "
                f"umbrales o cobertura de GeoTIFFs multiespectrales."
            )

    serie_df = _construir_serie_temporal(edificios_df, fechas_por_pol)
    serie_df.to_csv(out_serie, index=False, encoding="utf-8")
    logger.info(f"Serie temporal: {len(serie_df)} filas -> {out_serie}")

    logger.info(f"Duración total: {time.time() - t0:.1f}s")
    logger.info("Fin Tarea 1.6.")


if __name__ == "__main__":
    cli()
