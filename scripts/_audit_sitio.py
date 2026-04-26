"""Audit del sitio completo: detecta inconsistencias entre el GeoJSON y los CSVs.

Reporta polígonos en geojson sin datos, datos huérfanos sin polígono,
outliers en métricas, etc.
"""

from __future__ import annotations

from pathlib import Path

import geopandas as gpd
import pandas as pd

BASE = Path("webapp/frontend/public/data")


def main() -> None:
    g = gpd.read_file(BASE / "poligonos.geojson")
    ids_geo = set(g["id"].astype(str))
    print("\n--- AUDIT SITIO ---")
    print(f"Polígonos en GeoJSON: {len(ids_geo)}")
    print()

    csvs = {
        "serie_temporal": "serie_temporal.csv",
        "poblacion": "poblacion.csv",
        "vulnerabilidad": "vulnerabilidad.csv",
        "calor/uhi_mensual": "calor/uhi_mensual.csv",
        "calor/uhi_estacional": "calor/uhi_estacional.csv",
        "social/distancias": "social/distancias.csv",
        "social/ranking": "social/ranking.csv",
        "dynamic_world": "dynamic_world.csv",
        "sentinel1": "sentinel1.csv",
        "chirps": "chirps.csv",
        "no2": "no2.csv",
        "lst": "lst.csv",
        "firms": "firms.csv",
        "wdpa": "wdpa.csv",
    }

    print("Cobertura de datos por dataset:")
    print(
        f"{'dataset':<30s} {'in CSV':>6s} {'en GeoJSON':>12s} {'huérfanos':>10s} {'sin datos':>10s}"
    )
    for name, rel in csvs.items():
        path = BASE / rel
        if not path.exists():
            print(f"{name:<30s} (CSV no existe)")
            continue
        df = pd.read_csv(path)
        if "poligono_id" not in df.columns:
            print(f"{name:<30s} (sin columna poligono_id)")
            continue
        ids_csv = set(df["poligono_id"].astype(str))
        huerfanos = ids_csv - ids_geo  # IDs en CSV no en geojson
        sin_datos = ids_geo - ids_csv  # IDs en geojson sin datos
        cobertura = len(ids_geo & ids_csv)
        print(
            f"{name:<30s} {len(ids_csv):>6d} {cobertura:>12d} {len(huerfanos):>10d} {len(sin_datos):>10d}"
        )
        if huerfanos:
            print(f"  ⚠ huérfanos: {sorted(huerfanos)[:5]}")
        if sin_datos and len(sin_datos) <= 5:
            print(f"  ⚠ sin datos: {sorted(sin_datos)}")

    print()
    print("Outliers métricas viviendas (serie_temporal):")
    df = pd.read_csv(BASE / "serie_temporal.csv")
    df_2018 = df[df["anio"] == 2018].copy() if "anio" in df.columns else pd.DataFrame()
    df_2026 = df[df["anio"] == df["anio"].max()].copy() if "anio" in df.columns else pd.DataFrame()
    if not df_2018.empty and not df_2026.empty:
        m = df_2018.merge(df_2026, on="poligono_id", suffixes=("_2018", "_fin"))
        m["delta_pct"] = (
            (m["edificios_total_fin"] - m["edificios_total_2018"])
            / m["edificios_total_2018"].replace(0, 1)
            * 100
        )
        sorted_m = m.sort_values("delta_pct", ascending=False)
        print(
            f"  Top 3 crecimiento: {sorted_m.head(3)[['poligono_id', 'edificios_total_2018', 'edificios_total_fin', 'delta_pct']].to_string(index=False)}"
        )
        print(
            f"  Bottom 3:          {sorted_m.tail(3)[['poligono_id', 'edificios_total_2018', 'edificios_total_fin', 'delta_pct']].to_string(index=False)}"
        )

    print()
    print("Polígonos con n_edificios=0 (probables errores):")
    cero = df[df.get("edificios_total", 0) == 0]
    if len(cero) > 0:
        print(cero[["poligono_id", "anio", "edificios_total"]].to_string(index=False))
    else:
        print("  (ninguno)")


if __name__ == "__main__":
    main()
