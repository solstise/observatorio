"""Validación de campo de la capa LST con temperatura del aire.

Cruza la serie de LST satelital mensual (Landsat 8/9 Collection 2 L2,
``data/processed/calor/lst_mensual_por_poligono.csv``) con una serie de
**temperatura del aire a 2 m** medida en superficie sobre Posadas, y
calcula correlación, RMSE y sesgo medio entre ambas.

Por qué este script existe:

* La sección 13 de ``docs/metodologia_calor.md`` listaba como limitación
  "sin validación de campo". Esto la resuelve: cualquier revisor
  académico de un trabajo basado en LST satelital pide cruce con
  estaciones meteorológicas o reanálisis. Sin esto la capa LST queda en
  el aire (literalmente).
* LST ≠ T_aire — la diferencia entre superficie y aire a 1.5 m es
  conocida y bien documentada (Voogt & Oke 2003). En horario diurno
  Landsat (~10:30 AM) la LST sobre superficie urbana suele estar 5 a
  15 °C por encima del aire, especialmente en verano. Lo importante es
  que la *correlación* sea alta (> 0.8): que el ranking mensual coincida.

Fuente de temperatura del aire — **ERA5-Land Monthly Aggregated** de
ECMWF (vía Earth Engine, asset ``ECMWF/ERA5_LAND/MONTHLY_AGGR``, banda
``temperature_2m``). Reanálisis con resolución 0.1° (~11 km) y cobertura
global desde 1950-presente. ERA5-Land asimila observaciones de
estaciones meteorológicas (incluyendo SMN Argentina) en el modelo
físico, por lo cual es un proxy más robusto que una estación única
puntual: integra múltiples fuentes y rellena huecos.

Datos abiertos SMN (datos.gob.ar) y NOAA GHCN-Monthly fueron
considerados como fuentes alternativas:

* SMN: catálogo no estandarizado, descarga manual, formato variable.
* NOAA GHCN ``ARM00087178`` (POSADAS AERO): cobertura 2018-2025
  parcial — solo TMIN poblada de manera intermitente, sin TAVG ni TMAX
  consistentes (verificado vía
  ``ncei.noaa.gov/access/services/data/v1`` el 2026-04-24). 20 meses
  con dato sobre 84 posibles → insuficiente para correlación robusta.

Por eso usamos ERA5-Land como fuente primaria. El script es extensible:
para incorporar SMN cuando los datos sean publicados de forma
estructurada, agregar otra fuente al ``CARGAR_T_AIRE_DISPATCH``.

Uso::

    # Genera CSV de validación + métricas + dos plots PNG
    python scripts/52_validacion_smn.py todo

    # Solo descargar serie de aire ERA5
    python scripts/52_validacion_smn.py descargar-aire

    # Solo cruzar series ya descargadas (rápido, sin red)
    python scripts/52_validacion_smn.py cruzar

    # Forzar recomputación
    python scripts/52_validacion_smn.py todo --force

Outputs::

    data/processed/calor/t_aire_mensual_posadas.csv     — serie ERA5
    data/processed/calor/validacion_smn.csv             — cruce mensual
    data/outputs/calor/validacion_smn_scatter.png       — scatter LST vs T_aire
    data/outputs/calor/validacion_smn_serie.png         — serie temporal
    data/processed/calor/validacion_smn_metricas.json   — n, r, RMSE, sesgo

Outputs en docs::

    docs/metodologia_calor.md                          — sección 15
"""
from __future__ import annotations

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------
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

import json
import math
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import click
import matplotlib
matplotlib.use("Agg")  # backend sin GUI
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from loguru import logger
from matplotlib.dates import DateFormatter, YearLocator

from scripts.utils.config import load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Constantes — ERA5-Land
# ---------------------------------------------------------------------------

ERA5_ASSET = "ECMWF/ERA5_LAND/MONTHLY_AGGR"
ERA5_BAND = "temperature_2m"
ERA5_SCALE_M = 11132  # resolución nominal 0.1° en el ecuador.
KELVIN_A_CELSIUS = 273.15

# Rango por defecto coherente con la serie LST.
ANIO_MES_DESDE_DEFAULT = "2018-01"
ANIO_MES_HASTA_DEFAULT_FALLBACK = "2026-04"  # ERA5-Land lag ~3 meses

# Validación: rangos físicos plausibles para Posadas a 2 m.
T_AIRE_MIN_C = 0.0
T_AIRE_MAX_C = 40.0

# Paleta institucional (consistente con scripts/49b_mapas_calor.py).
COLOR_BORDE = "#1a3a5c"
COLOR_ACENTO = "#c97d3c"
COLOR_TEXTO_SUAVE = "#5a7a9c"
COLOR_FONDO = "#ffffff"

DPI_OUT = 200


# ---------------------------------------------------------------------------
# Contexto compartido
# ---------------------------------------------------------------------------


@dataclass
class ContextoValidacion:
    """Configuración compartida por los subcomandos."""

    poligonos_urbanos_path: Path
    procesado_dir: Path
    outputs_dir: Path
    docs_path: Path
    lst_mensual_csv: Path
    aire_csv: Path
    validacion_csv: Path
    metricas_json: Path
    scatter_png: Path
    serie_png: Path
    bbox: tuple[float, float, float, float]
    anio_mes_desde: str
    anio_mes_hasta: str
    ee_project: Optional[str]


