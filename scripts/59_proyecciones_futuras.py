"""Proyecciones a 2027 / 2030 / 2035 por barrio (regresión lineal + exponencial).

Sobre las series históricas robustas del Observatorio Urbano Posadas
(viviendas, población, % urbano, UHI verano), ajustamos dos modelos
candidatos por (polígono × métrica):

1. **Regresión lineal**: ``y = a + b·t`` — cambio constante por año.
2. **Regresión exponencial**: ``log(y) = a + b·t``, equivalente a
   ``y = e^a · e^(b·t)`` — crecimiento porcentual constante.

El modelo "ganador" es el que tiene mayor R² sobre el histórico, con
un **bonus por simplicidad**: si la diferencia entre R² lineal y
exponencial es < 5 puntos porcentuales, preferimos el lineal (Occam).

El **intervalo de confianza del 95 %** sobre la predicción se calcula
con la fórmula clásica de regresión OLS:

::

    SE_pred = sqrt( s² · (1 + 1/n + (t_pred - t̄)² / Σ(t - t̄)²) )

donde ``s²`` es la varianza residual del histórico. El factor de
ampliación es Student-t con ``n - 2`` grados de libertad, percentil
0.975. Para el modelo exponencial, esto se calcula en log-espacio y
luego se anti-loguea (lo que da bandas asimétricas en escala original).

**No se usa bootstrapping pesado** — la fórmula analítica es suficiente
y rápida para 43 barrios × 4 métricas × 3 años (516 filas).

Honestidad metodológica
-----------------------

- Solo 8 años de histórico (2018-2025) para viviendas/población.
  R² alto NO significa que la tendencia vaya a continuar. Cambios
  estructurales (políticas, eventos climáticos, crisis económica)
  no se modelan.
- Para 2035 (10 años de extrapolación) los IC se ensanchan mucho.
  Ese ensanchamiento es honesto pero no captura *epistemic uncertainty*
  (incertidumbre sobre el modelo en sí — ej. ¿es lineal o exponencial?).
- UHI puede no ser claramente lineal/exponencial. Si R² < 0.4
  marcamos ``confianza='baja'`` y NO proyectamos más allá de 2030.
- MapBiomas: la serie corre 1998-2022 (24 años) y los % se saturan
  cerca del 100 % en barrios consolidados. La regresión lineal sobre
  un % saturado da pendiente cero y R² inestable; lo flageamos.

Outputs
-------

``data/processed/proyecciones/proyecciones_por_poligono.csv``:
    Filas (poligono_id, métrica, anio_proyeccion). 11 columnas.

``data/processed/proyecciones/_metadata.json``:
    Metadatos del run (timestamp, parámetros, versión del modelo).

Uso
---
::

    python scripts/59_proyecciones_futuras.py
    python scripts/59_proyecciones_futuras.py --metricas viviendas,uhi
    python scripts/59_proyecciones_futuras.py --poligono itaembe_mini
    python scripts/59_proyecciones_futuras.py --anios 2027,2030,2035
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
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import click
import numpy as np
import pandas as pd
from loguru import logger
from scipy import stats as scipy_stats

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

# Métricas soportadas por el script. Cada una declara:
#   - source: ruta del CSV histórico relativa a la raíz del proyecto.
#   - col_anio: columna del CSV que contiene el año (puede derivarse de fecha).
#   - col_valor: columna del valor a proyectar.
#   - filtros: dict opcional de filtros (clave=valor) a aplicar antes del fit.
#   - anios_default: lista de años a proyectar si el CLI no la sobreescribe
#     (UHI no se proyecta a 2035 si su R² es bajo — ver lógica más abajo).
#   - permite_negativos: True si la métrica puede caer (UHI, etc.).
METRICAS_CONFIG = {
    "viviendas": {
        "source": "data/processed/conteos_v43/serie_temporal.csv",
        "col_fecha_a_anio": "fecha",  # extraemos el año del prefijo YYYY-MM
        "col_valor": "n_edificios_estimado",
        "filtros": None,
        "anios_default": [2027, 2030, 2035],
        "permite_negativos": False,
        "label": "Viviendas detectadas",
        "unidad": "unidades",
    },
    "poblacion": {
        "source": "data/processed/poblacion_estimada_v43.csv",
        "col_fecha_a_anio": "fecha",
        "col_valor": "poblacion_estimada",
        "filtros": None,
        "anios_default": [2027, 2030, 2035],
        "permite_negativos": False,
        "label": "Población estimada",
        "unidad": "habitantes",
    },
    "urbano": {
        "source": "data/processed/historia_larga/mapbiomas_por_poligono.csv",
        "col_anio": "anio",
        "col_valor": "pct_urbano",
        "filtros": None,
        # MapBiomas no tiene 2027 por estilo (es un % saturado para varios
        # barrios consolidados); proyectar 3 horizontes igual.
        "anios_default": [2030, 2035],
        "permite_negativos": False,
        "label": "% cobertura urbana (MapBiomas)",
        "unidad": "%",
    },
    "uhi": {
        "source": "data/processed/calor/uhi_estacional.csv",
        "col_anio": "anio",
        "col_valor": "uhi_vs_rural_mean",
        # UHI viene desagregado por estación; el prompt pide solo verano.
        "filtros": {"estacion": "verano"},
        "anios_default": [2030, 2035],
        "permite_negativos": True,  # un barrio con vegetación puede ser más fresco que rural
        "label": "UHI verano vs rural (°C)",
        "unidad": "°C",
    },
}

# Etiquetas internas → nombre esperado en el CSV de salida (para el frontend).
METRICAS_KEY_TO_OUT = {
    "viviendas": "viviendas",
    "poblacion": "poblacion",
    "urbano": "urbano",
    "uhi": "uhi_verano",
}

# Umbrales de confianza basados en R². Pensados para series cortas
# (8 años) — un R² de 0.7 sobre 8 puntos no es de los mejores, pero
# para extrapolación urbana es lo que la realidad nos da.
UMBRAL_R2_ALTA = 0.85
UMBRAL_R2_MEDIA = 0.55
UMBRAL_R2_DESCARTE = 0.40  # debajo de esto, marcar "baja" y NO ir a 2035

# Diferencia mínima en R² para preferir exponencial sobre lineal.
# Si el exponencial gana por <5 puntos, ganamos en simplicidad con
# el lineal (Occam: ambos modelos cuentan esencialmente la misma
# historia con esa diferencia).
DELTA_R2_OCCAM = 0.05


@dataclass
class ResultadoFit:
    """Resultado del ajuste para una (poligono × métrica)."""

    poligono_id: str
    metrica: str
    modelo_elegido: str  # "lineal" | "exp"
    r2_lineal: float
    r2_exp: float
    n_obs: int
    # Coeficientes del modelo elegido. Para 'lineal': y = intercept + slope*t.
    # Para 'exp': log(y) = intercept + slope*t  →  y = exp(intercept + slope*t).
    intercept: float
    slope: float
    # Varianza residual y media de t — necesarios para CI sobre nuevas predicciones.
    sigma2: float
    t_mean: float
    sxx: float  # Σ(t - t̄)²
    # En log-espacio si exp; sirve para reconstruir CI asimétrico.
    log_space: bool
    confianza: str  # "alta" | "media" | "baja"


# ---------------------------------------------------------------------------
# Carga y normalización de inputs
# ---------------------------------------------------------------------------


def _extraer_anio_de_fecha(fecha_str: str) -> Optional[int]:
    """Convierte ``YYYY-MM`` o ``YYYY-MM-DD`` o ``YYYY`` en entero."""
    if not isinstance(fecha_str, str):
        return None
    s = fecha_str.strip()
    if not s:
        return None
    try:
        return int(s[:4])
    except (ValueError, TypeError):
        return None


def cargar_serie_metrica(
    metrica: str,
    cfg: Dict,
) -> pd.DataFrame:
    """Lee el CSV declarado en config y devuelve un DataFrame con columnas:
    ``poligono_id, anio, valor``.

    Aplica filtros (si los hay) y normaliza columnas. Filas con valores
    no numéricos o NaN se descartan silenciosamente — el llamador puede
    inferirlo del ``n_obs`` final.
    """
    src = resolve_path(cfg["source"])
    if not src.exists():
        logger.error(f"Fuente de '{metrica}' no encontrada: {src}")
        return pd.DataFrame(columns=["poligono_id", "anio", "valor"])

    df = pd.read_csv(src)

    # Filtros simples (ej. estacion=verano para UHI).
    if cfg.get("filtros"):
        for k, v in cfg["filtros"].items():
            if k in df.columns:
                df = df[df[k] == v].copy()

    # Año: viene directo o derivado de una columna de fecha.
    if "col_anio" in cfg:
        df["anio"] = pd.to_numeric(df[cfg["col_anio"]], errors="coerce").astype("Int64")
    elif "col_fecha_a_anio" in cfg:
        df["anio"] = df[cfg["col_fecha_a_anio"]].apply(_extraer_anio_de_fecha).astype("Int64")
    else:
        raise ValueError(f"Métrica {metrica} no declara col_anio ni col_fecha_a_anio")

    df = df.rename(columns={cfg["col_valor"]: "valor"})
    df["valor"] = pd.to_numeric(df["valor"], errors="coerce")

    df["poligono_id"] = df["poligono_id"].astype(str)
    df = df[["poligono_id", "anio", "valor"]].dropna()
    df["anio"] = df["anio"].astype(int)

    # Si hay duplicados (poligono, año) — ej. UHI con varios meses por estación —
    # promediamos. Para las series de viviendas/poblacion/mb hay una observación
    # por año pero igual nos protegemos.
    df = df.groupby(["poligono_id", "anio"], as_index=False)["valor"].mean()
    df = df.sort_values(["poligono_id", "anio"]).reset_index(drop=True)
    return df


# ---------------------------------------------------------------------------
# Ajustes y comparación de modelos
# ---------------------------------------------------------------------------


def _r2_score(y_real: np.ndarray, y_pred: np.ndarray) -> float:
    """R² clásico (coeficiente de determinación). Devuelve NaN si y es constante."""
    y_real = np.asarray(y_real, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    ss_res = float(np.sum((y_real - y_pred) ** 2))
    ss_tot = float(np.sum((y_real - np.mean(y_real)) ** 2))
    if ss_tot < 1e-12:
        return float("nan")
    return 1.0 - ss_res / ss_tot


def _fit_lineal(t: np.ndarray, y: np.ndarray) -> Tuple[float, float, float, float, float, float]:
    """Ajuste OLS y = a + b·t. Devuelve (intercept, slope, r2, sigma2, t_mean, sxx)."""
    n = len(t)
    if n < 3:
        return float("nan"), float("nan"), float("nan"), float("nan"), float("nan"), float("nan")
    # Polyfit de grado 1: [slope, intercept].
    coef = np.polyfit(t, y, 1)
    slope = float(coef[0])
    intercept = float(coef[1])
    y_pred = intercept + slope * t
    r2 = _r2_score(y, y_pred)
    residuos = y - y_pred
    # Varianza residual (insesgada): SSR / (n - 2).
    sigma2 = float(np.sum(residuos ** 2) / max(n - 2, 1))
    t_mean = float(np.mean(t))
    sxx = float(np.sum((t - t_mean) ** 2))
    return intercept, slope, r2, sigma2, t_mean, sxx


def _fit_exp(t: np.ndarray, y: np.ndarray) -> Tuple[float, float, float, float, float, float]:
    """Ajuste log-lineal: log(y) = a + b·t. Solo aplicable si y > 0 estrictamente.

    Si y tiene ceros o negativos, devolvemos NaN en r2 (el llamador descarta
    el modelo).
    """
    n = len(t)
    if n < 3 or np.any(y <= 0):
        return float("nan"), float("nan"), float("nan"), float("nan"), float("nan"), float("nan")
    log_y = np.log(y)
    coef = np.polyfit(t, log_y, 1)
    slope = float(coef[0])
    intercept = float(coef[1])
    log_y_pred = intercept + slope * t
    # R² lo reportamos en escala original para comparabilidad con lineal.
    y_pred = np.exp(log_y_pred)
    r2 = _r2_score(y, y_pred)
    residuos_log = log_y - log_y_pred
    sigma2 = float(np.sum(residuos_log ** 2) / max(n - 2, 1))  # en log-espacio
    t_mean = float(np.mean(t))
    sxx = float(np.sum((t - t_mean) ** 2))
    return intercept, slope, r2, sigma2, t_mean, sxx


def elegir_modelo(
    poligono_id: str,
    metrica: str,
    df_pol: pd.DataFrame,
    permite_negativos: bool,
) -> Optional[ResultadoFit]:
    """Ajusta lineal y exponencial para un polígono y elige el mejor.

    Retorna None si no hay datos suficientes o si la varianza es nula.
    """
    if df_pol.empty:
        return None
    t = df_pol["anio"].to_numpy(dtype=float)
    y = df_pol["valor"].to_numpy(dtype=float)
    n = len(t)
    if n < 3:
        logger.debug(f"  {metrica}/{poligono_id}: n={n} < 3, omitido")
        return None
    # Si y es esencialmente constante, no hay nada que proyectar útilmente:
    # devolvemos lineal con slope=0 y r2 NaN (lo manejamos en confianza).
    var_y = float(np.var(y))
    if var_y < 1e-9:
        logger.debug(f"  {metrica}/{poligono_id}: var(y)≈0, marcado constante")
        return ResultadoFit(
            poligono_id=poligono_id,
            metrica=metrica,
            modelo_elegido="lineal",
            r2_lineal=1.0,  # técnicamente perfecto si y es constante
            r2_exp=float("nan"),
            n_obs=n,
            intercept=float(np.mean(y)),
            slope=0.0,
            sigma2=0.0,
            t_mean=float(np.mean(t)),
            sxx=float(np.sum((t - np.mean(t)) ** 2)) or 1.0,
            log_space=False,
            confianza="alta",
        )

    int_l, slope_l, r2_l, sigma2_l, tm_l, sxx_l = _fit_lineal(t, y)
    # Exp solo si y > 0 estrictamente; para UHI y otros con negativos lo
    # saltamos directo.
    if permite_negativos or np.any(y <= 0):
        int_e, slope_e, r2_e, sigma2_e, tm_e, sxx_e = (
            float("nan"),
            float("nan"),
            float("nan"),
            float("nan"),
            float("nan"),
            float("nan"),
        )
    else:
        int_e, slope_e, r2_e, sigma2_e, tm_e, sxx_e = _fit_exp(t, y)

    # Decisión: ganador por R², con bonus simplicidad para lineal.
    use_exp = (
        not math.isnan(r2_e)
        and not math.isnan(r2_l)
        and (r2_e - r2_l) > DELTA_R2_OCCAM
    )

    if use_exp:
        modelo = "exp"
        intercept = int_e
        slope = slope_e
        sigma2 = sigma2_e
        t_mean = tm_e
        sxx = sxx_e
        log_space = True
    else:
        modelo = "lineal"
        intercept = int_l
        slope = slope_l
        sigma2 = sigma2_l
        t_mean = tm_l
        sxx = sxx_l
        log_space = False

    # Asignación de confianza basada en R² del modelo elegido.
    r2_elegido = r2_e if use_exp else r2_l
    if math.isnan(r2_elegido):
        confianza = "baja"
    elif r2_elegido >= UMBRAL_R2_ALTA:
        confianza = "alta"
    elif r2_elegido >= UMBRAL_R2_MEDIA:
        confianza = "media"
    else:
        confianza = "baja"

    return ResultadoFit(
        poligono_id=poligono_id,
        metrica=metrica,
        modelo_elegido=modelo,
        r2_lineal=r2_l,
        r2_exp=r2_e,
        n_obs=n,
        intercept=intercept,
        slope=slope,
        sigma2=sigma2,
        t_mean=t_mean,
        sxx=sxx if sxx > 0 else 1.0,  # protección división por cero
        log_space=log_space,
        confianza=confianza,
    )


# ---------------------------------------------------------------------------
# Predicción con intervalo de confianza 95 %
# ---------------------------------------------------------------------------


def predecir(
    fit: ResultadoFit,
    anio: int,
    permite_negativos: bool,
    es_porcentaje: bool = False,
) -> Tuple[float, float, float]:
    """Predicción puntual + IC 95 % para un año dado.

    Returns:
        (valor_pred, ci_inferior, ci_superior)

    El IC se calcula con la fórmula de prediction-interval de OLS y se
    anti-loguea si el modelo es exponencial. Para métricas que NO admiten
    negativos (viviendas, población, %), recortamos el límite inferior
    a cero. Para porcentajes, también recortamos a 100 arriba.
    """
    n = fit.n_obs
    if n < 3 or fit.sxx <= 0:
        # Caso degenerado: devolvemos predicción puntual sin banda útil.
        if fit.log_space:
            valor = float(np.exp(fit.intercept + fit.slope * anio))
        else:
            valor = fit.intercept + fit.slope * anio
        return valor, valor, valor

    t = float(anio)
    # SE de la predicción para una observación nueva.
    se_pred = math.sqrt(
        fit.sigma2 * (1.0 + 1.0 / n + (t - fit.t_mean) ** 2 / fit.sxx)
    )
    t_crit = float(scipy_stats.t.ppf(0.975, df=max(n - 2, 1)))
    margen = t_crit * se_pred

    if fit.log_space:
        log_central = fit.intercept + fit.slope * t
        valor = float(np.exp(log_central))
        ci_lo = float(np.exp(log_central - margen))
        ci_hi = float(np.exp(log_central + margen))
    else:
        valor = fit.intercept + fit.slope * t
        ci_lo = valor - margen
        ci_hi = valor + margen

    # Recortes finales según el dominio de la métrica.
    if not permite_negativos:
        valor = max(valor, 0.0)
        ci_lo = max(ci_lo, 0.0)
        ci_hi = max(ci_hi, 0.0)
    if es_porcentaje:
        valor = min(valor, 100.0)
        ci_lo = min(ci_lo, 100.0)
        ci_hi = min(ci_hi, 100.0)

    return valor, ci_lo, ci_hi


# ---------------------------------------------------------------------------
# Pipeline principal
# ---------------------------------------------------------------------------


def procesar_metrica(
    metrica_key: str,
    cfg: Dict,
    anios_solicitados: List[int],
    poligonos_filtrados: Optional[List[str]],
) -> List[Dict]:
    """Procesa una métrica completa (todos los polígonos, todos los años pedidos).

    Devuelve una lista de filas dict listas para volcarse al CSV. Cada
    fila representa (polígono, métrica, año_proyeccion).
    """
    df_serie = cargar_serie_metrica(metrica_key, cfg)
    if df_serie.empty:
        logger.warning(f"  {metrica_key}: serie vacía, sin proyecciones")
        return []

    # Algunas métricas tienen su propio set de años default (UHI no va a 2035
    # por defecto, MapBiomas tampoco proyecta 2027 — ver config).
    anios_pedidos_metrica = anios_solicitados
    if not anios_pedidos_metrica:
        anios_pedidos_metrica = list(cfg["anios_default"])

    permite_neg = bool(cfg.get("permite_negativos"))
    es_pct = cfg["col_valor"].startswith("pct_") or cfg.get("unidad") == "%"

    out_metric_label = METRICAS_KEY_TO_OUT.get(metrica_key, metrica_key)

    resultados: List[Dict] = []
    poligonos = sorted(df_serie["poligono_id"].unique())
    if poligonos_filtrados:
        poligonos = [p for p in poligonos if p in poligonos_filtrados]
        if not poligonos:
            logger.warning(
                f"  {metrica_key}: ningún polígono coincide con --poligono"
            )

    n_lineal, n_exp, n_baja = 0, 0, 0
    for pol_id in poligonos:
        df_pol = df_serie[df_serie["poligono_id"] == pol_id]
        fit = elegir_modelo(pol_id, metrica_key, df_pol, permite_neg)
        if fit is None:
            continue

        # Para UHI con confianza baja, no proyectamos a 2035 — el prompt
        # lo pide explícitamente y honra la incertidumbre del modelo.
        if metrica_key == "uhi" and fit.confianza == "baja":
            anios_validos = [a for a in anios_pedidos_metrica if a <= 2030]
        else:
            anios_validos = list(anios_pedidos_metrica)

        if fit.modelo_elegido == "lineal":
            n_lineal += 1
        else:
            n_exp += 1
        if fit.confianza == "baja":
            n_baja += 1

        for anio in anios_validos:
            valor, lo, hi = predecir(fit, anio, permite_neg, es_porcentaje=es_pct)
            r2_elegido = fit.r2_exp if fit.modelo_elegido == "exp" else fit.r2_lineal
            resultados.append({
                "poligono_id": pol_id,
                "metrica": out_metric_label,
                "anio_proyeccion": int(anio),
                "valor_pred": round(float(valor), 3),
                "ci_inferior": round(float(lo), 3),
                "ci_superior": round(float(hi), 3),
                "modelo": fit.modelo_elegido,
                "r2": round(float(r2_elegido), 4) if not math.isnan(r2_elegido) else None,
                "confianza": fit.confianza,
                "n_obs": int(fit.n_obs),
            })

    logger.info(
        f"  {metrica_key}: {len(resultados)} filas "
        f"(lineal={n_lineal}, exp={n_exp}, conf_baja={n_baja})"
    )
    return resultados


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option(
    "--metricas",
    default="viviendas,poblacion,uhi,urbano",
    help=(
        "Lista coma-separada de métricas a proyectar "
        "(viviendas, poblacion, urbano, uhi). 'all' = todas."
    ),
)
@click.option(
    "--all-metricas",
    is_flag=True,
    default=False,
    help="Atajo para procesar todas las métricas (override de --metricas).",
)
@click.option(
    "--anios",
    default="2027,2030,2035",
    help=(
        "Años a proyectar, coma-separados. Cada métrica sigue su lógica "
        "propia de 'no extrapolar más de la cuenta' si la confianza es baja."
    ),
)
@click.option(
    "--poligono",
    default="",
    help="Si se especifica, proyecta solo ese polígono_id (debug).",
)
@click.option(
    "--output-dir",
    default="data/processed/proyecciones",
    type=click.Path(),
    help="Directorio donde se escribe proyecciones_por_poligono.csv y _metadata.json.",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def cli(
    metricas: str,
    all_metricas: bool,
    anios: str,
    poligono: str,
    output_dir: str,
    log_level: str,
) -> None:
    """Pipeline completo de proyecciones (lineal + exp con IC 95 %)."""
    setup_logger(nivel=log_level)
    logger.info("=" * 60)
    logger.info(f"Proyecciones futuras — v{SCRIPT_VERSION}")
    logger.info("=" * 60)

    # --- parseo de opciones ---
    if all_metricas or metricas.strip().lower() == "all":
        metricas_lista = list(METRICAS_CONFIG.keys())
    else:
        metricas_lista = [m.strip() for m in metricas.split(",") if m.strip()]
    metricas_invalidas = [m for m in metricas_lista if m not in METRICAS_CONFIG]
    if metricas_invalidas:
        logger.error(f"Métricas no soportadas: {metricas_invalidas}. Disponibles: {list(METRICAS_CONFIG.keys())}")
        sys.exit(2)

    try:
        anios_lista = [int(a.strip()) for a in anios.split(",") if a.strip()]
    except ValueError:
        logger.error(f"Lista de años inválida: {anios}")
        sys.exit(2)
    if not anios_lista:
        logger.error("--anios vacío.")
        sys.exit(2)

    poligonos_filtro: Optional[List[str]] = None
    if poligono.strip():
        poligonos_filtro = [poligono.strip()]
        logger.info(f"Filtrando a polígono único: {poligono.strip()}")

    out_dir = ensure_dir(resolve_path(output_dir))
    logger.info(f"Output dir: {out_dir}")
    logger.info(f"Métricas: {metricas_lista}")
    logger.info(f"Años:     {anios_lista}")

    # --- procesamiento ---
    todas_filas: List[Dict] = []
    for metrica in metricas_lista:
        logger.info(f"Procesando métrica '{metrica}'...")
        cfg = METRICAS_CONFIG[metrica]
        filas = procesar_metrica(metrica, cfg, anios_lista, poligonos_filtro)
        todas_filas.extend(filas)

    if not todas_filas:
        logger.error("No se generaron proyecciones — abortando sin escribir CSV.")
        sys.exit(3)

    # --- persistencia ---
    df_out = pd.DataFrame(todas_filas)
    # Reordeno columnas según el contrato declarado en el prompt.
    cols_order = [
        "poligono_id",
        "metrica",
        "anio_proyeccion",
        "valor_pred",
        "ci_inferior",
        "ci_superior",
        "modelo",
        "r2",
        "confianza",
        "n_obs",
    ]
    df_out = df_out[cols_order].sort_values(
        ["metrica", "poligono_id", "anio_proyeccion"]
    ).reset_index(drop=True)

    csv_path = out_dir / "proyecciones_por_poligono.csv"
    df_out.to_csv(csv_path, index=False, encoding="utf-8")
    logger.info(f"proyecciones_por_poligono.csv -> {len(df_out)} filas en {csv_path}")

    # Estadísticas para el metadata + el log final.
    distribucion_modelo = df_out["modelo"].value_counts().to_dict()
    distribucion_confianza = df_out["confianza"].value_counts().to_dict()

    metadata = {
        "script_version": SCRIPT_VERSION,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "parametros": {
            "metricas": metricas_lista,
            "anios": anios_lista,
            "poligono_filtro": poligonos_filtro,
        },
        "n_filas_total": int(len(df_out)),
        "n_poligonos_unicos": int(df_out["poligono_id"].nunique()),
        "distribucion_modelo": {str(k): int(v) for k, v in distribucion_modelo.items()},
        "distribucion_confianza": {str(k): int(v) for k, v in distribucion_confianza.items()},
        "umbrales_confianza": {
            "alta_min_r2": UMBRAL_R2_ALTA,
            "media_min_r2": UMBRAL_R2_MEDIA,
            "descarte_max_r2": UMBRAL_R2_DESCARTE,
            "delta_r2_occam": DELTA_R2_OCCAM,
        },
        "intervalo_confianza_pct": 95,
        "metodologia": (
            "Regresión lineal y log-lineal (exponencial) ajustadas por OLS "
            "sobre el histórico por polígono. El modelo elegido es el de "
            "mayor R², con bonus por simplicidad (lineal preferido si "
            "Δ R² < 0.05). El intervalo de confianza usa la fórmula "
            "analítica de prediction-interval para regresión OLS, con "
            "ampliación Student-t (n-2 g.l.) al percentil 0.975. Para "
            "modelos exponenciales el IC se computa en log-espacio y "
            "luego se anti-loguea (asimétrico)."
        ),
        "limitaciones_conocidas": [
            "Series de 8 años (viviendas/población) son cortas para "
            "extrapolar 10 años a 2035.",
            "El IC es solo de la regresión: no incluye epistemic "
            "uncertainty (incertidumbre sobre la elección del modelo).",
            "Cambios estructurales (políticas, eventos climáticos, "
            "crisis económica) NO se modelan.",
            "Para % saturados (urbano cerca de 100 %), la pendiente "
            "lineal tiende a cero y el R² puede ser inestable.",
            "UHI con R² < 0.4 no se proyecta a 2035 (confianza='baja').",
        ],
    }
    meta_path = out_dir / "_metadata.json"
    meta_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(f"_metadata.json -> {meta_path}")

    # --- resumen final con highlights ---
    logger.info("=" * 60)
    logger.info(f"  total filas          : {len(df_out)}")
    logger.info(f"  polígonos únicos     : {df_out['poligono_id'].nunique()}")
    logger.info(f"  distribución modelo  : {distribucion_modelo}")
    logger.info(f"  distribución conf.   : {distribucion_confianza}")

    # Top 3 viviendas 2035.
    df_viv_2035 = df_out[
        (df_out["metrica"] == "viviendas") & (df_out["anio_proyeccion"] == 2035)
    ].copy()
    if not df_viv_2035.empty:
        # Crecimiento absoluto desde 2026 (último año real). Aproximamos
        # con base = primera proyección sólida; basta con valor_pred 2035.
        top_viv = df_viv_2035.sort_values("valor_pred", ascending=False).head(3)
        logger.info("Top 3 barrios viviendas proyectadas 2035:")
        for _, r in top_viv.iterrows():
            logger.info(
                f"   - {r['poligono_id']:30s} {int(r['valor_pred']):6d} "
                f"viv (modelo={r['modelo']}, R²={r['r2']}, {r['confianza']})"
            )

    df_uhi_2030 = df_out[
        (df_out["metrica"] == "uhi_verano") & (df_out["anio_proyeccion"] == 2030)
    ].copy()
    if not df_uhi_2030.empty:
        top_uhi = df_uhi_2030.sort_values("valor_pred", ascending=False).head(3)
        logger.info("Top 3 barrios UHI verano proyectado 2030:")
        for _, r in top_uhi.iterrows():
            logger.info(
                f"   - {r['poligono_id']:30s} {r['valor_pred']:+6.2f} °C "
                f"(modelo={r['modelo']}, R²={r['r2']}, {r['confianza']})"
            )

    logger.info("=" * 60)
    logger.info("Proyecciones listas. Próximo paso: 80_sync_webapp.py")


if __name__ == "__main__":
    cli()
