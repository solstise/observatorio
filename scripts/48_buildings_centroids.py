"""Convierte el GeoJSON de polígonos de edificios mergeados a un GeoJSON liviano de centroides.

El input ``data/raw/buildings_merge/posadas_merged_buildings.geojson`` (~165 MB,
217 mil features Polygon) es demasiado pesado para servirse directamente al
frontend. Como cada feature ya trae ``lat`` y ``lon`` (centroide pre-calculado
en EPSG:32721 por ``42_ms_buildings_merge.py``), simplemente extraemos esos
puntos y descartamos la geometría poligonal y los campos no-renderizables.

Convenciones aplicadas para minimizar peso:
    - properties cortas: ``s`` (source), ``a`` (area_m2 redondeada a entero).
    - source mapeado a 1 letra: google→"g", microsoft→"m", both→"b".
    - sin ``building_id``, ``confidence_google``, ``geometry_wkt``.

Estimado de peso: 217k features × ~80 bytes ≈ 17 MB sin gzip; con la
compresión gzip que ya tiene activa nginx queda ~5-7 MB on-the-wire.

Idempotencia: usa MD5 del input para detectar cambios. Si el GeoJSON
intermedio coincide con el del último run, no rehace el trabajo.

Ejemplo de uso
--------------
    python scripts/48_buildings_centroids.py
    python scripts/48_buildings_centroids.py --force
    python scripts/48_buildings_centroids.py \\
        --input data/raw/buildings_merge/posadas_merged_buildings.geojson \\
        --output webapp/frontend/public/data/buildings_centroids.geojson
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Optional

import click
from loguru import logger
from tqdm import tqdm

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

from scripts.utils.io_geo import cache_check, hash_file
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_parent, resolve_path


SCRIPT_VERSION = "0.1.0"

DEFAULT_INPUT = "data/raw/buildings_merge/posadas_merged_buildings.geojson"
DEFAULT_OUTPUT = "webapp/frontend/public/data/buildings_centroids.geojson"

# Mapping de la columna `source` a 1 letra (compresión barata pero efectiva
# multiplicada por 217k features).
SOURCE_SHORT = {
    "google": "g",
    "microsoft": "m",
    "both": "b",
}


def _stream_features(input_path: Path):
    """Itera los features del GeoJSON línea a línea sin cargar todo en RAM.

    El archivo del pipeline (escrito por geopandas con driver=GeoJSON) tiene
    una feature por línea, en formato:

        {"type": "Feature", "properties": {...}, "geometry": {...}},

    Esto nos permite parsear como JSONL recortando la coma final, sin levantar
    los 165 MB en memoria.

    Args:
        input_path: Path al GeoJSON de polígonos.

    Yields:
        Diccionarios feature parseados.
    """
    with input_path.open("r", encoding="utf-8") as fh:
        for raw_line in fh:
            linea = raw_line.strip()
            if not linea or not linea.startswith('{ "type": "Feature"'):
                # Saltamos header (FeatureCollection, name, crs, "features": [)
                # y footer (]} cierre).
                continue
            # Quitamos coma final si la hay (todas menos la última feature
            # terminan en `},`).
            if linea.endswith(","):
                linea = linea[:-1]
            try:
                yield json.loads(linea)
            except json.JSONDecodeError as exc:
                logger.warning(f"Línea inválida (skip): {exc}")
                continue


def _convertir_a_centroides(input_path: Path, output_path: Path) -> dict:
    """Lee el GeoJSON de polígonos y escribe el GeoJSON de Points en streaming.

    Args:
        input_path: Path al GeoJSON merged (Polygons).
        output_path: Path destino para el GeoJSON liviano (Points).

    Returns:
        Dict con métricas: total, conteo por source, peso archivo (bytes).
    """
    ensure_parent(output_path)
    contador: Counter[str] = Counter()
    total = 0
    saltados = 0

    with output_path.open("w", encoding="utf-8") as out:
        out.write('{"type":"FeatureCollection","name":"buildings_centroids",')
        out.write('"crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:OGC:1.3:CRS84"}},')
        out.write('"features":[')
        primero = True

        for feat in tqdm(
            _stream_features(input_path),
            desc="Centroides",
            unit=" feat",
            mininterval=0.5,
        ):
            props = feat.get("properties") or {}
            lat = props.get("lat")
            lon = props.get("lon")
            source = props.get("source")
            area = props.get("area_m2")

            # Defensa: si falta cualquier campo crítico, salteamos en silencio
            # y reportamos al final cuántos quedaron afuera.
            if lat is None or lon is None or source is None:
                saltados += 1
                continue

            s = SOURCE_SHORT.get(source)
            if s is None:
                # Source inesperado — no rompemos pero contamos.
                saltados += 1
                continue

            # area_m2 a entero. None → 0 (no se va a renderizar de todos modos
            # si está mal).
            try:
                a = int(round(float(area))) if area is not None else 0
            except (TypeError, ValueError):
                a = 0

            # Escribimos compacto, sin espacios, sin saltos de línea por feature.
            # Coordinates en orden GeoJSON: [lon, lat].
            # Redondeamos a 6 decimales (precisión ~11 cm a la latitud de Posadas,
            # más que suficiente para visualizar puntos a zoom <=22). Esto baja
            # el peso del output ~40% vs los 15 decimales que escribe geopandas.
            lon_r = round(float(lon), 6)
            lat_r = round(float(lat), 6)
            feat_min = {
                "type": "Feature",
                "properties": {"s": s, "a": a},
                "geometry": {"type": "Point", "coordinates": [lon_r, lat_r]},
            }
            if not primero:
                out.write(",")
            # separators=(',',':') comprime al máximo eliminando espacios.
            out.write(json.dumps(feat_min, separators=(",", ":")))
            primero = False

            contador[s] += 1
            total += 1

        out.write("]}")

    peso_bytes = output_path.stat().st_size
    return {
        "total": total,
        "saltados": saltados,
        "por_source": dict(contador),
        "peso_bytes": peso_bytes,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--input",
    "input_path",
    default=DEFAULT_INPUT,
    show_default=True,
    type=click.Path(dir_okay=False),
    help="GeoJSON merged de polígonos (output de 42_ms_buildings_merge.py).",
)
@click.option(
    "--output",
    "output_path",
    default=DEFAULT_OUTPUT,
    show_default=True,
    type=click.Path(dir_okay=False),
    help="Path del GeoJSON liviano de Points para servir al frontend.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Forzar re-generación aunque exista un output válido para el mismo input.",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    input_path: str,
    output_path: str,
    force: bool,
    log_level: str,
) -> None:
    """Genera buildings_centroids.geojson desde el merge de Google + Microsoft."""
    setup_logger(nivel=log_level.upper())

    in_p = resolve_path(input_path)
    out_p = resolve_path(output_path)
    marker = out_p.with_suffix(".md5")

    logger.info("=" * 60)
    logger.info(f"48_buildings_centroids v{SCRIPT_VERSION}")
    logger.info(f"Input:  {in_p}")
    logger.info(f"Output: {out_p}")
    logger.info("=" * 60)

    if not in_p.exists():
        logger.error(
            f"No existe el GeoJSON de input: {in_p}. "
            f"Corré primero scripts/42_ms_buildings_merge.py."
        )
        sys.exit(2)

    # --- Idempotencia por MD5 del input ------------------------------------
    logger.info("Calculando MD5 del input para detectar cambios...")
    in_md5 = hash_file(in_p)
    logger.info(f"MD5 input: {in_md5}")

    if cache_check(out_p) and marker.exists() and not force:
        prev_md5 = marker.read_text(encoding="utf-8").strip()
        if prev_md5 == in_md5:
            peso_mb = out_p.stat().st_size / (1024 * 1024)
            logger.info(
                f"Output ya existe y matchea MD5 del input ({peso_mb:.2f} MB). "
                f"Skip (usá --force para rehacer)."
            )
            sys.exit(0)
        logger.info(
            f"Output existente pero MD5 distinto (prev={prev_md5}). Regenerando."
        )

    # --- Conversión --------------------------------------------------------
    metrics = _convertir_a_centroides(in_p, out_p)

    # Marker MD5 para próxima corrida.
    marker.write_text(in_md5, encoding="utf-8")

    # --- Reporte final -----------------------------------------------------
    peso_mb = metrics["peso_bytes"] / (1024 * 1024)
    por_source = metrics["por_source"]
    g = por_source.get("g", 0)
    m = por_source.get("m", 0)
    b = por_source.get("b", 0)

    logger.info("=" * 60)
    logger.info("Conversión completada.")
    logger.info(f"Total puntos:       {metrics['total']:,}")
    logger.info(f"  google ('g'):     {g:,}")
    logger.info(f"  microsoft ('m'):  {m:,}")
    logger.info(f"  both ('b'):       {b:,}")
    if metrics["saltados"] > 0:
        logger.warning(f"Features salteadas: {metrics['saltados']:,}")
    logger.info(f"Peso archivo:       {peso_mb:.2f} MB ({metrics['peso_bytes']:,} bytes)")
    logger.info(f"Output:             {out_p}")
    logger.info(f"Marker MD5:         {marker}")
    logger.info("=" * 60)

    sys.exit(0)


if __name__ == "__main__":
    main()
