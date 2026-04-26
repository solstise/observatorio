"""Descarga de servicios públicos y red vial desde OpenStreetMap (Overpass API).

Tarea 2.4 primera parte — Fase 2.

Uso
---
    python scripts/04_descarga_osm.py \\
        --servicios "amenity=clinic,amenity=hospital,amenity=school"

Sin argumentos, usa el bbox de ``geografia`` y el listado
``servicios_osm.servicios`` desde ``config/settings.yaml``.

Qué hace
--------
1. Construye una query Overpass QL con los tags recibidos.
2. Hace POST a ``https://overpass-api.de/api/interpreter`` con retry/backoff
   (la API Overpass rate-limitea con códigos 429 y 504; respetamos el header
   ``Retry-After`` cuando está presente).
3. Convierte nodes / ways / relations a puntos (centroide para ways/rels) y
   arma un ``GeoDataFrame`` con columnas ``osm_id``, ``tipo`` (tag clave=valor),
   ``name``, ``lat``, ``lon``, ``tags_raw``.
4. Guarda en ``data/raw/osm/servicios_posadas.geojson`` (EPSG:4326).
5. Bonus: descarga también la red vial (``highway=*``) a
   ``data/raw/osm/calles_posadas.geojson``, conservando el tag ``surface``
   (útil para la Tarea 2.5, cobertura de pavimento).
6. Cachea ambos outputs junto a un ``metadata.json`` con bbox, tags, timestamp
   y hash de la query. Re-correr sin cambios es no-op si ``--force`` no está.

Licencia
--------
OSM y sus derivados quedan bajo ODbL. Obligatorio atribución:
"© OpenStreetMap contributors" en todo output que se publique.
"""

from __future__ import annotations

import hashlib
import json
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import click
import requests
from loguru import logger

try:
    import geopandas as gpd  # type: ignore
    from shapely.geometry import LineString, Point, mapping  # type: ignore
except ImportError:  # pragma: no cover
    gpd = None
    LineString = None
    Point = None
    mapping = None

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
import sys as _sys
from pathlib import Path as _Path

_p = _Path(__file__).resolve().parent
while _p != _p.parent:
    if (_p / "pyproject.toml").exists():
        if str(_p) not in _sys.path:
            _sys.path.insert(0, str(_p))
        break
    _p = _p.parent
# --- fin del parche ---------------------------------------------------------

from scripts.utils.config import BBox, load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

OVERPASS_ENDPOINTS: List[str] = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]
OVERPASS_TIMEOUT_SEC = 180
HTTP_TIMEOUT_SEC = 300
MAX_RETRIES = 5
BACKOFF_BASE_SEC = 8.0

_INTERRUPTED = False


def _install_sigint_handler() -> None:
    def _handler(signum, frame):  # noqa: ANN001
        global _INTERRUPTED
        _INTERRUPTED = True
        logger.warning("Ctrl+C recibido — terminando tras el request actual.")

    signal.signal(signal.SIGINT, _handler)


# ---------------------------------------------------------------------------
# Construcción de queries Overpass QL
# ---------------------------------------------------------------------------


def _normalizar_servicio(tag: str) -> Tuple[str, str]:
    """Parsea 'key=value' a (key, value)."""
    if "=" not in tag:
        raise click.BadParameter(f"Tag mal formado: '{tag}'. Usá 'key=value' ej. 'amenity=school'.")
    key, value = tag.split("=", 1)
    return key.strip(), value.strip()


def _query_servicios(servicios: Sequence[str], bbox: BBox) -> str:
    """Overpass QL: nodes, ways y relations con los tags pedidos, dentro del bbox."""
    bbox_s = f"{bbox.sur},{bbox.oeste},{bbox.norte},{bbox.este}"
    bloques: List[str] = []
    for svc in servicios:
        key, value = _normalizar_servicio(svc)
        for tipo in ("node", "way", "relation"):
            if value == "*":
                bloques.append(f'  {tipo}["{key}"]({bbox_s});')
            else:
                bloques.append(f'  {tipo}["{key}"="{value}"]({bbox_s});')
    cuerpo = "\n".join(bloques)
    return (
        f"[out:json][timeout:{OVERPASS_TIMEOUT_SEC}];\n"
        f"(\n{cuerpo}\n);\n"
        "out body center;\n"
        ">;\n"
        "out skel qt;\n"
    )


