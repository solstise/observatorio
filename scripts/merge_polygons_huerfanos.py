"""Merge `config/poligonos_propuestos_huerfanos.geojson` al
`config/poligonos.geojson` principal SIN modificar ninguno de los 44 polígonos
existentes.

Pre-condiciones (verificadas por el script):
  * El preview existe y validó zero overlap contra los 44 actuales.
  * Ningún ID nuevo colisiona con los IDs existentes.

Acciones:
  1. Backup automático: `config/poligonos.geojson.bak.AAAAMMDD-HHMMSS`.
  2. Append de los features del preview al `features` del config.
  3. Re-corrida del audit de solapamientos final (paranoia).
  4. Reporte de líneas tocadas.

Tras aplicar:
  * Los 44 IDs originales quedan **byte-identical** en sus geometrías y props.
  * Aparecen los nuevos IDs al final del array.
  * El sitio renderiza solo los que tienen `publicar_en_sitio` true (los
    publicables) — el resto queda en config para auditoría pero no en UI.

Uso
---
    python scripts/merge_polygons_huerfanos.py
    # o con --dry-run para solo verificar sin escribir.
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

import geopandas as gpd
from shapely.geometry import shape

ROOT = Path(__file__).resolve().parent.parent
PATH_LEGACY = ROOT / "config/poligonos.geojson"
PATH_NUEVOS = ROOT / "config/poligonos_propuestos_huerfanos.geojson"

METRIC = 22195
TOL_OVERLAP_M2 = 100.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="No escribe.")
    args = parser.parse_args()

    if not PATH_NUEVOS.exists():
        raise SystemExit(
            f"No existe el preview: {PATH_NUEVOS}\n"
            f"Correr primero: python scripts/propose_polygons_huerfanos.py"
        )

    legacy = json.loads(PATH_LEGACY.read_text(encoding="utf-8"))
    nuevos = json.loads(PATH_NUEVOS.read_text(encoding="utf-8"))

    legacy_ids = {f["properties"]["id"] for f in legacy["features"]}
    nuevos_ids = [f["properties"]["id"] for f in nuevos["features"]]

    # ── Validaciones ──────────────────────────────────────────────────────
    print(f"Polígonos legacy: {len(legacy['features'])}")
    print(f"Polígonos nuevos: {len(nuevos['features'])}")

    # 1. IDs no deben colisionar.
    colisiones = set(legacy_ids) & set(nuevos_ids)
    if colisiones:
        raise SystemExit(f"ERROR: colisión de IDs entre legacy y nuevos: {sorted(colisiones)}")
    print("✓ Sin colisión de IDs.")

    # 2. IDs nuevos únicos entre sí.
    if len(nuevos_ids) != len(set(nuevos_ids)):
        from collections import Counter

        dupes = [k for k, v in Counter(nuevos_ids).items() if v > 1]
        raise SystemExit(f"ERROR: IDs duplicados en preview: {dupes}")
    print("✓ Sin IDs duplicados en preview.")

    # 3. Zero overlap geométrico contra los 44 legacy (paranoia recheck).
    legacy_gdf = gpd.GeoDataFrame.from_features(legacy["features"], crs=4326)
    legacy_real = legacy_gdf[legacy_gdf["nombre"] != "Posadas (toda la ciudad)"]
    legacy_m = legacy_real.to_crs(METRIC)
    union_legacy_m = legacy_m.geometry.union_all()

    overlap_count = 0
    for f in nuevos["features"]:
        g = shape(f["geometry"])
        gm = gpd.GeoSeries([g], crs=4326).to_crs(METRIC).iloc[0]
        inter = gm.intersection(union_legacy_m)
        if not inter.is_empty and inter.area > TOL_OVERLAP_M2:
            overlap_count += 1
            print(f"  ⚠ overlap real: {f['properties']['id']} " f"({inter.area / 1e6:.4f} km²)")
    if overlap_count > 0:
        raise SystemExit(
            f"ERROR: {overlap_count} polígonos nuevos solapan con legacy "
            f"(>{TOL_OVERLAP_M2} m²). Re-correr propose_polygons_huerfanos.py"
        )
    print("✓ Zero overlap contra los 44 legacy.")

    # ── Merge ─────────────────────────────────────────────────────────────
    if args.dry_run:
        print("\n[DRY-RUN] Validaciones OK. No se escribe.")
        return

    # Backup.
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bk = PATH_LEGACY.with_suffix(f".geojson.bak.{ts}")
    shutil.copy2(PATH_LEGACY, bk)
    print(f"\nBackup: {bk}")

    # Append.
    out = dict(legacy)
    out["features"] = list(legacy["features"]) + list(nuevos["features"])
    PATH_LEGACY.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Escrito: {PATH_LEGACY}")
    print(
        f"  total polígonos: {len(out['features'])} "
        f"({len(legacy['features'])} legacy + {len(nuevos['features'])} nuevos)"
    )

    publicables = sum(
        1 for f in nuevos["features"] if f["properties"].get("publicar_en_sitio") is True
    )
    print(f"  → de los nuevos, {publicables} se publican en el sitio.")
    print("\nProximo paso recomendado: python scripts/_audit_overlaps.py " "para validación final.")


if __name__ == "__main__":
    main()
