"""Cálculos puros de anegamiento v2. Calibración inicial, sin alertas oficiales."""

import re
import unicodedata
from datetime import datetime, timedelta, timezone

import numpy as np


def tipo_equipamiento(tags):
    name = (
        unicodedata.normalize("NFKD", tags.get("name", ""))
        .encode("ascii", "ignore")
        .decode()
        .lower()
    )
    if re.search(r"\bcav\b", name) or "centro de atencion al vecino" in name:
        return "CAV"
    labels = {
        "school": "Escuela",
        "hospital": "Hospital",
        "clinic": "Centro de salud",
        "doctors": "Atención de salud",
        "community_centre": "Centro comunitario",
        "sports_centre": "Centro deportivo",
    }
    return labels.get(tags.get("amenity", tags.get("leisure", "")))


def nivel_lluvia(max_1h, max_24h, thresholds):
    if max_1h is None or max_24h is None:
        return "a_verificar"
    for level in ("muy_alto", "alto", "atencion"):
        t = thresholds[level]
        if max_1h >= t["mm_1h"] or max_24h >= t["mm_24h"]:
            return level
    return "sin_umbral"


def rolling_max(values, hours):
    """Solo ventanas completas: nunca sustituye faltantes por cero."""
    a = np.asarray(values, dtype=float)
    if len(a) < hours:
        return None
    windows = np.lib.stride_tricks.sliding_window_view(a, hours)
    valid = windows[np.isfinite(windows).all(axis=1)]
    return float(valid.sum(axis=1).max()) if len(valid) else None


OPCIONES_TORMENTA = {"rafaga_fuerte_kmh": 60, "dia_lluvioso_mm": 20}
# Códigos WMO de Open-Meteo: 95 tormenta, 96 y 99 tormenta con granizo.
CODIGO_TORMENTA = 95


def _miembros(hourly, variable, indices):
    """Matriz horas × miembros con las series completas de una variable."""
    keys = [k for k in hourly if k == variable or k.startswith(variable + "_")]
    if not keys:
        return np.empty((len(indices), 0))
    matrix = np.column_stack(
        [
            np.asarray([np.nan if v is None else v for v in hourly[k]], dtype=float)[indices]
            for k in keys
        ]
    )
    return matrix[:, np.isfinite(matrix).all(axis=0)]


def _porcentaje(flags):
    flags = list(flags)
    return round(100 * sum(flags) / len(flags), 1) if flags else None


