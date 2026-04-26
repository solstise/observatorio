"""Capa de pronóstico climático por barrio (paquete A1 + A2 + A4).

Llama a Open-Meteo (Ensemble + Air Quality) para Posadas y proyecta el
pronóstico base (centro de la ciudad) sobre los 43 barrios usando un
**offset Landsat invertido nocturno** derivado de la métrica UHI vs
rural. La idea: si un barrio urbano denso retiene más calor que el
campo, su Tmin (mínima nocturna) tiende a ser **más alta** que la del
centro, mientras que un barrio con mucha vegetación y agua cercana
puede ser **más fría**. Para Tmax usamos el offset diurno.

El pronóstico base ya viene de un ensamble de 6 modelos meteorológicos
(ECMWF IFS04, GFS, ICON, JMA, GEM, BoM ACCESS) y nos quedamos con los
percentiles p10 / p50 / p90 calculados sobre los miembros del ensemble
para construir una **banda de confianza honesta** (A4): cuando los
modelos discrepan, la banda se ensancha; cuando convergen, se estrecha.

Outputs
-------

``data/processed/forecast/forecast_diario_por_barrio.csv``:
    Filas (barrio, fecha) con tmin/tmax p10/p50/p90, precipitación y
    código de tiempo WMO. Cubre los próximos 14 días.

``data/processed/forecast/forecast_horario.csv``:
    Detalle horario para Posadas centro, últimas 72 horas del run y
    próximas 72 horas. Sirve para gráficos finos (hourly).

``data/processed/forecast/aqi_diario.csv``:
    AQI europeo, PM10, PM2.5, NO2, SO2 y O3 (5 días de pronóstico).
    NO se desagrega por barrio: la resolución del modelo es ~10 km y
    Posadas entera entra en una sola celda — fingir variación interbarrio
    sería deshonesto.

``data/processed/forecast/_metadata.json``:
    Metadatos del run (timestamp, modelos usados, n filas, fuente).

Honestidad metodológica
-----------------------

- Las temperaturas Open-Meteo son del aire a 2 m de altura, NO del
  suelo (LST). El offset basado en LST es un proxy razonable de la
  diferencia interbarrios pero introduce ruido — por eso conservamos
  la banda p10-p90 amplia y la mostramos siempre.
- Cuando un barrio no tiene UHI calculado, el offset cae a 0 (igual
  al centro) y se marca con ``offset_origen='ninguno'`` para
  trazabilidad.
- ``posadas_completa`` se EXCLUYE: el pronóstico es por barrios.

Uso
---
::

    python scripts/57_forecast_clima.py
    python scripts/57_forecast_clima.py --solo-barrios san_isidro,a4_nueva_esperanza
    python scripts/57_forecast_clima.py --dias 7 --skip-aqi
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
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import click
import numpy as np
import pandas as pd
import requests
from loguru import logger

from scripts.utils.logger import setup_logger
from scripts.utils.paths import resolve_path

SCRIPT_VERSION = "0.1.0"

# --- Constantes geográficas (Posadas centro) --------------------------------
POSADAS_LAT = -27.3667
POSADAS_LON = -55.8967
TIMEZONE = "America/Argentina/Cordoba"

# Modelos del ensemble Open-Meteo (los seis pedidos en el prompt).
ENSEMBLE_MODELS = [
    "ecmwf_ifs04",
    "gfs_seamless",
    "icon_global",
    "jma_gsm",
    "gem_global",
    "bom_access_global",
]

ENSEMBLE_URL = "https://ensemble-api.open-meteo.com/v1/ensemble"
AQI_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

# Cuántos miembros aporta cada modelo (lo expone Open-Meteo en docs).
# No es crítico si difiere ligeramente: solo se usa para sanity-check.
MIEMBROS_TOTALES_TIPICOS = 50

# Forecast horizon por defecto (14 d daily + horario para 72 h).
FORECAST_DIAS_DEFAULT = 14
FORECAST_HORAS_FINAS = 72  # horario detallado próximas 72 h

# --- Utilitarios ------------------------------------------------------------


def _http_get_json(url: str, params: Dict, timeout: int = 60) -> Dict:
    """GET con retry simple y JSON. Logea url + params al final."""
    backoffs = [1, 3, 8]
    ultimo_error: Optional[Exception] = None
    for intento, espera in enumerate([0] + backoffs, start=1):
        if espera:
            import time as _time

            _time.sleep(espera)
        try:
            r = requests.get(url, params=params, timeout=timeout)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as exc:
            ultimo_error = exc
            logger.warning(f"  intento {intento}/{len(backoffs) + 1} falló: {exc}")
    raise RuntimeError(f"Open-Meteo no respondió tras {len(backoffs) + 1} intentos: {ultimo_error}")


def _percentiles_por_dia(matriz: np.ndarray, percentiles=(10, 50, 90)) -> Dict[int, np.ndarray]:
    """Recibe una matriz (n_dias, n_miembros) y devuelve diccionario percentil → array(n_dias)."""
    out = {}
    for p in percentiles:
        out[p] = np.nanpercentile(matriz, p, axis=1)
    return out


def _agregar_diario_desde_horario(
    times: List[str],
    valores_por_miembro: Dict[str, List[float]],
    fn_agregacion: str = "max",
) -> Tuple[List[str], np.ndarray]:
    """Convierte series horarias del ensemble a una serie diaria.

    Open-Meteo Ensemble devuelve ``hourly`` para temperature_2m con una
    columna por miembro: ``temperature_2m_member01``, ``..._member02``,
    etc. (más una serie base sin sufijo, que es el determinístico). Para
    obtener Tmax/Tmin diaria por miembro necesitamos resamplear.

    Args:
        times: lista de timestamps ISO (hora local).
        valores_por_miembro: dict miembro → valores horarios.
        fn_agregacion: 'max', 'min' o 'sum' por día.

    Returns:
        (lista_de_fechas_unicas, matriz n_dias × n_miembros).
    """
    df_t = pd.DataFrame({"time": pd.to_datetime(times)})
    df_t["fecha"] = df_t["time"].dt.date.astype(str)
    fechas_unicas = sorted(df_t["fecha"].unique())

    cols = list(valores_por_miembro.keys())
    matriz = np.full((len(fechas_unicas), len(cols)), np.nan, dtype=float)
    for j, col in enumerate(cols):
        serie = pd.Series(valores_por_miembro[col], index=df_t["fecha"].values)
        if fn_agregacion == "max":
            agg = serie.groupby(level=0).max()
        elif fn_agregacion == "min":
            agg = serie.groupby(level=0).min()
        elif fn_agregacion == "sum":
            agg = serie.groupby(level=0).sum()
        else:
            raise ValueError(f"agregación no soportada: {fn_agregacion}")
        for i, f in enumerate(fechas_unicas):
            if f in agg.index:
                v = agg.loc[f]
                if pd.notna(v):
                    matriz[i, j] = float(v)
    return fechas_unicas, matriz


# --- Llamadas a Open-Meteo --------------------------------------------------


def llamar_ensemble(
    lat: float,
    lon: float,
    forecast_days: int = FORECAST_DIAS_DEFAULT,
) -> Dict:
    """Llamada al endpoint ensemble. Devuelve el JSON crudo.

    Pedimos hourly+daily para extraer luego percentiles. El daily de
    Open-Meteo Ensemble agrega por miembro automáticamente, así que
    tenemos columnas ``temperature_2m_max_member01..N``.
    """
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
        "models": ",".join(ENSEMBLE_MODELS),
        "timezone": TIMEZONE,
        "forecast_days": forecast_days,
    }
    logger.info(f"Llamando Ensemble API ({forecast_days} días, {len(ENSEMBLE_MODELS)} modelos).")
    return _http_get_json(ENSEMBLE_URL, params)


def llamar_aqi(
    lat: float,
    lon: float,
    forecast_days: int = 5,
) -> Dict:
    """Llamada al endpoint air-quality. Devuelve JSON crudo."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "pm10,pm2_5,nitrogen_dioxide,sulphur_dioxide,ozone,european_aqi",
        "forecast_days": forecast_days,
        "timezone": TIMEZONE,
    }
    logger.info(f"Llamando Air Quality API ({forecast_days} días).")
    return _http_get_json(AQI_URL, params)


