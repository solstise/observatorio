"""Calidad de aire multi-gas Sentinel-5P TROPOMI por polígono y año.

Extiende la cobertura ambiental existente (script 47, NO2 únicamente) a
cinco gases adicionales medidos por TROPOMI en Sentinel-5 Precursor:

1) **SO2** (`COPERNICUS/S5P/OFFL/L3_SO2`) — dióxido de azufre. Trazador de
   emisiones industriales y eventualmente volcánicas. En Posadas la señal
   suele ser muy débil (no hay industria pesada local).

2) **CO** (`COPERNICUS/S5P/OFFL/L3_CO`) — monóxido de carbono. Trazador
   de combustión incompleta: tránsito vehicular, generadores, fogatas y
   especialmente quemas agrícolas + incendios forestales upwind.

3) **HCHO** (`COPERNICUS/S5P/OFFL/L3_HCHO`) — formaldehído. Mezcla de
   emisiones biogénicas (selva paranaense) + combustión y producción
   secundaria por VOCs antropogénicos.

4) **CH4** (`COPERNICUS/S5P/OFFL/L3_CH4`) — metano. Útil para fugas de gas
   natural, rellenos sanitarios y ganadería. **Resolución pobre: ~7 km
   por píxel** — para Posadas un solo píxel cubre varios barrios, así que
   marcamos `ch4_calidad="baja"` en todas las filas.

5) **O3** (`COPERNICUS/S5P/OFFL/L3_O3`) — ozono total atmosférico. TROPOMI
   reporta **columna total** (estratosférica + troposférica), por lo que
   no es un buen indicador de calidad de aire urbano (la troposférica
   contribuye <10% del total). Se incluye con `o3_calidad="baja"` para
   completitud, pero no se debe usar para health urbano.

El NO2 troposférico ya lo cubre el script 47 (`no2_anual.csv`); este
script lo recomputa y lo emite junto con los demás para que la fila por
(polígono, año) sea autocontenida.

Output: ``data/processed/ambiental/aire_multigas_anual.csv`` con columnas:

    poligono_id, anio,
    no2_mol_m2, no2_relativo_bbox, n_imagenes_no2,
    so2_mol_m2, n_imagenes_so2,
    co_mol_m2, n_imagenes_co,
    hcho_mol_m2, n_imagenes_hcho,
    ch4_ppb, n_imagenes_ch4, ch4_calidad,
    o3_du, n_imagenes_o3, o3_calidad

Uso::

    python scripts/48_aire_multigas.py
    python scripts/48_aire_multigas.py --anio-desde 2020 --anio-hasta 2025
    python scripts/48_aire_multigas.py --force

Idempotencia: el CSV está keyed por (poligono_id, anio). Si la fila ya
existe se respeta salvo que se pase --force. Frescura natural: anual.

Si el script falla por permisos / cuota / asset cambiado en una banda
particular, se loguea WARNING y se sigue con los demás. La fila se
escribe con el gas faltante en blanco, no se aborta el polígono entero.

Cita: ESA Copernicus Sentinel-5P TROPOMI; Veefkind et al. 2012,
*TROPOMI on the ESA Sentinel-5 Precursor: A GMES mission for global
observations of the atmospheric composition for climate, air quality
and ozone layer applications*, Remote Sensing of Environment 120,
70-83.
"""

from __future__ import annotations

import csv
import sys

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------
import sys as _sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from pathlib import Path as _Path
from typing import Any, Dict, List, Optional, Set, Tuple

import click
from loguru import logger
from tqdm import tqdm

_p = _Path(__file__).resolve().parent
while _p != _p.parent:
    if (_p / "pyproject.toml").exists():
        if str(_p) not in _sys.path:
            _sys.path.insert(0, str(_p))
        break
    _p = _p.parent
# --- fin del parche ---------------------------------------------------------

from scripts.utils.config import Settings, load_settings
from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.io_geo import load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

# ---------------------------------------------------------------------------
# Definición de gases TROPOMI
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GasS5P:
    """Configuración de un gas Sentinel-5P TROPOMI."""

    nombre: str  # clave corta para el CSV (ej. "no2", "so2", "ch4").
    asset: str
    band: str
    scale_m: int
    csv_value_col: str  # nombre de la columna numérica en el CSV.
    csv_count_col: str
    # Si la calidad espacial/temática es baja se marca con una bandera
    # constante en la columna `csv_calidad_col` (ej. "baja" para CH4 y O3).
    csv_calidad_col: Optional[str] = None
    calidad_fija: Optional[str] = None
    # Conversión opcional aplicada al valor crudo de TROPOMI antes de
    # almacenar (ej. CH4 mixing ratio en ppb ya viene en esa unidad).
    descripcion: str = ""


