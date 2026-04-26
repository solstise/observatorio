"""Prueba si nuestro proyecto Earth Engine puede acceder al dataset NICFI."""

import os
import sys
from pathlib import Path

import ee
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

project = os.environ.get("EE_PROJECT_ID", "observatorio-posadas")
print(f"Proyecto EE: {project}\n")

try:
    ee.Initialize(project=project)
    print("ee.Initialize OK\n")
except Exception as e:
    print(f"FALLO ee.Initialize: {e}")
    sys.exit(1)

# Probar acceso al dataset NICFI Americas.
ASSET = "projects/planet-nicfi/assets/basemaps/americas"
print(f"Intentando acceder a {ASSET}...")

try:
    ic = ee.ImageCollection(ASSET)
    # Filtrar por Posadas (aprox) y 2024-07.
    aoi = ee.Geometry.Rectangle([-56.01, -27.43, -55.97, -27.39])
    sub = ic.filterDate("2024-07-01", "2024-08-01").filterBounds(aoi)
    count = sub.size().getInfo()
    print(f"  Mosaicos encontrados en Posadas julio 2024: {count}")

    if count > 0:
        first = ee.Image(sub.first())
        bands = first.bandNames().getInfo()
        props = first.propertyNames().getInfo()
        print(f"  Bandas: {bands}")
        print(f"  Properties (sample): {props[:10]}")
        print(f"  ID imagen: {first.get('system:id').getInfo()}")
        print(f"  Cadencia: {first.get('cadence').getInfo()}")
        print("\n  ✓ ACCESO OK - podemos usar NICFI vía GEE sin costo")
    else:
        print("  Sin mosaicos — verificar acceso al programa NICFI/TFO")
except ee.EEException as exc:
    msg = str(exc)
    print(f"\n  FALLO: {msg[:300]}")
    if "denied" in msg.lower() or "permission" in msg.lower() or "access" in msg.lower():
        print("\n  ❌ Tu proyecto EE NO tiene acceso al dataset NICFI todavía.")
        print("  Tenés que registrarte en:")
        print("    https://docs.planet.com/platform/integrations/google-earth-engine/nicfi-gee/")
        print("  o (antes del rebrand):")
        print("    https://www.planet.com/nicfi/")
        print("  Una vez aprobado, asocian tu proyecto EE al programa y podés acceder gratis.")
    sys.exit(2)
