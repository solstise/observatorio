"""Backscatter Sentinel-1 (SAR) como proxy de cambios estructurales.

Dataset: ``COPERNICUS/S1_GRD`` — Sentinel-1 Ground Range Detected, bandas
VV y VH en polarización dual, modo IW, 10m de resolución, revisita 6-12
días sobre Argentina. Disponible desde **octubre 2014**.

Para cada (polígono, fecha-objetivo) se construye un composite temporal
(media en dominio lineal, reexpresado a dB al final) dentro de una
ventana de ±45 días, filtrando por:

- ``orbitProperties_pass == DESCENDING`` (consistencia geométrica entre
  fechas — descendente es la pasada de mañana en Sudamérica).
- ``instrumentMode == IW`` (Interferometric Wide — modo estándar tierra).
- ``transmitterReceiverPolarisation`` incluye VV y VH.

Métricas reportadas
-------------------
- ``s1_vv_mean_db``: media espacial de VV (dB).
- ``s1_vh_mean_db``: media espacial de VH (dB).
- ``s1_cross_ratio``: VV - VH (dB). Valores altos correlacionan con
  superficies duras lisas (asfalto, techos); valores bajos con volumen
  vegetal (bosque, cultivos).
- ``delta_vv_mean_db``: VV_actual - VV_anterior (dB). Diferencia respecto
  de la fecha anterior presente en la lista para el mismo polígono.
  Proxy de *cambio estructural*.

Honestidad metodológica
-----------------------
SAR backscatter **no es directamente interpretable como "cambio urbano"**.
El valor de VV/VH sube con:

- Superficies duras y rugosas (edificios, asfalto con grano).
- Reflectores corner (intersecciones calle-pared perpendiculares).
- Contenido de humedad del suelo (en rural puede subir varios dB con lluvia).

Y baja con:

- Superficies lisas y mojadas (agua quieta, techos húmedos recién caído).
- Sombras topográficas y cambios de ángulo de incidencia.

Consecuencias prácticas:

- Un ``delta_vv > 1 dB`` entre dos fechas **típicamente** indica edificación
  nueva o modificación estructural significativa, pero **requiere validación
  visual** contra imágenes ópticas (Sentinel-2 o Planet) porque también
  puede disparar por eventos de humedad/inundación.
- La comparación temporal es válida solo entre composites de la **misma
  órbita** (por eso filtramos DESCENDING en todos los runs) y condiciones
  de humedad razonablemente similares (ventana ±45 días promedia eventos
  puntuales).
- ``cross_ratio`` (VV-VH) es más estable frente a humedad superficial que
  los valores absolutos; es un buen complemento.

Ejemplo de uso::

    # Defaults (lee fechas de settings.yaml)
    python scripts/43_sentinel1_cambios.py

    # Smoke test
    python scripts/43_sentinel1_cambios.py --fechas 2024-07

    # Reprocesar todo
    python scripts/43_sentinel1_cambios.py --force
"""

from __future__ import annotations

import math
import sys

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
import sys as _sys
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from pathlib import Path as _Path
from typing import Any, Dict, List, Optional, Tuple

import click
import pandas as pd
from loguru import logger
from tqdm import tqdm

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
from scripts.utils.io_geo import load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, ensure_parent, resolve_path

SCRIPT_VERSION = "0.1.0"

# Asset y configuración.
S1_ASSET = "COPERNICUS/S1_GRD"
ORBIT_PASS = "DESCENDING"
INSTRUMENT_MODE = "IW"

# Ventana temporal a cada lado de la fecha-objetivo (días).
VENTANA_DIAS = 45

# Resolución en metros para reducers (nominal de S1 GRD).
ESCALA_S1_M = 10

# Columnas de salida del CSV, en orden.
CSV_COLUMNS = [
    "poligono_id",
    "fecha",
    "s1_vv_mean_db",
    "s1_vh_mean_db",
    "s1_cross_ratio",
    "delta_vv_mean_db",
    "n_imagenes_vv",
    "n_imagenes_vh",
    "version_script",
    "fecha_calculo",
]


