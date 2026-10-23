"""Ambiente para granizo en Posadas: índice SHIP con tres modelos (GFS, ECMWF, ICON).

No es una probabilidad de granizo ni un aviso: indica si el ambiente que prevé cada
modelo favorece granizo grande. Se muestran los tres para que se vea el acuerdo o el
desacuerdo entre ellos. Las alertas por granizo son las del SMN.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import requests

from scripts.nino_model import categoria_granizo, consenso_granizo, ship

URL = "https://api.open-meteo.com/v1/forecast"
DESTINO = ROOT / "webapp/frontend/public/data/nino/granizo.json"
POSADAS = (-27.3667, -55.8967)
MODELOS = {"gfs_seamless": "GFS (NOAA)", "ecmwf_ifs025": "ECMWF", "icon_seamless": "ICON (DWD)"}
VARIABLES = [
    "cape",
    "dew_point_2m",
    "surface_pressure",
    "temperature_500hPa",
    "temperature_700hPa",
    "geopotential_height_500hPa",
    "geopotential_height_700hPa",
    "wind_speed_500hPa",
    "wind_direction_500hPa",
    "wind_speed_10m",
    "wind_direction_10m",
    "freezing_level_height",
]


def serie(hourly, nombre):
    return np.array([np.nan if v is None else v for v in hourly.get(nombre, [])], dtype=float)


def resumir_modelo(hourly):
    tiempos = hourly["time"]
    n = len(tiempos)
    datos = {v: serie(hourly, v) for v in VARIABLES}
    datos = {v: (s if s.size == n else np.full(n, np.nan)) for v, s in datos.items()}
    valores = ship(
        datos["cape"],
        datos["dew_point_2m"],
        datos["surface_pressure"],
        datos["temperature_500hPa"],
        datos["temperature_700hPa"],
        datos["geopotential_height_500hPa"],
        datos["geopotential_height_700hPa"],
        datos["wind_speed_500hPa"],
        datos["wind_direction_500hPa"],
        datos["wind_speed_10m"],
        datos["wind_direction_10m"],
        datos["freezing_level_height"],
    )
    horas = [
        {"time": t, "ship": round(float(v), 2) if np.isfinite(v) else None}
        for t, v in zip(tiempos, valores)
    ]
    dias = {}
    for t, v, cape in zip(tiempos, valores, datos["cape"]):
        if not np.isfinite(v):
            continue
        dia = dias.setdefault(t[:10], {"ship_max": -1.0, "hora": None, "cape_max": 0.0})
        if v > dia["ship_max"]:
            dia.update(ship_max=float(v), hora=t[11:16])
        if np.isfinite(cape):
            dia["cape_max"] = max(dia["cape_max"], float(cape))
    for dia in dias.values():
        dia["ship_max"] = round(dia["ship_max"], 2)
        dia["cape_max"] = round(dia["cape_max"])
        dia["categoria"] = categoria_granizo(dia["ship_max"])
    return horas, dias


def main():
    modelos, fallas = {}, {}
    for modelo, nombre in MODELOS.items():
        try:
            r = requests.get(
                URL,
                params={
                    "latitude": POSADAS[0],
                    "longitude": POSADAS[1],
                    "hourly": ",".join(VARIABLES),
                    "models": modelo,
                    "forecast_days": 3,
                    "timezone": "America/Argentina/Buenos_Aires",
                },
                timeout=60,
            )
            r.raise_for_status()
            horas, dias = resumir_modelo(r.json()["hourly"])
            modelos[modelo] = {"nombre": nombre, "horas": horas, "dias": dias}
        except (requests.RequestException, KeyError, ValueError) as exc:
            fallas[modelo] = str(exc)[:200]
    fechas = sorted({d for m in modelos.values() for d in m["dias"]})
    dias = [
        {
            "fecha": fecha,
            "modelos": {k: m["dias"].get(fecha) for k, m in modelos.items()},
            "consenso": consenso_granizo(
                [(m["dias"].get(fecha) or {}).get("categoria") for m in modelos.values()]
            ),
        }
        for fecha in fechas
    ]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "estado": "disponible" if modelos else "no_disponible",
        "metodo": "SHIP (Storm Prediction Center, NOAA) con aproximaciones de Open-Meteo",
        "cortes": {"moderado": 0.5, "alto": 1.0},
        "modelos": {k: {"nombre": m["nombre"], "horas": m["horas"]} for k, m in modelos.items()},
        "dias": dias,
        "fallas": fallas,
    }
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    resumen = ", ".join(f"{d['fecha']}: {d['consenso']}" for d in dias)
    print(f"Granizo (SHIP): {len(modelos)} modelos. {resumen}")


if __name__ == "__main__":
    main()