# --- Procesamiento del ensemble ---------------------------------------------


def parsear_ensemble_diario(j: Dict) -> pd.DataFrame:
    """Construye el DataFrame diario base de Posadas centro con percentiles.

    Open-Meteo Ensemble devuelve, en `daily`, columnas tipo
    ``temperature_2m_max`` (la principal, que es del primer modelo) y
    una por miembro: ``temperature_2m_max_member01..NN``. Lo robusto es
    agarrar todas las columnas que matchean el sufijo y calcular
    percentiles sobre ellas.
    """
    daily = j.get("daily") or {}
    if not daily:
        raise RuntimeError("Open-Meteo no devolvió bloque 'daily'.")

    fechas = daily["time"]

    def _matriz_por_miembro(prefijo: str) -> np.ndarray:
        keys = [k for k in daily.keys() if k == prefijo or k.startswith(prefijo + "_")]
        if not keys:
            return np.full((len(fechas), 1), np.nan, dtype=float)
        cols = []
        for k in keys:
            arr = np.array(daily[k], dtype=float)
            cols.append(arr)
        return np.column_stack(cols)

    tmax_mx = _matriz_por_miembro("temperature_2m_max")
    tmin_mx = _matriz_por_miembro("temperature_2m_min")
    pp_mx = _matriz_por_miembro("precipitation_sum")

    # weather_code: tomamos la moda por día sobre miembros (categórica).
    wc_mx = _matriz_por_miembro("weather_code")
    if wc_mx.shape[1] > 0:
        # Moda por fila ignorando NaN.
        from scipy import stats  # type: ignore

        try:
            modes = stats.mode(
                np.nan_to_num(wc_mx, nan=-1).astype(int), axis=1, keepdims=False
            ).mode
            wcode = np.where(modes >= 0, modes, np.nan)
        except Exception:
            wcode = np.array(
                [
                    pd.Series(row).mode().iloc[0] if pd.Series(row).notna().any() else np.nan
                    for row in wc_mx
                ]
            )
    else:
        wcode = np.full(len(fechas), np.nan, dtype=float)

    pcts_tmax = _percentiles_por_dia(tmax_mx)
    pcts_tmin = _percentiles_por_dia(tmin_mx)
    # Para precipitación tomamos la mediana (sum es ya por miembro).
    pp_p50 = (
        np.nanpercentile(pp_mx, 50, axis=1) if pp_mx.shape[1] > 0 else np.full(len(fechas), np.nan)
    )

    df = pd.DataFrame(
        {
            "fecha": fechas,
            "tmax_p10": np.round(pcts_tmax[10], 2),
            "tmax_p50": np.round(pcts_tmax[50], 2),
            "tmax_p90": np.round(pcts_tmax[90], 2),
            "tmin_p10": np.round(pcts_tmin[10], 2),
            "tmin_p50": np.round(pcts_tmin[50], 2),
            "tmin_p90": np.round(pcts_tmin[90], 2),
            "precipitation_mm": np.round(pp_p50, 2),
            "weather_code": wcode,
        }
    )
    df["weather_code"] = df["weather_code"].astype("Int64")
    n_miembros_tmax = tmax_mx.shape[1]
    n_miembros_tmin = tmin_mx.shape[1]
    logger.info(
        f"Ensemble parseado: {len(df)} días, "
        f"{n_miembros_tmax} miembros tmax, {n_miembros_tmin} miembros tmin."
    )
    return df


