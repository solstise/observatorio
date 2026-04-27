"""Indicador de superficie construida con Google Dynamic World V1.

Dataset: ``GOOGLE/DYNAMICWORLD/V1`` — probabilidades por píxel a 10m con
cadencia 2-5 días, derivadas de Sentinel-2. La banda ``built`` entrega un
valor continuo en [0, 1] que expresa la probabilidad de que el píxel sea
superficie construida (no una clasificación binaria).

Para cada (polígono, fecha-objetivo) se construye un composite temporal
(mediana por píxel) dentro de una ventana de ±45 días y se computan tres
métricas dentro del polígono:

- ``dw_built_mean``:      promedio espacial de la probabilidad ``built``.
- ``dw_built_median``:    mediana espacial de la probabilidad ``built``.
- ``dw_built_pct_ge_50``: fracción del área con ``built >= 0.5`` (proxy
  intuitivo de "construido", sensible al threshold elegido).

Honestidad metodológica
-----------------------
Dynamic World es un clasificador **probabilístico**, no una máscara binaria
oficial. La interpretación correcta es:

- El ``mean`` de la probabilidad ``built`` es el indicador **más estable**
  y el que recomendamos para comparar entre fechas o polígonos. Integra
  incertidumbre del clasificador de forma continua.
- El ``pct >= 0.5`` es intuitivo ("qué fracción está construida") pero es
  muy sensible al threshold: moverlo a 0.4 o 0.6 puede cambiar la serie
  de forma significativa, especialmente en zonas de transición
  (rur-urbana, chacras subdivididas).
- La cadencia efectiva depende de la disponibilidad de Sentinel-2 sin
  nubes. En algunas fechas el composite puede armarse con pocas imágenes
  (se loguea ``n_imagenes``).
- No reemplaza un conteo por footprints (Open Buildings). Aporta una
  visión complementaria de la **intensidad de uso construido** a escala
  de píxel, incluyendo calles pavimentadas y techos pequeños que Open
  Buildings puede perder.

Ejemplo de uso::

    # Defaults (lee fechas de settings.yaml)
    python scripts/41_dynamic_world.py

    # Una fecha puntual, smoke test
    python scripts/41_dynamic_world.py --fechas 2024-07

    # Reprocesar todo
    python scripts/41_dynamic_world.py --force
"""

from __future__ import annotations

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

# Versión del script — se registra en logs para trazabilidad.
SCRIPT_VERSION = "0.1.0"

# Nombre del asset Earth Engine.
DW_ASSET = "GOOGLE/DYNAMICWORLD/V1"

# Banda de probabilidad de superficie construida (valores 0-1).
DW_BAND_BUILT = "built"

# Threshold para el cálculo de área "construida" (proxy binario).
DW_BUILT_THRESHOLD = 0.5

# Ventana temporal a cada lado de la fecha-objetivo (días).
VENTANA_DIAS = 45

# Escala en metros/pixel para los reducers. Dynamic World es nativo 10m.
ESCALA_DW_M = 10

