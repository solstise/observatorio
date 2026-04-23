"""Descarga Google Open Buildings v3 para la bbox de Posadas.

Corresponde a la Tarea 1.5 del PROMPT_OBSERVATORIO_POSADAS.md.

Fuente: `GOOGLE/Research/open-buildings/v3/polygons` en Earth Engine.
Campos extraídos: building_id (auto), lat, lon, area_m2, confidence,
geometry (polígono original del techo detectado).

Formatos de salida:
    - `posadas_buildings.geojson` (principal, para geopandas/Leaflet).
    - `posadas_buildings.csv`     (sidecar, para Excel/pandas sin GIS).

Estrategia de descarga (en orden de intento):
    1. `FeatureCollection.getInfo()` — rápido para < ~5000 features.
    2. Export a GeoJSON vía `getDownloadURL` si cabe (<32MB).
    3. Fallback manual: instrucciones para descargar el CSV oficial
       desde https://sites.research.google/gr/open-buildings/ y filtrar
       por bbox — documentado como ruta alternativa.

Ejemplo de uso:
    python scripts/03_descarga_buildings.py
    python scripts/03_descarga_buildings.py --confidence-min 0.80 --force

Notas:
    - Open Buildings es un snapshot estático (mayo 2023). No dice cuándo
      apareció cada edificio. La inferencia temporal va en Tarea 1.6.
    - Para zonas donde Google tiene gaps, considerar entrenar modelo propio
      en Fase 2.
"""

from __future__ import annotations

import json
import shutil
import sys
import traceback
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

import click
from loguru import logger

from scripts.utils.config import Settings, load_settings
from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.io_geo import cache_check, hash_file
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, ensure_parent, resolve_path


SCRIPT_VERSION = "0.1.0"
EE_ASSET = "GOOGLE/Research/open-buildings/v3/polygons"

LINK_OPEN_BUILDINGS_CSV = "https://sites.research.google/gr/open-buildings/"


def inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine con mensajes humanos si falla.

    Args:
        project_id: Project ID de Google Cloud.
    """
    try:
        import ee
    except ImportError as exc:
        logger.error("earthengine-api no está instalado. `pip install earthengine-api`")
        raise SystemExit(1) from exc
    try:
        if project_id:
            ee.Initialize(project=project_id)
        else:
            ee.Initialize()
        logger.info(
            f"Earth Engine OK "
            f"{'(proyecto ' + project_id + ')' if project_id else '(default ADC)'}"
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló ee.Initialize(): {exc}")
        logger.error(
            "Corré primero `python scripts/test_ee_auth.py --project PROJECT_ID` "
            "y resolvé los errores de autenticación."
        )
        raise SystemExit(1) from exc


def _parsear_bbox(bbox_cli: Optional[str], settings: Settings) -> Tuple[float, float, float, float]:
    """Parsea bbox desde CLI o settings. Devuelve (oeste, sur, este, norte).

    Args:
        bbox_cli: "oeste,sur,este,norte" o None para usar settings.yaml.
        settings: Settings cargado.

    Returns:
        Tupla de floats (oeste, sur, este, norte).
    """
    if bbox_cli:
        partes = [float(x.strip()) for x in bbox_cli.split(",")]
        if len(partes) != 4:
            raise click.BadParameter("bbox debe tener 4 valores: oeste,sur,este,norte")
        return tuple(partes)  # type: ignore[return-value]
    return settings.geografia.bbox.as_tuple()


# ---------------------------------------------------------------------------
# Descarga vía Earth Engine
# ---------------------------------------------------------------------------


def _descargar_url(url: str, destino: Path) -> None:
    """Descarga un URL a un archivo destino en streaming."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=600) as resp, destino.open("wb") as fh:
        shutil.copyfileobj(resp, fh)


