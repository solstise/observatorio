"""Recorta arg_ppp_2020.tif (ya descargado) al bbox ampliado.

Evita re-descargar el raster global de 1.8GB al usar --force.
Usa la misma lógica de recorte que 05_descarga_worldpop.py pero saltea el download.
"""

import json
from datetime import datetime
from pathlib import Path

import geopandas as gpd
import rasterio
from rasterio.mask import mask
from shapely.geometry import box

RAIZ = Path(__file__).resolve().parent.parent.parent

RASTER_GLOBAL = RAIZ / "data" / "raw" / "worldpop" / "arg_ppp_2020.tif"
RASTER_RECORTE = RAIZ / "data" / "raw" / "worldpop" / "posadas_pop_2020.tif"
RESUMEN = RAIZ / "data" / "raw" / "worldpop" / "posadas_pop_2020.resumen.json"


def main():
    # bbox del geojson actual.
    poligonos = gpd.read_file(RAIZ / "config" / "poligonos.geojson")
    west, south, east, north = poligonos.total_bounds
    # Pequeño margen.
    margen = 0.01
    bbox = (west - margen, south - margen, east + margen, north + margen)
    print(f"BBox recorte: {bbox}")

    if not RASTER_GLOBAL.exists():
        raise SystemExit(f"No existe {RASTER_GLOBAL}. Correr descarga primero.")

    with rasterio.open(RASTER_GLOBAL) as src:
        print(f"Raster global: CRS={src.crs} shape={src.shape} bounds={src.bounds}")
        geom = [box(*bbox).__geo_interface__]
        recortado, transform = mask(src, geom, crop=True, filled=True, nodata=src.nodata)
        meta = src.meta.copy()
        meta.update(
            {
                "height": recortado.shape[1],
                "width": recortado.shape[2],
                "transform": transform,
            }
        )
        RASTER_RECORTE.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(RASTER_RECORTE, "w", **meta) as dst:
            dst.write(recortado)
        print(f"Recorte: shape={recortado.shape} → {RASTER_RECORTE}")

    # Actualizar resumen.
    size_mb = RASTER_RECORTE.stat().st_size / (1024 * 1024)
    with rasterio.open(RASTER_RECORTE) as src:
        resumen = {
            "fuente": "WorldPop Global 2000-2020 top-down unconstrained",
            "pais": "ARG",
            "year": "2020",
            "url_origen": "https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/ARG/arg_ppp_2020.tif",
            "fecha_recorte": datetime.utcnow().isoformat(),
            "version_script": "0.1.1-ampliacion",
            "bbox_solicitada": list(bbox),
            "bbox_efectiva": list(src.bounds),
            "shape": list(src.shape),
            "resolucion_deg": [src.transform[0], abs(src.transform[4])],
            "crs": str(src.crs),
            "size_mb": round(size_mb, 3),
        }
    RESUMEN.write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Resumen: {RESUMEN}")


if __name__ == "__main__":
    main()