def _query_calles(bbox: BBox) -> str:
    """Overpass QL para la red vial del bbox. Preserva tags ``surface`` y ``name``."""
    bbox_s = f"{bbox.sur},{bbox.oeste},{bbox.norte},{bbox.este}"
    return (
        f"[out:json][timeout:{OVERPASS_TIMEOUT_SEC}];\n"
        "(\n"
        f'  way["highway"]({bbox_s});\n'
        ");\n"
        "out body;\n"
        ">;\n"
        "out skel qt;\n"
    )


# ---------------------------------------------------------------------------
# Cliente Overpass con retry/rotación de endpoints
# ---------------------------------------------------------------------------


@dataclass
class OverpassClient:
    """Cliente minimalista Overpass que rota entre endpoints al rate-limitear."""

    session: requests.Session
    endpoints: List[str]

    @classmethod
    def build(cls) -> "OverpassClient":
        s = requests.Session()
        s.headers.update(
            {
                "User-Agent": "observatorio-urbano-posadas/0.1 (+osm)",
                "Accept": "application/json",
            }
        )
        return cls(session=s, endpoints=list(OVERPASS_ENDPOINTS))

    def run(self, query: str) -> dict:
        """POST al endpoint activo. En 429/504 rota y aplica backoff."""
        last_err: Optional[Exception] = None
        for intento in range(1, MAX_RETRIES + 1):
            if _INTERRUPTED:
                raise KeyboardInterrupt()
            endpoint = self.endpoints[(intento - 1) % len(self.endpoints)]
            logger.info(f"Overpass intento {intento}/{MAX_RETRIES} → {endpoint}")
            try:
                resp = self.session.post(
                    endpoint,
                    data={"data": query},
                    timeout=HTTP_TIMEOUT_SEC,
                )
            except requests.RequestException as exc:
                last_err = exc
                delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
                logger.warning(
                    f"Error de red ({exc.__class__.__name__}: {exc}). " f"Backoff {delay:.1f}s."
                )
                time.sleep(delay)
                continue

            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 504):
                retry_after = resp.headers.get("Retry-After")
                if retry_after:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
                else:
                    delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
                logger.warning(
                    f"Overpass {resp.status_code} — rate limit. "
                    f"Reintento en {delay:.1f}s (cambio endpoint)."
                )
                time.sleep(delay)
                continue
            if 500 <= resp.status_code < 600:
                delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
                logger.warning(f"Overpass {resp.status_code}. Reintento en {delay:.1f}s.")
                time.sleep(delay)
                continue

            # Errores 4xx distintos a 429: levantar con detalle
            raise RuntimeError(f"Overpass respondió {resp.status_code}: " f"{resp.text[:300]}")

        raise RuntimeError(f"Overpass falló tras {MAX_RETRIES} intentos: {last_err}")


# ---------------------------------------------------------------------------
# Parseo de respuestas Overpass
# ---------------------------------------------------------------------------


def _coords_way(
    elem: dict, node_index: Dict[int, Tuple[float, float]]
) -> List[Tuple[float, float]]:
    """Reconstruye coordenadas de un way a partir del índice de nodes."""
    coords: List[Tuple[float, float]] = []
    for nid in elem.get("nodes", []):
        latlon = node_index.get(nid)
        if latlon is not None:
            coords.append((latlon[1], latlon[0]))  # (lon, lat)
    return coords


def _centroide_elem(
    elem: dict, node_index: Dict[int, Tuple[float, float]]
) -> Optional[Tuple[float, float]]:
    """Devuelve (lon, lat) del centroide. Prefiere ``center`` si está."""
    if elem.get("type") == "node":
        lat = elem.get("lat")
        lon = elem.get("lon")
        if lat is None or lon is None:
            return None
        return (float(lon), float(lat))
    center = elem.get("center")
    if center and center.get("lat") is not None:
        return (float(center["lon"]), float(center["lat"]))
    if elem.get("type") == "way":
        coords = _coords_way(elem, node_index)
        if not coords:
            return None
        mlon = sum(c[0] for c in coords) / len(coords)
        mlat = sum(c[1] for c in coords) / len(coords)
        return (mlon, mlat)
    return None