def _intentar_descarga_directa(
    fc, destino_geojson: Path, resumen_path: Path
) -> bool:
    """Intenta bajar la FeatureCollection vía `getDownloadURL` (GeoJSON).

    Args:
        fc: `ee.FeatureCollection` ya filtrada.
        destino_geojson: Path destino.
        resumen_path: Path donde persistimos un resumen parcial.

    Returns:
        True si la descarga tuvo éxito, False si falló (para caer a siguiente fallback).
    """
    try:
        # Formato "GEOJSON" para earthengine-api moderno. Probamos también variantes.
        try:
            url = fc.getDownloadURL(filetype="GEOJSON")
        except TypeError:
            # API vieja: usar positional o dict.
            url = fc.getDownloadURL("GEOJSON")
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"getDownloadURL falló: {exc}")
        return False

    logger.info(f"Descargando GeoJSON desde EE → {destino_geojson.name}")
    try:
        _descargar_url(url, destino_geojson)
        size_mb = destino_geojson.stat().st_size / (1024 * 1024)
        logger.info(f"GeoJSON descargado ({size_mb:.2f} MB)")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Fallo la descarga del URL de EE: {exc}")
        return False


def _fallback_export_drive(fc, descripcion: str) -> str:
    """Lanza un export a Google Drive y avisa al usuario cómo continuar.

    Args:
        fc: FeatureCollection a exportar.
        descripcion: Nombre del task para que el usuario lo identifique.

    Returns:
        ID del task de Earth Engine para que el usuario lo monitoree.
    """
    import ee

    task = ee.batch.Export.table.toDrive(
        collection=fc,
        description=descripcion,
        fileFormat="GeoJSON",
    )
    task.start()
    task_id = task.id
    logger.warning("=" * 60)
    logger.warning("FALLBACK: export a Google Drive iniciado (asíncrono).")
    logger.warning(f"Task ID: {task_id}")
    logger.warning(f"Monitoreá el progreso en: https://code.earthengine.google.com/tasks")
    logger.warning(
        "Cuando termine, el GeoJSON aparece en tu Google Drive. Bajalo manualmente "
        "y movelo a data/raw/google_buildings/posadas_buildings.geojson"
    )
    logger.warning("=" * 60)
    return task_id


def _imprimir_fallback_csv(bbox: Tuple[float, float, float, float]) -> None:
    """Imprime instrucciones para el fallback manual con el CSV oficial.

    Args:
        bbox: (oeste, sur, este, norte).
    """
    oeste, sur, este, norte = bbox
    logger.warning("=" * 60)
    logger.warning("FALLBACK MANUAL — Descarga directa del CSV de Google:")
    logger.warning(f"  1. Visitá {LINK_OPEN_BUILDINGS_CSV}")
    logger.warning("  2. Buscá el tile S2 que cubre Posadas (usar 'selector' del sitio).")
    logger.warning(
        f"  3. BBox de Posadas: oeste={oeste}, sur={sur}, este={este}, norte={norte}"
    )
    logger.warning("  4. Descargá el CSV (~200 MB para la región LATAM correspondiente).")
    logger.warning("  5. Filtrá con pandas: `df[(df.longitude >= -56) & ...]`")
    logger.warning(
        "  6. Guardalo como data/raw/google_buildings/posadas_buildings.geojson "
        "usando geopandas.GeoDataFrame.from_xy()."
    )
    logger.warning("=" * 60)


# ---------------------------------------------------------------------------
# Procesamiento post-descarga
# ---------------------------------------------------------------------------


