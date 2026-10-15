"""Recorta Copernicus GLO-30 Public 2021 COG sobre barrios +600 m. Sin credenciales."""

import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.windows import Window, from_bounds

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "data/raw/dem/posadas_dem_nino.tif"


def descargar():
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    polygons = gpd.read_file(ROOT / "config/poligonos.geojson").to_crs(32721)
    polygons = polygons[
        (polygons.id != "posadas_completa") & (polygons.categoria != "ciudad_completa")
    ]
    area = gpd.GeoSeries([polygons.geometry.union_all().buffer(600)], crs=32721).to_crs(4326)
    bounds = area.total_bounds.tolist()
    urls, cropped = [], []
    for lat in range(math.floor(bounds[1]), math.ceil(bounds[3])):
        for lon in range(math.floor(bounds[0]), math.ceil(bounds[2])):
            name = f"Copernicus_DSM_COG_10_{'S' if lat < 0 else 'N'}{abs(lat):02d}_00_{'W' if lon < 0 else 'E'}{abs(lon):03d}_00_DEM"
            url = f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"
            urls.append(url)
            tile = TARGET.parent / f"{name}_nino_recorte.tif"
            print(f"Leyendo ventana pública de {name}", flush=True)
            with rasterio.Env(
                GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                GDAL_HTTP_TIMEOUT="60",
            ):
                with rasterio.open(url) as source:
                    left = max(bounds[0], source.bounds.left)
                    bottom = max(bounds[1], source.bounds.bottom)
                    right = min(bounds[2], source.bounds.right)
                    top = min(bounds[3], source.bounds.top)
                    w = from_bounds(left, bottom, right, top, source.transform)
                    window = Window(
                        math.floor(w.col_off),
                        math.floor(w.row_off),
                        math.ceil(w.col_off + w.width) - math.floor(w.col_off),
                        math.ceil(w.row_off + w.height) - math.floor(w.row_off),
                    )
                    data = source.read(1, window=window, masked=True)
                    profile = source.profile.copy()
                    profile.update(
                        height=data.shape[0],
                        width=data.shape[1],
                        transform=source.window_transform(window),
                        compress="deflate",
                        nodata=-9999,
                        dtype="float32",
                        count=1,
                    )
                    with rasterio.open(tile, "w", **profile) as dest:
                        dest.write(data.filled(-9999).astype("float32"), 1)
            cropped.append(tile)
    sources = [rasterio.open(p) for p in cropped]
    try:
        array, transform = merge(sources, nodata=-9999)
        profile = sources[0].profile.copy()
        profile.update(height=array.shape[1], width=array.shape[2], transform=transform)
        with rasterio.open(TARGET, "w", **profile) as dest:
            dest.write(array)
        valid = np.isfinite(array) & (array != -9999)
    finally:
        for source in sources:
            source.close()
    metadata = {
        "downloaded_at": datetime.now(timezone.utc).isoformat(),
        "dataset": "Copernicus DEM GLO-30 Public, release 2021",
        "fuente": "https://registry.opendata.aws/copernicus-dem/",
        "urls": urls,
        "bbox_barrios_margen_600m": bounds,
        "resampling": "ninguno: ventanas y mosaico en grilla nativa",
        "nodata_pixels": int((~valid).sum()),
        "shape": list(array.shape),
        "sha256": hashlib.sha256(TARGET.read_bytes()).hexdigest(),
    }
    TARGET.with_suffix(".json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    descargar()
