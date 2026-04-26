"""Capa social — Ranking político de prioridad de inversión por polígono.

Tarea Fase 3 (capa social, segunda parte).

Cruza tres dimensiones para producir un índice agregado y un ranking de
prioridad **política / presupuestaria** entre los polígonos monitoreados:

1. **Vulnerabilidad** territorial (script ``35_indice_vulnerabilidad.py``,
   versión ``v0-borrador``). Mide carencias relativas de servicios,
   crecimiento, densidad, etc.
2. **UHI estacional verano** (script ``49_calor_pipeline.py``). Mide
   intensidad de isla de calor diurna en el verano más reciente, métrica
   ``uhi_vs_rural_mean`` (delta °C contra polígonos rurales).
3. **Acceso a servicios públicos** (script ``53_servicios_distancias.py``).
   Distancia mínima a CAPS, escuela, hospital y transporte.

Fórmula
-------

::

    indice_prioridad = 0.4 * vulnerabilidad_norm
                     + 0.3 * uhi_verano_norm
                     + 0.3 * (1 - acceso_servicios_norm)

Cada término normalizado a [0, 1] por min-max sobre el set actual.

- Mayor ``indice_prioridad`` → **mayor prioridad de inversión política**.
- ``acceso_servicios_norm`` se invierte (``1 - x``) porque acceso *bueno*
  (más bajo en distancia) significa *menor* prioridad.

Pesos
-----

Los pesos por defecto se justifican así:

- 0.4 a vulnerabilidad: es el indicador compuesto más completo (incluye
  varias dimensiones en sí mismo) y el de mayor confianza (consensuado
  con el equipo en Fase 2). Le damos más peso.
- 0.3 a UHI verano: el calor es la única señal ambiental con efecto
  inmediato sobre salud (hospitalizaciones por ola de calor). Es nueva
  pero crítica para Posadas (verano 2024 batió récords).
- 0.3 a acceso a servicios: complementa vulnerabilidad sin duplicar; la
  vulnerabilidad usa solo CAPS y escuela, este indicador agrega
  hospital y transporte.

Disclaimer importante
---------------------

Este ranking es un **insumo técnico para priorizar inversión a nivel
barrio**, NO una herramienta de decisión sobre individuos. Ver
``docs/metodologia_servicios.md`` sección "Cómo NO usar el ranking".

Output
------

``data/processed/social/ranking_politico.csv`` con columnas:

- ``poligono_id``
- ``vulnerabilidad`` — score 0-100 del CSV vulnerabilidad_v0.
- ``uhi_verano`` — delta °C vs rural en el verano más reciente.
- ``acceso_servicios_norm`` — promedio normalizado de las 4 distancias
  (0 = mejor acceso, 1 = peor acceso).
- ``vulnerabilidad_norm`` — vulnerabilidad min-max [0, 1].
- ``uhi_verano_norm`` — UHI min-max [0, 1].
- ``indice_prioridad`` — score final [0, 1], mayor = más prioridad.
- ``ranking`` — posición ordinal 1..N.

Uso
---
    python scripts/54_ranking_politico.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Dict, Optional

import click
import pandas as pd
from loguru import logger

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

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path


# ---------------------------------------------------------------------------
# Pesos (ajustables por flag --pesos)
# ---------------------------------------------------------------------------

PESOS_DEFAULT: Dict[str, float] = {
    "vulnerabilidad": 0.4,
    "uhi_verano": 0.3,
    "acceso_servicios": 0.3,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _min_max(serie: pd.Series, invertir: bool = False) -> pd.Series:
    """Normaliza min-max a [0, 1]. NaN → 0.5 (neutralizado).

    Args:
        serie: valores numéricos.
        invertir: si True, valores altos del input → 0 y valores bajos → 1.
    """
    s = serie.astype(float)
    finitos = s[s.notna() & s.apply(math.isfinite)]
    if finitos.empty:
        return pd.Series([0.5] * len(s), index=s.index, dtype=float)
    mn = finitos.min()
    mx = finitos.max()
    if mx == mn:
        return pd.Series([0.5] * len(s), index=s.index, dtype=float)
    n = (s - mn) / (mx - mn)
    if invertir:
        n = 1.0 - n
    return n.fillna(0.5)


def _cargar_vulnerabilidad(path: Path) -> pd.DataFrame:
    """Carga el CSV de vulnerabilidad con columnas ``poligono_id, score``.

    Acepta los CSVs ``v0-borrador`` con columna ``score`` (0-100).
    """
    if not path.exists():
        raise FileNotFoundError(f"No se encontró vulnerabilidad en {path}.")
    df = pd.read_csv(path)
    if "poligono_id" not in df.columns or "score" not in df.columns:
        raise ValueError(
            f"CSV vulnerabilidad mal formado: faltan columnas en {path}."
        )
    df["poligono_id"] = df["poligono_id"].astype(str)
    df = df[["poligono_id", "score"]].rename(columns={"score": "vulnerabilidad"})
    logger.info(f"  vulnerabilidad: {len(df)} polígonos.")
    return df


def _cargar_uhi_verano(path: Path) -> pd.DataFrame:
    """Carga UHI estacional, se queda con la fila ``estacion='verano'`` más reciente.

    Output: DataFrame con ``poligono_id, uhi_verano`` (delta °C vs rural).
    """
    if not path.exists():
        raise FileNotFoundError(f"No se encontró UHI estacional en {path}.")
    df = pd.read_csv(path)
    requeridas = {"poligono_id", "anio", "estacion", "uhi_vs_rural_mean"}
    if not requeridas.issubset(df.columns):
        raise ValueError(
            f"CSV UHI estacional mal formado: faltan columnas {requeridas - set(df.columns)}."
        )
    df["poligono_id"] = df["poligono_id"].astype(str)
    df = df[df["estacion"].str.lower() == "verano"]
    if df.empty:
        logger.warning("UHI estacional no tiene filas con estacion='verano'.")
        return pd.DataFrame(columns=["poligono_id", "uhi_verano"])
    # Quedarnos con la fila del verano más reciente por polígono.
    df = df.sort_values(["poligono_id", "anio"]).groupby("poligono_id").tail(1)
    out = df[["poligono_id", "uhi_vs_rural_mean"]].rename(
        columns={"uhi_vs_rural_mean": "uhi_verano"}
    )
    logger.info(f"  uhi_verano: {len(out)} polígonos (verano más reciente).")
    return out


def _cargar_distancias(path: Path) -> pd.DataFrame:
    """Carga distancias del script 53 y computa un score promedio normalizado.

    Returns:
        DataFrame con ``poligono_id`` y las 4 distancias originales más
        un ``acceso_servicios_norm`` que es el promedio (0-1) de las
        4 distancias normalizadas (mayor = peor acceso).
    """
    if not path.exists():
        raise FileNotFoundError(f"No se encontró distancias en {path}.")
    df = pd.read_csv(path)
    requeridas = {
        "poligono_id",
        "dist_caps_m",
        "dist_escuela_m",
        "dist_hospital_m",
        "dist_transporte_m",
    }
    if not requeridas.issubset(df.columns):
        raise ValueError(
            f"CSV distancias mal formado: faltan columnas {requeridas - set(df.columns)}."
        )
    df["poligono_id"] = df["poligono_id"].astype(str)

    # Normalizamos cada distancia a [0,1] (más alto = peor acceso) y promediamos.
    n_caps = _min_max(df["dist_caps_m"], invertir=False)
    n_esc = _min_max(df["dist_escuela_m"], invertir=False)
    n_hosp = _min_max(df["dist_hospital_m"], invertir=False)
    n_tra = _min_max(df["dist_transporte_m"], invertir=False)
    df["acceso_servicios_norm"] = (n_caps + n_esc + n_hosp + n_tra) / 4.0
    df["acceso_servicios_norm"] = df["acceso_servicios_norm"].round(4)
    logger.info(f"  distancias: {len(df)} polígonos.")
    return df[
        [
            "poligono_id",
            "dist_caps_m",
            "dist_escuela_m",
            "dist_hospital_m",
            "dist_transporte_m",
            "acceso_servicios_norm",
        ]
    ]


# ---------------------------------------------------------------------------
# Cálculo principal
# ---------------------------------------------------------------------------


def _construir_ranking(
    df_vuln: pd.DataFrame,
    df_uhi: pd.DataFrame,
    df_dist: pd.DataFrame,
    pesos: Dict[str, float],
) -> pd.DataFrame:
    """Une los tres datasets, normaliza y construye el ranking final."""
    # Outer join sobre las distancias (que tiene los 40 polígonos),
    # vulnerabilidad y UHI quizás no estén para todos.
    df = df_dist.merge(df_vuln, on="poligono_id", how="left")
    df = df.merge(df_uhi, on="poligono_id", how="left")

    # Normalización de cada componente a [0, 1].
    df["vulnerabilidad_norm"] = _min_max(df["vulnerabilidad"], invertir=False).round(4)
    df["uhi_verano_norm"] = _min_max(df["uhi_verano"], invertir=False).round(4)

    # acceso_servicios_norm ya es 0-1 (mayor = peor); para "prioridad" usamos
    # tal cual: 0 acceso → score alto. La fórmula del prompt dice
    # `(1 - acceso_servicios_normalizado)`, lo cual asume que el
    # `acceso_servicios_normalizado` representa *qué tan bueno* es el acceso.
    # Por consistencia con esa convención, definimos:
    #   acceso_norm_bueno = 1 - acceso_servicios_norm  (1 = excelente acceso)
    #   componente_acceso = 1 - acceso_norm_bueno = acceso_servicios_norm
    # O sea: el componente "carencia de acceso" = acceso_servicios_norm tal cual.
    df["indice_prioridad"] = (
        pesos["vulnerabilidad"] * df["vulnerabilidad_norm"].fillna(0.5)
        + pesos["uhi_verano"] * df["uhi_verano_norm"].fillna(0.5)
        + pesos["acceso_servicios"] * df["acceso_servicios_norm"].fillna(0.5)
    ).round(4)

    df = df.sort_values("indice_prioridad", ascending=False).reset_index(drop=True)
    df["ranking"] = df.index + 1

    cols_out = [
        "poligono_id",
        "vulnerabilidad",
        "uhi_verano",
        "dist_caps_m",
        "dist_escuela_m",
        "dist_hospital_m",
        "dist_transporte_m",
        "vulnerabilidad_norm",
        "uhi_verano_norm",
        "acceso_servicios_norm",
        "indice_prioridad",
        "ranking",
    ]
    return df[cols_out]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option(
    "--vulnerabilidad",
    default="data/processed/vulnerabilidad_v0.csv",
    type=click.Path(),
    help="CSV de vulnerabilidad (script 35). Acepta `_fresh` también.",
)
@click.option(
    "--uhi",
    default="data/processed/calor/uhi_estacional.csv",
    type=click.Path(),
    help="CSV UHI estacional (script 49).",
)
@click.option(
    "--distancias",
    default="data/processed/social/distancias_por_poligono.csv",
    type=click.Path(),
    help="CSV de distancias por polígono (script 53).",
)
@click.option(
    "--output",
    default="data/processed/social/ranking_politico.csv",
    type=click.Path(),
    help="CSV de salida con ranking.",
)
@click.option(
    "--peso-vulnerabilidad",
    default=PESOS_DEFAULT["vulnerabilidad"],
    type=float,
    help="Peso de vulnerabilidad (default 0.4).",
)
@click.option(
    "--peso-uhi",
    default=PESOS_DEFAULT["uhi_verano"],
    type=float,
    help="Peso de UHI verano (default 0.3).",
)
@click.option(
    "--peso-acceso",
    default=PESOS_DEFAULT["acceso_servicios"],
    type=float,
    help="Peso de carencia de acceso a servicios (default 0.3).",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    vulnerabilidad: str,
    uhi: str,
    distancias: str,
    output: str,
    peso_vulnerabilidad: float,
    peso_uhi: float,
    peso_acceso: float,
    log_level: str,
) -> None:
    """Construye el ranking político de prioridad de inversión por polígono."""
    setup_logger(nivel=log_level)

    pesos = {
        "vulnerabilidad": peso_vulnerabilidad,
        "uhi_verano": peso_uhi,
        "acceso_servicios": peso_acceso,
    }
    total = sum(pesos.values())
    if abs(total - 1.0) > 1e-3:
        logger.warning(
            f"Pesos suman {total:.3f} ≠ 1.0 — los renormalizo proporcionalmente."
        )
        pesos = {k: v / total for k, v in pesos.items()}
    logger.info(f"Pesos efectivos: {pesos}")

    vuln_path = resolve_path(vulnerabilidad)
    uhi_path = resolve_path(uhi)
    dist_path = resolve_path(distancias)
    out_path = resolve_path(output)
    ensure_parent(out_path)

    try:
        logger.info("Cargando datasets fuente.")
        df_vuln = _cargar_vulnerabilidad(vuln_path)
        df_uhi = _cargar_uhi_verano(uhi_path)
        df_dist = _cargar_distancias(dist_path)

        logger.info("Construyendo ranking.")
        df_out = _construir_ranking(df_vuln, df_uhi, df_dist, pesos)

        df_out.to_csv(out_path, index=False, encoding="utf-8")
        logger.info(f"CSV guardado en {out_path} ({len(df_out)} filas).")

        # Top y bottom para informar.
        top5 = df_out.head(5)[["ranking", "poligono_id", "indice_prioridad"]]
        bot5 = df_out.tail(5)[["ranking", "poligono_id", "indice_prioridad"]]
        logger.info(f"Top 5 prioridad:\n{top5.to_string(index=False)}")
        logger.info(f"Bottom 5 (mejor situación):\n{bot5.to_string(index=False)}")

    except Exception as exc:
        logger.exception(f"Error en script 54: {exc}")
        sys.exit(2)


if __name__ == "__main__":
    main()