def _post_procesar_geojson(
    geojson_path: Path,
    csv_path: Path,
    confidence_min: float,
) -> dict:
    """Carga el GeoJSON descargado, filtra por confidence y genera sidecar CSV.

    Args:
        geojson_path: GeoJSON crudo bajado de EE.
        csv_path: Path del CSV sidecar a generar.
        confidence_min: Umbral mínimo de confidence.

    Returns:
        Dict con resumen: total_crudo, total_filtrado, area_promedio_m2, etc.
    """
    import geopandas as gpd

    gdf = gpd.read_file(geojson_path)
    total_crudo = len(gdf)
    logger.info(f"GeoJSON crudo: {total_crudo} features")

    # Los campos de Open Buildings v3 en EE son: area_in_meters, confidence,
    # full_plus_code, longitude_latitude (point). El polígono viene como geometry.
    # Renombramos para matchear lo pedido en el prompt.
    rename = {}
    if "area_in_meters" in gdf.columns:
        rename["area_in_meters"] = "area_m2"
    if rename:
        gdf = gdf.rename(columns=rename)

    # Filtro por confidence.
    if "confidence" in gdf.columns:
        gdf_filtrado = gdf[gdf["confidence"] >= confidence_min].copy()
    else:
        logger.warning("No se encontró columna 'confidence'; se exporta sin filtro.")
        gdf_filtrado = gdf.copy()

    # Asignamos building_id estable basado en el índice + plus code si existe.
    if "full_plus_code" in gdf_filtrado.columns:
        gdf_filtrado["building_id"] = gdf_filtrado["full_plus_code"].astype(str)
    else:
        gdf_filtrado["building_id"] = [f"b_{i:08d}" for i in range(len(gdf_filtrado))]

    # Centroides (lat, lon) — en Open Buildings vienen como 'longitude_latitude' point.
    # Si no, los calculamos.
    if "longitude_latitude" in gdf_filtrado.columns:
        # Viene como POINT WKT o similar; lo parseamos.
        try:
            from shapely import wkt

            pts = gdf_filtrado["longitude_latitude"].apply(
                lambda s: wkt.loads(s) if isinstance(s, str) else s
            )
            gdf_filtrado["lon"] = pts.apply(lambda p: p.x if p else None)
            gdf_filtrado["lat"] = pts.apply(lambda p: p.y if p else None)
        except Exception:  # noqa: BLE001
            centroides = gdf_filtrado.geometry.centroid
            gdf_filtrado["lon"] = centroides.x
            gdf_filtrado["lat"] = centroides.y
    else:
        centroides = gdf_filtrado.geometry.centroid
        gdf_filtrado["lon"] = centroides.x
        gdf_filtrado["lat"] = centroides.y

    # Reordenamos columnas para consistencia.
    columnas_objetivo = ["building_id", "lat", "lon", "area_m2", "confidence", "geometry"]
    columnas_finales = [c for c in columnas_objetivo if c in gdf_filtrado.columns]
    gdf_filtrado = gdf_filtrado[columnas_finales]

    # Escritura final (sobrescribimos el crudo con el filtrado).
    gdf_filtrado.to_file(geojson_path, driver="GeoJSON")

    # CSV sidecar (sin geometría, centroides + metadatos).
    df_csv = gdf_filtrado.drop(columns=["geometry"]).copy()
    df_csv.to_csv(csv_path, index=False)

    area_media = None
    if "area_m2" in gdf_filtrado.columns and len(gdf_filtrado):
        area_media = float(gdf_filtrado["area_m2"].mean())

    return {
        "total_crudo": total_crudo,
        "total_filtrado": int(len(gdf_filtrado)),
        "confidence_min": confidence_min,
        "area_promedio_m2": area_media,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--bbox",
    "bbox_cli",
    default=None,
    help=(
        "BBox en grados: 'oeste,sur,este,norte'. "
        "Si se omite, se usa el bbox de settings.yaml."
    ),
)
@click.option(
    "--confidence-min",
    "confidence_min",
    default=None,
    type=float,
    help="Umbral mínimo de confidence (default: de settings.yaml).",
)
@click.option(
    "--output",
    "output_path",
    default="data/raw/google_buildings/posadas_buildings.geojson",
    show_default=True,
    help="Path del GeoJSON de salida.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Forzar re-descarga aunque ya exista en caché.",
)
@click.option(
    "--project",
    "ee_project",
    default=None,
    help="Project ID de Earth Engine (default: EE_PROJECT_ID del .env).",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    bbox_cli: Optional[str],
    confidence_min: Optional[float],
    output_path: str,
    force: bool,
    ee_project: Optional[str],
    nivel_log: str,
) -> None:
    """Descarga Google Open Buildings v3 para la bbox de Posadas (Tarea 1.5)."""
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()

    bbox = _parsear_bbox(bbox_cli, settings)
    conf = confidence_min if confidence_min is not None else settings.edificios.confidence_threshold
    output_geojson = ensure_parent(resolve_path(output_path))
    output_csv = output_geojson.with_suffix(".csv")
    ensure_dir(output_geojson.parent)

    ee_project_resolved = ee_project or settings.env.ee_project_id

    logger.info("=" * 60)
    logger.info("Descarga Google Open Buildings v3 — Observatorio Urbano Posadas")
    logger.info("=" * 60)
    logger.info(f"BBox (O,S,E,N):      {bbox}")
    logger.info(f"Confidence mínima:   {conf}")
    logger.info(f"Output GeoJSON:      {output_geojson}")
    logger.info(f"Output CSV sidecar:  {output_csv}")
    logger.info(f"EE project:          {ee_project_resolved or '(default ADC)'}")
    logger.info(f"Force re-descarga:   {force}")

    # Idempotencia.
    if cache_check(output_geojson) and cache_check(output_csv) and not force:
        logger.info("Ambos outputs ya existen. Skip (usá --force para re-descargar).")
        # Log de MD5 para trazabilidad aun en cache hit.
        md5 = hash_file(output_geojson)
        logger.info(f"MD5 GeoJSON existente: {md5}")
        sys.exit(0)

    # Guardados parciales si Ctrl+C.
    marcador_parcial = output_geojson.with_suffix(".parcial.marker")

    def _marcar_parcial() -> None:
        marcador_parcial.write_text(
            f"Interrupción: {datetime.now().isoformat()}", encoding="utf-8"
        )

    with graceful_interrupt() as state:
        state.on_interrupt(_marcar_parcial)

        inicializar_ee(ee_project_resolved)
        import ee

        oeste, sur, este, norte = bbox
        region = ee.Geometry.Rectangle([oeste, sur, este, norte])
        fc = ee.FeatureCollection(EE_ASSET).filterBounds(region)

        try:
            n_estimado = fc.size().getInfo()
            logger.info(f"Features en bbox antes de filtrar confidence: {n_estimado}")
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"No pude contar features previo a descarga: {exc}")

        # Filtramos por confidence en el server-side para bajar menos.
        fc_filtrado = fc.filter(ee.Filter.gte("confidence", conf))

        # Paso 1: intentar descarga directa vía getDownloadURL.
        ok = _intentar_descarga_directa(
            fc_filtrado, output_geojson, output_geojson.with_suffix(".resumen.json")
        )

        if not ok:
            # Paso 2: fallback export a Drive.
            try:
                descripcion = f"posadas_open_buildings_v3_{datetime.now():%Y%m%d_%H%M}"
                task_id = _fallback_export_drive(fc_filtrado, descripcion)
                logger.info(f"Export lanzado a Drive. Task ID: {task_id}")
                logger.info(
                    "Este script termina acá. Cuando el task complete, bajá el GeoJSON "
                    "de tu Drive y copiálo al path configurado, luego re-corré para "
                    "que genere el CSV sidecar."
                )
                marcador_parcial.unlink(missing_ok=True)
                sys.exit(0)
            except Exception as exc:  # noqa: BLE001
                logger.error(f"Falló también el export a Drive: {exc}")
                logger.debug(traceback.format_exc())
                _imprimir_fallback_csv(bbox)
                marcador_parcial.unlink(missing_ok=True)
                sys.exit(3)

        # Paso 3: post-procesar (filtrar, CSV sidecar, MD5).
        try:
            resumen = _post_procesar_geojson(output_geojson, output_csv, conf)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Falló post-procesamiento: {exc}")
            logger.debug(traceback.format_exc())
            sys.exit(4)

        # MD5 final para trazabilidad.
        md5_geojson = hash_file(output_geojson)
        md5_csv = hash_file(output_csv)

        # Resumen / metadata JSON.
        meta = {
            "fuente": EE_ASSET,
            "bbox": list(bbox),
            "confidence_min": conf,
            "timestamp": datetime.now().isoformat(),
            "version_script": SCRIPT_VERSION,
            "md5_geojson": md5_geojson,
            "md5_csv": md5_csv,
            **resumen,
        }
        meta_path = output_geojson.with_suffix(".resumen.json")
        with meta_path.open("w", encoding="utf-8") as fh:
            json.dump(meta, fh, ensure_ascii=False, indent=2)

        # Borramos marcador parcial si quedó.
        marcador_parcial.unlink(missing_ok=True)

        logger.info("=" * 60)
        logger.info("Descarga completada.")
        logger.info(f"Total edificios (pre-filtro):   {resumen['total_crudo']}")
        logger.info(f"Total edificios (post-filtro):  {resumen['total_filtrado']}")
        logger.info(f"Confidence mínima aplicada:     {resumen['confidence_min']}")
        if resumen.get("area_promedio_m2") is not None:
            logger.info(f"Área promedio (m²):             {resumen['area_promedio_m2']:.1f}")
        logger.info(f"MD5 GeoJSON: {md5_geojson}")
        logger.info(f"MD5 CSV:     {md5_csv}")
        logger.info(f"Metadata:    {meta_path}")
        logger.info("=" * 60)

    sys.exit(0)


if __name__ == "__main__":
    main()
