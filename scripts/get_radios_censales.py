"""Descarga radios censales INDEC 2022 (departamento Capital, Misiones).

La cartografía oficial de radios censales 2022 del INDEC se publica vía
GeoServer en https://geonode.indec.gob.ar/geoserver/ows como la capa
``geonode:radios_censales2``. Cada radio es la unidad mínima de empadronamiento
y son **mutuamente exclusivos** por construcción: no se solapan entre sí.

Esta es la fuente autoritativa para recortar a un radio del Departamento
Capital de Misiones (Posadas). La usamos como base para reconstruir
``config/poligonos.geojson`` sin solapamientos (ver ``scripts/build_polygons_from_radios.py``).

Salidas
-------
- ``data/raw/indec/radios_censales_capital_misiones.geojson`` — todos los
  radios del depto Capital (urbanos, rurales y mixtos), CRS EPSG:4326.
- ``data/raw/indec/_metadata/radios_censales_capital.json`` — metadatos
  (URL WFS, bbox, n_features, md5, fecha).

Uso
---
::

    wsl -d Ubuntu -- bash -c "cd /mnt/c/ProyectosIA/Antigravity/observatorio \\
        && source venv/bin/activate && python scripts/get_radios_censales.py"

Licencia
--------
INDEC publica bajo Ley 27.275 (Acceso a la Información Pública). Atribución:
*Instituto Nacional de Estadística y Censos (INDEC), Censo 2022, cartografía
de radios censales.*
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "raw" / "indec"
META_DIR = OUT_DIR / "_metadata"

# Bbox de Posadas (config/settings.yaml)
BBOX_OESTE, BBOX_SUR, BBOX_ESTE, BBOX_NORTE = -56.00, -27.50, -55.80, -27.30

WFS_URL = "https://geonode.indec.gob.ar/geoserver/ows"
TYPE_NAME = "geonode:radios_censales2"

USER_AGENT = "observatorio-urbano-posadas/0.3 (+radios-censales-indec)"


def fetch_radios() -> dict:
    """GET WFS GetFeature, devuelve GeoJSON FeatureCollection completo del bbox."""
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": TYPE_NAME,
        "srsName": "EPSG:4326",
        "outputFormat": "application/json",
        "bbox": f"{BBOX_OESTE},{BBOX_SUR},{BBOX_ESTE},{BBOX_NORTE},EPSG:4326",
    }
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    # GeoServer del INDEC tiene cadena TLS incompleta (común en *.gob.ar)
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass
    print(f"WFS GetFeature -> {WFS_URL} typeNames={TYPE_NAME}")
    r = requests.get(WFS_URL, params=params, headers=headers, timeout=180, verify=False)
    r.raise_for_status()
    print(f"  status={r.status_code} bytes={len(r.content):,}")
    return r.json()


def filter_capital(fc: dict) -> dict:
    """Filtra solo radios cuyo dpto == Capital (Misiones)."""
    feats = [f for f in fc.get("features", []) if f["properties"].get("dpto") == "Capital"]
    return {"type": "FeatureCollection", "features": feats}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    META_DIR.mkdir(parents=True, exist_ok=True)

    fc = fetch_radios()
    fc_capital = filter_capital(fc)
    n = len(fc_capital["features"])
    print(f"Radios depto Capital (Misiones): {n}")

    out_path = OUT_DIR / "radios_censales_capital_misiones.geojson"
    text = json.dumps(fc_capital, ensure_ascii=False)
    out_path.write_text(text, encoding="utf-8")
    md5 = hashlib.md5(text.encode("utf-8")).hexdigest()
    print(f"-> {out_path} ({out_path.stat().st_size:,} bytes md5={md5[:8]}...)")

    # Conteo por tipo (Urbano/Rural/Mixto)
    from collections import Counter
    by_tro = Counter(f["properties"].get("tro") or "?" for f in fc_capital["features"])
    by_cfn = Counter(f["properties"].get("cfn") or "?" for f in fc_capital["features"])
    print(f"  por tipo (tro): {dict(by_tro)}")
    print(f"  fracciones (cfn) distintas: {len(by_cfn)}")

    meta = {
        "fuente": "INDEC GeoNode WFS",
        "url": (
            f"{WFS_URL}?service=WFS&version=2.0.0&request=GetFeature"
            f"&typeNames={TYPE_NAME}&srsName=EPSG:4326&outputFormat=application/json"
            f"&bbox={BBOX_OESTE},{BBOX_SUR},{BBOX_ESTE},{BBOX_NORTE},EPSG:4326"
        ),
        "type_name": TYPE_NAME,
        "filtro_post_descarga": 'properties.dpto == "Capital"',
        "bbox": [BBOX_OESTE, BBOX_SUR, BBOX_ESTE, BBOX_NORTE],
        "archivo": str(out_path.relative_to(ROOT)),
        "n_features": n,
        "by_tro": dict(by_tro),
        "n_fracciones": len(by_cfn),
        "md5": md5,
        "fecha_descarga": datetime.now(timezone.utc).isoformat(),
        "licencia": (
            "INDEC bajo Ley 27.275 (acceso, uso y redistribución libres). "
            "Atribución: 'Instituto Nacional de Estadística y Censos (INDEC), "
            "Censo 2022, cartografía de radios censales'."
        ),
        "esquema_propiedades": {
            "fid": "ID interno GeoNode",
            "id": "ID INDEC del radio",
            "cpr": "Código provincia (54 = Misiones)",
            "jur": "Nombre provincia",
            "cde": "Código departamento (54028 = Capital)",
            "dpto": "Nombre departamento",
            "cfn": "Código fracción censal (numérico)",
            "cro": "Código de radio dentro de la fracción",
            "tro": "Tipo: U=Urbano, R=Rural, M=Mixto",
            "cod_indec": "Código compuesto cpr+cde+cfn+cro (clave única)",
            "sag": "Origen del dato (INDEC)",
        },
    }
    meta_path = META_DIR / "radios_censales_capital.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"-> {meta_path}")


if __name__ == "__main__":
    main()
