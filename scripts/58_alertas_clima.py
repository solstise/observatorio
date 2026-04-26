"""Capa de alertas climáticas trigger automáticas (paquete A3).

Lee ``forecast_diario_por_barrio.csv`` y ``aqi_diario.csv`` (script 57)
y aplica reglas configurables para generar alertas activas. El cruce
con el ranking político (script 54) destaca los **barrios prioritarios
bajo alerta** — combinación de alta vulnerabilidad social + evento
climático adverso, que es el caso de uso más relevante para política
pública.

Reglas (configurables en ``config/alertas.yaml``):

- **Frío extremo (ROJA)**: tmin_p50 < 5°C + tmin_p10 ≤ 0°C, ≥2 días
  consecutivos.
- **Frío severo (NARANJA)**: tmin_p50 < 8°C, ≥2 días consecutivos.
- **Calor extremo (ROJA)**: tmax_p50 > 38°C, ≥2 días consecutivos.
- **Lluvia intensa (NARANJA)**: precipitation_sum > 50 mm/día.
- **AQI malo (AMARILLA)**: european_aqi > 80.

Output: ``data/processed/forecast/alertas_activas.json``::

    [
      {
        "tipo": "frio_severo",
        "severidad": "naranja",
        "fecha_inicio": "2026-04-26",
        "fecha_fin": "2026-04-28",
        "n_dias": 3,
        "n_barrios_afectados": 12,
        "barrios_afectados": ["san_isidro", "..."],
        "barrios_prioritarios": ["san_isidro", "federal", ...],
        "descripcion": "..."
      },
      ...
    ]

Uso
---
::

    python scripts/58_alertas_clima.py
    python scripts/58_alertas_clima.py --config config/alertas.yaml
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
import pandas as pd
import yaml
from loguru import logger

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path

SCRIPT_VERSION = "0.1.0"

SEVERIDAD_RANK = {"roja": 3, "naranja": 2, "amarilla": 1}


def cargar_config(path: Path) -> Dict:
    """Carga config YAML; si no existe, usa defaults razonables."""
    if not path.exists():
        logger.warning(f"Config {path} no existe — uso defaults internos.")
        return _config_default()
    with path.open("r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    return cfg


def _config_default() -> Dict:
    """Valores por defecto idénticos a config/alertas.yaml para fallback."""
    return {
        "frio_extremo": {
            "severidad": "roja",
            "descripcion": "Frío extremo: tmin < 5°C con prob. de helada (P10 ≤ 0°C), 2+ días.",
            "umbral_tmin_p50_max": 5.0,
            "umbral_tmin_p10_max": 0.0,
            "dias_consecutivos_min": 2,
        },
        "frio_severo": {
            "severidad": "naranja",
            "descripcion": "Frío severo: tmin < 8°C, 2+ días consecutivos.",
            "umbral_tmin_p50_max": 8.0,
            "dias_consecutivos_min": 2,
        },
        "calor_extremo": {
            "severidad": "roja",
            "descripcion": "Calor extremo: tmax > 38°C, 2+ días consecutivos.",
            "umbral_tmax_p50_min": 38.0,
            "dias_consecutivos_min": 2,
        },
        "lluvia_intensa": {
            "severidad": "naranja",
            "descripcion": "Lluvia intensa: precipitación > 50 mm/día.",
            "umbral_precip_mm_min": 50.0,
            "dias_consecutivos_min": 1,
        },
        "aqi_malo": {
            "severidad": "amarilla",
            "descripcion": "AQI europeo > 80.",
            "umbral_aqi_min": 80.0,
            "dias_consecutivos_min": 1,
        },
        "top_alert": {"prioridad_min": 0.55},
    }


# --- Detección de rachas ----------------------------------------------------


def _rachas_consecutivas(
    df_barrio_ordenado: pd.DataFrame,
    columna_bool: str,
    min_consecutivos: int,
) -> List[Tuple[str, str, int]]:
    """Devuelve lista de (fecha_inicio, fecha_fin, n_dias) donde la
    columna boolean es True por al menos ``min_consecutivos`` días seguidos.

    Asume que ``df`` viene ordenado por fecha ascendente y sin huecos
    (el forecast es continuo día a día).
    """
    rachas: List[Tuple[str, str, int]] = []
    if df_barrio_ordenado.empty:
        return rachas
    arr = df_barrio_ordenado[columna_bool].astype(bool).values
    fechas = df_barrio_ordenado["fecha"].astype(str).values
    n = len(arr)
    i = 0
    while i < n:
        if not arr[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and arr[j + 1]:
            j += 1
        long_racha = j - i + 1
        if long_racha >= min_consecutivos:
            rachas.append((fechas[i], fechas[j], long_racha))
        i = j + 1
    return rachas


def detectar_alerta_temperatura(
    df_forecast: pd.DataFrame,
    cfg_alerta: Dict,
    tipo: str,
) -> List[Dict]:
    """Detecta alertas de frío o calor por barrio.

    Args:
        df_forecast: forecast diario por barrio.
        cfg_alerta: subconfig (umbral_tmin/tmax_p50, etc.).
        tipo: 'frio_extremo' | 'frio_severo' | 'calor_extremo'.

    Returns:
        Lista de eventos por barrio con (poligono_id, fecha_inicio, fecha_fin, n_dias).
    """
    min_dias = int(cfg_alerta.get("dias_consecutivos_min", 2))
    eventos: List[Dict] = []

    for pid, sub in df_forecast.groupby("poligono_id"):
        sub = sub.sort_values("fecha")

        if tipo == "frio_extremo":
            umbral_p50 = float(cfg_alerta["umbral_tmin_p50_max"])
            umbral_p10 = float(cfg_alerta["umbral_tmin_p10_max"])
            sub["match"] = (sub["tmin_p50"] < umbral_p50) & (sub["tmin_p10"] <= umbral_p10)
        elif tipo == "frio_severo":
            umbral_p50 = float(cfg_alerta["umbral_tmin_p50_max"])
            sub["match"] = sub["tmin_p50"] < umbral_p50
        elif tipo == "calor_extremo":
            umbral_p50 = float(cfg_alerta["umbral_tmax_p50_min"])
            sub["match"] = sub["tmax_p50"] > umbral_p50
        else:
            continue

        for ini, fin, n in _rachas_consecutivas(sub, "match", min_dias):
            eventos.append({
                "poligono_id": str(pid),
                "fecha_inicio": ini,
                "fecha_fin": fin,
                "n_dias": int(n),
            })
    return eventos


def detectar_alerta_lluvia(df_forecast: pd.DataFrame, cfg_alerta: Dict) -> List[Dict]:
    """Detecta días de lluvia intensa (cualquier barrio: la lluvia es
    razonablemente uniforme a esta escala).

    Como no hay variación interbarrios en precipitación, en la práctica
    esto es global a Posadas pero lo reportamos por barrio igual para
    consistencia con el resto del schema.
    """
    umbral = float(cfg_alerta.get("umbral_precip_mm_min", 50.0))
    min_dias = int(cfg_alerta.get("dias_consecutivos_min", 1))
    eventos: List[Dict] = []

    for pid, sub in df_forecast.groupby("poligono_id"):
        sub = sub.sort_values("fecha")
        sub["match"] = sub["precipitation_mm"] > umbral
        for ini, fin, n in _rachas_consecutivas(sub, "match", min_dias):
            eventos.append({
                "poligono_id": str(pid),
                "fecha_inicio": ini,
                "fecha_fin": fin,
                "n_dias": int(n),
            })
    return eventos


def detectar_alerta_aqi(df_aqi: pd.DataFrame, cfg_alerta: Dict, todos_los_barrios: List[str]) -> List[Dict]:
    """Para AQI, la alerta aplica a todos los barrios (modelo ~10 km)."""
    if df_aqi.empty:
        return []
    umbral = float(cfg_alerta.get("umbral_aqi_min", 80.0))
    min_dias = int(cfg_alerta.get("dias_consecutivos_min", 1))
    df = df_aqi.copy().sort_values("fecha")
    df["match"] = df["european_aqi"] > umbral
    rachas = _rachas_consecutivas(df, "match", min_dias)
    eventos: List[Dict] = []
    for ini, fin, n in rachas:
        for pid in todos_los_barrios:
            eventos.append({
                "poligono_id": str(pid),
                "fecha_inicio": ini,
                "fecha_fin": fin,
                "n_dias": int(n),
            })
    return eventos


# --- Agregación a alertas globales ------------------------------------------


def agregar_alertas(
    eventos_por_tipo: Dict[str, List[Dict]],
    config: Dict,
    ranking: pd.DataFrame,
    nombres_barrios: Dict[str, str],
) -> List[Dict]:
    """Para cada tipo, fusiona eventos de barrios distintos que comparten
    rango de fechas y produce un objeto alerta consumible por el frontend.
    """
    prio_min = float(config.get("top_alert", {}).get("prioridad_min", 0.55))
    prio_idx: Dict[str, float] = {}
    if not ranking.empty:
        prio_idx = {
            str(r["poligono_id"]): float(r.get("indice_prioridad") or 0.0)
            for _, r in ranking.iterrows()
        }

    alertas: List[Dict] = []
    for tipo, eventos in eventos_por_tipo.items():
        if not eventos:
            continue
        cfg = config.get(tipo, {})
        sev = str(cfg.get("severidad", "amarilla")).lower()
        descripcion = str(cfg.get("descripcion", "")).strip()

        # Indexamos eventos por (fecha_inicio, fecha_fin) para fusionar barrios.
        bucket: Dict[Tuple[str, str], List[Dict]] = {}
        for ev in eventos:
            key = (ev["fecha_inicio"], ev["fecha_fin"])
            bucket.setdefault(key, []).append(ev)

        for (ini, fin), evs in bucket.items():
            barrios = sorted({ev["poligono_id"] for ev in evs})
            n_dias = max(int(ev["n_dias"]) for ev in evs)
            barrios_prio = sorted(
                [b for b in barrios if prio_idx.get(b, 0.0) >= prio_min],
                key=lambda b: prio_idx.get(b, 0.0),
                reverse=True,
            )
            alertas.append({
                "tipo": tipo,
                "severidad": sev,
                "fecha_inicio": ini,
                "fecha_fin": fin,
                "n_dias": n_dias,
                "n_barrios_afectados": len(barrios),
                "barrios_afectados": barrios,
                "barrios_afectados_nombres": [nombres_barrios.get(b, b) for b in barrios],
                "barrios_prioritarios": barrios_prio,
                "barrios_prioritarios_nombres": [nombres_barrios.get(b, b) for b in barrios_prio],
                "descripcion": descripcion,
            })

    # Orden: severidad desc, luego fecha_inicio asc, luego n_barrios desc.
    alertas.sort(
        key=lambda a: (
            -SEVERIDAD_RANK.get(a["severidad"], 0),
            a["fecha_inicio"],
            -a["n_barrios_afectados"],
        )
    )
    return alertas


# --- Carga auxiliar ---------------------------------------------------------


def cargar_nombres_barrios(geojson_path: Path) -> Dict[str, str]:
    """Mapea poligono_id → nombre humano desde el GeoJSON. Devuelve {} si falta."""
    if not geojson_path.exists():
        logger.warning(f"GeoJSON {geojson_path} no existe; nombres = id.")
        return {}
    with geojson_path.open("r", encoding="utf-8") as f:
        gj = json.load(f)
    out: Dict[str, str] = {}
    for f in gj.get("features", []):
        p = f.get("properties") or {}
        pid = str(p.get("id") or p.get("poligono_id") or "")
        nombre = str(p.get("nombre") or pid)
        if pid:
            out[pid] = nombre
    return out


# --- CLI --------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option(
    "--forecast",
    default="data/processed/forecast/forecast_diario_por_barrio.csv",
    type=click.Path(),
)
@click.option(
    "--aqi",
    default="data/processed/forecast/aqi_diario.csv",
    type=click.Path(),
)
@click.option(
    "--ranking",
    default="data/processed/social/ranking_politico.csv",
    type=click.Path(),
    help="Ranking político (script 54), para marcar barrios prioritarios.",
)
@click.option(
    "--poligonos",
    default="config/poligonos.geojson",
    type=click.Path(),
    help="GeoJSON para lookup de nombres legibles.",
)
@click.option(
    "--config",
    "config_path",
    default="config/alertas.yaml",
    type=click.Path(),
)
@click.option(
    "--out",
    default="data/processed/forecast/alertas_activas.json",
    type=click.Path(),
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    forecast: str,
    aqi: str,
    ranking: str,
    poligonos: str,
    config_path: str,
    out: str,
    log_level: str,
) -> None:
    """Pipeline de alertas climáticas."""
    setup_logger(nivel=log_level)
    logger.info("=" * 60)
    logger.info(f"Alertas climáticas — v{SCRIPT_VERSION}")
    logger.info("=" * 60)

    forecast_path = resolve_path(forecast)
    aqi_path = resolve_path(aqi)
    ranking_path = resolve_path(ranking)
    poligonos_path = resolve_path(poligonos)
    cfg_path = resolve_path(config_path)
    out_path = resolve_path(out)
    ensure_parent(out_path)

    cfg = cargar_config(cfg_path)

    if not forecast_path.exists():
        logger.error(f"Forecast diario no existe en {forecast_path}. Corré scripts/57 primero.")
        sys.exit(2)

    df_fc = pd.read_csv(forecast_path)
    df_fc["poligono_id"] = df_fc["poligono_id"].astype(str)
    logger.info(f"Forecast: {len(df_fc)} filas, {df_fc['poligono_id'].nunique()} barrios.")

    df_aqi = pd.read_csv(aqi_path) if aqi_path.exists() else pd.DataFrame()
    if not df_aqi.empty:
        df_aqi["fecha"] = df_aqi["fecha"].astype(str)
    logger.info(f"AQI: {len(df_aqi)} filas.")

    df_rk = pd.read_csv(ranking_path) if ranking_path.exists() else pd.DataFrame()
    if not df_rk.empty:
        df_rk["poligono_id"] = df_rk["poligono_id"].astype(str)

    nombres = cargar_nombres_barrios(poligonos_path)
    barrios_universo = sorted(df_fc["poligono_id"].unique().tolist())

    # Detección.
    eventos: Dict[str, List[Dict]] = {
        "frio_extremo": detectar_alerta_temperatura(df_fc, cfg.get("frio_extremo", {}), "frio_extremo"),
        "frio_severo": detectar_alerta_temperatura(df_fc, cfg.get("frio_severo", {}), "frio_severo"),
        "calor_extremo": detectar_alerta_temperatura(df_fc, cfg.get("calor_extremo", {}), "calor_extremo"),
        "lluvia_intensa": detectar_alerta_lluvia(df_fc, cfg.get("lluvia_intensa", {})),
        "aqi_malo": detectar_alerta_aqi(df_aqi, cfg.get("aqi_malo", {}), barrios_universo),
    }

    # Frío severo no se reporta sobre barrios que ya están en frío extremo
    # para no duplicar la severidad sobre el mismo evento. Filtramos:
    if eventos["frio_extremo"]:
        bloqueados = {
            (ev["poligono_id"], ev["fecha_inicio"], ev["fecha_fin"])
            for ev in eventos["frio_extremo"]
        }
        eventos["frio_severo"] = [
            ev for ev in eventos["frio_severo"]
            if not any(
                ev["poligono_id"] == bloq[0]
                and not (ev["fecha_fin"] < bloq[1] or ev["fecha_inicio"] > bloq[2])
                for bloq in bloqueados
            )
        ]

    for tipo, evs in eventos.items():
        logger.info(f"  {tipo}: {len(evs)} eventos por (barrio,fecha).")

    alertas = agregar_alertas(eventos, cfg, df_rk, nombres)

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "script_version": SCRIPT_VERSION,
        "n_alertas": len(alertas),
        "ventana_dias": int(
            (
                pd.to_datetime(df_fc["fecha"]).max() - pd.to_datetime(df_fc["fecha"]).min()
            ).days + 1
        )
        if not df_fc.empty
        else 0,
        "alertas": alertas,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"alertas_activas.json -> {len(alertas)} alertas en {out_path}")

    if alertas:
        logger.info("Resumen alertas (top 5 por severidad):")
        for a in alertas[:5]:
            logger.info(
                f"  [{a['severidad'].upper()}] {a['tipo']} {a['fecha_inicio']}→{a['fecha_fin']} "
                f"({a['n_dias']}d, {a['n_barrios_afectados']} barrios)"
            )
    else:
        logger.info("No hay alertas activas para la ventana del forecast.")

    logger.info("=" * 60)


if __name__ == "__main__":
    main()