# ---------------------------------------------------------------------------
# Earth Engine helpers
# ---------------------------------------------------------------------------


def inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine con manejo de errores explícito.

    Args:
        project_id: Project ID de Google Cloud. None acepta el default del ADC.

    Raises:
        SystemExit: si falla la inicialización.
    """
    try:
        import ee
    except ImportError as exc:
        logger.error("earthengine-api no está instalado. Corré: pip install earthengine-api")
        raise SystemExit(1) from exc

    sa_key = __import__("os").environ.get("EE_SERVICE_ACCOUNT_KEY")
    try:
        if sa_key and Path(sa_key).exists():
            credentials = ee.ServiceAccountCredentials(None, sa_key)
            ee.Initialize(credentials)
        elif project_id:
            ee.Initialize(project=project_id)
        else:
            ee.Initialize()
        logger.info(
            f"Earth Engine inicializado "
            f"{'(proyecto ' + project_id + ')' if project_id else '(proyecto default)'}"
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló ee.Initialize(): {exc}")
        logger.error(
            "Ejecutá primero `python scripts/test_ee_auth.py --project PROJECT_ID` "
            "y resolvé los errores de autenticación antes de intentar descargar."
        )
        raise SystemExit(1) from exc


def _rango_fechas(fecha_target: str, ventana_dias: int = VENTANA_DIAS) -> Tuple[str, str]:
    """Devuelve (inicio, fin) YYYY-MM-DD interpretando fecha_target como el día 15."""
    fecha_centro = datetime.strptime(fecha_target + "-15", "%Y-%m-%d")
    inicio = (fecha_centro - timedelta(days=ventana_dias)).strftime("%Y-%m-%d")
    fin = (fecha_centro + timedelta(days=ventana_dias)).strftime("%Y-%m-%d")
    return inicio, fin


def _coleccion_s1(geom, fecha_target: str, polarizacion: str) -> Tuple[Any, int]:
    """Filtra S1_GRD para geom, fecha±ventana, DESCENDING/IW y polarización dada.

    S1_GRD está en **dB** en el archivo de EE (ya se aplicó log). Para
    hacer composite temporal correctamente hay que convertir a potencia
    lineal, promediar, y volver a dB — eso lo hace ``_composite_mean_db``.

    Args:
        geom: ``ee.Geometry`` del polígono.
        fecha_target: ``YYYY-MM``.
        polarizacion: ``"VV"`` o ``"VH"``.

    Returns:
        Tupla (coleccion, n_imagenes).
    """
    import ee

    inicio, fin = _rango_fechas(fecha_target)
    coleccion = (
        ee.ImageCollection(S1_ASSET)
        .filterBounds(geom)
        .filterDate(inicio, fin)
        .filter(ee.Filter.eq("orbitProperties_pass", ORBIT_PASS))
        .filter(ee.Filter.eq("instrumentMode", INSTRUMENT_MODE))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", polarizacion))
        .select([polarizacion])
    )
    n = int(coleccion.size().getInfo())
    return coleccion, n


def _db_a_lineal(image):
    """Convierte una imagen en dB a potencia lineal: 10**(dB/10)."""
    import ee

    return ee.Image(10).pow(image.divide(10))


def _lineal_a_db(image):
    """Convierte una imagen en potencia lineal a dB: 10*log10(lin)."""

    return image.log10().multiply(10)


def _composite_mean_db(coleccion, geom, banda: str) -> Optional[float]:
    """Media espacial de la banda (dB) sobre el polígono, promediando en lineal.

    El pipeline correcto es:
    1. Convertir cada imagen de dB → potencia lineal.
    2. Promediar temporalmente (media por píxel).
    3. Reducir espacialmente con media sobre el polígono.
    4. Convertir el escalar resultante de lineal → dB.

    Esto respeta la naturaleza multiplicativa del backscatter y evita el
    sesgo de promediar en dominio logarítmico.

    Args:
        coleccion: ``ee.ImageCollection`` con la banda deseada.
        geom: ``ee.Geometry`` del polígono.
        banda: Nombre de la banda (``"VV"`` o ``"VH"``).

    Returns:
        Media espacial en dB, o None si no hay datos.
    """
    import ee

    lineal = coleccion.map(_db_a_lineal)
    composite_lineal = lineal.mean().rename(banda)

    try:
        stats = composite_lineal.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=ESCALA_S1_M,
            maxPixels=1e9,
            bestEffort=True,
        ).getInfo()
    except Exception as exc:  # noqa: BLE001
        logger.error(f"   reduceRegion({banda}) falló: {exc}")
        return None

    val_lineal = stats.get(banda)
    if val_lineal is None or val_lineal <= 0:
        return None
    return float(10.0 * math.log10(val_lineal))


# ---------------------------------------------------------------------------
# I/O CSV
# ---------------------------------------------------------------------------


def _cargar_csv_existente(output_path: Path) -> pd.DataFrame:
    """Carga el CSV existente o devuelve un DataFrame vacío con el esquema esperado."""
    if output_path.exists() and output_path.stat().st_size > 0:
        try:
            df = pd.read_csv(output_path)
            if "poligono_id" in df.columns and "fecha" in df.columns:
                df["poligono_id"] = df["poligono_id"].astype(str)
                df["fecha"] = df["fecha"].astype(str)
                return df
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"CSV existente ilegible ({exc}), se recreará.")
    return pd.DataFrame(columns=CSV_COLUMNS)


def _key_existe(df: pd.DataFrame, poligono_id: str, fecha: str) -> bool:
    """Indica si la combinación (poligono, fecha) ya tiene fila en el CSV."""
    if df.empty:
        return False
    match = (df["poligono_id"] == poligono_id) & (df["fecha"] == fecha)
    return bool(match.any())


def _guardar_csv(df: pd.DataFrame, output_path: Path) -> None:
    """Escribe el CSV respetando el orden de columnas."""
    ensure_parent(output_path)
    cols = [c for c in CSV_COLUMNS if c in df.columns]
    extras = [c for c in df.columns if c not in CSV_COLUMNS]
    df_out = df[cols + extras].copy()
    df_out.to_csv(output_path, index=False, encoding="utf-8")
    logger.info(f"CSV guardado ({len(df_out)} filas) → {output_path}")


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def _parsear_fechas(fechas_cli: Optional[str], settings: Settings) -> List[str]:
    """Devuelve la lista de fechas target desde CLI o settings.yaml."""
    if fechas_cli:
        return [f.strip() for f in fechas_cli.split(",") if f.strip()]
    return settings.sentinel2.fechas_target


def _procesar(
    poligono_id: str,
    geometry_geojson: dict,
    fecha_target: str,
) -> Dict[str, Any]:
    """Calcula las métricas S1 para una combinación (polígono, fecha).

    Args:
        poligono_id: Slug del polígono.
        geometry_geojson: GeoJSON dict del polígono.
        fecha_target: YYYY-MM.

    Returns:
        Dict con el esquema de fila del CSV (delta_vv queda en None acá;
        se calcula a posteriori con la serie completa).
    """
    import ee

    base_fila = {
        "poligono_id": poligono_id,
        "fecha": fecha_target,
        "s1_vv_mean_db": None,
        "s1_vh_mean_db": None,
        "s1_cross_ratio": None,
        "delta_vv_mean_db": None,
        "n_imagenes_vv": 0,
        "n_imagenes_vh": 0,
        "version_script": SCRIPT_VERSION,
        "fecha_calculo": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
    }

    try:
        ee_geom = ee.Geometry(geometry_geojson)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[{poligono_id}|{fecha_target}] Geometría inválida: {exc}")
        return base_fila

    col_vv, n_vv = _coleccion_s1(ee_geom, fecha_target, "VV")
    col_vh, n_vh = _coleccion_s1(ee_geom, fecha_target, "VH")
    logger.info(
        f"[{poligono_id}|{fecha_target}] S1 {ORBIT_PASS}/{INSTRUMENT_MODE} "
        f"ventana ±{VENTANA_DIAS}d → n_VV={n_vv} n_VH={n_vh}"
    )

    base_fila["n_imagenes_vv"] = n_vv
    base_fila["n_imagenes_vh"] = n_vh

    if n_vv == 0 and n_vh == 0:
        logger.warning(f"[{poligono_id}|{fecha_target}] Sin imágenes S1 disponibles.")
        return base_fila

    vv_db = _composite_mean_db(col_vv, ee_geom, "VV") if n_vv > 0 else None
    vh_db = _composite_mean_db(col_vh, ee_geom, "VH") if n_vh > 0 else None

    base_fila["s1_vv_mean_db"] = vv_db
    base_fila["s1_vh_mean_db"] = vh_db
    if vv_db is not None and vh_db is not None:
        base_fila["s1_cross_ratio"] = vv_db - vh_db

    vv_str = f"{vv_db:.2f}dB" if vv_db is not None else "NA"
    vh_str = f"{vh_db:.2f}dB" if vh_db is not None else "NA"
    cross = base_fila["s1_cross_ratio"]
    cross_str = f"{cross:.2f}dB" if cross is not None else "NA"
    logger.info(f"[{poligono_id}|{fecha_target}] VV={vv_str} | VH={vh_str} | VV-VH={cross_str}")

    return base_fila


def _calcular_deltas(df: pd.DataFrame) -> pd.DataFrame:
    """Agrega columna delta_vv_mean_db por polígono respecto a la fecha anterior.

    Ordena por poligono_id y fecha, y para cada polígono calcula la
    diferencia entre el VV de la fecha actual y el VV de la fecha anterior
    disponible en el DataFrame.

    Args:
        df: DataFrame con columnas ``poligono_id``, ``fecha``, ``s1_vv_mean_db``.

    Returns:
        Mismo DataFrame con ``delta_vv_mean_db`` poblada. Para la primera
        fecha de cada polígono el delta queda en None.
    """
    if df.empty:
        return df
    df = df.sort_values(["poligono_id", "fecha"]).reset_index(drop=True)
    df["delta_vv_mean_db"] = df.groupby("poligono_id")["s1_vv_mean_db"].diff()
    return df


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--poligonos",
    "poligonos_path",
    default="config/poligonos.geojson",
    show_default=True,
    help="Path al GeoJSON de polígonos.",
)
@click.option(
    "--fechas",
    "fechas_cli",
    default=None,
    help=(
        "Fechas target separadas por coma (ej: '2018-07,2019-07'). "
        "Si se omite, se usan las de settings.yaml."
    ),
)
@click.option(
    "--output",
    "output_path",
    default="data/processed/sentinel1/sentinel1_backscatter.csv",
    show_default=True,
    help="Path del CSV de salida.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Recalcular combinaciones (polígono, fecha) aunque ya estén en el CSV.",
)
@click.option(
    "--project",
    "ee_project",
    default=None,
    help="Project ID de Earth Engine. Si se omite, se usa EE_PROJECT_ID del .env.",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    poligonos_path: str,
    fechas_cli: Optional[str],
    output_path: str,
    force: bool,
    ee_project: Optional[str],
    nivel_log: str,
) -> None:
    """Calcula backscatter SAR (Sentinel-1) por polígono y fecha con delta temporal."""
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    fechas = _parsear_fechas(fechas_cli, settings)
    out = resolve_path(output_path)
    ensure_dir(out.parent)
    ee_project_resolved = ee_project or settings.env.ee_project_id

    logger.info("=" * 60)
    logger.info("Sentinel-1 SAR backscatter — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"Polígonos:          {poligonos_path}")
    logger.info(f"Fechas target:      {', '.join(fechas)}")
    logger.info(f"Ventana temporal:   ±{VENTANA_DIAS} días")
    logger.info(f"Órbita / modo:      {ORBIT_PASS} / {INSTRUMENT_MODE}")
    logger.info(f"Output CSV:         {out}")
    logger.info(f"Force recompute:    {force}")
    logger.info(f"EE project:         {ee_project_resolved or '(default del ADC)'}")

    inicializar_ee(ee_project_resolved)

    gdf = load_geojson(poligonos_path)
    if "id" not in gdf.columns:
        logger.error("El GeoJSON no tiene columna 'id' en properties. Abortando.")
        sys.exit(2)
    logger.info(f"Se cargaron {len(gdf)} polígonos.")

    df_existente = _cargar_csv_existente(out)
    if not df_existente.empty:
        logger.info(f"CSV existente: {len(df_existente)} filas ya calculadas.")

    filas_nuevas: List[Dict[str, Any]] = []

    def _persistir_parcial() -> None:
        """Callback de interrupción: mergea, recalcula deltas y guarda."""
        if not filas_nuevas:
            logger.info("No hay filas nuevas para persistir.")
            return
        df_nuevo = pd.DataFrame(filas_nuevas)
        if not df_existente.empty:
            claves_nuevas = set(
                zip(df_nuevo["poligono_id"].astype(str), df_nuevo["fecha"].astype(str))
            )
            mask_keep = ~df_existente.apply(
                lambda r: (str(r["poligono_id"]), str(r["fecha"])) in claves_nuevas,
                axis=1,
            )
            df_final = pd.concat([df_existente[mask_keep], df_nuevo], ignore_index=True)
        else:
            df_final = df_nuevo
        # Recalcular delta_vv sobre toda la serie para mantener consistencia.
        df_final = _calcular_deltas(df_final)
        _guardar_csv(df_final, out)

    with graceful_interrupt() as state:
        state.on_interrupt(_persistir_parcial)

        total = len(gdf) * len(fechas)
        logger.info(f"Total combinaciones (polígono × fecha): {total}")

        pbar = tqdm(total=total, desc="S1 SAR", unit="comb")
        try:
            for _, row in gdf.iterrows():
                poligono_id = str(row["id"])
                geom_geojson = row.geometry.__geo_interface__
                for fecha in fechas:
                    if not force and _key_existe(df_existente, poligono_id, fecha):
                        logger.info(
                            f"[{poligono_id}|{fecha}] Ya en CSV → skip (usá --force para recalcular)."
                        )
                        pbar.update(1)
                        continue
                    try:
                        fila = _procesar(poligono_id, geom_geojson, fecha)
                        filas_nuevas.append(fila)
                    except Exception as exc:  # noqa: BLE001
                        logger.error(f"[{poligono_id}|{fecha}] Excepción no manejada: {exc}")
                        logger.debug(traceback.format_exc())
                        filas_nuevas.append(
                            {
                                "poligono_id": poligono_id,
                                "fecha": fecha,
                                "s1_vv_mean_db": None,
                                "s1_vh_mean_db": None,
                                "s1_cross_ratio": None,
                                "delta_vv_mean_db": None,
                                "n_imagenes_vv": 0,
                                "n_imagenes_vh": 0,
                                "version_script": SCRIPT_VERSION,
                                "fecha_calculo": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                            }
                        )
                    pbar.update(1)
        finally:
            pbar.close()

    _persistir_parcial()

    total_filas_nuevas = len(filas_nuevas)
    con_datos = sum(1 for r in filas_nuevas if r.get("s1_vv_mean_db") is not None)
    sin_datos = total_filas_nuevas - con_datos

    logger.info("=" * 60)
    logger.info("Resumen Sentinel-1")
    logger.info("=" * 60)
    logger.info(f"Filas procesadas en este run: {total_filas_nuevas}")
    logger.info(f"Con métricas válidas:         {con_datos}")
    logger.info(f"Sin datos (ventana vacía):    {sin_datos}")
    logger.info(f"CSV final:                    {out}")

    sys.exit(0)


if __name__ == "__main__":
    main()