def resumen_ensemble(payload, thresholds, now=None, opciones=None):
    opciones = {**OPCIONES_TORMENTA, **(opciones or {})}
    now = now or datetime.now(timezone.utc)
    local_tz = timezone(timedelta(seconds=payload.get("utc_offset_seconds", -10800)))
    hourly = payload["hourly"]
    times = [datetime.fromisoformat(t).replace(tzinfo=local_tz) for t in hourly["time"]]
    indices = [i for i, t in enumerate(times) if t > now][:72]
    if len(indices) != 72 or any(
        times[b] - times[a] != timedelta(hours=1) for a, b in zip(indices, indices[1:])
    ):
        raise ValueError("Se requieren 72 horas futuras consecutivas")
    keys = [k for k in hourly if k == "precipitation" or k.startswith("precipitation_")]
    if not keys:
        raise ValueError("Sin miembros de precipitación")
    matrix = np.column_stack([np.asarray(hourly[k], dtype=float)[indices] for k in keys])
    matrix[matrix < 0] = np.nan
    matrix = matrix[:, np.isfinite(matrix).all(axis=0)]
    if matrix.shape[1] == 0:
        raise ValueError("Ningún miembro cubre las 72 h completas")
    members = range(matrix.shape[1])
    p10, p50, p90 = np.percentile(matrix, [10, 50, 90], axis=1)
    # Cada escenario ubica la tormenta a otra hora: la mediana hora por hora la
    # aplana. Primero se toma el pico de cada escenario y después la mediana.
    metrics = {}
    for name, h in (("max_1h", 1), ("max_3h", 3), ("24h", 24), ("48h", 48)):
        peaks = [rolling_max(matrix[:, j], h) for j in members]
        metrics[f"lluvia_{name}"] = round(float(np.percentile(peaks, 50)), 2)
        metrics[f"lluvia_{name}_p90"] = round(float(np.percentile(peaks, 90)), 2)
    probabilities = {}
    for level, t in thresholds.items():
        exceed = [
            rolling_max(matrix[:, j], 1) >= t["mm_1h"]
            or rolling_max(matrix[:, j], 24) >= t["mm_24h"]
            for j in members
        ]
        probabilities[level] = _porcentaje(exceed)
    # La media del ensamble conserva cuándo es más probable el chaparrón.
    peak = int(np.argmax(matrix.mean(axis=1)))
    codes = _miembros(hourly, "weather_code", indices)
    gusts = _miembros(hourly, "wind_gusts_10m", indices)
    # Cada valor horario es la lluvia de la hora anterior: 00:00 cierra el día previo.
    day_of = [(times[i] - timedelta(hours=1)).date() for i in indices]
    days = []
    for day in sorted(set(day_of)):
        rows_day = [j for j, d in enumerate(day_of) if d == day]
        totals = matrix[rows_day].sum(axis=0)
        q10, q50, q90 = np.percentile(totals, [10, 50, 90])
        days.append(
            {
                "fecha": day.isoformat(),
                "horas": len(rows_day),
                "desde": (times[indices[rows_day[0]]] - timedelta(hours=1)).isoformat(),
                "hasta": times[indices[rows_day[-1]]].isoformat(),
                "p10": round(float(q10), 1),
                "p50": round(float(q50), 1),
                "p90": round(float(q90), 1),
                "max_1h": round(float(np.percentile(matrix[rows_day].max(axis=0), 50)), 1),
                "prob_lluvioso": _porcentaje(totals >= opciones["dia_lluvioso_mm"]),
                "prob_atencion": _porcentaje(
                    (matrix[rows_day].max(axis=0) >= thresholds["atencion"]["mm_1h"])
                    | (totals >= thresholds["atencion"]["mm_24h"])
                ),
                "prob_tormenta": _porcentaje(
                    (codes[rows_day] >= CODIGO_TORMENTA).any(axis=0) if codes.size else []
                ),
                "prob_rafagas": _porcentaje(
                    (gusts[rows_day] >= opciones["rafaga_fuerte_kmh"]).any(axis=0)
                    if gusts.size
                    else []
                ),
            }
        )
    rows = [
        {
            "time": times[i].isoformat(),
            "p10": round(float(p10[j]), 2),
            "p50": round(float(p50[j]), 2),
            "p90": round(float(p90[j]), 2),
            "media": round(float(matrix[j].mean()), 2),
        }
        for j, i in enumerate(indices)
    ]
    return {
        **metrics,
        "nivel": nivel_lluvia(metrics["lluvia_max_1h"], metrics["lluvia_24h"], thresholds),
        "probabilidades": probabilities,
        "n_miembros": matrix.shape[1],
        "tormenta": {
            "prob_tormenta": _porcentaje(
                (codes >= CODIGO_TORMENTA).any(axis=0) if codes.size else []
            ),
            "n_miembros_tormenta": int(codes.shape[1]),
            "prob_rafagas": _porcentaje(
                (gusts >= opciones["rafaga_fuerte_kmh"]).any(axis=0) if gusts.size else []
            ),
            "n_miembros_rafagas": int(gusts.shape[1]),
            "rafaga_fuerte_kmh": opciones["rafaga_fuerte_kmh"],
        },
        "dias": days,
        "dia_lluvioso_mm": opciones["dia_lluvioso_mm"],
        "ventana_inicio": (times[indices[peak]] - timedelta(hours=1)).isoformat(),
        "ventana_fin": times[indices[peak]].isoformat(),
        "horas": rows,
        "metodo": "mediana de los picos de cada escenario",
        "alcance": "Una celda para Posadas; no distingue lluvia entre barrios",
        "acumulados": "Máximo móvil de 24/48 h dentro de las próximas 72 h",
    }


def score_impacto(rain, exposure_pct, thresholds):
    if exposure_pct is None:
        return None
    hazard = min(
        1.0,
        max(
            rain["lluvia_max_1h"] / thresholds["muy_alto"]["mm_1h"],
            rain["lluvia_24h"] / thresholds["muy_alto"]["mm_24h"],
        ),
    )
    return round(100 * hazard * (0.25 + 0.75 * min(100, max(0, exposure_pct)) / 100), 2)


def agregar_exposicion(classes, population=None):
    """Clases disjuntas; expuestas incluye muy expuestas. Footprints son proxy de viviendas."""
    total = len(classes)
    very = sum(c == "muy_expuesto" for c in classes)
    exposed = sum(c in ("muy_expuesto", "expuesto") for c in classes)
    unknown = sum(c == "a_verificar" for c in classes)
    pct = round(100 * exposed / total, 2) if total and unknown == 0 else None
    pop = (
        round(population * exposed / total) if population is not None and pct is not None else None
    )
    return {
        "edificios_total": total,
        "viviendas_muy_expuestas": very,
        "viviendas_expuestas": exposed,
        "pct_viviendas_expuestas": pct,
        "edificios_a_verificar": unknown,
        "poblacion_expuesta_estimada": pop,
        "poblacion_expuesta_min": round(pop * 0.8) if pop is not None else None,
        "poblacion_expuesta_max": round(pop * 1.2) if pop is not None else None,
        "estado": "calculado" if pct is not None else "a_verificar",
    }