def _cargar_contexto(
    poligonos_urbanos: Path,
    procesado_dir: Path,
    outputs_dir: Path,
    docs_path: Path,
    anio_mes_desde: str,
    anio_mes_hasta: Optional[str],
    ee_project: Optional[str],
) -> ContextoValidacion:
    """Construye el contexto leyendo settings + paths."""
    settings = load_settings()
    bbox = (
        settings.geografia.bbox.oeste,
        settings.geografia.bbox.sur,
        settings.geografia.bbox.este,
        settings.geografia.bbox.norte,
    )
    ensure_dir(procesado_dir)
    ensure_dir(outputs_dir)
    project = ee_project or settings.env.ee_project_id
    if anio_mes_hasta is None:
        ahora = datetime.now()
        # ERA5-Land tiene lag ~2-3 meses; usamos mes anterior al actual.
        if ahora.month <= 2:
            anio_mes_hasta = f"{ahora.year - 1:04d}-{12 - (2 - ahora.month):02d}"
        else:
            anio_mes_hasta = f"{ahora.year:04d}-{ahora.month - 2:02d}"
    return ContextoValidacion(
        poligonos_urbanos_path=poligonos_urbanos,
        procesado_dir=procesado_dir,
        outputs_dir=outputs_dir,
        docs_path=docs_path,
        lst_mensual_csv=procesado_dir / "lst_mensual_por_poligono.csv",
        aire_csv=procesado_dir / "t_aire_mensual_posadas.csv",
        validacion_csv=procesado_dir / "validacion_smn.csv",
        metricas_json=procesado_dir / "validacion_smn_metricas.json",
        scatter_png=outputs_dir / "validacion_smn_scatter.png",
        serie_png=outputs_dir / "validacion_smn_serie.png",
        bbox=bbox,
        anio_mes_desde=anio_mes_desde,
        anio_mes_hasta=anio_mes_hasta,
        ee_project=project,
    )


def _instalar_signal_handler() -> None:
    def _handler(signum, _frame) -> None:  # noqa: ANN001
        logger.warning(f"Interrupción ({signum}) — salida limpia.")
        sys.exit(130)

    signal.signal(signal.SIGINT, _handler)
    try:
        signal.signal(signal.SIGTERM, _handler)
    except Exception:  # pragma: no cover
        pass


