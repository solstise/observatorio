"""Descarga buildings para los polígonos nuevos (no cubiertos por el dump existente).

Contexto: el GeoJSON existente en data/raw/google_buildings/posadas_buildings.geojson
cubre la bbox [-56.008, -27.423, -55.895, -27.351] (116k edificios, c=0.70).
Con la ampliación a 14 polígonos la bbox agregada es [-56.028, -27.464, -55.856, -27.347],
que excede en oeste (nemesio_parma), este (miguel_lanus, villa_bonita) y sur (villa_bonita).

Google Open Buildings v3 para la bbox completa da 202k features en EE, lo cual excede
el límite de getDownloadURL (HTTP 500). Estrategia:

1. Descargar por polígono nuevo usando bbox chico (polígono + buffer 100m).
2. Merge con el geojson existente, deduplicando por building_id (full_plus_code).
3. Sobrescribir posadas_buildings.geojson.

El resumen JSON se actualiza con el nuevo total.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import ee
import geopandas as gpd
import pandas as pd
import urllib.request
import shutil
from dotenv import load_dotenv
import os

RAIZ = Path(__file__).resolve().parent.parent.parent
GEOJSON_OUT = RAIZ / "data" / "raw" / "google_buildings" / "posadas_buildings.geojson"
CSV_OUT = RAIZ / "data" / "raw" / "google_buildings" / "posadas_buildings.csv"
RESUMEN_OUT = RAIZ / "data" / "raw" / "google_buildings" / "posadas_buildings.resumen.json"

EE_ASSET = "GOOGLE/Research/open-buildings/v3/polygons"
CONFIDENCE_MIN = 0.70

# IDs de polígonos nuevos (los originales ya están cubiertos).
NUEVOS = [
    "miguel_lanus",
    "villa_sarita",
    "nemesio_parma",
    "itaembe_pora",
    "villa_urquiza",
    "aguas_corrientes",
    "centro",
    "bajada_vieja",
    "villa_bonita",
]


def descargar_bbox(oeste, sur, este, norte):
    """Descarga buildings para una bbox chica (devuelve GeoDataFrame)."""
    region = ee.Geometry.Rectangle([oeste, sur, este, norte])
    fc = ee.FeatureCollection(EE_ASSET).filterBounds(region)
    fc_filt = fc.filter(ee.Filter.gte("confidence", CONFIDENCE_MIN))
    n = fc_filt.size().getInfo()
    print(f"    → {n} edificios en bbox")
    if n == 0:
        return gpd.GeoDataFrame(columns=["building_id", "lat", "lon", "area_m2", "confidence", "geometry"], geometry="geometry", crs="EPSG:4326")

    # Intentar getDownloadURL.
    import tempfile
    url = fc_filt.getDownloadURL(filetype="GEOJSON")
    tmp = Path(tempfile.mktemp(suffix=".geojson"))
    with urllib.request.urlopen(url, timeout=600) as resp, tmp.open("wb") as fh:
        shutil.copyfileobj(resp, fh)
    gdf = gpd.read_file(tmp)
    tmp.unlink(missing_ok=True)
    return gdf


def main():
    load_dotenv(RAIZ / ".env")
    ee.Initialize(project=os.environ.get("EE_PROJECT_ID", "observatorio-posadas"))

    # Cargar polígonos.
    poligonos = gpd.read_file(RAIZ / "config" / "poligonos.geojson")
    poligonos_nuevos = poligonos[poligonos["id"].isin(NUEVOS)].copy()
    print(f"Polígonos nuevos a bajar: {len(poligonos_nuevos)}")

    # Cargar buildings existentes.
    existente = gpd.read_file(GEOJSON_OUT)
    print(f"Existentes: {len(existente)} edificios")
    existente_ids = set(existente["building_id"].astype(str))

    nuevos_frames = []
    for _, row in poligonos_nuevos.iterrows():
        pid = row["id"]
        # bbox del polígono con buffer 200m ~ 0.002°.
        w, s, e, n = row.geometry.bounds
        buffer = 0.002
        bbox = (w - buffer, s - buffer, e + buffer, n + buffer)
        print(f"[{pid}] bbox={bbox}")
        try:
            gdf = descargar_bbox(*bbox)
            if len(gdf) > 0:
                # Renombrar como post-proceso estándar.
                rename = {}
                if "area_in_meters" in gdf.columns:
                    rename["area_in_meters"] = "area_m2"
                if rename:
                    gdf = gdf.rename(columns=rename)
                # Normalizar building_id.
                if "full_plus_code" in gdf.columns:
                    gdf["building_id"] = gdf["full_plus_code"].astype(str)
                else:
                    gdf["building_id"] = [f"b_{pid}_{i:08d}" for i in range(len(gdf))]
                # lat/lon de centroides.
                if "lat" not in gdf.columns or "lon" not in gdf.columns:
                    centroides = gdf.geometry.centroid
                    gdf["lat"] = centroides.y
                    gdf["lon"] = centroides.x
                cols = ["building_id", "lat", "lon", "area_m2", "confidence", "geometry"]
                cols_existen = [c for c in cols if c in gdf.columns]
                gdf = gdf[cols_existen]
                nuevos_frames.append(gdf)
                print(f"  agregado: {len(gdf)}")
        except Exception as exc:
            print(f"  FALLO: {exc}")

    if not nuevos_frames:
        print("No se bajaron buildings nuevos.")
        return

    nuevos = pd.concat(nuevos_frames, ignore_index=True)
    nuevos = gpd.GeoDataFrame(nuevos, geometry="geometry", crs="EPSG:4326")
    print(f"Total buildings nuevos bajados: {len(nuevos)}")

    # Dedup: el building_id de google (plus_code) es único.
    nuevos_filtrados = nuevos[~nuevos["building_id"].isin(existente_ids)].copy()
    print(f"Después de dedup vs existente: {len(nuevos_filtrados)} nuevos únicos")

    # Merge final.
    merge = gpd.GeoDataFrame(
        pd.concat([existente, nuevos_filtrados], ignore_index=True),
        geometry="geometry", crs="EPSG:4326",
    )
    print(f"Total final: {len(merge)}")

    # Sobrescribir.
    merge.to_file(GEOJSON_OUT, driver="GeoJSON")

    # CSV sidecar.
    df_csv = merge.drop(columns=["geometry"]).copy()
    df_csv.to_csv(CSV_OUT, index=False)

    # Resumen.
    resumen = {
        "fuente": EE_ASSET,
        "bbox": list(merge.total_bounds),
        "confidence_min": CONFIDENCE_MIN,
        "timestamp": datetime.utcnow().isoformat(),
        "version_script": "0.1.1-ampliacion",
        "total_filtrado": len(merge),
        "area_promedio_m2": float(merge["area_m2"].mean()) if "area_m2" in merge.columns else None,
        "nota": f"Ampliación desde 116k a {len(merge)} por adición de buildings en polígonos nuevos",
    }
    RESUMEN_OUT.write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nResumen escrito a {RESUMEN_OUT}")


if __name__ == "__main__":
    main()