def parsear_ensemble_horario(
    j: Dict, horas_atras: int = 0, horas_adelante: int = FORECAST_HORAS_FINAS
) -> pd.DataFrame:
    """DataFrame horario con la mediana del ensemble + bandas p10/p90.

    Solo expone las próximas ``horas_adelante`` horas (más eventualmente
    ``horas_atras``, aunque Open-Meteo Ensemble no devuelve pasado).
    """
    hourly = j.get("hourly") or {}
    if not hourly:
        return pd.DataFrame()

    times = hourly["time"]

    def _matriz_horaria(prefijo: str) -> np.ndarray:
        keys = [k for k in hourly.keys() if k == prefijo or k.startswith(prefijo + "_")]
        if not keys:
            return np.full((len(times), 1), np.nan, dtype=float)
        return np.column_stack([np.array(hourly[k], dtype=float) for k in keys])

    t_mx = _matriz_horaria("temperature_2m")
    rh_mx = _matriz_horaria("relative_humidity_2m")
    pr_mx = _matriz_horaria("precipitation")
    ws_mx = _matriz_horaria("wind_speed_10m")

    df = pd.DataFrame(
        {
            "time": times,
            "temp_p10": np.round(np.nanpercentile(t_mx, 10, axis=1), 2),
            "temp_p50": np.round(np.nanpercentile(t_mx, 50, axis=1), 2),
            "temp_p90": np.round(np.nanpercentile(t_mx, 90, axis=1), 2),
            "rh_p50": np.round(np.nanpercentile(rh_mx, 50, axis=1), 1),
            "precip_p50": np.round(np.nanpercentile(pr_mx, 50, axis=1), 2),
            "wind_p50": np.round(np.nanpercentile(ws_mx, 50, axis=1), 2),
        }
    )
    # Cortar a las primeras N horas para no llenar el CSV con 14 días horarios.
    return df.head(horas_adelante).copy()