def _parse_servicios(data: dict, tags_pedidos: Sequence[str]) -> "gpd.GeoDataFrame":
    """Convierte la respuesta Overpass en GeoDataFrame de puntos."""
    if gpd is None or Point is None:
        raise RuntimeError("geopandas/shapely no están instalados.")
    elems = data.get("elements", [])
    node_index: Dict[int, Tuple[float, float]] = {}
    for e in elems:
        if e.get("type") == "node":
            node_index[int(e["id"])] = (float(e["lat"]), float(e["lon"]))

    keys_interes = {k.split("=")[0] for k in tags_pedidos}
    filas: List[dict] = []
    for e in elems:
        if e.get("type") == "node" and not any(k in (e.get("tags") or {}) for k in keys_interes):
            # Nodes auxiliares (parte de ways): los salteamos.
            continue
        tags = e.get("tags") or {}
        if not any(k in tags for k in keys_interes):
            continue
        centroide = _centroide_elem(e, node_index)
        if centroide is None:
            continue
        # Determinar 'tipo' más específico posible
        tipo = None
        for svc in tags_pedidos:
            k, v = _normalizar_servicio(svc)
            if k in tags and (v == "*" or tags[k] == v):
                tipo = f"{k}={tags[k]}"
                break
        filas.append(
            {
                "osm_id": f"{e['type']}/{e['id']}",
                "tipo": tipo or ",".join(f"{k}={tags[k]}" for k in keys_interes if k in tags),
                "name": tags.get("name") or tags.get("official_name"),
                "lon": centroide[0],
                "lat": centroide[1],
                "tags_raw": json.dumps(tags, ensure_ascii=False),
                "geometry": Point(centroide[0], centroide[1]),
            }
        )
    logger.info(f"Parseados {len(filas)} puntos de servicios.")
    return gpd.GeoDataFrame(filas, geometry="geometry", crs="EPSG:4326")


def _parse_calles(data: dict) -> "gpd.GeoDataFrame":
    """Convierte respuesta de ways highway=* en GeoDataFrame de líneas."""
    if gpd is None or LineString is None:
        raise RuntimeError("geopandas/shapely no están instalados.")
    elems = data.get("elements", [])
    node_index: Dict[int, Tuple[float, float]] = {}
    for e in elems:
        if e.get("type") == "node":
            node_index[int(e["id"])] = (float(e["lat"]), float(e["lon"]))

    filas: List[dict] = []
    for e in elems:
        if e.get("type") != "way":
            continue
        tags = e.get("tags") or {}
        if "highway" not in tags:
            continue
        coords = _coords_way(e, node_index)
        if len(coords) < 2:
            continue
        filas.append(
            {
                "osm_id": f"way/{e['id']}",
                "highway": tags.get("highway"),
                "name": tags.get("name"),
                "surface": tags.get("surface"),
                "tags_raw": json.dumps(tags, ensure_ascii=False),
                "geometry": LineString(coords),
            }
        )
    logger.info(f"Parseadas {len(filas)} calles.")
    return gpd.GeoDataFrame(filas, geometry="geometry", crs="EPSG:4326")


# ---------------------------------------------------------------------------
# Caché: firma y metadata
# ---------------------------------------------------------------------------


