"""Cálculos puros de anegamiento v2. Calibración inicial, sin alertas oficiales."""

from datetime import datetime, timedelta, timezone

import numpy as np


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


def resumen_ensemble(payload, thresholds, now=None):
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
    p10, p50, p90 = np.percentile(matrix, [10, 50, 90], axis=1)
    metrics = {
        f"lluvia_{name}": round(rolling_max(p50, h), 2)
        for name, h in (("max_1h", 1), ("max_3h", 3), ("24h", 24), ("48h", 48))
    }
    probabilities = {}
    for level, t in thresholds.items():
        exceed = [
            rolling_max(matrix[:, j], 1) >= t["mm_1h"]
            or rolling_max(matrix[:, j], 24) >= t["mm_24h"]
            for j in range(matrix.shape[1])
        ]
        probabilities[level] = round(100 * sum(exceed) / len(exceed), 1)
    peak = int(np.argmax(p50))
    rows = [
        {
            "time": times[i].isoformat(),
            "p10": round(float(p10[j]), 2),
            "p50": round(float(p50[j]), 2),
            "p90": round(float(p90[j]), 2),
        }
        for j, i in enumerate(indices)
    ]
    return {
        **metrics,
        "nivel": nivel_lluvia(metrics["lluvia_max_1h"], metrics["lluvia_24h"], thresholds),
        "probabilidades": probabilities,
        "n_miembros": matrix.shape[1],
        "ventana_inicio": (times[indices[peak]] - timedelta(hours=1)).isoformat(),
        "ventana_fin": times[indices[peak]].isoformat(),
        "horas": rows,
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
