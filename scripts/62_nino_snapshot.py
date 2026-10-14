"""Publica snapshot v2 con exposición estática versionada y pronóstico vigente."""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pandas as pd

from scripts.nino_model import score_impacto


def main():
    public = ROOT / "webapp/frontend/public/data"
    dest = public / "nino"
    dest.mkdir(parents=True, exist_ok=True)
    rain = json.loads((public / "forecast/lluvia_72h.json").read_text(encoding="utf-8"))
    source = ROOT / "data/outputs/exposicion_hidrica.json"
    exposure = (
        json.loads(source.read_text(encoding="utf-8"))
        if source.exists()
        else {"barrios": [], "estado": "a_verificar"}
    )
    old = public / "riesgos/anegamiento.csv"
    risks = public / "riesgos"
    risks.mkdir(parents=True, exist_ok=True)
    # v1 se conserva sin sobrescribir ni inventar su fecha de emisión.
    if old.exists() and not (risks / "anegamiento_v1.csv").exists():
        shutil.copy2(old, risks / "anegamiento_v1.csv")
    baseline = ROOT / "data/outputs/anegamiento_v1.csv"
    if not (risks / "anegamiento_v1.csv").exists() and baseline.exists():
        shutil.copy2(baseline, risks / "anegamiento_v1.csv")
    if (risks / "anegamiento_v1.csv").exists():
        shutil.copy2(risks / "anegamiento_v1.csv", dest / "anegamiento_v1.csv")
    legacy = (
        pd.read_csv(risks / "anegamiento_v1.csv").set_index("poligono_id").to_dict("index")
        if (risks / "anegamiento_v1.csv").exists()
        else {}
    )
    dw_path = public / "dynamic_world.csv"
    dw = {}
    if dw_path.exists():
        table = pd.read_csv(dw_path).sort_values("fecha").groupby("poligono_id").tail(1)
        dw = table.set_index("poligono_id").to_dict("index")
    rows = []
    for row in exposure["barrios"]:
        score = score_impacto(rain, row["pct_viviendas_expuestas"], rain["umbrales"])
        level = (
            "a_verificar"
            if score is None
            else (
                "muy_alto"
                if score >= 75
                else "alto" if score >= 50 else "atencion" if score >= 20 else "sin_umbral"
            )
        )
        built = dw.get(row["poligono_id"], {}).get("dw_built_pct_ge_50")
        # dw_built_mean es probabilidad media de clase, NO porcentaje impermeable.
        built = float(built) * 100 if built is not None and pd.notna(built) else None
        rows.append(
            {
                **row,
                "score_anegamiento": score,
                "nivel": level,
                "categoria": (
                    "medio" if level == "atencion" else "bajo" if level == "sin_umbral" else level
                ),
                "lluvia_max_1h": rain["lluvia_max_1h"],
                "lluvia_48h_proj_mm": rain["lluvia_48h"],
                "pct_impermeable": built,
                "riesgo_inundacion_base": None,
                "anegamiento_v1": legacy.get(row["poligono_id"], {}).get("score_anegamiento"),
                "generated_at": rain["generated_at"],
            }
        )
    rows.sort(key=lambda r: (r["score_anegamiento"] or 0, r["viviendas_expuestas"]), reverse=True)
    payload = {
        "generated_at": rain["generated_at"],
        "lluvia": rain,
        "barrios": rows,
        "exposicion_generated_at": exposure.get("generated_at"),
        "estado_exposicion": "calculado" if rows else "a_verificar",
    }
    (dest / "estado.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
    )
    if rows:
        pd.DataFrame(rows).to_csv(dest / "barrios.csv", index=False)
        pd.DataFrame(rows).to_csv(risks / "anegamiento_v2.csv", index=False)
    for name in (
        "exposicion_hidrica.json",
        "exposicion_hidrica.geojson",
        "exposicion_hidrica.kml",
        "equipamientos_nino.geojson",
    ):
        source = ROOT / "data/outputs" / name
        if source.exists():
            shutil.copy2(source, dest / name)
    shutil.copy2(ROOT / "data/eventos_anegamiento.csv", dest / "eventos_anegamiento.csv")
    print(f"Snapshot Modo El Niño: {len(rows)} barrios, {rain['generated_at']}")


if __name__ == "__main__":
    main()