# Resoluciones nominales del producto OFFL L3 (degradadas vs L2 nativo).
# Fuentes: GEE Catalog y Veefkind et al. 2012.
GASES: List[GasS5P] = [
    GasS5P(
        nombre="no2",
        asset="COPERNICUS/S5P/OFFL/L3_NO2",
        band="tropospheric_NO2_column_number_density",
        scale_m=1113,
        csv_value_col="no2_mol_m2",
        csv_count_col="n_imagenes_no2",
        descripcion="NO2 troposférico (mol/m²) — tráfico, combustión.",
    ),
    GasS5P(
        nombre="so2",
        asset="COPERNICUS/S5P/OFFL/L3_SO2",
        # Capa de ~1 km de altura (PBL); más representativa de fuentes
        # cercanas a superficie que la columna total atmosférica.
        band="SO2_column_number_density",
        scale_m=1113,
        csv_value_col="so2_mol_m2",
        csv_count_col="n_imagenes_so2",
        descripcion="SO2 columna troposférica (mol/m²) — industria, volcánico.",
    ),
    GasS5P(
        nombre="co",
        asset="COPERNICUS/S5P/OFFL/L3_CO",
        band="CO_column_number_density",
        scale_m=1113,
        csv_value_col="co_mol_m2",
        csv_count_col="n_imagenes_co",
        descripcion="CO columna total (mol/m²) — combustión incompleta + quemas.",
    ),
    GasS5P(
        nombre="hcho",
        asset="COPERNICUS/S5P/OFFL/L3_HCHO",
        band="tropospheric_HCHO_column_number_density",
        scale_m=1113,
        csv_value_col="hcho_mol_m2",
        csv_count_col="n_imagenes_hcho",
        descripcion="HCHO troposférico (mol/m²) — biogénico + quemas.",
    ),
    GasS5P(
        nombre="ch4",
        asset="COPERNICUS/S5P/OFFL/L3_CH4",
        # Mixing ratio columna, partes por mil millones en volumen.
        band="CH4_column_volume_mixing_ratio_dry_air",
        scale_m=1113,  # nominal del producto; resolución espacial real ~7 km.
        csv_value_col="ch4_ppb",
        csv_count_col="n_imagenes_ch4",
        csv_calidad_col="ch4_calidad",
        # Resolución nativa CH4 ~7×7 km — un solo píxel cubre varios barrios.
        # No diferencia espacialmente a escala intra-urbana.
        calidad_fija="baja",
        descripcion=(
            "CH4 mixing ratio (ppb) — agropecuario, fugas. Resolución ~7 km, "
            "no diferencia barrios chicos de Posadas (calidad espacial baja)."
        ),
    ),
    GasS5P(
        nombre="o3",
        asset="COPERNICUS/S5P/OFFL/L3_O3",
        # Columna total atmosférica en Dobson Units (1 DU = 2.69e16 mol/cm²).
        band="O3_column_number_density",
        scale_m=1113,
        csv_value_col="o3_du",
        csv_count_col="n_imagenes_o3",
        csv_calidad_col="o3_calidad",
        # TROPOMI O3 reporta columna **total**, dominada por la
        # estratosférica. La fracción troposférica (la que importa para
        # health urbana) es <10% y no se separa fácilmente. Marcamos baja.
        calidad_fija="baja",
        descripcion=(
            "O3 columna total (DU) — ESA reporta total atmosférico, "
            "dominado por estratosférico. NO es buen indicador de calidad "
            "urbana (calidad temática baja)."
        ),
    ),
]


# Conversión auxiliar: TROPOMI O3 viene en mol/m². 1 DU = 4.4615e-4 mol/m².
# Multiplicar mol/m² × (1 / 4.4615e-4) = DU.
MOL_M2_TO_DU = 1.0 / 4.4615e-4

# Conversión CH4 mixing ratio: la banda viene ya en ppb (parts per billion);
# no hace falta escalar.

ANIO_DESDE_DEFAULT = 2019  # S5P empieza jun-2018; arrancamos en 2019.
ANIO_HASTA_DEFAULT = 2025


# ---------------------------------------------------------------------------
# Earth Engine init
# ---------------------------------------------------------------------------


def inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine. Aborta el script si falla."""
    try:
        import ee
    except ImportError as exc:
        logger.error("earthengine-api no instalado. pip install earthengine-api")
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
        logger.error(f"ee.Initialize falló: {exc}")
        logger.error("Corré primero: python scripts/test_ee_auth.py --project PROJECT_ID")
        raise SystemExit(1) from exc


# ---------------------------------------------------------------------------
# Helpers comunes
# ---------------------------------------------------------------------------


def _ee_geometry_from_row(row) -> Any:
    """Convierte la geometría shapely de una fila a ee.Geometry (EPSG:4326)."""
    import ee

    return ee.Geometry(row.geometry.__geo_interface__)


def _bbox_ee_geometry(settings: Settings) -> Any:
    """Construye una ee.Geometry.Rectangle del bbox urbano de Posadas."""
    import ee

    b = settings.geografia.bbox
    return ee.Geometry.Rectangle([b.oeste, b.sur, b.este, b.norte])


def _media_anual_gas(
    gas: GasS5P,
    geom: Any,
    inicio: str,
    fin: str,
) -> Tuple[Optional[float], int]:
    """Media anual de un gas Sentinel-5P sobre un polígono.

    Args:
        gas: Configuración del gas (asset, banda, escala).
        geom: ee.Geometry del polígono.
        inicio: Fecha inicio (YYYY-MM-DD) inclusiva.
        fin: Fecha fin (YYYY-MM-DD) exclusiva.

    Returns:
        Tupla (media, n_imagenes). media es None si no hay datos válidos.
    """
    import ee

    try:
        col = ee.ImageCollection(gas.asset).filterDate(inicio, fin).select(gas.band)
        n = int(col.size().getInfo() or 0)
        if n == 0:
            return None, 0
        img = col.mean()
        stats = img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=geom,
            scale=gas.scale_m,
            maxPixels=1e10,
            bestEffort=True,
        ).getInfo()
        if not stats:
            return None, n
        val = stats.get(gas.band)
        return (float(val) if val is not None else None), n
    except Exception as exc:  # noqa: BLE001
        # Si el asset no existe / cuota / banda renombrada → degradar.
        logger.debug(f"{gas.nombre} {inicio}→{fin} falló: {exc}")
        return None, 0


def _aplicar_conversion_unidad(gas: GasS5P, valor: float) -> float:
    """Aplica conversión de unidades específica de cada gas si corresponde.

    - O3: mol/m² → Dobson Units (DU).
    - CH4: viene en ppb, no se convierte.
    - Los demás permanecen en mol/m².
    """
    if gas.nombre == "o3":
        return valor * MOL_M2_TO_DU
    return valor


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------


def _columnas_csv() -> List[str]:
    """Header completo del CSV multigas (mismo orden siempre)."""
    cols: List[str] = ["poligono_id", "anio"]
    # NO2 incluye relativo al bbox.
    cols.extend(["no2_mol_m2", "no2_relativo_bbox", "n_imagenes_no2"])
    for gas in GASES:
        if gas.nombre == "no2":
            continue
        cols.append(gas.csv_value_col)
        cols.append(gas.csv_count_col)
        if gas.csv_calidad_col:
            cols.append(gas.csv_calidad_col)
    return cols


def _leer_csv_existente(destino: Path, columnas: List[str]) -> List[Dict[str, Any]]:
    """Lee un CSV existente. Si el header no matchea, devuelve []."""
    if not destino.exists() or destino.stat().st_size == 0:
        return []
    try:
        with destino.open("r", encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            header = reader.fieldnames or []
            # Aceptamos header subset estricto (debe contener TODAS las cols
            # esperadas). Si sumamos un gas nuevo, regeneramos.
            if not set(columnas).issubset(set(header)):
                logger.warning(
                    f"Header de {destino.name} no contiene todas las columnas. "
                    f"Regenerando desde cero."
                )
                return []
            return [dict(r) for r in reader]
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"No se pudo leer {destino.name}: {exc}. Regenerando.")
        return []


def _claves_poligono_anio(filas: List[Dict[str, Any]]) -> Set[Tuple[str, int]]:
    """Set de (poligono_id, anio) ya calculadas en filas previas."""
    claves: Set[Tuple[str, int]] = set()
    for r in filas:
        try:
            claves.add((str(r["poligono_id"]), int(r["anio"])))
        except (KeyError, ValueError, TypeError):
            continue
    return claves


def _write_csv(rows: List[Dict[str, Any]], destino: Path, columnas: List[str]) -> None:
    """Escribe el CSV final con header fijo. Crea el directorio si no existe."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=columnas, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    logger.info(f"CSV escrito → {destino} ({len(rows)} filas)")


