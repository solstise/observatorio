"""Estimación de población por polígono y fecha (Fase 1 básica).

Combina el conteo de edificios por polígono (``serie_temporal.csv``) con la
grilla de WorldPop 2020 para estimar población histórica y proyectada con
bandas de confianza explícitas.

Método (para cada polígono y fecha):

1. Calcular baseline poblacional 2020 = suma zonal del raster WorldPop dentro
   del polígono.
2. Si el polígono tiene edificios detectados en 2020, escalar:
   ``pob_t = pob_base * (n_edif_t / n_edif_2020)``.
   Marcar ``metodo = "worldpop_escalado"``.
3. Si no hay WorldPop válido para el polígono, o n_edif_2020 == 0, caer al
   estimador directo ``pob = n_edif * personas_por_vivienda``.
   Marcar ``metodo = "directo"``.
4. Reportar banda ±20% (más ancha que la banda de conteo edilicio, porque a
   la incertidumbre del conteo sumamos la incertidumbre de personas/vivienda).

Supuestos explícitos que se loguean al correr:

- personas/vivienda = 3.6 (INDEC Misiones, dato promedio provincial;
  parametrizable con ``--personas-por-vivienda``).
- Base poblacional = WorldPop 2020 (último año global publicado).
- WorldPop subestima zonas de cambio rápido, por eso escalamos por
  crecimiento de edificios respecto del baseline 2020 cuando hay datos.

Salida:

- ``data/processed/poblacion_estimada.csv`` con columnas:
  ``poligono_id, fecha, poblacion_min, poblacion_estimada, poblacion_max, metodo``.

Ejemplo::

    python scripts/30_estimar_poblacion.py \\
        --serie-temporal data/processed/conteos/serie_temporal.csv \\
        --worldpop data/raw/worldpop/arg_ppp_2020.tif \\
        --poligonos config/poligonos.geojson \\
        --output data/processed/poblacion_estimada.csv \\
        --personas-por-vivienda 3.6
"""

from __future__ import annotations

import logging
import math
import signal
import sys
import time
from pathlib import Path

import click
import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.mask import mask as rio_mask
from shapely.geometry import mapping

try:
    from scripts.utils.logger import get_logger  # type: ignore
except Exception:
    try:
        from scripts.utils.logger import setup_logger as _setup

        def get_logger(name: str) -> logging.Logger:
            return _setup(name) if callable(_setup) else logging.getLogger(name)
    except Exception:
        def get_logger(name: str) -> logging.Logger:
            logging.basicConfig(
                level=logging.INFO,
                format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
            )
            return logging.getLogger(name)

try:
    from scripts.utils.config import load_settings  # type: ignore
except Exception:
    def load_settings():  # type: ignore
        return None


logger = get_logger(__name__)

BANDA_ERROR_POBLACION = 0.20  # ±20%
FECHA_BASELINE_WORLDPOP = "2020-07"


def _suma_zonal_worldpop(
    raster_path: Path, poligono_geom
) -> tuple[float, bool]:
    """Devuelve (población_baseline, valido_worldpop) para un polígono.

    Usa ``rasterio.mask.mask`` con ``crop=True`` y suma los píxeles válidos.
    Si falla (polígono fuera del raster, nodata dominante), retorna
    ``(0.0, False)``.
    """
    try:
        with rasterio.open(raster_path) as ds:
            # Reproyectar polígono si hace falta.
            out_image, _ = rio_mask(
                ds, [mapping(poligono_geom)], crop=True, filled=True, nodata=0
            )
            if out_image.size == 0:
                return 0.0, False
            arr = out_image[0].astype(np.float64)
            nodata = ds.nodata
            if nodata is not None:
                arr = np.where(np.isclose(arr, nodata), 0.0, arr)
            arr = np.where(arr < 0, 0.0, arr)  # WorldPop -99999 residuales
            suma = float(np.nansum(arr))
            # Si todos los píxeles son 0 -> no hay WorldPop útil para este polígono.
            valido = suma > 0.0
            return suma, valido
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Fallo zonal WorldPop: {exc}")
        return 0.0, False


def _cargar_poligonos(path: Path) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        gdf = gdf.set_crs(epsg=4326)
    else:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def _buscar_n_edif_2020(serie: pd.DataFrame, poligono_id: str) -> int | None:
    """Devuelve el conteo más cercano a 2020-07 para el polígono.

    Si no hay dato ese mes exacto, busca el más próximo en el año 2020.
    """
    sub = serie[serie["poligono_id"] == poligono_id].copy()
    if sub.empty:
        return None
    # Exacto 2020-07 primero
    exacto = sub[sub["fecha"] == FECHA_BASELINE_WORLDPOP]
    if not exacto.empty:
        return int(exacto.iloc[0]["n_edificios_estimado"])
    # Cualquier 2020-xx
    sub["anio"] = sub["fecha"].str[:4]
    sub_2020 = sub[sub["anio"] == "2020"]
    if not sub_2020.empty:
        return int(sub_2020.iloc[0]["n_edificios_estimado"])
    return None