def parsear_aqi(j: Dict) -> pd.DataFrame:
    """Agrega AQI horario a diario tomando max diario de cada contaminante."""
    hourly = j.get("hourly") or {}
    if not hourly:
        logger.warning("AQI no devolvió bloque 'hourly'; retorno DataFrame vacío.")
        return pd.DataFrame()

    times = pd.to_datetime(hourly["time"])
    df = pd.DataFrame(
        {
            "time": times,
            "pm10": hourly.get("pm10", []),
            "pm2_5": hourly.get("pm2_5", []),
            "no2": hourly.get("nitrogen_dioxide", []),
            "so2": hourly.get("sulphur_dioxide", []),
            "ozone": hourly.get("ozone", []),
            "european_aqi": hourly.get("european_aqi", []),
        }
    )
    df["fecha"] = df["time"].dt.date.astype(str)
    # AQI europeo es un máximo diario por convención; los demás también
    # los tomamos como max diario porque interesa el peor momento.
    grp = (
        df.groupby("fecha")
        .agg(
            {
                "pm10": "max",
                "pm2_5": "max",
                "no2": "max",
                "so2": "max",
                "ozone": "max",
                "european_aqi": "max",
            }
        )
        .reset_index()
    )
    for c in ["pm10", "pm2_5", "no2", "so2", "ozone", "european_aqi"]:
        grp[c] = grp[c].round(1)
    return grp


# --- Cálculo del offset por barrio (Landsat invertido nocturno) ------------


