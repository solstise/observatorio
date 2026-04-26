"""Auditoría de solapamientos entre polígonos.

Mide cuánto se pisan los polígonos del config y reporta los pares
problemáticos. Output: stdout + CSV en data/processed/_overlap_audit.csv.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd

OUTPUT = Path("data/processed/_overlap_audit.csv")


EXCLUIDOS_AUDIT = {"posadas_completa"}  # capa de referencia, no es barrio


def main() -> None:
    g = gpd.read_file("config/poligonos.geojson")
    g = g[~g["id"].isin(EXCLUIDOS_AUDIT)].reset_index(drop=True)
    g = g.to_crs("EPSG:32721")  # UTM 21S, metros
    n = len(g)
    print(f"Polígonos cargados (excluyendo {sorted(EXCLUIDOS_AUDIT)}): {n}")
    g["area_km2"] = g.geometry.area / 1e6

    rows = []
    for i in range(n):
        for j in range(i + 1, n):
            a = g.iloc[i]
            b = g.iloc[j]
            if not a.geometry.intersects(b.geometry):
                continue
            inter = a.geometry.intersection(b.geometry)
            inter_km2 = inter.area / 1e6
            if inter_km2 < 1e-4:
                continue  # contacto en arista, irrelevante
            pct_a = inter_km2 / a["area_km2"] * 100
            pct_b = inter_km2 / b["area_km2"] * 100
            rows.append(
                {
                    "id_a": a["id"],
                    "id_b": b["id"],
                    "area_a_km2": round(a["area_km2"], 3),
                    "area_b_km2": round(b["area_km2"], 3),
                    "interseccion_km2": round(inter_km2, 4),
                    "pct_a": round(pct_a, 2),
                    "pct_b": round(pct_b, 2),
                    "max_pct": round(max(pct_a, pct_b), 2),
                }
            )

    if rows:
        df = pd.DataFrame(rows).sort_values("max_pct", ascending=False)
    else:
        df = pd.DataFrame(
            columns=[
                "id_a",
                "id_b",
                "area_a_km2",
                "area_b_km2",
                "interseccion_km2",
                "pct_a",
                "pct_b",
                "max_pct",
            ]
        )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT, index=False, encoding="utf-8")

    print(f"\nPares con solapamiento >= 0.0001 km²: {len(df)}")
    if not df.empty:
        print(f"Pares con solapamiento >= 1%: {len(df[df['max_pct'] >= 1])}")
        print(f"Pares con solapamiento >= 10%: {len(df[df['max_pct'] >= 10])}")
        print(f"Pares con solapamiento >= 50%: {len(df[df['max_pct'] >= 50])}")
        print()
        print("Top 20 pares más solapados:")
        print(df.head(20).to_string(index=False))
    else:
        print("Sin solapamientos detectados (mutuamente exclusivos)")


if __name__ == "__main__":
    main()