@click.command(help="Estima población histórica por polígono y fecha.")
@click.option(
    "--serie-temporal",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=Path("data/processed/conteos/serie_temporal.csv"),
    show_default=True,
)
@click.option(
    "--worldpop",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("data/raw/worldpop/arg_ppp_2020.tif"),
    show_default=True,
)
@click.option(
    "--poligonos",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=Path("config/poligonos.geojson"),
    show_default=True,
)
@click.option(
    "--output",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("data/processed/poblacion_estimada.csv"),
    show_default=True,
)
@click.option(
    "--personas-por-vivienda",
    type=float,
    default=3.6,
    show_default=True,
    help="Default 3.6 (promedio INDEC Misiones).",
)
def cli(
    serie_temporal: Path,
    worldpop: Path,
    poligonos: Path,
    output: Path,
    personas_por_vivienda: float,
) -> None:
    """Entry point CLI."""
    t0 = time.time()
    logger.info("=" * 60)
    logger.info("Observatorio Posadas — Estimación de población (Fase 1)")
    logger.info("=" * 60)
    logger.info("Supuestos explícitos:")
    logger.info(f"  personas/vivienda  = {personas_por_vivienda:.2f} (INDEC Misiones)")
    logger.info(f"  base poblacional   = WorldPop 2020 ({worldpop})")
    logger.info(f"  banda de error pob = ±{BANDA_ERROR_POBLACION * 100:.0f}%")
    logger.info(
        "Nota: WorldPop subestima zonas de cambio rápido. "
        "Escalamos por crecimiento edilicio respecto del baseline 2020."
    )

    output.parent.mkdir(parents=True, exist_ok=True)

    def _handler(signum, frame):  # noqa: ANN001
        logger.warning(f"Interrupción ({signum}) — salida limpia.")
        sys.exit(130)

    signal.signal(signal.SIGINT, _handler)

    serie_df = pd.read_csv(serie_temporal)
    if serie_df.empty:
        logger.error("serie_temporal.csv está vacío — aborto.")
        sys.exit(1)

    pols_gdf = _cargar_poligonos(poligonos)
    pols_gdf = pols_gdf.rename(columns={"id": "poligono_id"})
    pols_gdf["poligono_id"] = pols_gdf["poligono_id"].astype(str)

    worldpop_ok = worldpop.exists()
    if not worldpop_ok:
        logger.warning(
            "No se encontró %s — todos los polígonos usarán método 'directo'.",
            worldpop,
        )

    # Pre-calculamos baselines WorldPop por polígono (una sola vez).
    baseline_por_pol: dict[str, tuple[float, bool]] = {}
    for _, fila in pols_gdf.iterrows():
        pol_id = str(fila["poligono_id"])
        if not worldpop_ok:
            baseline_por_pol[pol_id] = (0.0, False)
            continue
        pob, valido = _suma_zonal_worldpop(worldpop, fila.geometry)
        baseline_por_pol[pol_id] = (pob, valido)
        logger.info(
            "Baseline WorldPop 2020 '%s': %s personas (válido=%s)",
            pol_id,
            f"{pob:,.0f}" if valido else "n/a",
            valido,
        )

    # Iteramos serie y generamos filas de salida.
    filas: list[dict] = []
    for pol_id in serie_df["poligono_id"].unique():
        sub = serie_df[serie_df["poligono_id"] == pol_id].sort_values("fecha")
        pob_base, wp_valido = baseline_por_pol.get(str(pol_id), (0.0, False))
        n_edif_2020 = _buscar_n_edif_2020(serie_df, str(pol_id))

        usa_worldpop = wp_valido and n_edif_2020 is not None and n_edif_2020 > 0
        if not usa_worldpop:
            logger.info(
                "Polígono '%s': método directo (WorldPop válido=%s, n_edif_2020=%s)",
                pol_id,
                wp_valido,
                n_edif_2020,
            )

        for _, fila in sub.iterrows():
            n_edif = int(fila["n_edificios_estimado"])
            if usa_worldpop:
                factor = n_edif / float(n_edif_2020) if n_edif_2020 else 0.0
                pob_est = pob_base * factor
                metodo = "worldpop_escalado"
            else:
                pob_est = n_edif * personas_por_vivienda
                metodo = "directo"

            pob_min = int(math.floor(pob_est * (1 - BANDA_ERROR_POBLACION)))
            pob_max = int(math.ceil(pob_est * (1 + BANDA_ERROR_POBLACION)))
            pob_central = int(round(pob_est))

            filas.append(
                {
                    "poligono_id": pol_id,
                    "fecha": fila["fecha"],
                    "poblacion_min": pob_min,
                    "poblacion_estimada": pob_central,
                    "poblacion_max": pob_max,
                    "metodo": metodo,
                }
            )

    if not filas:
        logger.error("No se generaron filas de población — aborto.")
        sys.exit(2)

    out_df = pd.DataFrame(filas)
    out_df.to_csv(output, index=False, encoding="utf-8")
    logger.info(f"Población estimada: {len(out_df)} filas -> {output}")

    resumen_metodo = out_df["metodo"].value_counts().to_dict()
    logger.info(f"Desglose por método: {resumen_metodo}")
    logger.info(f"Duración total: {time.time() - t0:.1f}s")
    logger.info("Fin estimación población Fase 1.")


if __name__ == "__main__":
    cli()
