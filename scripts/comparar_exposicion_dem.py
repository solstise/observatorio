"""Compara la revisión DEM con el snapshot versionado anterior, en forma agregada."""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import pandas as pd
import rasterio

from scripts.utils.exposicion_dem import sample_dem

BASELINE = "f937d8c"


def main():
    previous = json.loads(
        subprocess.check_output(
            ["git", "show", f"{BASELINE}:data/outputs/exposicion_hidrica.json"], cwd=ROOT
        )
    )
    current = json.loads(
        (ROOT / "data/outputs/exposicion_hidrica.json").read_text(encoding="utf-8")
    )
    by_id = {r["poligono_id"]: r for r in previous["barrios"]}
    comparison = []
    for row in current["barrios"]:
        old = by_id[row["poligono_id"]]
        comparison.append(
            {
                "poligono_id": row["poligono_id"],
                "nombre": row["nombre"],
                "estado_antes": old["estado"],
                "estado_despues": row["estado"],
                "pendientes_antes": old["edificios_a_verificar"],
                "pendientes_despues": row["edificios_a_verificar"],
                "viviendas_expuestas_antes": old["viviendas_expuestas"],
                "viviendas_expuestas_despues": row["viviendas_expuestas"],
                "pct_expuestas_antes": old["pct_viviendas_expuestas"],
                "pct_expuestas_despues": row["pct_viviendas_expuestas"],
                "poblacion_expuesta_despues": row["poblacion_expuesta_estimada"],
                "cobertura_worldpop": row["cobertura_worldpop"],
            }
        )
    buildings = pd.read_csv(
        ROOT / "data/raw/buildings_merge/posadas_merged_buildings.csv", usecols=["lat", "lon"]
    )
    coords = np.column_stack((buildings.lon, buildings.lat))
    with (
        rasterio.open(ROOT / "data/raw/dem/posadas_dem.tif") as old,
        rasterio.open(ROOT / "data/raw/dem/posadas_dem_nino.tif") as new,
    ):
        before, after = sample_dem(old, coords, 4326), sample_dem(new, coords, 4326)
        valid = np.isfinite(before) & np.isfinite(after)
        difference = after[valid] - before[valid]
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "baseline_commit": BASELINE,
        "barrios_completados": sum(
            r["estado_antes"] != "calculado" and r["estado_despues"] == "calculado"
            for r in comparison
        ),
        "barrios_a_verificar_dem": sum(r["estado_despues"] != "calculado" for r in comparison),
        "barrios_worldpop_incompleto": [
            r["nombre"] for r in comparison if r["cobertura_worldpop"] != "completa"
        ],
        "comparacion_alturas_en_centroides_con_ambos_rasters": {
            "n": int(valid.sum()),
            "mediana_diferencia_m": float(np.median(difference)),
            "p95_diferencia_absoluta_m": float(np.percentile(np.abs(difference), 95)),
            "max_diferencia_absoluta_m": float(np.abs(difference).max()),
        },
        "barrios": comparison,
    }
    (ROOT / "data/outputs/comparacion_exposicion_dem.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    print(
        json.dumps(
            {k: v for k, v in result.items() if k != "barrios"}, ensure_ascii=False, indent=2
        )
    )


if __name__ == "__main__":
    main()