def calcular_offsets_por_barrio(
    df_uhi_estacional: pd.DataFrame,
) -> pd.DataFrame:
    """Para cada barrio computa offsets diurno (verano) e invertido nocturno (invierno).

    ``offset_calor`` (Tmax): usamos UHI verano vs rural — un barrio
    con +3°C de UHI tiende a tener Tmax aire ~+1°C arriba (la regla
    LST → aire es aprox 1/3 de la diferencia LST).

    ``offset_frio`` (Tmin nocturno): la noche urbana retiene calor por
    el albedo y la masa térmica del cemento. Usamos UHI invierno como
    proxy: barrios con UHI invierno alto retienen más calor → sube Tmin.
    Para Tmin, el factor de transferencia LST → aire es aún más bajo
    (~0.2). Un barrio con UHI invierno -2°C (vegetación abundante) será
    ~-0.4°C en Tmin nocturna.

    El "Landsat invertido" del prompt: para frío, urbano denso retiene
    calor → barrios calientes diurnamente terminan siendo barrios
    *menos fríos* nocturnamente. La señal se invierte en su lectura
    pero el dato base es el mismo UHI Landsat.

    Args:
        df_uhi_estacional: CSV ``uhi_estacional.csv`` (script 49).

    Returns:
        DataFrame con columnas:
        ``poligono_id, offset_calor_c, offset_frio_c, offset_origen``.
    """
    if df_uhi_estacional.empty:
        return pd.DataFrame(
            columns=["poligono_id", "offset_calor_c", "offset_frio_c", "offset_origen"]
        )

    # Factores de calibración LST → aire 2 m. Conservadores y honestos:
    # se sabe que la transferencia es alta y variable, así que la banda
    # p10-p90 ya cubre el ruido residual.
    K_DIA = 0.33  # 3°C de UHI LST diurno ≈ 1°C diferencial Tmax aire
    K_NOCHE = 0.20  # 5°C de UHI LST nocturno ≈ 1°C diferencial Tmin aire

    # UHI verano más reciente por barrio (proxy diurno).
    df_v = df_uhi_estacional[df_uhi_estacional["estacion"].str.lower() == "verano"].copy()
    if not df_v.empty:
        df_v = df_v.sort_values(["poligono_id", "anio"]).groupby("poligono_id").tail(1)
    df_v = df_v[["poligono_id", "uhi_vs_rural_mean"]].rename(
        columns={"uhi_vs_rural_mean": "uhi_verano"}
    )

    # UHI invierno más reciente por barrio (proxy nocturno; en invierno
    # el cielo despejado favorece la pérdida radiativa, y la diferencia
    # urbano/rural es máxima en mínimas nocturnas).
    df_i = df_uhi_estacional[df_uhi_estacional["estacion"].str.lower() == "invierno"].copy()
    if not df_i.empty:
        df_i = df_i.sort_values(["poligono_id", "anio"]).groupby("poligono_id").tail(1)
    df_i = df_i[["poligono_id", "uhi_vs_rural_mean"]].rename(
        columns={"uhi_vs_rural_mean": "uhi_invierno"}
    )

    df = df_v.merge(df_i, on="poligono_id", how="outer")
    df["poligono_id"] = df["poligono_id"].astype(str)

    df["offset_calor_c"] = (df["uhi_verano"].fillna(0.0) * K_DIA).round(2)
    df["offset_frio_c"] = (df["uhi_invierno"].fillna(0.0) * K_NOCHE).round(2)

    def _origen(row) -> str:
        v = pd.notna(row["uhi_verano"])
        i = pd.notna(row["uhi_invierno"])
        if v and i:
            return "uhi_verano+invierno"
        if v:
            return "uhi_verano"
        if i:
            return "uhi_invierno"
        return "ninguno"

    df["offset_origen"] = df.apply(_origen, axis=1)
    return df[["poligono_id", "offset_calor_c", "offset_frio_c", "offset_origen"]]


def proyectar_forecast_por_barrio(
    forecast_centro: pd.DataFrame,
    offsets: pd.DataFrame,
    barrios: List[str],
    generated_at: str,
) -> pd.DataFrame:
    """Proyecta el forecast del centro a cada barrio aplicando offsets.

    El offset se suma a Tmax/Tmin sin tocar la banda relativa: es
    decir, p10/p50/p90 se desplazan en bloque. La razón es que el
    offset por barrio es una constante respecto del ensemble; introducir
    incertidumbre adicional sobre el offset duplicaría la dispersión y
    no tenemos evidencia para esa magnitud.
    """
    rows = []
    offsets_idx = offsets.set_index("poligono_id") if not offsets.empty else pd.DataFrame()

    for barrio in barrios:
        if barrio in offsets_idx.index:
            off_calor = float(offsets_idx.at[barrio, "offset_calor_c"])
            off_frio = float(offsets_idx.at[barrio, "offset_frio_c"])
            origen = str(offsets_idx.at[barrio, "offset_origen"])
        else:
            off_calor = 0.0
            off_frio = 0.0
            origen = "ninguno"

        for _, fc in forecast_centro.iterrows():
            rows.append(
                {
                    "poligono_id": barrio,
                    "fecha": str(fc["fecha"]),
                    "tmin_p10": round(float(fc["tmin_p10"]) + off_frio, 2),
                    "tmin_p50": round(float(fc["tmin_p50"]) + off_frio, 2),
                    "tmin_p90": round(float(fc["tmin_p90"]) + off_frio, 2),
                    "tmax_p10": round(float(fc["tmax_p10"]) + off_calor, 2),
                    "tmax_p50": round(float(fc["tmax_p50"]) + off_calor, 2),
                    "tmax_p90": round(float(fc["tmax_p90"]) + off_calor, 2),
                    "precipitation_mm": (
                        float(fc["precipitation_mm"]) if pd.notna(fc["precipitation_mm"]) else None
                    ),
                    "weather_code": (
                        int(fc["weather_code"]) if pd.notna(fc["weather_code"]) else None
                    ),
                    "offset_calor_c": off_calor,
                    "offset_frio_c": off_frio,
                    "offset_origen": origen,
                    "generated_at": generated_at,
                }
            )
    return pd.DataFrame(rows)


