"""Descarga barrios oficiales de Posadas desde OSM Overpass.

Genera un GeoJSON con todos los `place=suburb|neighbourhood|hamlet|quarter`
y `admin_level=10` dentro del bbox del proyecto. Guarda dos artefactos:

* ``data/raw/osm/barrios_posadas_overpass.json`` — respuesta cruda
* ``data/raw/osm/barrios_posadas.geojson`` — GeoDataFrame con geometría real
  (Polygon/MultiPolygon si OSM lo tiene, Point si solo es un node).

Ejecución reproducible:

    wsl -d Ubuntu -- bash -c "cd /mnt/c/ProyectosIA/Antigravity/observatorio \
        && source venv/bin/activate && python scripts/get_barrios_osm.py"

Datos cacheados con `data/raw/osm/barrios_metadata.json`.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "raw" / "osm"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# bbox del proyecto (config/settings.yaml)
BBOX = (-27.50, -56.00, -27.30, -55.80)  # S, W, N, E

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

HEADERS = {
    "User-Agent": (
        "ObservatorioUrbanoPosadas/0.3 " "(github.com/observatorio-posadas; fundile@gmail.com)"
    ),
    "Accept": "application/json",
}

QUERY_TPL = """[out:json][timeout:180];
(
  node["place"~"^(suburb|neighbourhood|hamlet|quarter|village)$"]({s},{w},{n},{e});
  way["place"~"^(suburb|neighbourhood|hamlet|quarter|village)$"]({s},{w},{n},{e});
  relation["place"~"^(suburb|neighbourhood|hamlet|quarter|village)$"]({s},{w},{n},{e});
  relation["admin_level"="10"]({s},{w},{n},{e});
  way["admin_level"="10"]({s},{w},{n},{e});
);
(._;>;);
out body;
"""


def fetch_overpass() -> dict:
    s, w, n, e = BBOX
    query = QUERY_TPL.format(s=s, w=w, n=n, e=e)
    last_err = None
    for url in OVERPASS_URLS:
        try:
            print(f"-> POST {url}")
            r = requests.post(url, data={"data": query}, headers=HEADERS, timeout=180)
            print(f"   status={r.status_code} bytes={len(r.content)}")
            if r.status_code == 200 and r.content.startswith(b"{"):
                return r.json()
            last_err = f"{url} -> {r.status_code}"
        except Exception as exc:  # pragma: no cover
            last_err = f"{url} -> {exc!r}"
        time.sleep(2)
    raise RuntimeError(f"Overpass failed: {last_err}")


def main() -> None:
    data = fetch_overpass()
    raw_path = OUT_DIR / "barrios_posadas_overpass.json"
    raw_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"Saved raw -> {raw_path}")

    elements = data.get("elements", [])
    suburbs = [
        el
        for el in elements
        if el.get("type") in ("node", "way", "relation")
        and (
            el.get("tags", {}).get("place")
            in ("suburb", "neighbourhood", "hamlet", "quarter", "village")
            or el.get("tags", {}).get("admin_level") == "10"
        )
    ]
    print(f"\nElementos con tags barrio: {len(suburbs)}")
    for el in sorted(suburbs, key=lambda x: x.get("tags", {}).get("name", "")):
        tags = el.get("tags", {})
        print(
            f"  {el['type']:9} id={el['id']:>10}  "
            f"place={tags.get('place','-'):14} "
            f"admin_level={tags.get('admin_level','-'):3}  "
            f"{tags.get('name','???')}"
        )


if __name__ == "__main__":
    main()