def _firma(bbox: BBox, items: Sequence[str], flavor: str) -> str:
    """Hash determinístico de (bbox, items, flavor) — para cachear queries."""
    payload = {
        "bbox": [bbox.oeste, bbox.sur, bbox.este, bbox.norte],
        "items": sorted(items),
        "flavor": flavor,
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def _guardar_metadata(destino: Path, bbox: BBox, items: Sequence[str], flavor: str) -> None:
    meta = {
        "firma": _firma(bbox, items, flavor),
        "bbox": {
            "oeste": bbox.oeste,
            "sur": bbox.sur,
            "este": bbox.este,
            "norte": bbox.norte,
        },
        "items": list(items),
        "flavor": flavor,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "licencia": "ODbL — © OpenStreetMap contributors",
    }
    with destino.open("w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)


def _metadata_coincide(path: Path, bbox: BBox, items: Sequence[str], flavor: str) -> bool:
    if not path.exists():
        return False
    try:
        with path.open("r", encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return False
    return meta.get("firma") == _firma(bbox, items, flavor)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option(
    "--bbox",
    default=None,
    help="BBox 'oeste,sur,este,norte'. Default: geografia.bbox del settings.",
)
@click.option(
    "--servicios",
    default=None,
    help=(
        "Lista de tags OSM separados por coma (ej. 'amenity=clinic,amenity=school'). "
        "Default: servicios_osm.servicios de settings.yaml."
    ),
)
@click.option(
    "--output",
    default="data/raw/osm/servicios_posadas.geojson",
    type=click.Path(),
    help="Archivo de salida de servicios.",
)
@click.option(
    "--calles-output",
    default="data/raw/osm/calles_posadas.geojson",
    type=click.Path(),
    help="Archivo de salida de calles (highway=*).",
)
@click.option(
    "--skip-calles",
    is_flag=True,
    default=False,
    help="No descargar calles.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Fuerza la descarga aunque haya cache válido.",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
)
def main(
    bbox: Optional[str],
    servicios: Optional[str],
    output: str,
    calles_output: str,
    skip_calles: bool,
    force: bool,
    log_level: str,
) -> None:
    """Descarga servicios públicos + red vial de OSM vía Overpass."""
    setup_logger(nivel=log_level)
    _install_sigint_handler()

    settings = load_settings()

    if bbox:
        partes = [float(x.strip()) for x in bbox.split(",")]
        if len(partes) != 4:
            raise click.BadParameter("bbox debe tener 4 valores.")
        bbox_obj = BBox(oeste=partes[0], sur=partes[1], este=partes[2], norte=partes[3])
    else:
        bbox_obj = settings.geografia.bbox

    if servicios:
        lista_svc = [s.strip() for s in servicios.split(",") if s.strip()]
    else:
        lista_svc = list(settings.servicios_osm.servicios)
    logger.info(f"Servicios a consultar ({len(lista_svc)}): {', '.join(lista_svc)}")

    if gpd is None:
        logger.error("geopandas no está instalado. Agregá 'pip install geopandas shapely'.")
        sys.exit(1)

    output_path = resolve_path(output)
    ensure_parent(output_path)
    meta_svc_path = output_path.with_suffix(".meta.json")

    client = OverpassClient.build()

    # --- Servicios ---
    if (
        not force
        and _metadata_coincide(meta_svc_path, bbox_obj, lista_svc, "servicios")
        and output_path.exists()
    ):
        logger.info(f"Servicios en cache: {output_path} (firma coincide).")
    else:
        q_svc = _query_servicios(lista_svc, bbox_obj)
        logger.debug(f"Query Overpass servicios:\n{q_svc}")
        data_svc = client.run(q_svc)
        gdf_svc = _parse_servicios(data_svc, lista_svc)
        if gdf_svc.empty:
            logger.warning("No se encontraron servicios en el bbox.")
        gdf_svc.to_file(output_path, driver="GeoJSON")
        _guardar_metadata(meta_svc_path, bbox_obj, lista_svc, "servicios")
        logger.info(f"Guardado {output_path} con {len(gdf_svc)} filas.")

    # --- Calles ---
    if not skip_calles:
        calles_path = resolve_path(calles_output)
        ensure_parent(calles_path)
        meta_calles_path = calles_path.with_suffix(".meta.json")
        if (
            not force
            and _metadata_coincide(meta_calles_path, bbox_obj, ["highway=*"], "calles")
            and calles_path.exists()
        ):
            logger.info(f"Calles en cache: {calles_path}.")
        else:
            q_calles = _query_calles(bbox_obj)
            data_calles = client.run(q_calles)
            gdf_calles = _parse_calles(data_calles)
            if gdf_calles.empty:
                logger.warning("No se encontraron calles en el bbox.")
            gdf_calles.to_file(calles_path, driver="GeoJSON")
            _guardar_metadata(meta_calles_path, bbox_obj, ["highway=*"], "calles")
            logger.info(f"Guardado {calles_path} con {len(gdf_calles)} filas.")

    logger.info("Descarga OSM finalizada.")


if __name__ == "__main__":
    main()