# Columnas de salida del CSV, en orden.
CSV_COLUMNS = [
    "poligono_id",
    "fecha",
    "dw_built_mean",
    "dw_built_median",
    "dw_built_pct_ge_50",
    "n_imagenes",
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
    """Devuelve (inicio, fin) YYYY-MM-DD interpretando fecha_target como el día 15.

    Args:
        fecha_target: String YYYY-MM.
        ventana_dias: Días a cada lado de la fecha.

    Returns:
        Tupla (fecha_inicio, fecha_fin) en formato YYYY-MM-DD.
    """
    fecha_centro = datetime.strptime(fecha_target + "-15", "%Y-%m-%d")
    inicio = (fecha_centro - timedelta(days=ventana_dias)).strftime("%Y-%m-%d")
    fin = (fecha_centro + timedelta(days=ventana_dias)).strftime("%Y-%m-%d")
    return inicio, fin


def _coleccion_dw(geom, fecha_target: str) -> Tuple[Any, int]:
    """Filtra la ImageCollection de Dynamic World para geom y fecha±ventana.

    Args:
        geom: `ee.Geometry` del polígono.
        fecha_target: String YYYY-MM.

    Returns:
        Tupla (coleccion_filtrada, n_imagenes). Si no hay imágenes devuelve
        (coleccion_vacia, 0).
    """
    import ee

    inicio, fin = _rango_fechas(fecha_target)
    coleccion = (
        ee.ImageCollection(DW_ASSET)
        .filterBounds(geom)
        .filterDate(inicio, fin)
        .select([DW_BAND_BUILT])
    )
    n = int(coleccion.size().getInfo())
    return coleccion, n


def _calcular_metricas(
    coleccion,
    geom,
) -> Dict[str, Optional[float]]:
    """Calcula mean, median y pct>=0.5 de la banda ``built`` dentro del polígono.

    El composite temporal es la mediana por píxel (robusta a outliers por
    nubes o artefactos puntuales). Luego se reducen espacialmente las tres
    métricas en una sola llamada a EE para minimizar roundtrips.

    Args:
        coleccion: ``ee.ImageCollection`` ya filtrada y con banda ``built``.
        geom: ``ee.Geometry`` del polígono.

    Returns:
        Dict con claves ``dw_built_mean``, ``dw_built_median``,
        ``dw_built_pct_ge_50`` (todas en [0, 1] o None si falla).
    """
    import ee

    # Composite temporal: mediana por píxel de la probabilidad "built".
    composite = coleccion.median().select(DW_BAND_BUILT)

    # Máscara binaria para el threshold (1 = construido, 0 = no).
    built_mask = composite.gte(DW_BUILT_THRESHOLD).rename("built_ge_50")

    # Imagen con ambas bandas para reducir en una sola pasada.
    stack = composite.addBands(built_mask)

    # Combinamos mean + median para la banda continua. `mean` de la banda
    # binaria equivale a la fracción de píxeles >= threshold.
    reducer = ee.Reducer.mean().combine(ee.Reducer.median(), sharedInputs=True)

    try:
        stats = stack.reduceRegion(
            reducer=reducer,
            geometry=geom,
            scale=ESCALA_DW_M,
            maxPixels=1e9,
            bestEffort=True,
        ).getInfo()
    except Exception as exc:  # noqa: BLE001
        logger.error(f"   reduceRegion falló: {exc}")
        return {
            "dw_built_mean": None,
            "dw_built_median": None,
            "dw_built_pct_ge_50": None,
        }

    # EE devuelve las claves como `{banda}_{reducer}`. Ejemplo:
    # {'built_mean': 0.42, 'built_median': 0.38, 'built_ge_50_mean': 0.31, ...}
    # El pct se obtiene del mean de la banda binaria.
    mean_val = stats.get(f"{DW_BAND_BUILT}_mean")
    median_val = stats.get(f"{DW_BAND_BUILT}_median")
    pct_val = stats.get("built_ge_50_mean")

    return {
        "dw_built_mean": float(mean_val) if mean_val is not None else None,
        "dw_built_median": float(median_val) if median_val is not None else None,
        "dw_built_pct_ge_50": float(pct_val) if pct_val is not None else None,
    }


# ---------------------------------------------------------------------------
# I/O CSV
# ---------------------------------------------------------------------------


def _cargar_csv_existente(output_path: Path) -> pd.DataFrame:
    """Carga el CSV existente o devuelve un DataFrame vacío con el esquema esperado."""
    if output_path.exists() and output_path.stat().st_size > 0:
        try:
            df = pd.read_csv(output_path)
            if "poligono_id" in df.columns and "fecha" in df.columns:
                # Garantizamos tipos string para comparación de keys.
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
    # Reordenar columnas según el esquema canónico (ignorando extras que pudiera haber).
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
    """Calcula las métricas DW para una combinación (polígono, fecha).

    Args:
        poligono_id: Slug del polígono.
        geometry_geojson: GeoJSON dict del polígono.
        fecha_target: YYYY-MM.

    Returns:
        Dict con el esquema de fila del CSV, o con métricas en None si no hubo datos.
    """
    import ee

    try:
        ee_geom = ee.Geometry(geometry_geojson)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[{poligono_id}|{fecha_target}] Geometría inválida: {exc}")
        return {
            "poligono_id": poligono_id,
            "fecha": fecha_target,
            "dw_built_mean": None,
            "dw_built_median": None,
            "dw_built_pct_ge_50": None,
            "n_imagenes": 0,
            "version_script": SCRIPT_VERSION,
            "fecha_calculo": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        }

    coleccion, n = _coleccion_dw(ee_geom, fecha_target)
    logger.info(f"[{poligono_id}|{fecha_target}] ventana ±{VENTANA_DIAS}d → n_imagenes={n}")

    if n == 0:
        logger.warning(f"[{poligono_id}|{fecha_target}] Dynamic World sin imágenes disponibles.")
        return {
            "poligono_id": poligono_id,
            "fecha": fecha_target,
            "dw_built_mean": None,
            "dw_built_median": None,
            "dw_built_pct_ge_50": None,
            "n_imagenes": 0,
            "version_script": SCRIPT_VERSION,
            "fecha_calculo": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        }

    metricas = _calcular_metricas(coleccion, ee_geom)
    if metricas["dw_built_mean"] is not None:
        logger.info(
            f"[{poligono_id}|{fecha_target}] "
            f"built_mean={metricas['dw_built_mean']:.4f} "
            f"| built_median={metricas['dw_built_median']:.4f} "
            f"| pct>=0.5={metricas['dw_built_pct_ge_50']:.4f}"
        )
    else:
        logger.warning(f"[{poligono_id}|{fecha_target}] Sin métricas válidas tras reduceRegion.")

    return {
        "poligono_id": poligono_id,
        "fecha": fecha_target,
        "dw_built_mean": metricas["dw_built_mean"],
        "dw_built_median": metricas["dw_built_median"],
        "dw_built_pct_ge_50": metricas["dw_built_pct_ge_50"],
        "n_imagenes": n,
        "version_script": SCRIPT_VERSION,
        "fecha_calculo": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
    }


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
    default="data/processed/dynamic_world/dynamic_world_built.csv",
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
    """Calcula probabilidad de superficie construida (Dynamic World V1) por polígono y fecha."""
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    fechas = _parsear_fechas(fechas_cli, settings)
    out = resolve_path(output_path)
    ensure_dir(out.parent)
    ee_project_resolved = ee_project or settings.env.ee_project_id

    logger.info("=" * 60)
    logger.info("Dynamic World V1 — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"Polígonos:          {poligonos_path}")
    logger.info(f"Fechas target:      {', '.join(fechas)}")
    logger.info(f"Ventana temporal:   ±{VENTANA_DIAS} días")
    logger.info(f"Threshold built:    {DW_BUILT_THRESHOLD}")
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

    # Filas acumuladas durante el run (para merge final).
    filas_nuevas: List[Dict[str, Any]] = []

    def _persistir_parcial() -> None:
        """Callback de interrupción: mergea lo nuevo con lo existente y guarda."""
        if not filas_nuevas:
            logger.info("No hay filas nuevas para persistir.")
            return
        df_nuevo = pd.DataFrame(filas_nuevas)
        if not df_existente.empty:
            # Sacamos del existente lo que vuelva a estar en df_nuevo (force o refresh).
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
        df_final = df_final.sort_values(["poligono_id", "fecha"]).reset_index(drop=True)
        _guardar_csv(df_final, out)

    with graceful_interrupt() as state:
        state.on_interrupt(_persistir_parcial)

        total = len(gdf) * len(fechas)
        logger.info(f"Total combinaciones (polígono × fecha): {total}")

        pbar = tqdm(total=total, desc="DW built", unit="comb")
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
                                "dw_built_mean": None,
                                "dw_built_median": None,
                                "dw_built_pct_ge_50": None,
                                "n_imagenes": 0,
                                "version_script": SCRIPT_VERSION,
                                "fecha_calculo": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
                            }
                        )
                    pbar.update(1)
        finally:
            pbar.close()

    # Merge final y guardado.
    _persistir_parcial()

    # Resumen.
    total_filas_nuevas = len(filas_nuevas)
    con_datos = sum(1 for r in filas_nuevas if r.get("dw_built_mean") is not None)
    sin_datos = total_filas_nuevas - con_datos

    logger.info("=" * 60)
    logger.info("Resumen Dynamic World")
    logger.info("=" * 60)
    logger.info(f"Filas procesadas en este run: {total_filas_nuevas}")
    logger.info(f"Con métricas válidas:         {con_datos}")
    logger.info(f"Sin datos (ventana vacía):    {sin_datos}")
    logger.info(f"CSV final:                    {out}")

    sys.exit(0)


if __name__ == "__main__":
    main()