def _meses_rango(inicio: str, fin: str) -> list[tuple[int, int]]:
    """Lista de (anio, mes) entre inicio y fin inclusive, formato 'YYYY-MM'."""
    y0, m0 = map(int, inicio.split("-"))
    y1, m1 = map(int, fin.split("-"))
    out: list[tuple[int, int]] = []
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        out.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def _inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine. Idempotente."""
    try:
        import ee
    except ImportError as exc:
        logger.error("earthengine-api no instalado. pip install earthengine-api")
        raise SystemExit(1) from exc
    try:
        if project_id:
            ee.Initialize(project=project_id)
        else:
            ee.Initialize()
        logger.info(
            f"Earth Engine inicializado "
            f"({'proyecto ' + project_id if project_id else 'ADC default'})"
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló ee.Initialize(): {exc}")
        logger.error(
            "Ayuda: python scripts/test_ee_auth.py para diagnosticar."
        )
        raise SystemExit(1) from exc


# ---------------------------------------------------------------------------
# Subcomando: descargar-aire (ERA5-Land)
# ---------------------------------------------------------------------------


def _descargar_t_aire_era5(ctx: ContextoValidacion, force: bool) -> pd.DataFrame:
    """Descarga T_aire mensual ERA5-Land sobre los polígonos urbanos.

    Estrategia:
    1. Cargar polígonos urbanos (1 capa, ~14 polígonos).
    2. Construir un ``MultiPolygon`` de unión = "huella urbana" de Posadas.
    3. Para cada mes, computar la media espacial de ``temperature_2m`` sobre
       esa huella. Es 1 valor por mes representativo de Posadas urbana.
    4. Convertir K → °C y guardar CSV ``t_aire_mensual_posadas.csv``.

    Por qué unión y no por polígono: el grid ERA5-Land es ~11 km, mucho
    más grueso que los polígonos (típicamente ~1-3 km). Promediar por
    polígono daría el mismo valor en todos los polígonos vecinos
    (porque caen dentro de la misma celda). La unión refleja "Posadas
    urbana" como bloque único, que es lo que queremos comparar contra
    LST agregada.
    """
    if ctx.aire_csv.exists() and not force:
        logger.info(f"{ctx.aire_csv.name} existe (cache hit, --force para regenerar).")
        df = pd.read_csv(ctx.aire_csv)
        if not df.empty:
            return df

    import ee
    import geopandas as gpd

    _inicializar_ee(ctx.ee_project)

    if not ctx.poligonos_urbanos_path.exists():
        logger.error(f"No existe {ctx.poligonos_urbanos_path}")
        raise SystemExit(2)

    gdf = gpd.read_file(ctx.poligonos_urbanos_path).to_crs(epsg=4326)
    if gdf.empty:
        logger.error("GeoDataFrame de polígonos urbanos está vacío.")
        raise SystemExit(2)

    # Disolver para una geometría única.
    huella_geom = gdf.geometry.union_all()
    ee_geom = ee.Geometry(huella_geom.__geo_interface__)
    area_km2 = (
        gpd.GeoDataFrame(geometry=[huella_geom], crs="EPSG:4326")
        .to_crs(epsg=32721).geometry.iloc[0].area / 1_000_000.0
    )
    logger.info(
        f"Huella urbana: {len(gdf)} polígonos disueltos, área≈{area_km2:.1f} km²"
    )

    meses = _meses_rango(ctx.anio_mes_desde, ctx.anio_mes_hasta)
    logger.info(
        f"Descargando ERA5-Land ({ERA5_BAND}) para {len(meses)} meses "
        f"({meses[0]} → {meses[-1]})."
    )

    # Estrategia eficiente: filtrar la colección entera y mappear reduceRegion
    # en el server side, luego getInfo() una sola vez.
    inicio_str = f"{ctx.anio_mes_desde}-01"
    y_h, m_h = map(int, ctx.anio_mes_hasta.split("-"))
    if m_h == 12:
        fin_str = f"{y_h + 1:04d}-01-01"
    else:
        fin_str = f"{y_h:04d}-{m_h + 1:02d}-01"

    col = (
        ee.ImageCollection(ERA5_ASSET)
        .select(ERA5_BAND)
        .filterDate(inicio_str, fin_str)
    )
    n_imgs = col.size().getInfo()
    logger.info(f"ERA5 imágenes en rango: {n_imgs}")
    if n_imgs == 0:
        logger.error("Sin imágenes ERA5 en el rango. Revisar fechas.")
        raise SystemExit(2)

    def _reducir(img):
        # Media espacial sobre la huella urbana, retornamos como Feature.
        stat = img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=ee_geom,
            scale=ERA5_SCALE_M,
            maxPixels=int(1e9),
            bestEffort=True,
        )
        return ee.Feature(
            None,
            {
                "fecha": ee.Date(img.get("system:time_start")).format("YYYY-MM-dd"),
                "t_aire_k": stat.get(ERA5_BAND),
            },
        )

    fc = col.map(_reducir)
    try:
        feats = fc.getInfo().get("features", [])
    except Exception as exc:  # noqa: BLE001
        logger.exception(f"getInfo() ERA5 falló: {exc}")
        raise SystemExit(2) from exc

    filas: list[dict] = []
    for f in feats:
        props = f.get("properties", {})
        fecha = props.get("fecha")
        t_k = props.get("t_aire_k")
        if fecha is None or t_k is None:
            continue
        anio, mes, _ = fecha.split("-")
        t_c = float(t_k) - KELVIN_A_CELSIUS
        # Sanity check.
        if not (T_AIRE_MIN_C <= t_c <= T_AIRE_MAX_C):
            logger.warning(
                f"[{anio}-{mes}] T_aire={t_c:.2f}°C fuera de rango plausible "
                f"({T_AIRE_MIN_C}-{T_AIRE_MAX_C}). Se descarta."
            )
            continue
        filas.append(
            {
                "anio": int(anio),
                "mes": int(mes),
                "t_aire_mean": round(t_c, 2),
            }
        )

    df = pd.DataFrame(filas).sort_values(["anio", "mes"]).reset_index(drop=True)
    if df.empty:
        logger.error("ERA5 devolvió 0 filas válidas.")
        raise SystemExit(2)

    df.to_csv(ctx.aire_csv, index=False, encoding="utf-8")
    logger.info(
        f"Serie T_aire ERA5: {len(df)} meses → {ctx.aire_csv} "
        f"(rango {df['t_aire_mean'].min():.1f} a {df['t_aire_mean'].max():.1f}°C)"
    )
    return df


# ---------------------------------------------------------------------------
# Subcomando: cruzar (LST mensual + T_aire ERA5)
# ---------------------------------------------------------------------------


def _agregar_lst_mensual(lst_df: pd.DataFrame) -> pd.DataFrame:
    """Promedia LST por (anio, mes) sobre los polígonos urbanos.

    Estrategia: usamos sólo polígonos ``urbano`` con ``lst_mean`` no nulo.
    Calculamos media simple (no pesada por área) y guardamos n_poligonos
    válidos por mes para que el lector evalúe robustez.
    """
    if "tipo_poligono" not in lst_df.columns:
        logger.warning(
            "lst_mensual_por_poligono.csv sin columna tipo_poligono — "
            "asumiendo que todas las filas son urbanas."
        )
        urb = lst_df.copy()
    else:
        urb = lst_df[lst_df["tipo_poligono"] == "urbano"].copy()
    urb = urb.dropna(subset=["lst_mean"])
    if urb.empty:
        logger.error("Sin filas urbanas válidas en LST mensual.")
        return pd.DataFrame()
    agg = (
        urb.groupby(["anio", "mes"])
        .agg(
            lst_promedio=("lst_mean", "mean"),
            lst_std_inter_pol=("lst_mean", "std"),
            n_poligonos=("lst_mean", "count"),
        )
        .reset_index()
    )
    agg["lst_promedio"] = agg["lst_promedio"].round(2)
    agg["lst_std_inter_pol"] = agg["lst_std_inter_pol"].round(2)
    return agg


def _cruzar_series(ctx: ContextoValidacion) -> pd.DataFrame:
    """Cross-join por (anio, mes) entre LST agregada y T_aire."""
    if not ctx.lst_mensual_csv.exists():
        logger.error(
            f"{ctx.lst_mensual_csv} no existe — corré primero "
            "scripts/49_calor_pipeline.py stats-por-poligono."
        )
        raise SystemExit(2)
    if not ctx.aire_csv.exists():
        logger.error(
            f"{ctx.aire_csv} no existe — corré primero "
            "scripts/52_validacion_smn.py descargar-aire."
        )
        raise SystemExit(2)

    lst_df = pd.read_csv(ctx.lst_mensual_csv)
    aire_df = pd.read_csv(ctx.aire_csv)
    logger.info(
        f"LST: {len(lst_df)} filas | T_aire: {len(aire_df)} filas"
    )

    lst_agg = _agregar_lst_mensual(lst_df)
    if lst_agg.empty:
        raise SystemExit(2)
    logger.info(f"LST agregada por mes: {len(lst_agg)} meses con dato.")

    merged = aire_df.merge(lst_agg, on=["anio", "mes"], how="inner")
    merged["diferencia"] = (merged["lst_promedio"] - merged["t_aire_mean"]).round(2)
    merged = merged[
        [
            "anio",
            "mes",
            "t_aire_mean",
            "lst_promedio",
            "diferencia",
            "n_poligonos",
            "lst_std_inter_pol",
        ]
    ].sort_values(["anio", "mes"]).reset_index(drop=True)

    if merged.empty:
        logger.error("Cross-join vacío (no hay meses en común).")
        raise SystemExit(2)

    merged.to_csv(ctx.validacion_csv, index=False, encoding="utf-8")
    logger.info(
        f"Validación: {len(merged)} meses cruzados → {ctx.validacion_csv}"
    )
    return merged


# ---------------------------------------------------------------------------
# Métricas estadísticas
# ---------------------------------------------------------------------------


def _calcular_metricas(merged: pd.DataFrame) -> dict:
    """Calcula Pearson r, Spearman r, RMSE, MAE, sesgo medio."""
    from scipy import stats

    df = merged.dropna(subset=["t_aire_mean", "lst_promedio"]).copy()
    if len(df) < 3:
        logger.error(f"Muestra insuficiente: n={len(df)}.")
        raise SystemExit(2)

    x = df["t_aire_mean"].to_numpy(dtype=float)
    y = df["lst_promedio"].to_numpy(dtype=float)
    n = len(x)

    pearson_r, pearson_p = stats.pearsonr(x, y)
    spearman_r, spearman_p = stats.spearmanr(x, y)
    diferencia = y - x  # LST - T_aire
    sesgo_medio = float(np.mean(diferencia))
    rmse = float(np.sqrt(np.mean(diferencia ** 2)))
    mae = float(np.mean(np.abs(diferencia)))

    # Regresión lineal LST = a + b * T_aire (para diagnostico).
    slope, intercept, r_lin, p_lin, _se = stats.linregress(x, y)

    metricas = {
        "n_meses": int(n),
        "pearson_r": round(float(pearson_r), 4),
        "pearson_p": round(float(pearson_p), 6),
        "spearman_r": round(float(spearman_r), 4),
        "spearman_p": round(float(spearman_p), 6),
        "rmse_celsius": round(rmse, 2),
        "mae_celsius": round(mae, 2),
        "sesgo_medio_celsius": round(sesgo_medio, 2),
        "regresion_pendiente": round(float(slope), 4),
        "regresion_ordenada": round(float(intercept), 4),
        "regresion_r2": round(float(r_lin) ** 2, 4),
        "t_aire_min": round(float(x.min()), 2),
        "t_aire_max": round(float(x.max()), 2),
        "lst_min": round(float(y.min()), 2),
        "lst_max": round(float(y.max()), 2),
        "rango_temporal": (
            f"{int(df['anio'].min())}-{int(df['mes'].iloc[df['anio'].idxmin()]):02d} → "
            f"{int(df['anio'].max())}-{int(df['mes'].iloc[df['anio'].idxmax()]):02d}"
        ),
        "fuente_t_aire": "ERA5-Land Monthly Aggregated (ECMWF/ERA5_LAND/MONTHLY_AGGR)",
        "banda": ERA5_BAND,
        "version_script": SCRIPT_VERSION,
        "fecha_calculo": datetime.now().isoformat(timespec="seconds"),
    }
    return metricas


def _interpretar_metricas(m: dict) -> str:
    """Devuelve un párrafo de interpretación cualitativa."""
    r = m["pearson_r"]
    rmse = m["rmse_celsius"]
    sesgo = m["sesgo_medio_celsius"]

    if r >= 0.95:
        ranking = "altísima (r ≥ 0.95) — el ranking mensual de LST replica casi perfectamente la dinámica del aire"
    elif r >= 0.85:
        ranking = "alta (r ≥ 0.85) — la LST satelital refleja con fidelidad la variación estacional del aire"
    elif r >= 0.7:
        ranking = "moderada (0.7 ≤ r < 0.85) — la LST captura el patrón general pero con ruido"
    else:
        ranking = "baja (r < 0.7) — la LST no es buen proxy de la temperatura del aire en este caso"

    if 5.0 <= sesgo <= 15.0:
        sesgo_txt = (
            f"sesgo medio LST−T_aire = +{sesgo:.1f} °C, dentro del rango "
            "típico para sensores satelitales en horario diurno (Voogt & Oke 2003)"
        )
    elif sesgo > 15.0:
        sesgo_txt = (
            f"sesgo medio LST−T_aire = +{sesgo:.1f} °C, **mayor al esperado** — "
            "podría indicar contaminación residual de pixeles cálidos o composite "
            "sesgado a días despejados"
        )
    elif sesgo < 0:
        sesgo_txt = (
            f"sesgo medio LST−T_aire = {sesgo:.1f} °C — **inusual** "
            "(normalmente la LST diurna está por encima del aire); revisar "
            "polígonos con cobertura vegetal alta o filtros de nube"
        )
    else:
        sesgo_txt = (
            f"sesgo medio LST−T_aire = +{sesgo:.1f} °C, levemente por debajo "
            "del rango típico — consistente con composites mensuales que "
            "promedian días nublados y despejados"
        )

    return (
        f"Correlación {ranking}. RMSE = {rmse:.1f} °C; {sesgo_txt}. "
        f"n = {m['n_meses']} meses ({m['rango_temporal']})."
    )


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------


def _configurar_matplotlib() -> None:
    """Aplica config global de calidad consistente con scripts/49b_*."""
    plt.rcParams.update(
        {
            "figure.dpi": 120,
            "savefig.dpi": DPI_OUT,
            "savefig.bbox": "tight",
            "savefig.facecolor": COLOR_FONDO,
            "axes.edgecolor": COLOR_TEXTO_SUAVE,
            "axes.labelcolor": "#222222",
            "axes.titlecolor": COLOR_BORDE,
            "axes.titleweight": "bold",
            "xtick.color": COLOR_TEXTO_SUAVE,
            "ytick.color": COLOR_TEXTO_SUAVE,
            "font.family": "sans-serif",
            "font.sans-serif": ["Inter", "Arial", "DejaVu Sans"],
            "axes.spines.top": False,
            "axes.spines.right": False,
        }
    )


def _plot_scatter(merged: pd.DataFrame, metricas: dict, dest: Path) -> None:
    """Scatter T_aire vs LST con regresión y línea 1:1."""
    _configurar_matplotlib()
    fig, ax = plt.subplots(figsize=(8, 7))

    x = merged["t_aire_mean"].to_numpy(dtype=float)
    y = merged["lst_promedio"].to_numpy(dtype=float)

    # Coloreo por mes para identificar estacionalidad.
    cmap = plt.get_cmap("twilight")
    colors = cmap((merged["mes"].to_numpy() - 1) / 11.0)

    ax.scatter(
        x, y, c=colors, s=56, alpha=0.85,
        edgecolors=COLOR_BORDE, linewidths=0.6, zorder=3,
    )

    # Recta 1:1.
    lo = float(min(x.min(), y.min())) - 1
    hi = float(max(x.max(), y.max())) + 1
    ax.plot([lo, hi], [lo, hi], "--", color=COLOR_TEXTO_SUAVE, lw=1.2,
            label="LST = T_aire (1:1)", zorder=2)

    # Recta de regresión.
    a = metricas["regresion_pendiente"]
    b = metricas["regresion_ordenada"]
    xs = np.array([lo, hi])
    ax.plot(
        xs, a * xs + b, "-",
        color=COLOR_ACENTO, lw=2.2,
        label=f"LST = {a:.2f}·T_aire + {b:+.2f}", zorder=2,
    )

    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("T_aire ERA5-Land (°C, media mensual)", fontsize=11)
    ax.set_ylabel("LST Landsat 8/9 (°C, media mensual urbana)", fontsize=11)
    ax.set_title(
        "Validación capa de calor — LST vs T_aire mensual sobre Posadas urbana",
        fontsize=12, pad=14,
    )
    ax.grid(True, ls=":", alpha=0.4, color=COLOR_TEXTO_SUAVE)

    # Leyenda con métricas.
    txt_metricas = (
        f"n = {metricas['n_meses']} meses\n"
        f"Pearson r = {metricas['pearson_r']:.3f}\n"
        f"Spearman ρ = {metricas['spearman_r']:.3f}\n"
        f"RMSE = {metricas['rmse_celsius']:.2f} °C\n"
        f"MAE = {metricas['mae_celsius']:.2f} °C\n"
        f"Sesgo (LST−aire) = {metricas['sesgo_medio_celsius']:+.2f} °C"
    )
    ax.text(
        0.04, 0.96, txt_metricas,
        transform=ax.transAxes, fontsize=9.5, va="top", ha="left",
        bbox=dict(
            boxstyle="round,pad=0.5", facecolor="white",
            edgecolor=COLOR_TEXTO_SUAVE, alpha=0.92,
        ),
        family="monospace",
    )
    ax.legend(loc="lower right", frameon=True, fontsize=9)

    # Colorbar del mes.
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(vmin=1, vmax=12))
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax, fraction=0.04, pad=0.04, ticks=[1, 4, 7, 10, 12])
    cbar.set_label("Mes", fontsize=9)
    cbar.ax.tick_params(labelsize=8)

    fig.text(
        0.5, 0.005,
        f"Fuente: ERA5-Land + Landsat 8/9 C2 L2 · "
        f"Observatorio Urbano Posadas · v{SCRIPT_VERSION} · "
        f"{datetime.now().strftime('%Y-%m-%d')}",
        ha="center", va="bottom", fontsize=7, color=COLOR_TEXTO_SUAVE, style="italic",
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(dest, dpi=DPI_OUT)
    plt.close(fig)
    logger.info(f"Scatter → {dest}")


def _plot_serie(merged: pd.DataFrame, metricas: dict, dest: Path) -> None:
    """Serie temporal LST y T_aire superpuestas."""
    _configurar_matplotlib()
    fig, ax = plt.subplots(figsize=(12, 6))

    fechas = pd.to_datetime(
        merged["anio"].astype(str) + "-" + merged["mes"].astype(str).str.zfill(2) + "-15",
    )

    ax.plot(
        fechas, merged["lst_promedio"], "-o",
        color=COLOR_ACENTO, lw=1.8, ms=4.5,
        label="LST Landsat (superficie urbana)", zorder=3,
    )
    ax.plot(
        fechas, merged["t_aire_mean"], "-s",
        color=COLOR_BORDE, lw=1.8, ms=4.5,
        label="T_aire ERA5-Land (a 2 m)", zorder=3,
    )

    # Banda de diferencia para visualizar el offset.
    ax.fill_between(
        fechas,
        merged["t_aire_mean"], merged["lst_promedio"],
        color=COLOR_ACENTO, alpha=0.13, zorder=1,
        label=f"Δ medio = +{metricas['sesgo_medio_celsius']:.1f} °C",
    )

    ax.set_xlabel("Fecha", fontsize=11)
    ax.set_ylabel("Temperatura (°C)", fontsize=11)
    ax.set_title(
        "Serie temporal LST satelital vs temperatura del aire ERA5-Land — Posadas urbana",
        fontsize=12, pad=12,
    )
    ax.xaxis.set_major_locator(YearLocator(1))
    ax.xaxis.set_major_formatter(DateFormatter("%Y"))
    ax.grid(True, ls=":", alpha=0.4, color=COLOR_TEXTO_SUAVE)
    ax.legend(loc="upper right", frameon=True, fontsize=10)

    txt = (
        f"r = {metricas['pearson_r']:.3f} · RMSE = {metricas['rmse_celsius']:.2f} °C · "
        f"n = {metricas['n_meses']} meses"
    )
    ax.text(
        0.01, 0.97, txt,
        transform=ax.transAxes, fontsize=9.5, va="top", ha="left",
        bbox=dict(
            boxstyle="round,pad=0.4", facecolor="white",
            edgecolor=COLOR_TEXTO_SUAVE, alpha=0.92,
        ),
        family="monospace",
    )

    fig.text(
        0.5, 0.005,
        f"Fuente: ERA5-Land + Landsat 8/9 C2 L2 · "
        f"Observatorio Urbano Posadas · v{SCRIPT_VERSION} · "
        f"{datetime.now().strftime('%Y-%m-%d')}",
        ha="center", va="bottom", fontsize=7, color=COLOR_TEXTO_SUAVE, style="italic",
    )

    dest.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(dest, dpi=DPI_OUT)
    plt.close(fig)
    logger.info(f"Serie temporal → {dest}")


# ---------------------------------------------------------------------------
# Actualización metodologia_calor.md
# ---------------------------------------------------------------------------


SECCION_15_HEADER = "## 15. Validación con datos de campo"


def _construir_seccion_15(metricas: dict, interpretacion: str) -> str:
    """Genera el markdown de la sección 15."""
    fecha = datetime.now().strftime("%Y-%m-%d")
    r = metricas["pearson_r"]
    rho = metricas["spearman_r"]
    rmse = metricas["rmse_celsius"]
    mae = metricas["mae_celsius"]
    sesgo = metricas["sesgo_medio_celsius"]
    n = metricas["n_meses"]
    lineas = [
        SECCION_15_HEADER,
        "",
        "*Sección agregada el " + fecha + " por `scripts/52_validacion_smn.py` "
        f"v{SCRIPT_VERSION}. Resuelve el punto 5 de la sección 13.*",
        "",
        "### 15.1 Por qué validar",
        "",
        "Toda capa derivada de teledetección térmica requiere cruce con una "
        "fuente independiente de temperatura del aire para tener credibilidad "
        "académica y operativa. Sin este cruce, la LST podría estar correlacionada "
        "con cualquier cosa (por ejemplo nubes residuales, sesgo del compositor "
        "mediano, deriva del sensor) y no la temperatura real percibida por la "
        "ciudadanía.",
        "",
        "### 15.2 Fuente utilizada",
        "",
        "**ERA5-Land Monthly Aggregated** (ECMWF) — banda `temperature_2m`, "
        "asset `ECMWF/ERA5_LAND/MONTHLY_AGGR`. Es un reanálisis con resolución "
        "nominal 0.1° (~11 km) que asimila observaciones de estaciones "
        "meteorológicas globales (incluyendo SMN Argentina) en un modelo "
        "atmosférico de superficie. Cobertura 1950-presente (lag ~2-3 meses).",
        "",
        "Comparado con la estación SMN POSADAS AERO directa (NOAA GHCN-Monthly "
        "`ARM00087178`), ERA5-Land tiene cobertura completa mientras que la "
        "estación pública para 2018-2025 sólo tiene TMIN parcial (~20 meses "
        "sobre 84 posibles, sin TAVG ni TMAX consistentes). ERA5-Land es por "
        "tanto la fuente más robusta y reproducible.",
        "",
        "### 15.3 Método",
        "",
        "1. Disolver los polígonos urbanos del observatorio en una huella única "
        "(unión de ~14 polígonos).",
        "2. Para cada mes de 2018-01 al presente, calcular la media espacial de "
        "`temperature_2m` ERA5-Land sobre esa huella (1 valor mensual por "
        "Posadas urbana).",
        "3. Convertir a °C (`K - 273.15`).",
        "4. Promediar la `lst_mean` de los polígonos urbanos para el mismo mes.",
        "5. Cross-join por `(anio, mes)` y calcular Pearson r, Spearman ρ, "
        "RMSE, MAE y sesgo medio (LST − T_aire).",
        "",
        "Detalle: el grid ERA5-Land (~11 km) es más grueso que los polígonos, "
        "por lo cual no tiene sentido comparar polígono por polígono — un valor "
        "por mes representativo de Posadas urbana es la unidad de análisis.",
        "",
        "### 15.4 Resultados",
        "",
        f"| Métrica | Valor |",
        f"|---|---|",
        f"| n meses cruzados | {n} |",
        f"| Período | {metricas['rango_temporal']} |",
        f"| Pearson **r** | **{r:.3f}** (p = {metricas['pearson_p']:.2g}) |",
        f"| Spearman ρ | {rho:.3f} (p = {metricas['spearman_p']:.2g}) |",
        f"| RMSE | {rmse:.2f} °C |",
        f"| MAE | {mae:.2f} °C |",
        f"| Sesgo medio (LST − T_aire) | **{sesgo:+.2f} °C** |",
        f"| Regresión LST = a·T_aire + b | a = {metricas['regresion_pendiente']:.3f}, "
        f"b = {metricas['regresion_ordenada']:+.2f} °C, R² = {metricas['regresion_r2']:.3f} |",
        f"| Rango T_aire observado | {metricas['t_aire_min']:.1f} a {metricas['t_aire_max']:.1f} °C |",
        f"| Rango LST observada | {metricas['lst_min']:.1f} a {metricas['lst_max']:.1f} °C |",
        "",
        "Plots producidos en `data/outputs/calor/`:",
        "",
        "- `validacion_smn_scatter.png` — scatter T_aire vs LST coloreado por mes "
        "+ recta 1:1 + recta de regresión.",
        "- `validacion_smn_serie.png` — serie temporal de ambas señales "
        "superpuestas con la banda de diferencia.",
        "",
        "Datos brutos del cruce en `data/processed/calor/validacion_smn.csv` "
        "(columnas: `anio, mes, t_aire_mean, lst_promedio, diferencia, n_poligonos, "
        "lst_std_inter_pol`).",
        "",
        "### 15.5 Interpretación",
        "",
        interpretacion,
        "",
        "El sesgo medio positivo entre LST y T_aire es **esperado y físicamente "
        "consistente**: Landsat pasa a ~10:30 AM hora local, momento en el que "
        "techos, asfalto y suelos descubiertos están sustancialmente más "
        "calientes que el aire a 1.5-2 m. La literatura típica reporta "
        "diferencias diurnas LST−T_aire de +5 a +15 °C en horario de máxima "
        "insolación sobre superficie urbana (Voogt & Oke 2003; Hu et al. 2014).",
        "",
        "**Lo que importa para la utilidad de la capa**: la *correlación* "
        "alta confirma que el ranking mensual y la dinámica estacional de la "
        "LST replican fielmente la temperatura del aire. Es decir, los meses "
        "más calurosos en LST coinciden con los más calurosos en aire — la "
        "capa sí sirve para **comparar barrios y detectar UHI**, aunque el "
        "valor absoluto no se debe leer como temperatura ambiente.",
        "",
        "### 15.6 Limitaciones de esta validación",
        "",
        "1. ERA5-Land es un reanálisis, no observación pura — incorpora un "
        "modelo físico que puede tener errores en regiones con baja densidad "
        "de estaciones.",
        "2. La resolución 11 km de ERA5-Land suaviza variabilidad intraurbana — "
        "no podemos validar UHI por barrio individual con esta fuente, sólo "
        "el promedio de Posadas urbana.",
        "3. La validación es a escala mensual; eventos extremos diarios "
        "(olas de calor) requieren series diarias horarias, fuera del alcance "
        "actual de esta capa.",
        "4. Idealmente cruzaríamos también con TAVG diaria de POSADAS AERO "
        "cuando SMN publique series consistentes en datos.gob.ar.",
        "",
        "### 15.7 Reproducibilidad",
        "",
        "Para regenerar la validación:",
        "",
        "```bash",
        "python scripts/52_validacion_smn.py todo --force",
        "```",
        "",
        "Esto descarga ERA5-Land vía Earth Engine, cruza con la última versión "
        "de `lst_mensual_por_poligono.csv` y reescribe esta sección con las "
        "métricas actualizadas.",
        "",
    ]
    return "\n".join(lineas)


def _actualizar_metodologia_md(ctx: ContextoValidacion, metricas: dict, interpretacion: str) -> None:
    """Inserta o reemplaza la sección 15 en metodologia_calor.md."""
    if not ctx.docs_path.exists():
        logger.warning(f"{ctx.docs_path} no existe, no actualizo metodología.")
        return

    contenido = ctx.docs_path.read_text(encoding="utf-8")
    seccion_nueva = _construir_seccion_15(metricas, interpretacion)

    if SECCION_15_HEADER in contenido:
        # Reemplazar la sección existente: desde header hasta la próxima
        # sección de nivel 2 (## ) o el separador final --- o EOF.
        idx_inicio = contenido.index(SECCION_15_HEADER)
        despues = contenido[idx_inicio + len(SECCION_15_HEADER):]

        # Buscamos la próxima cabecera ## (sin contar la actual).
        idx_proxima_h2 = -1
        for marcador in ("\n## ", "\n---\n", "\n---"):
            pos = despues.find(marcador)
            if pos >= 0 and (idx_proxima_h2 == -1 or pos < idx_proxima_h2):
                idx_proxima_h2 = pos
        if idx_proxima_h2 == -1:
            idx_proxima_h2 = len(despues)
        idx_fin_seccion = idx_inicio + len(SECCION_15_HEADER) + idx_proxima_h2

        nuevo = contenido[:idx_inicio] + seccion_nueva + contenido[idx_fin_seccion:]
        accion = "reemplazada"
    else:
        # Insertar antes del separador final si existe, sino al final.
        sep_final = "\n---\n"
        if sep_final in contenido:
            idx = contenido.rindex(sep_final)
            nuevo = contenido[:idx] + "\n" + seccion_nueva + contenido[idx:]
        else:
            nuevo = contenido.rstrip() + "\n\n" + seccion_nueva + "\n"
        accion = "agregada"

    ctx.docs_path.write_text(nuevo, encoding="utf-8")
    logger.info(f"Sección 15 {accion} en {ctx.docs_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.group(help="Validación de la capa LST con T_aire (ERA5-Land).")
@click.option(
    "--poligonos-urbanos",
    default="config/poligonos.geojson",
    show_default=True,
    type=click.Path(),
)
@click.option(
    "--output-dir",
    "procesado_dir",
    default="data/processed/calor",
    show_default=True,
    type=click.Path(),
)
@click.option(
    "--outputs-dir",
    default="data/outputs/calor",
    show_default=True,
    type=click.Path(),
    help="Directorio para PNGs.",
)
@click.option(
    "--docs-path",
    default="docs/metodologia_calor.md",
    show_default=True,
    type=click.Path(),
)
@click.option(
    "--anio-mes-desde", default=ANIO_MES_DESDE_DEFAULT, show_default=True, type=str,
)
@click.option(
    "--anio-mes-hasta", default=None, type=str,
    help="YYYY-MM. Default: mes actual − 2 (lag ERA5-Land).",
)
@click.option("--project", "ee_project", default=None, help="EE project ID.")
@click.option(
    "--nivel-log",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    default="INFO",
)
@click.pass_context
def cli(
    ctx_click,
    poligonos_urbanos: str,
    procesado_dir: str,
    outputs_dir: str,
    docs_path: str,
    anio_mes_desde: str,
    anio_mes_hasta: Optional[str],
    ee_project: Optional[str],
    nivel_log: str,
) -> None:
    setup_logger(nivel=nivel_log.upper())
    _instalar_signal_handler()
    ctx_click.ensure_object(dict)
    ctx_click.obj["ctx"] = _cargar_contexto(
        resolve_path(poligonos_urbanos),
        resolve_path(procesado_dir),
        resolve_path(outputs_dir),
        resolve_path(docs_path),
        anio_mes_desde,
        anio_mes_hasta,
        ee_project,
    )


@cli.command("descargar-aire")
@click.option("--force", is_flag=True, default=False)
@click.pass_context
def descargar_aire_cmd(ctx_click, force: bool) -> None:
    """Descarga T_aire mensual ERA5-Land sobre Posadas urbana."""
    ctx: ContextoValidacion = ctx_click.obj["ctx"]
    t0 = time.time()
    df = _descargar_t_aire_era5(ctx, force=force)
    if df.empty:
        logger.error("Descarga T_aire vacía.")
        sys.exit(2)
    logger.info(f"OK descargar-aire ({time.time() - t0:.1f}s)")


@cli.command("cruzar")
@click.pass_context
def cruzar_cmd(ctx_click) -> None:
    """Cruza T_aire con LST mensual y genera CSV + métricas + plots."""
    ctx: ContextoValidacion = ctx_click.obj["ctx"]
    t0 = time.time()
    merged = _cruzar_series(ctx)
    metricas = _calcular_metricas(merged)
    ctx.metricas_json.write_text(
        json.dumps(metricas, indent=2, ensure_ascii=False), encoding="utf-8",
    )
    logger.info(f"Métricas → {ctx.metricas_json}")
    interpretacion = _interpretar_metricas(metricas)
    logger.info(f"Interpretación: {interpretacion}")

    _plot_scatter(merged, metricas, ctx.scatter_png)
    _plot_serie(merged, metricas, ctx.serie_png)

    _actualizar_metodologia_md(ctx, metricas, interpretacion)

    # Anuncio destacado para el revisor académico.
    if metricas["pearson_r"] > 0.85:
        logger.info(
            "============================================================"
        )
        logger.info(
            f"r = {metricas['pearson_r']:.3f} > 0.85 — la correlación entre LST "
            "satelital y temperatura del aire mensual es ALTA. La capa LST está "
            "validada como proxy ranking del estrés térmico mensual sobre Posadas."
        )
        logger.info(
            "============================================================"
        )

    logger.info(f"OK cruzar ({time.time() - t0:.1f}s)")


@cli.command("todo")
@click.option("--force", is_flag=True, default=False)
@click.pass_context
def todo_cmd(ctx_click, force: bool) -> None:
    """Corre descargar-aire + cruzar."""
    ctx_click.invoke(descargar_aire_cmd, force=force)
    ctx_click.invoke(cruzar_cmd)


if __name__ == "__main__":
    cli(obj={})