# ---------------------------------------------------------------------------
# Procesamiento principal
# ---------------------------------------------------------------------------


def procesar_aire_multigas(
    gdf,
    bbox_geom: Any,
    anio_desde: int,
    anio_hasta: int,
    destino_csv: Path,
    *,
    force: bool,
) -> Tuple[bool, str]:
    """Procesa los 6 gases TROPOMI por polígono y año.

    Para cada (polígono, año):
      1. NO2 se calcula con relativo al bbox de Posadas (igual que script 47).
      2. SO2, CO, HCHO, CH4, O3 se calculan como media anual sin relativo
         (los relativos no agregan info útil para gases con baja resolución
         o relevancia urbana, y aumentan latencia EE).
      3. CH4 y O3 se etiquetan con `*_calidad="baja"` por las razones
         documentadas en el header del módulo.

    Si un gas falla puntualmente (banda renombrada, cuota, etc.) la fila
    se escribe con esa columna vacía pero las demás presentes — no se
    aborta el polígono completo.

    Args:
        gdf: GeoDataFrame con polígonos.
        bbox_geom: ee.Geometry del bbox urbano (cache para NO2 relativo).
        anio_desde: Primer año (≥2019 recomendado).
        anio_hasta: Último año (inclusive).
        destino_csv: Path del CSV a escribir.
        force: Si True, recomputa filas previas.

    Returns:
        Tupla (ok, mensaje resumen).
    """
    logger.info("=" * 60)
    logger.info(
        f"Aire multi-gas TROPOMI {anio_desde}-{anio_hasta} "
        f"({len(GASES)} gases × {len(gdf)} polígonos)"
    )
    logger.info("=" * 60)
    for gas in GASES:
        logger.info(f"  - {gas.nombre.upper():4s} {gas.descripcion}")

    columnas = _columnas_csv()
    previas = [] if force else _leer_csv_existente(destino_csv, columnas)
    ya_hechas = _claves_poligono_anio(previas)
    if previas:
        logger.info(
            f"Aire multi-gas — {len(previas)} filas ya existen, se respetan " f"salvo --force."
        )

    # Cache del NO2 del bbox por año (una sola consulta por año vs N
    # polígonos). Ahorra ~35 llamadas EE por año.
    no2_bbox_por_anio: Dict[int, Optional[float]] = {}

    filas: List[Dict[str, Any]] = list(previas)
    total_iter = len(gdf) * (anio_hasta - anio_desde + 1)
    pbar = tqdm(total=total_iter, desc="Aire", unit="pol-año")
    agregadas = 0

    for _, row in gdf.iterrows():
        poligono_id = str(row["id"])
        try:
            geom = _ee_geometry_from_row(row)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[{poligono_id}] geometría inválida: {exc}")
            pbar.update(anio_hasta - anio_desde + 1)
            continue

        for anio in range(anio_desde, anio_hasta + 1):
            if (poligono_id, anio) in ya_hechas:
                pbar.update(1)
                continue

            inicio = f"{anio}-01-01"
            fin = f"{anio + 1}-01-01"

            # Inicializamos la fila con las claves obligatorias y vacíos.
            fila: Dict[str, Any] = {"poligono_id": poligono_id, "anio": anio}

            # NO2 — caché del bbox para relativo.
            if anio not in no2_bbox_por_anio:
                no2_gas = next(g for g in GASES if g.nombre == "no2")
                bbox_val, _bbox_n = _media_anual_gas(no2_gas, bbox_geom, inicio, fin)
                no2_bbox_por_anio[anio] = bbox_val
                if bbox_val is not None:
                    logger.debug(f"NO2 bbox {anio} = {bbox_val:.4e} mol/m²")

            algun_gas_ok = False
            for gas in GASES:
                val, n_img = _media_anual_gas(gas, geom, inicio, fin)
                if val is not None:
                    val = _aplicar_conversion_unidad(gas, val)
                    algun_gas_ok = True

                # Formato científico breve para mol/m², 4 decimales para
                # CH4 ppb, 2 decimales para O3 DU.
                if val is None:
                    fila[gas.csv_value_col] = ""
                elif gas.nombre == "ch4":
                    fila[gas.csv_value_col] = round(val, 4)
                elif gas.nombre == "o3":
                    fila[gas.csv_value_col] = round(val, 2)
                else:
                    fila[gas.csv_value_col] = f"{val:.6e}"

                fila[gas.csv_count_col] = n_img

                if gas.csv_calidad_col:
                    # Cuando el gas tiene una bandera fija (CH4/O3 → baja).
                    fila[gas.csv_calidad_col] = gas.calidad_fija or "alta"

                # NO2 — además calculamos relativo al bbox.
                if gas.nombre == "no2":
                    bbox_val = no2_bbox_por_anio.get(anio)
                    if val is not None and bbox_val and bbox_val != 0:
                        fila["no2_relativo_bbox"] = round(val / bbox_val, 4)
                    else:
                        fila["no2_relativo_bbox"] = ""

            if not algun_gas_ok:
                # No hubo NINGÚN gas con datos. Saltamos la fila para no
                # contaminar el CSV con basura.
                logger.debug(f"[{poligono_id}|{anio}] sin datos para ningún gas.")
                pbar.update(1)
                continue

            filas.append(fila)
            agregadas += 1
            logger.debug(
                f"[{poligono_id}|{anio}] OK — "
                f"no2={fila.get('no2_mol_m2', '')} "
                f"so2={fila.get('so2_mol_m2', '')} "
                f"co={fila.get('co_mol_m2', '')}"
            )
            pbar.update(1)

    pbar.close()

    if not filas:
        return False, "Aire multi-gas no produjo ninguna fila."

    _write_csv(filas, destino_csv, columnas=columnas)
    return (
        True,
        f"Aire multi-gas OK — {len(filas)} filas ({agregadas} nuevas) en " f"{destino_csv.name}",
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--poligonos",
    "poligonos_path",
    default="config/poligonos.geojson",
    show_default=True,
    help="Path al GeoJSON de polígonos.",
)
@click.option(
    "--output-dir",
    "output_dir",
    default="data/processed/ambiental",
    show_default=True,
    help="Directorio raíz de salida.",
)
@click.option(
    "--project",
    "ee_project",
    default=None,
    help="Project ID Earth Engine. Default: EE_PROJECT_ID del .env.",
)
@click.option(
    "--anio-desde",
    default=ANIO_DESDE_DEFAULT,
    show_default=True,
    type=int,
    help="Primer año (S5P empieza jun-2018; default 2019 para años completos).",
)
@click.option(
    "--anio-hasta",
    default=ANIO_HASTA_DEFAULT,
    show_default=True,
    type=int,
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Recomputar filas existentes en el CSV.",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
)
def cli(
    poligonos_path: str,
    output_dir: str,
    ee_project: Optional[str],
    anio_desde: int,
    anio_hasta: int,
    force: bool,
    nivel_log: str,
) -> None:
    """Calidad de aire multi-gas Sentinel-5P por polígono y año."""
    setup_logger(nivel=nivel_log.upper())
    settings = load_settings()
    project = ee_project or settings.env.ee_project_id

    logger.info("=" * 60)
    logger.info(f"Aire multi-gas TROPOMI v{SCRIPT_VERSION}")
    logger.info("=" * 60)
    logger.info(f"Polígonos:  {poligonos_path}")
    logger.info(f"Output dir: {output_dir}")
    logger.info(f"EE project: {project or '(default ADC)'}")
    logger.info(f"Años:       {anio_desde}-{anio_hasta}")
    logger.info(f"Force:      {force}")

    inicializar_ee(project)
    gdf = load_geojson(poligonos_path)
    if "id" not in gdf.columns:
        logger.error("El GeoJSON no tiene columna 'id'. Abortando.")
        sys.exit(2)
    logger.info(f"Cargados {len(gdf)} polígonos.")

    out = ensure_dir(resolve_path(output_dir))
    destino = out / "aire_multigas_anual.csv"
    bbox_geom = _bbox_ee_geometry(settings)

    with graceful_interrupt() as state:
        state.on_interrupt(
            lambda: logger.warning("Interrupción — el CSV puede quedar parcial en disco.")
        )
        try:
            ok, msg = procesar_aire_multigas(
                gdf, bbox_geom, anio_desde, anio_hasta, destino, force=force
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Aire multi-gas excepción: {exc}")
            logger.debug(traceback.format_exc())
            ok, msg = False, f"Aire multi-gas falló: {exc}"

    logger.info(msg)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    cli()
