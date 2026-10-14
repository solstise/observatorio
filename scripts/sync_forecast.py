"""Sincroniza exclusivamente el snapshot de pronóstico, sin requerir Earth Engine."""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "forecast_diario_por_barrio.csv": "forecast_diario.csv",
    "forecast_horario.csv": "forecast_horario.csv",
    "aqi_diario.csv": "aqi_diario.csv",
    "alertas_activas.json": "alertas_activas.json",
    "_metadata.json": "_metadata.json",
}


def sync_forecast(root=ROOT):
    source = root / "data/processed/forecast"
    target = root / "webapp/frontend/public/data/forecast"
    meta = json.loads((source / "_metadata.json").read_text(encoding="utf-8"))
    ts = datetime.fromisoformat(meta["generated_at"])
    if ts.tzinfo is None:
        raise ValueError("generated_at debe incluir zona horaria")
    age = (datetime.now(timezone.utc) - ts).total_seconds()
    if not -300 <= age <= 86400:
        raise ValueError("Pronóstico fuera de la ventana de frescura de 24 h")
    for name in FILES:
        if not (source / name).is_file():
            raise FileNotFoundError(source / name)
    target.mkdir(parents=True, exist_ok=True)
    for name, dest in FILES.items():
        shutil.copy2(source / name, target / dest)
    print(f"Snapshot sincronizado: {meta['generated_at']}")


if __name__ == "__main__":
    sync_forecast()
