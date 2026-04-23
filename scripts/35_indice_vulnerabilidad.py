"""Indicador compuesto de vulnerabilidad — BORRADOR METODOLOGICO.

Tarea 2.5 — Fase 2.

==============================================================================
DISCLAIMER CRITICO — LEER ANTES DE USAR
==============================================================================

Este indicador NO reemplaza la NBI oficial del INDEC ni cualquier otro
índice de vulnerabilidad oficial (IPM, Gini, índice de NBI por radio,
etc.). Es una estimación proxy construida a partir de sensado remoto,
OSM y registros administrativos, útil únicamente para **priorización
interna de recorridas, inversión y análisis** por parte del equipo
técnico del Observatorio Urbano Posadas.

**NO debe usarse** para tomar decisiones de política pública con efectos
legales sobre individuos (asignación de subsidios, tarifas diferenciadas,
criterios de elegibilidad de beneficiarios, etc.). Tales decisiones
requieren fuentes oficiales del INDEC y del IPEC Misiones.

Los pesos por defecto son **arbitrarios** y están a la espera de
calibración empírica con datos censales 2022 cuando estén disponibles
en formato abierto para Posadas. Esta versión está etiquetada
``v0-borrador`` en el output para que cualquier consumidor sepa el
estado de madurez.

==============================================================================

Componentes del score
---------------------
Cada xi se normaliza 0-1 por min-max sobre el set de polígonos del run.
Signo en cada variable se orienta de modo que **valores más altos = mayor
vulnerabilidad**.

- ``crecimiento_5anios``: tasa de crecimiento de viviendas últimos 5 años
  (más rápido → mayor presión de infraestructura → mayor vulnerabilidad).
- ``densidad_actual``: viviendas por km² (más densidad → mayor
  vulnerabilidad de servicios).
- ``distancia_caps_norm``: distancia al CAPS/clinic más cercano
  (más lejos → peor acceso a salud).
- ``distancia_escuela_norm``: distancia a escuela más cercana.
- ``cobertura_pavimento``: fracción de longitud vial **no pavimentada**
  internamente (se invierte para que "peor" sea alto).
- ``riesgo_inundacion``: placeholder 0 por default. En Fase 3 se estima
  con DEM / cota respecto del Paraná / Sentinel-1. Se puede sobreescribir
  por polígono con un CSV ``riesgo_inundacion.csv`` de dos columnas.

Pesos por defecto (suma 1.0)::

    crecimiento     0.25
    densidad        0.15
    distancia_caps  0.20
    distancia_esc   0.15
    pavimento       0.15
    inundacion      0.10

Se pueden pisar vía ``--pesos config/pesos_vulnerabilidad.yaml`` que tenga
el mismo esquema.

Score final
-----------
``score = sum(w_i * x_i_norm) * 100``  ∈ [0, 100]
Interpretación: 0 = menos vulnerable del set, 100 = más vulnerable del set.
Es un ranking relativo, **no absoluto**.

Output
------
``data/processed/vulnerabilidad_v0.csv`` con columnas:

- ``poligono_id``
- ``score``
- ``componentes_json``: JSON stringificado con cada xi crudo, xi
  normalizado y su peso.
- ``version_metodologia`` = ``"v0-borrador"``
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

import click
import pandas as pd
from loguru import logger

try:
    import geopandas as gpd  # type: ignore
    import yaml  # type: ignore
except ImportError:  # pragma: no cover
    gpd = None
    yaml = None

from scripts.utils.config import load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path

# ---------------------------------------------------------------------------
# Pesos default
# ---------------------------------------------------------------------------

PESOS_DEFAULT: Dict[str, float] = {
    "crecimiento": 0.25,
    "densidad": 0.15,
    "distancia_caps": 0.20,
    "distancia_escuela": 0.15,
    "pavimento": 0.15,
    "inundacion": 0.10,
}
VERSION_METODOLOGIA = "v0-borrador"


def _validar_pesos(p: Dict[str, float]) -> Dict[str, float]:
    """Verifica que todas las claves existen y sum≈1 (normaliza si no)."""
    faltantes = set(PESOS_DEFAULT) - set(p)
    extras = set(p) - set(PESOS_DEFAULT)
    if faltantes:
        logger.warning(
            f"Pesos faltantes {faltantes} — se completan con default."
        )
        for k in faltantes:
            p[k] = PESOS_DEFAULT[k]
    if extras:
        logger.warning(f"Pesos desconocidos {extras} — ignorados.")
        for k in extras:
            p.pop(k, None)
    total = sum(p.values())
    if abs(total - 1.0) > 1e-3:
        logger.warning(
            f"Pesos suman {total:.3f} ≠ 1.0 — los renormalizo proporcionalmente."
        )
        p = {k: v / total for k, v in p.items()}
    return p


# ---------------------------------------------------------------------------
# Normalización min-max
# ---------------------------------------------------------------------------


def _min_max(serie: pd.Series, invertir: bool = False) -> pd.Series:
    """Normaliza una serie numérica a [0, 1] con min-max.

    Args:
        serie: valores numéricos. NaN se mantienen NaN.
        invertir: si True, valores altos → 0, valores bajos → 1.
    """
    s = serie.astype(float)
    mn = s.min(skipna=True)
    mx = s.max(skipna=True)
    if not math.isfinite(mn) or not math.isfinite(mx) or mx == mn:
        return pd.Series([0.5] * len(s), index=s.index, dtype=float)
    n = (s - mn) / (mx - mn)
    if invertir:
        n = 1.0 - n
    return n


# ---------------------------------------------------------------------------
# Carga y cálculo de cobertura de pavimento desde OSM
# ---------------------------------------------------------------------------


def _cobertura_pavimento(
    poligonos_gdf, calles_gdf, crs_metrico: str
) -> pd.Series:
    """Calcula fracción de longitud vial interna con ``surface`` no pavimentado.

    Returns:
        Series index=poligono_id con fracción no-pavimentada en [0, 1].
        Polígonos sin calles internas devuelven NaN (→ 0.5 luego en min-max).
    """
    SURFACES_PAVIMENTO = {
        "paved",
        "asphalt",
        "concrete",
        "concrete:plates",
        "concrete:lanes",
        "paving_stones",
        "cobblestone",
        "sett",
    }
    gdf_p = poligonos_gdf.to_crs(crs_metrico)
    gdf_c = calles_gdf.to_crs(crs_metrico)

    out: Dict[str, float] = {}
    for _, row in gdf_p.iterrows():
        pid = str(row.get("poligono_id"))
        dentro = gdf_c[gdf_c.intersects(row.geometry)]
        if dentro.empty:
            out[pid] = math.nan
            continue
        clipped = dentro.copy()
        clipped["geometry"] = clipped.geometry.intersection(row.geometry)
        clipped = clipped[~clipped.geometry.is_empty]
        largo_total = clipped.geometry.length.sum()
        if largo_total <= 0:
            out[pid] = math.nan
            continue
        surf = clipped.get("surface")
        if surf is None:
            no_pav = 1.0  # si nadie tiene 'surface' declarado, asumimos no pavimentado
        else:
            pav_mask = surf.fillna("").str.lower().isin(SURFACES_PAVIMENTO)
            largo_pav = clipped[pav_mask].geometry.length.sum()
            frac_pav = float(largo_pav / largo_total)
            no_pav = 1.0 - frac_pav
        out[pid] = float(no_pav)
    return pd.Series(out, name="cobertura_pavimento_invertida")


# ---------------------------------------------------------------------------
# Ensamblaje del dataset de componentes
# ---------------------------------------------------------------------------


@dataclass
class Inputs:
    serie_temporal: Optional[Path]
    servicios: Optional[Path]
    poligonos: Path
    calles: Optional[Path]
    riesgo_inundacion: Optional[Path]


def _cargar_componentes(inputs: Inputs, crs_metrico: str) -> pd.DataFrame:
    """Construye el DataFrame poligono_id × variables crudas."""
    if gpd is None:
        raise RuntimeError("geopandas no está instalado.")

    # --- Polígonos base ---
    gdf_poli = gpd.read_file(inputs.poligonos)
    if "poligono_id" not in gdf_poli.columns:
        gdf_poli["poligono_id"] = gdf_poli.index.astype(str)
    gdf_poli["poligono_id"] = gdf_poli["poligono_id"].astype(str)

    # Área para densidad
    gdf_poli_m = gdf_poli.to_crs(crs_metrico)
    area_km2 = gdf_poli_m.geometry.area / 1e6
    df = pd.DataFrame(
        {
            "poligono_id": gdf_poli["poligono_id"].values,
            "area_km2": area_km2.values,
        }
    )

    # --- Crecimiento y viviendas actuales desde serie temporal ---
    if inputs.serie_temporal and inputs.serie_temporal.exists():
        st = pd.read_csv(inputs.serie_temporal)
        st["fecha"] = pd.to_datetime(st["fecha"], errors="coerce")
        st = st.dropna(subset=["fecha"])
        crec: Dict[str, float] = {}
        dens: Dict[str, float] = {}
        for pid, sub in st.groupby("poligono_id"):
            sub = sub.sort_values("fecha")
            ultimo = sub.iloc[-1]
            hace_5 = sub[sub["fecha"] <= ultimo["fecha"] - pd.DateOffset(years=5)]
            if hace_5.empty:
                base = sub.iloc[0]
            else:
                base = hace_5.iloc[-1]
            n_hoy = float(ultimo.get("n_edificios") or 0)
            n_base = float(base.get("n_edificios") or 0)
            if n_base <= 0:
                tasa = math.nan
            else:
                tasa = (n_hoy - n_base) / n_base  # fraccional; 1.0 = duplicó
            crec[str(pid)] = tasa
            dens[str(pid)] = n_hoy  # viviendas absolutas, luego /km²
        df["n_edificios_actual"] = df["poligono_id"].map(dens)
        df["crecimiento_5anios"] = df["poligono_id"].map(crec)
    else:
        logger.warning(
            f"No hay serie temporal en {inputs.serie_temporal} — "
            "crecimiento y densidad quedan NaN."
        )
        df["n_edificios_actual"] = math.nan
        df["crecimiento_5anios"] = math.nan

    df["densidad_actual"] = df["n_edificios_actual"] / df["area_km2"]

    # --- Distancia a servicios ---
    if inputs.servicios and inputs.servicios.exists():
        svc = pd.read_csv(inputs.servicios)
        def _dist(familia: str) -> pd.Series:
            sub = svc[svc["tipo_servicio"] == familia]
            sub = sub.groupby("poligono_id")["distancia_minima_m"].min()
            return sub
        dc = _dist("caps_clinic")
        de = _dist("escuela")
        df["distancia_caps_m"] = df["poligono_id"].map(dc)
        df["distancia_escuela_m"] = df["poligono_id"].map(de)
    else:
        logger.warning(
            f"No hay CSV de servicios en {inputs.servicios} — "
            "distancias quedan NaN."
        )
        df["distancia_caps_m"] = math.nan
        df["distancia_escuela_m"] = math.nan

    # --- Cobertura de pavimento desde OSM calles ---
    if inputs.calles and inputs.calles.exists():
        calles_gdf = gpd.read_file(inputs.calles)
        cobertura = _cobertura_pavimento(gdf_poli, calles_gdf, crs_metrico)
        df["pavimento_invertido"] = df["poligono_id"].map(cobertura)
    else:
        logger.warning(
            f"No hay calles OSM en {inputs.calles} — "
            "cobertura pavimento queda NaN."
        )
        df["pavimento_invertido"] = math.nan

    # --- Riesgo de inundación (override manual / placeholder) ---
    if inputs.riesgo_inundacion and inputs.riesgo_inundacion.exists():
        ri = pd.read_csv(inputs.riesgo_inundacion)
        df["riesgo_inundacion"] = df["poligono_id"].map(
            ri.set_index("poligono_id")["riesgo_inundacion"]
        )
    else:
        df["riesgo_inundacion"] = 0.0  # placeholder Fase 3

    return df


# ---------------------------------------------------------------------------
# Score
# ---------------------------------------------------------------------------


def _construir_score(df: pd.DataFrame, pesos: Dict[str, float]) -> pd.DataFrame:
    """Normaliza cada componente y computa score ponderado."""
    norm = pd.DataFrame({"poligono_id": df["poligono_id"]})
    # Todas las variables ya están orientadas (valor alto = peor) salvo
    # pavimento_invertido que ya es "no-pavimentado", así que todas con
    # invertir=False.
    norm["crecimiento_n"] = _min_max(df["crecimiento_5anios"], invertir=False)
    norm["densidad_n"] = _min_max(df["densidad_actual"], invertir=False)
    norm["distancia_caps_n"] = _min_max(df["distancia_caps_m"], invertir=False)
    norm["distancia_escuela_n"] = _min_max(df["distancia_escuela_m"], invertir=False)
    norm["pavimento_n"] = _min_max(df["pavimento_invertido"], invertir=False)
    norm["inundacion_n"] = _min_max(df["riesgo_inundacion"], invertir=False)

    # Cualquier NaN → 0.5 (neutralizado) con flag para documentación.
    missing_cols = norm.isna().any()
    if missing_cols.any():
        logger.info(
            "Normalizando valores faltantes a 0.5 (neutral) en columnas: "
            f"{list(missing_cols[missing_cols].index)}"
        )
        norm = norm.fillna(0.5)

    score_raw = (
        norm["crecimiento_n"] * pesos["crecimiento"]
        + norm["densidad_n"] * pesos["densidad"]
        + norm["distancia_caps_n"] * pesos["distancia_caps"]
        + norm["distancia_escuela_n"] * pesos["distancia_escuela"]
        + norm["pavimento_n"] * pesos["pavimento"]
        + norm["inundacion_n"] * pesos["inundacion"]
    )

    out = pd.DataFrame(
        {
            "poligono_id": df["poligono_id"],
            "score": (score_raw * 100.0).round(2),
        }
    )
    # Componentes JSON por fila: crudo + normalizado + peso
    def _compo_fila(i: int) -> str:
        fila = df.iloc[i]
        norm_fila = norm.iloc[i]
        return json.dumps(
            {
                "crecimiento": {
                    "crudo": _f(fila["crecimiento_5anios"]),
                    "norm": _f(norm_fila["crecimiento_n"]),
                    "peso": pesos["crecimiento"],
                },
                "densidad": {
                    "crudo": _f(fila["densidad_actual"]),
                    "norm": _f(norm_fila["densidad_n"]),
                    "peso": pesos["densidad"],
                },
                "distancia_caps": {
                    "crudo_m": _f(fila["distancia_caps_m"]),
                    "norm": _f(norm_fila["distancia_caps_n"]),
                    "peso": pesos["distancia_caps"],
                },
                "distancia_escuela": {
                    "crudo_m": _f(fila["distancia_escuela_m"]),
                    "norm": _f(norm_fila["distancia_escuela_n"]),
                    "peso": pesos["distancia_escuela"],
                },
                "pavimento": {
                    "crudo_no_pav_frac": _f(fila["pavimento_invertido"]),
                    "norm": _f(norm_fila["pavimento_n"]),
                    "peso": pesos["pavimento"],
                },
                "inundacion": {
                    "crudo": _f(fila["riesgo_inundacion"]),
                    "norm": _f(norm_fila["inundacion_n"]),
                    "peso": pesos["inundacion"],
                },
            },
            ensure_ascii=False,
        )

    out["componentes_json"] = [_compo_fila(i) for i in range(len(df))]
    out["version_metodologia"] = VERSION_METODOLOGIA
    return out


def _f(x) -> Optional[float]:
    """Serializa floats NaN-safe para JSON."""
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(x) or math.isinf(x):
        return None
    return round(x, 4)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option(
    "--poligonos",
    default="config/poligonos.geojson",
    type=click.Path(exists=True),
)
@click.option(
    "--serie-temporal",
    default="data/processed/conteos/serie_temporal.csv",
    type=click.Path(),
    help="CSV de serie temporal de edificios por polígono.",
)
@click.option(
    "--servicios",
    default="data/processed/servicios_por_poligono.csv",
    type=click.Path(),
    help="CSV output del script 40.",
)
@click.option(
    "--calles",
    default="data/raw/osm/calles_posadas.geojson",
    type=click.Path(),
    help="GeoJSON de calles OSM.",
)
@click.option(
    "--riesgo-inundacion",
    default=None,
    type=click.Path(),
    help="CSV opcional con columnas poligono_id, riesgo_inundacion (0-1).",
)
@click.option(
    "--pesos",
    default=None,
    type=click.Path(),
    help="YAML con pesos custom. Default: PESOS_DEFAULT del script.",
)
@click.option(
    "--output",
    default="data/processed/vulnerabilidad_v0.csv",
    type=click.Path(),
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    poligonos: str,
    serie_temporal: str,
    servicios: str,
    calles: str,
    riesgo_inundacion: Optional[str],
    pesos: Optional[str],
    output: str,
    log_level: str,
) -> None:
    """Calcula el score compuesto de vulnerabilidad (BORRADOR, ver disclaimer)."""
    setup_logger(nivel=log_level)

    logger.warning(
        "Este indicador es un BORRADOR METODOLOGICO. "
        "NO reemplaza NBI INDEC. Revisá el docstring del script."
    )

    if gpd is None:
        logger.error("geopandas no está instalado.")
        sys.exit(1)

    settings = load_settings()
    crs_metrico = settings.geografia.crs_metrico

    if pesos:
        if yaml is None:
            raise RuntimeError("PyYAML no disponible.")
        with open(resolve_path(pesos), "r", encoding="utf-8") as fh:
            pesos_dict = yaml.safe_load(fh) or {}
        pesos_dict = _validar_pesos({k: float(v) for k, v in pesos_dict.items()})
    else:
        pesos_dict = dict(PESOS_DEFAULT)
    logger.info(f"Pesos: {pesos_dict}")

    inputs = Inputs(
        poligonos=resolve_path(poligonos),
        serie_temporal=resolve_path(serie_temporal) if serie_temporal else None,
        servicios=resolve_path(servicios) if servicios else None,
        calles=resolve_path(calles) if calles else None,
        riesgo_inundacion=resolve_path(riesgo_inundacion) if riesgo_inundacion else None,
    )
    df = _cargar_componentes(inputs, crs_metrico)
    logger.info(f"Componentes calculados para {len(df)} polígonos.")

    out = _construir_score(df, pesos_dict)
    output_path = resolve_path(output)
    ensure_parent(output_path)
    out.to_csv(output_path, index=False, encoding="utf-8")
    logger.info(f"Vulnerabilidad v0 escrita en {output_path}.")
    logger.warning(
        "Recordatorio: etiquetar cualquier visualización pública con "
        "'v0-borrador — no usar para decisiones legales individuales'."
    )


if __name__ == "__main__":
    main()