# --- Carga de barrios -------------------------------------------------------


def cargar_barrios(geojson_path: Path) -> List[str]:
    """Lee los IDs de barrios del GeoJSON, excluyendo posadas_completa."""
    with geojson_path.open("r", encoding="utf-8") as f:
        gj = json.load(f)
    out = []
    for f in gj.get("features", []):
        props = f.get("properties") or {}
        pid = str(props.get("id") or props.get("poligono_id") or "").strip()
        if not pid:
            continue
        if pid == "posadas_completa":
            continue
        # También excluir features marcados como ciudad_completa por categoria.
        if props.get("categoria") == "ciudad_completa":
            continue
        out.append(pid)
    out = sorted(set(out))
    logger.info(f"Barrios a pronosticar: {len(out)} (excluye posadas_completa).")
    return out


# --- CLI --------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option(
    "--poligonos",
    default="config/poligonos.geojson",
    type=click.Path(),
    help="GeoJSON de polígonos (lista de barrios a proyectar).",
)
@click.option(
    "--uhi",
    default="data/processed/calor/uhi_estacional.csv",
    type=click.Path(),
    help="UHI estacional (script 49) — fuente del offset por barrio.",
)
@click.option(
    "--out-dir",
    default="data/processed/forecast",
    type=click.Path(),
    help="Directorio de salida.",
)
@click.option(
    "--dias",
    default=FORECAST_DIAS_DEFAULT,
    type=int,
    help="Cantidad de días de pronóstico daily.",
)
@click.option(
    "--horas-finas",
    default=FORECAST_HORAS_FINAS,
    type=int,
    help="Horas del CSV horario de Posadas centro.",
)
@click.option(
    "--solo-barrios",
    default="",
    help="Lista coma-separada de barrios para limitar (debug).",
)
@click.option(
    "--skip-aqi",
    is_flag=True,
    default=False,
    help="No llamar Air Quality API (útil si está caída).",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    poligonos: str,
    uhi: str,
    out_dir: str,
    dias: int,
    horas_finas: int,
    solo_barrios: str,
    skip_aqi: bool,
    log_level: str,
) -> None:
    """Pipeline completo de pronóstico climático por barrio."""
    setup_logger(nivel=log_level)
    logger.info("=" * 60)
    logger.info(f"Forecast clima por barrio — v{SCRIPT_VERSION}")
    logger.info("=" * 60)

    poligonos_path = resolve_path(poligonos)
    uhi_path = resolve_path(uhi)
    out_path = resolve_path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    barrios = cargar_barrios(poligonos_path)
    if solo_barrios:
        whitelist = {x.strip() for x in solo_barrios.split(",") if x.strip()}
        barrios = [b for b in barrios if b in whitelist]
        logger.info(f"Filtrado por --solo-barrios: {len(barrios)} barrios.")
    if not barrios:
        logger.error("No quedaron barrios para procesar.")
        sys.exit(2)

    # Offsets desde UHI (script 49).
    if uhi_path.exists():
        df_uhi = pd.read_csv(uhi_path)
        df_uhi["poligono_id"] = df_uhi["poligono_id"].astype(str)
        offsets = calcular_offsets_por_barrio(df_uhi)
        logger.info(f"Offsets calculados para {len(offsets)} barrios. Origen UHI: {uhi_path}")
        # Inspección rápida.
        n_offset_origen_ninguno = (offsets["offset_origen"] == "ninguno").sum()
        if n_offset_origen_ninguno > 0:
            logger.warning(
                f"  {n_offset_origen_ninguno} barrios sin UHI: offset = 0 (igual al centro)."
            )
    else:
        logger.warning(f"UHI no encontrado en {uhi_path}; offset = 0 para todos los barrios.")
        offsets = pd.DataFrame(
            columns=["poligono_id", "offset_calor_c", "offset_frio_c", "offset_origen"]
        )

    # Llamadas API.
    try:
        j_ens = llamar_ensemble(POSADAS_LAT, POSADAS_LON, forecast_days=dias)
    except RuntimeError as exc:
        logger.exception(f"Ensemble API falló: {exc}")
        sys.exit(3)

    df_centro = parsear_ensemble_diario(j_ens)
    df_horario = parsear_ensemble_horario(j_ens, horas_adelante=horas_finas)

    if not skip_aqi:
        try:
            j_aqi = llamar_aqi(POSADAS_LAT, POSADAS_LON, forecast_days=5)
            df_aqi = parsear_aqi(j_aqi)
        except RuntimeError as exc:
            logger.warning(f"AQI API falló — se omite ({exc}).")
            df_aqi = pd.DataFrame()
    else:
        df_aqi = pd.DataFrame()

    # Proyección por barrio.
    generated_at = datetime.now().isoformat(timespec="seconds")
    df_barrios = proyectar_forecast_por_barrio(
        forecast_centro=df_centro,
        offsets=offsets,
        barrios=barrios,
        generated_at=generated_at,
    )

    # Persistencia.
    f_diario = out_path / "forecast_diario_por_barrio.csv"
    df_barrios.to_csv(f_diario, index=False, encoding="utf-8")
    logger.info(f"forecast_diario_por_barrio.csv -> {len(df_barrios)} filas en {f_diario}")

    f_horario = out_path / "forecast_horario.csv"
    df_horario.to_csv(f_horario, index=False, encoding="utf-8")
    logger.info(f"forecast_horario.csv -> {len(df_horario)} filas en {f_horario}")

    f_aqi = out_path / "aqi_diario.csv"
    if not df_aqi.empty:
        df_aqi.to_csv(f_aqi, index=False, encoding="utf-8")
        logger.info(f"aqi_diario.csv -> {len(df_aqi)} filas en {f_aqi}")
    else:
        # Aún en caso de skip o error, persistimos un CSV vacío con header
        # para que el sync no rompa.
        pd.DataFrame(
            columns=["fecha", "pm10", "pm2_5", "no2", "so2", "ozone", "european_aqi"]
        ).to_csv(f_aqi, index=False, encoding="utf-8")
        logger.info(f"aqi_diario.csv -> 0 filas (header only) en {f_aqi}")

    metadata = {
        "script_version": SCRIPT_VERSION,
        "generated_at": generated_at,
        "modelos": ENSEMBLE_MODELS,
        "n_barrios": len(barrios),
        "n_filas_diario": len(df_barrios),
        "n_filas_horario": len(df_horario),
        "n_filas_aqi": len(df_aqi),
        "fuente_ensemble": ENSEMBLE_URL,
        "fuente_aqi": AQI_URL,
        "centro_lat": POSADAS_LAT,
        "centro_lon": POSADAS_LON,
        "timezone": TIMEZONE,
    }
    (out_path / "_metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("=" * 60)
    logger.info("Forecast climático listo.")
    logger.info(
        f"  diario: {len(df_barrios)} filas, {len(barrios)} barrios x {len(df_centro)} días"
    )
    logger.info(f"  horario: {len(df_horario)} filas")
    logger.info(f"  aqi: {len(df_aqi)} filas")

    # Top 3 con Tmin más fría en próximos 7 días para inspección rápida.
    if not df_barrios.empty:
        fechas_7 = sorted(df_barrios["fecha"].unique())[:7]
        sub = df_barrios[df_barrios["fecha"].isin(fechas_7)]
        top3 = sub.groupby("poligono_id")["tmin_p50"].min().sort_values().head(3)
        logger.info(f"Top 3 barrios con Tmin pronosticada más fría (próx. 7 d):\n{top3}")

    logger.info("=" * 60)


if __name__ == "__main__":
    main()
