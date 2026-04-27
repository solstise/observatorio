"""Capa de calor urbano — pipeline completo.

Descarga Landsat 8/9 Collection 2 Level 2 (banda térmica ST_B10), calcula
temperatura de superficie (LST) mensual por polígono, y deriva intensidad
de isla de calor urbana (UHI) con tres definiciones.

Tres subcomandos click + flag ``todo``:

* ``descargar-landsat``: composites mensuales vía Earth Engine (L8+L9 merged).
* ``stats-por-poligono``: estadísticas LST por polígono (urbanos + rurales).
  Acepta ``--fuente {landsat|cbers|merged}`` (default ``merged``) para
  combinar Landsat con CBERS-4 IRS térmico cuando Landsat tuvo gaps.
* ``calcular-uhi``: tres métricas UHI (vs rural, vs ciudad, anomalía
  estacional) + agregación estacional DJF/MAM/JJA/SON.

Honestidad metodológica (crítico leer):

* **LST ≠ temperatura del aire**. Landsat mide temperatura de superficie
  (techos, asfalto, pasto) a ~10:30 AM hora solar local. A esa hora en
  verano, el asfalto puede estar a 50°C mientras el aire a 1.5 m del
  suelo está a 32°C. Diferencia típica +5 a +20°C según superficie.
* UHI diurna (lo que medimos acá) es real pero menos intensa que UHI
  nocturna. Para complemento diario/nocturno, `scripts/47_ambiental.py
  lst` usa MODIS LST (1 km) día + noche.
* Cobertura nubosa subtropical en Posadas ~50% anual. Meses con <2
  escenas válidas se marcan NaN (no interpolamos).
* Rangos esperados: LST urbana Posadas 25-45°C verano, 15-25°C invierno.
  Valores fuera → probable bug (filtro ``rangos_validacion`` en log).
* UHI negativa en invierno es plausible (sombras de edificios).

Ejemplo de uso::

    # Descargar composites 2018-01 a 2026-04 (todos los meses)
    python scripts/49_calor_pipeline.py descargar-landsat

    # Solo algunos meses para smoke test
    python scripts/49_calor_pipeline.py descargar-landsat --meses 2024-01,2024-07

    # Stats por polígono (urbanos + rurales)
    python scripts/49_calor_pipeline.py stats-por-poligono

    # UHI + agregación estacional
    python scripts/49_calor_pipeline.py calcular-uhi

    # Todo de una
    python scripts/49_calor_pipeline.py todo

Outputs::

    data/raw/landsat_lst/lst_{YYYYMM}.tif             — composites mensuales
    data/processed/calor/lst_mensual_por_poligono.csv — stats por (pol, mes)
    data/processed/calor/uhi_por_poligono_mensual.csv — UHI mensual
    data/processed/calor/uhi_estacional.csv           — agregación estacional

Fuentes:
- LANDSAT/LC08/C02/T1_L2 (Landsat 8, 2013-presente), USGS public domain.
- LANDSAT/LC09/C02/T1_L2 (Landsat 9, 2021-presente), USGS public domain.
"""

from __future__ import annotations

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------
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

import hashlib
import json
import math
import shutil
import signal
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import click
import numpy as np
import pandas as pd
from loguru import logger
from tqdm import tqdm

from scripts.utils.config import load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.4.0"

EE_ASSET_L8 = "LANDSAT/LC08/C02/T1_L2"
EE_ASSET_L9 = "LANDSAT/LC09/C02/T1_L2"
EE_BANDA_TERMICA = "ST_B10"
EE_CRS = "EPSG:4326"

# Fuentes térmicas soportadas por --fuente.
FUENTE_LANDSAT = "landsat"
FUENTE_CBERS = "cbers"
FUENTE_MERGED = "merged"
FUENTES_VALIDAS = (FUENTE_LANDSAT, FUENTE_CBERS, FUENTE_MERGED)

# Path por defecto del CSV producido por scripts/45d_cbers_termico.py (T1).
# Schema esperado: poligono_id, anio, mes, lst_mean_cbers, n_pixeles,
# fecha_pasada, calidad ("alta" | "media" | "baja").
CBERS_TERMICO_CSV_DEFAULT = "data/processed/cbers_termico/lst_cbers_mensual.csv"
CBERS_CALIDADES_ACEPTADAS = {"alta", "media"}

# Factores oficiales USGS C2L2 para ST_B10 → Kelvin → Celsius.
LST_SCALE = 0.00341802
LST_OFFSET = 149.0
KELVIN_A_CELSIUS = 273.15

# Máscara de nubes / sombras en QA_PIXEL.
BIT_CLOUD = 1 << 3
BIT_CLOUD_SHADOW = 1 << 4

# Umbrales de validación metodológica.
LST_MIN_CELSIUS_VALIDO = 5.0
LST_MAX_CELSIUS_VALIDO = 60.0
UHI_MAX_ALERTA_BUG = 15.0  # si UHI > 15°C probable bug
PCT_VALIDOS_MINIMO = 30.0  # si pixeles validos < 30% del polígono → NaN
ESCENAS_MINIMAS_POR_MES = 2

# Estaciones hemisferio sur (mes).
MESES_POR_ESTACION = {
    "verano": (12, 1, 2),
    "otono": (3, 4, 5),
    "invierno": (6, 7, 8),
    "primavera": (9, 10, 11),
}


# ---------------------------------------------------------------------------
# Helpers generales
# ---------------------------------------------------------------------------


@dataclass
class ContextoCalor:
    """Configuración compartida por los subcomandos."""

    poligonos_urbanos_path: Path
    poligonos_rurales_path: Path
    landsat_raw_dir: Path
    procesado_dir: Path
    bbox: tuple[float, float, float, float]
    bbox_buffer_km: float
    ee_project: Optional[str]
    cbers_termico_csv: Path
    fuente: str = FUENTE_MERGED


def _cargar_contexto(
    poligonos_urbanos: Path,
    poligonos_rurales: Path,
    landsat_dir: Path,
    procesado_dir: Path,
    ee_project: Optional[str],
    buffer_km: float,
    cbers_termico_csv: Path,
    fuente: str = FUENTE_MERGED,
) -> ContextoCalor:
    """Construye el contexto leyendo settings + paths."""
    settings = load_settings()
    bbox = (
        settings.geografia.bbox.oeste,
        settings.geografia.bbox.sur,
        settings.geografia.bbox.este,
        settings.geografia.bbox.norte,
    )
    ensure_dir(landsat_dir)
    ensure_dir(procesado_dir)
    project = ee_project or settings.env.ee_project_id
    return ContextoCalor(
        poligonos_urbanos_path=poligonos_urbanos,
        poligonos_rurales_path=poligonos_rurales,
        landsat_raw_dir=landsat_dir,
        procesado_dir=procesado_dir,
        bbox=bbox,
        bbox_buffer_km=buffer_km,
        ee_project=project,
        cbers_termico_csv=cbers_termico_csv,
        fuente=fuente,
    )


def _inicializar_ee(project_id: Optional[str]) -> None:
    """Inicializa Earth Engine. Idempotente."""
    try:
        import ee
    except ImportError as exc:
        logger.error("earthengine-api no instalado. pip install earthengine-api")
        raise SystemExit(1) from exc
    sa_key = __import__("os").environ.get("EE_SERVICE_ACCOUNT_KEY")
    try:
        if sa_key and Path(sa_key).exists():
            credentials = ee.ServiceAccountCredentials(None, sa_key)
            ee.Initialize(credentials)
        elif project_id:
            ee.Initialize(project=project_id)
        else:
            ee.Initialize()
        logger.info(
            f"Earth Engine inicializado "
            f"({'proyecto ' + project_id if project_id else 'ADC default'})"
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Falló ee.Initialize(): {exc}")
        logger.error("Ayuda: python scripts/test_ee_auth.py para diagnosticar.")
        raise SystemExit(1) from exc


def _bbox_con_buffer(
    bbox: tuple[float, float, float, float], buffer_km: float
) -> tuple[float, float, float, float]:
    """Expande el bbox en grados aproximando ``buffer_km`` por lado.

    Rough conversion: 1 grado de lat ≈ 111 km. 1 grado de lon a lat=-27.4
    ≈ 111.32 × cos(-27.4°) ≈ 98.8 km.
    """
    oeste, sur, este, norte = bbox
    delta_lat = buffer_km / 111.32
    lat_media = (sur + norte) / 2.0
    delta_lon = buffer_km / (111.32 * math.cos(math.radians(lat_media)))
    return (oeste - delta_lon, sur - delta_lat, este + delta_lon, norte + delta_lat)


def _meses_rango(inicio: str, fin: str) -> list[tuple[int, int]]:
    """Lista de (anio, mes) entre inicio y fin inclusive, formato 'YYYY-MM'."""
    y0, m0 = map(int, inicio.split("-"))
    y1, m1 = map(int, fin.split("-"))
    out: list[tuple[int, int]] = []
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        out.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def _md5_archivo(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _instalar_signal_handler() -> None:
    def _handler(signum, _frame) -> None:  # noqa: ANN001
        logger.warning(f"Interrupción ({signum}) — salida limpia.")
        sys.exit(130)

    signal.signal(signal.SIGINT, _handler)
    try:
        signal.signal(signal.SIGTERM, _handler)
    except Exception:  # pragma: no cover
        pass


# ---------------------------------------------------------------------------
# Subcomando: descargar-landsat
# ---------------------------------------------------------------------------


def _construir_coleccion_landsat(ee_mod, bbox_geom, inicio, fin, cloud_threshold):
    """Construye ImageCollection L8+L9 filtrada por fecha y CLOUD_COVER."""
    ee = ee_mod
    l8 = (
        ee.ImageCollection(EE_ASSET_L8)
        .filterBounds(bbox_geom)
        .filterDate(inicio, fin)
        .filter(ee.Filter.lt("CLOUD_COVER", cloud_threshold))
    )
    l9 = (
        ee.ImageCollection(EE_ASSET_L9)
        .filterBounds(bbox_geom)
        .filterDate(inicio, fin)
        .filter(ee.Filter.lt("CLOUD_COVER", cloud_threshold))
    )
    return l8.merge(l9)


def _mask_clouds(ee_mod, image):
    """Aplica máscara QA_PIXEL (nubes + sombras) y retorna la imagen."""
    qa = image.select("QA_PIXEL")
    no_nube = qa.bitwiseAnd(BIT_CLOUD).eq(0)
    no_sombra = qa.bitwiseAnd(BIT_CLOUD_SHADOW).eq(0)
    return image.updateMask(no_nube.And(no_sombra))


def _a_celsius(ee_mod, image):
    """Convierte ST_B10 a Celsius preservando timestamp."""
    lst = (
        image.select(EE_BANDA_TERMICA)
        .multiply(LST_SCALE)
        .add(LST_OFFSET)
        .subtract(KELVIN_A_CELSIUS)
        .rename("LST_C")
    )
    return lst.copyProperties(image, ["system:time_start", "CLOUD_COVER"])


def _descargar_composite_mensual(
    ctx: ContextoCalor,
    anio: int,
    mes: int,
    cloud_threshold: float,
    force: bool,
) -> Optional[dict]:
    """Genera composite mediano mensual y lo guarda como GeoTIFF.

    Returns:
        dict con metadata del composite o None si skip.
    """
    import ee

    yyyymm = f"{anio:04d}{mes:02d}"
    out_path = ctx.landsat_raw_dir / f"lst_{yyyymm}.tif"
    if out_path.exists() and not force:
        logger.info(f"[{anio}-{mes:02d}] cache hit, skip ({out_path.name}).")
        return {"status": "cache", "path": str(out_path)}

    inicio = ee.Date.fromYMD(anio, mes, 1)
    fin = inicio.advance(1, "month")

    bbox_buf = _bbox_con_buffer(ctx.bbox, ctx.bbox_buffer_km)
    bbox_geom = ee.Geometry.Rectangle(list(bbox_buf), proj=EE_CRS, geodesic=False)

    coll = _construir_coleccion_landsat(ee, bbox_geom, inicio, fin, cloud_threshold)
    n_escenas = coll.size().getInfo()
    if n_escenas < ESCENAS_MINIMAS_POR_MES:
        logger.warning(
            f"[{anio}-{mes:02d}] solo {n_escenas} escenas válidas "
            f"(mínimo {ESCENAS_MINIMAS_POR_MES}) — skip."
        )
        return {"status": "sin_datos", "n_escenas": n_escenas}

    cloud_mean = coll.aggregate_mean("CLOUD_COVER").getInfo()
    masked = coll.map(lambda img: _mask_clouds(ee, img)).map(lambda img: _a_celsius(ee, img))
    composite = masked.median().clip(bbox_geom)

    try:
        url = composite.getDownloadURL(
            {
                "region": bbox_geom,
                "scale": 30,
                "crs": EE_CRS,
                "format": "GEO_TIFF",
                "maxPixels": int(1e9),
            }
        )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            f"[{anio}-{mes:02d}] getDownloadURL falló: {exc}. Si supera 33M "
            "pixeles, reducir bbox o usar Export.image.toDrive."
        ) from exc

    tmp = out_path.with_suffix(out_path.suffix + ".download.tmp")
    try:
        with urllib.request.urlopen(url, timeout=300) as resp, tmp.open("wb") as fh:
            shutil.copyfileobj(resp, fh)
    except Exception as exc:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"[{anio}-{mes:02d}] fallo descarga .tif: {exc}") from exc

    with tmp.open("rb") as fh:
        magic = fh.read(4)
    if magic[:2] == b"PK":
        import zipfile

        with zipfile.ZipFile(tmp) as z:
            tifs = [n for n in z.namelist() if n.lower().endswith((".tif", ".tiff"))]
            if not tifs:
                raise RuntimeError(f"[{anio}-{mes:02d}] zip sin .tif: {z.namelist()}")
            with z.open(tifs[0]) as src, out_path.open("wb") as dst:
                shutil.copyfileobj(src, dst)
        tmp.unlink(missing_ok=True)
    elif magic[:2] in (b"II", b"MM"):
        shutil.move(str(tmp), str(out_path))
    else:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"[{anio}-{mes:02d}] magic bytes inesperados: {magic!r}")

    md5 = _md5_archivo(out_path)
    logger.info(
        f"[{anio}-{mes:02d}] OK — {n_escenas} escenas, cloud_cover mean "
        f"{cloud_mean:.1f}%, MD5={md5[:8]}..., {out_path.stat().st_size / 1024:.0f} KB"
    )
    return {
        "status": "ok",
        "n_escenas": n_escenas,
        "cloud_cover_mean": cloud_mean,
        "md5": md5,
        "path": str(out_path),
        "size_bytes": out_path.stat().st_size,
    }


# ---------------------------------------------------------------------------
# Subcomando: stats-por-poligono
# ---------------------------------------------------------------------------


def _stats_poligono_sobre_raster(geom_4326, raster_path: Path) -> dict:
    """Calcula stats LST para un polígono sobre un raster mensual."""
    import rasterio
    from rasterio.mask import mask as rio_mask
    from shapely.geometry import mapping

    with rasterio.open(raster_path) as ds:
        try:
            arr, _ = rio_mask(ds, [mapping(geom_4326)], crop=True, filled=True, nodata=np.nan)
        except Exception as exc:  # noqa: BLE001
            return {"error": f"mask: {exc}"}
        data = arr[0].astype(np.float64)

    # Los pixeles con nodata=-inf o valores fuera de rango los tratamos como NaN.
    data = np.where(np.isfinite(data), data, np.nan)
    data = np.where(
        (data >= LST_MIN_CELSIUS_VALIDO) & (data <= LST_MAX_CELSIUS_VALIDO), data, np.nan
    )
    total = data.size
    validos = np.count_nonzero(~np.isnan(data))
    if total == 0:
        return {"pct_validos": 0.0, "count_validos": 0}
    pct_validos = validos / total * 100.0
    out: dict = {"pct_validos": round(pct_validos, 1), "count_validos": int(validos)}
    if pct_validos < PCT_VALIDOS_MINIMO:
        out.update(
            {
                "lst_mean": np.nan,
                "lst_median": np.nan,
                "lst_std": np.nan,
                "lst_p10": np.nan,
                "lst_p90": np.nan,
                "lst_max": np.nan,
            }
        )
        return out
    out["lst_mean"] = float(np.nanmean(data))
    out["lst_median"] = float(np.nanmedian(data))
    out["lst_std"] = float(np.nanstd(data))
    out["lst_p10"] = float(np.nanpercentile(data, 10))
    out["lst_p90"] = float(np.nanpercentile(data, 90))
    out["lst_max"] = float(np.nanmax(data))
    return out


def _cargar_cbers_termico(csv_path: Path) -> pd.DataFrame:
    """Carga el CSV de CBERS-4 IRS térmico mensual producido por T1.

    Schema esperado (scripts/45d_cbers_termico.py):
        poligono_id, anio, mes, lst_mean_cbers, n_pixeles, fecha_pasada, calidad

    Returns:
        DataFrame normalizado con columnas tipadas. Si el archivo no existe
        o está vacío, devuelve un DF vacío con las columnas esperadas para
        que el merge sea no-op.
    """
    cols = [
        "poligono_id",
        "anio",
        "mes",
        "lst_mean_cbers",
        "n_pixeles",
        "fecha_pasada",
        "calidad",
    ]
    if not csv_path.exists():
        logger.info(
            f"CBERS térmico CSV no existe ({csv_path}); merge corre vacío "
            "(el script de T1 lo generará)."
        )
        return pd.DataFrame(columns=cols)
    try:
        df = pd.read_csv(csv_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"No pude leer {csv_path}: {exc}. Sigo sin CBERS.")
        return pd.DataFrame(columns=cols)
    if df.empty:
        return pd.DataFrame(columns=cols)
    # Normalizamos tipos para joinear con confianza.
    for c in ("anio", "mes"):
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")
    if "poligono_id" in df.columns:
        df["poligono_id"] = df["poligono_id"].astype(str)
    if "calidad" in df.columns:
        df["calidad"] = df["calidad"].astype(str).str.strip().str.lower()
    if "lst_mean_cbers" in df.columns:
        df["lst_mean_cbers"] = pd.to_numeric(df["lst_mean_cbers"], errors="coerce")
    return df


def _enriquecer_con_cbers(
    stats_df: pd.DataFrame,
    cbers_df: pd.DataFrame,
    fuente: str,
) -> pd.DataFrame:
    """Aplica la lógica de merge entre stats Landsat y CBERS térmico.

    Reglas según ``fuente``:
        - "landsat": comportamiento legacy. ``fuente_lst`` no se agrega para
          mantener compatibilidad bit a bit con outputs anteriores.
        - "cbers": reemplaza ``lst_mean`` por la versión CBERS cuando existe
          y ``calidad ∈ {alta, media}``. Marca ``fuente_lst="cbers"``.
        - "merged" (default): Landsat primario. Donde Landsat falla
          (``pct_validos < 30%`` o LST nula) y CBERS aporta calidad
          aceptable, llena con CBERS y marca ``fuente_lst="cbers"``. Donde
          ambos coexisten, marca ``fuente_lst="merged"`` y deja el valor
          Landsat (criterio: Landsat es la calibración de referencia).

    También agrega ``confianza_cross_sensor``:
        - "alta" cuando hay overlap Landsat + CBERS para el mismo
          (poligono, anio, mes) — es decir, podemos cruzar calibraciones.
        - "media" cuando la fila depende sólo de CBERS sin overlap previo
          en ese mismo polígono.
        - vacío para filas Landsat puras.
    """
    if stats_df.empty:
        return stats_df

    df = stats_df.copy()
    df["poligono_id"] = df["poligono_id"].astype(str)

    # Modo legacy: no agregamos columnas nuevas — output idéntico al previo.
    if fuente == FUENTE_LANDSAT:
        return df

    # Inicializamos las columnas nuevas (siempre en merged/cbers).
    df["fuente_lst"] = pd.Series([None] * len(df), dtype=object)
    df["confianza_cross_sensor"] = pd.Series([None] * len(df), dtype=object)

    # Marca filas Landsat que tengan LST válida.
    tiene_landsat = df["lst_mean"].notna() & (
        df.get("pct_validos", pd.Series([100.0] * len(df))).fillna(0) >= PCT_VALIDOS_MINIMO
    )
    df.loc[tiene_landsat, "fuente_lst"] = "landsat"

    if cbers_df is None or cbers_df.empty:
        return df

    # Filtramos CBERS por calidad antes del merge.
    cb = cbers_df[cbers_df["calidad"].isin(CBERS_CALIDADES_ACEPTADAS)].copy()
    if cb.empty:
        return df
    cb_idx = cb.set_index(["poligono_id", "anio", "mes"])

    # Set de overlaps (mismas tripletas presentes en Landsat con dato).
    overlaps_validos: set[tuple[str, int, int]] = set()
    if tiene_landsat.any():
        ov = df.loc[tiene_landsat, ["poligono_id", "anio", "mes"]]
        ov_keys = list(
            zip(ov["poligono_id"].astype(str), ov["anio"].astype(int), ov["mes"].astype(int))
        )
        for k in ov_keys:
            if k in cb_idx.index:
                overlaps_validos.add(k)

    # Para 'cbers' sobreescribimos siempre que CBERS tenga dato; para
    # 'merged' sólo cuando Landsat falló.
    for idx, row in df.iterrows():
        key = (str(row["poligono_id"]), int(row["anio"]), int(row["mes"]))
        landsat_ok = (
            bool(tiene_landsat.iloc[df.index.get_loc(idx)])
            if False
            else (row["fuente_lst"] == "landsat")
        )
        if key not in cb_idx.index:
            continue
        cbers_row = cb_idx.loc[key]
        # Si la fila CBERS está duplicada para la misma tripleta, tomamos la
        # primera (defensivo).
        if isinstance(cbers_row, pd.DataFrame):
            cbers_row = cbers_row.iloc[0]

        cbers_lst = cbers_row.get("lst_mean_cbers")
        if pd.isna(cbers_lst):
            continue

        if fuente == FUENTE_CBERS:
            df.at[idx, "lst_mean"] = round(float(cbers_lst), 2)
            df.at[idx, "fuente_lst"] = "cbers"
            df.at[idx, "confianza_cross_sensor"] = "alta" if key in overlaps_validos else "media"
            continue

        # fuente == merged
        if landsat_ok:
            # Landsat tiene dato: lo mantenemos, pero anotamos que CBERS
            # también está disponible (cross-validable) → "merged" + alta.
            df.at[idx, "fuente_lst"] = "merged"
            df.at[idx, "confianza_cross_sensor"] = "alta"
        else:
            df.at[idx, "lst_mean"] = round(float(cbers_lst), 2)
            df.at[idx, "fuente_lst"] = "cbers"
            df.at[idx, "confianza_cross_sensor"] = "alta" if key in overlaps_validos else "media"

    # Para 'merged': si una tripleta urbana/rural existe sólo en CBERS y no
    # tiene fila Landsat, la agregamos como fila nueva. (Sin esto, los meses
    # 100% perdidos en Landsat no aparecerían en absoluto.)
    if fuente in (FUENTE_MERGED, FUENTE_CBERS):
        existentes = set(
            zip(
                df["poligono_id"].astype(str),
                df["anio"].astype(int),
                df["mes"].astype(int),
            )
        )
        nuevas: list[dict] = []
        # Necesitamos saber el tipo_poligono. Si la tripleta no está en
        # stats Landsat, intentamos heredar el tipo desde otra fila del
        # mismo polígono.
        tipo_por_pol = (
            df.drop_duplicates("poligono_id").set_index("poligono_id")["tipo_poligono"].to_dict()
        )
        for (pid, anio, mes), grp in cb.groupby(["poligono_id", "anio", "mes"]):
            cbers_row = grp.iloc[0]
            cbers_lst = cbers_row.get("lst_mean_cbers")
            if pd.isna(cbers_lst):
                continue
            if (str(pid), int(anio), int(mes)) in existentes:
                continue
            tipo = tipo_por_pol.get(str(pid))
            if tipo is None:
                # Sin contexto del polígono: lo saltamos para no introducir
                # filas huérfanas con tipo desconocido.
                continue
            nuevas.append(
                {
                    "poligono_id": str(pid),
                    "tipo_poligono": tipo,
                    "anio": int(anio),
                    "mes": int(mes),
                    "pct_validos": np.nan,
                    "count_validos": int(cbers_row.get("n_pixeles") or 0),
                    "lst_mean": round(float(cbers_lst), 2),
                    "lst_median": np.nan,
                    "lst_std": np.nan,
                    "lst_p10": np.nan,
                    "lst_p90": np.nan,
                    "lst_max": np.nan,
                    "fuente_lst": "cbers",
                    # Sin overlap previo conocido → confianza media.
                    "confianza_cross_sensor": "media",
                }
            )
        if nuevas:
            df = pd.concat([df, pd.DataFrame(nuevas)], ignore_index=True)
            logger.info(
                f"CBERS aportó {len(nuevas)} filas extra para meses sin " "registro Landsat."
            )

    return df


def _calcular_stats_por_poligono(ctx: ContextoCalor) -> pd.DataFrame:
    """Recorre todos los rasters mensuales y todos los polígonos.

    Si ``ctx.fuente`` es ``cbers`` o ``merged``, también incorpora datos
    del CSV CBERS térmico vía :func:`_enriquecer_con_cbers`.
    """
    import geopandas as gpd

    urbanos = gpd.read_file(ctx.poligonos_urbanos_path).to_crs(epsg=4326)
    urbanos["tipo_poligono"] = "urbano"
    rurales = gpd.read_file(ctx.poligonos_rurales_path).to_crs(epsg=4326)
    rurales["tipo_poligono"] = "rural"
    todos = pd.concat(
        [
            urbanos[["id", "tipo_poligono", "geometry"]],
            rurales[["id", "tipo_poligono", "geometry"]],
        ],
        ignore_index=True,
    )
    logger.info(f"Polígonos: {len(urbanos)} urbanos + {len(rurales)} rurales = {len(todos)}")

    rasters = sorted(ctx.landsat_raw_dir.glob("lst_*.tif"))
    logger.info(f"Rasters mensuales disponibles: {len(rasters)}")
    if not rasters and ctx.fuente == FUENTE_LANDSAT:
        logger.warning("No hay rasters Landsat — corré 'descargar-landsat' primero.")
        return pd.DataFrame()

    filas: list[dict] = []
    for raster in tqdm(rasters, desc="Rasters LST"):
        yyyymm = raster.stem.replace("lst_", "")
        anio = int(yyyymm[:4])
        mes = int(yyyymm[4:6])
        for _, row in todos.iterrows():
            st = _stats_poligono_sobre_raster(row.geometry, raster)
            if "error" in st:
                logger.warning(f"[{row['id']} {yyyymm}] {st['error']}")
                continue
            fila = {
                "poligono_id": str(row["id"]),
                "tipo_poligono": row["tipo_poligono"],
                "anio": anio,
                "mes": mes,
            }
            fila.update(
                {
                    k: (round(v, 2) if isinstance(v, float) and not np.isnan(v) else v)
                    for k, v in st.items()
                }
            )
            filas.append(fila)
    df = pd.DataFrame(filas)

    if ctx.fuente in (FUENTE_CBERS, FUENTE_MERGED):
        cbers_df = _cargar_cbers_termico(ctx.cbers_termico_csv)
        n_antes = len(df)
        df = _enriquecer_con_cbers(df, cbers_df, ctx.fuente)
        logger.info(
            f"Merge CBERS ({ctx.fuente}): {n_antes} filas Landsat → "
            f"{len(df)} filas finales. CBERS aportó "
            f"{(df['fuente_lst'] == 'cbers').sum() if 'fuente_lst' in df.columns else 0} valores."
        )

    return df


# ---------------------------------------------------------------------------
# Subcomando: calcular-uhi
# ---------------------------------------------------------------------------


def _calcular_uhi(stats_df: pd.DataFrame) -> pd.DataFrame:
    """Calcula UHI absoluta (vs rural), relativa (vs ciudad), y anomalía histórica."""
    if stats_df.empty:
        return pd.DataFrame()
    df = stats_df.copy()
    df = df.dropna(subset=["lst_mean"])

    # Promedios mensuales de rurales y urbanos.
    prom_rural = (
        df[df["tipo_poligono"] == "rural"]
        .groupby(["anio", "mes"])["lst_mean"]
        .mean()
        .rename("lst_rural_baseline")
    )
    prom_urbano = (
        df[df["tipo_poligono"] == "urbano"]
        .groupby(["anio", "mes"])["lst_mean"]
        .mean()
        .rename("lst_urbano_mean")
    )

    # Solo reportamos UHI para polígonos URBANOS.
    urb = df[df["tipo_poligono"] == "urbano"].copy()
    urb = urb.merge(prom_rural, on=["anio", "mes"], how="left")
    urb = urb.merge(prom_urbano, on=["anio", "mes"], how="left")

    urb["uhi_vs_rural"] = urb["lst_mean"] - urb["lst_rural_baseline"]
    urb["uhi_vs_ciudad"] = urb["lst_mean"] - urb["lst_urbano_mean"]

    # Anomalía histórica por (polígono, mes): promedio de todos los años anteriores.
    anomalias: list[float] = []
    n_hist_list: list[int] = []
    std_hist_list: list[float] = []
    for idx, row in urb.iterrows():
        pid = row["poligono_id"]
        mes = row["mes"]
        anio_actual = row["anio"]
        historico = urb[
            (urb["poligono_id"] == pid) & (urb["mes"] == mes) & (urb["anio"] < anio_actual)
        ]
        n_hist = len(historico)
        if n_hist >= 1:
            mean_hist = float(historico["lst_mean"].mean())
            std_hist = float(historico["lst_mean"].std(ddof=0)) if n_hist > 1 else 0.0
            anomalias.append(round(row["lst_mean"] - mean_hist, 2))
            n_hist_list.append(n_hist)
            std_hist_list.append(round(std_hist, 2))
        else:
            anomalias.append(np.nan)
            n_hist_list.append(0)
            std_hist_list.append(np.nan)

    urb["uhi_anomalia"] = anomalias
    urb["n_observaciones_historico"] = n_hist_list
    urb["std_historico"] = std_hist_list

    # Sanity check: warning si UHI excede umbral.
    excesos = urb[urb["uhi_vs_rural"].abs() > UHI_MAX_ALERTA_BUG]
    if len(excesos):
        logger.warning(
            f"{len(excesos)} filas con |uhi_vs_rural| > {UHI_MAX_ALERTA_BUG}°C — "
            "revisar, probable bug o anomalía extrema."
        )

    # Seleccionamos y redondeamos columnas de salida.
    cols_base = [
        "poligono_id",
        "anio",
        "mes",
        "lst_mean",
        "uhi_vs_rural",
        "uhi_vs_ciudad",
        "uhi_anomalia",
        "lst_rural_baseline",
        "n_observaciones_historico",
        "std_historico",
    ]
    # fuente_lst y confianza_cross_sensor se propagan si vinieron del input
    # (modo merged/cbers). En modo landsat legacy no aparecen, manteniendo
    # el schema histórico.
    cols_extra = [c for c in ("fuente_lst", "confianza_cross_sensor") if c in urb.columns]
    out = urb[cols_base + cols_extra].copy()
    for col in ["lst_mean", "uhi_vs_rural", "uhi_vs_ciudad", "lst_rural_baseline"]:
        out[col] = out[col].round(2)
    return out


def _agregar_estacional(uhi_df: pd.DataFrame) -> pd.DataFrame:
    """Promedia UHI mensuales por (polígono, año, estación)."""
    if uhi_df.empty:
        return pd.DataFrame()
    df = uhi_df.copy()

    def _estacion_anio(row):
        m = int(row["mes"])
        a = int(row["anio"])
        if m == 12:
            return f"verano|{a + 1}"  # DJF se cuenta en el año siguiente (enero-febrero)
        for est, meses in MESES_POR_ESTACION.items():
            if m in meses:
                return f"{est}|{a}"
        return f"otono|{a}"

    df["estacion_anio"] = df.apply(_estacion_anio, axis=1)
    df[["estacion", "anio_est"]] = df["estacion_anio"].str.split("|", expand=True)
    df["anio_est"] = df["anio_est"].astype(int)

    agg = (
        df.groupby(["poligono_id", "anio_est", "estacion"])
        .agg(
            uhi_vs_rural_mean=("uhi_vs_rural", "mean"),
            uhi_vs_ciudad_mean=("uhi_vs_ciudad", "mean"),
            lst_mean=("lst_mean", "mean"),
            n_meses=("mes", "count"),
        )
        .reset_index()
        .rename(columns={"anio_est": "anio"})
    )
    for col in ["uhi_vs_rural_mean", "uhi_vs_ciudad_mean", "lst_mean"]:
        agg[col] = agg[col].round(2)
    return agg[
        [
            "poligono_id",
            "anio",
            "estacion",
            "uhi_vs_rural_mean",
            "uhi_vs_ciudad_mean",
            "lst_mean",
            "n_meses",
        ]
    ]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.group(help="Pipeline de calor urbano — Landsat LST + UHI.")
@click.option(
    "--poligonos-urbanos",
    default="config/poligonos.geojson",
    show_default=True,
    type=click.Path(),
)
@click.option(
    "--poligonos-rurales",
    default="config/poligonos_baseline_rural.geojson",
    show_default=True,
    type=click.Path(),
)
@click.option(
    "--landsat-dir",
    default="data/raw/landsat_lst",
    show_default=True,
    type=click.Path(),
)
@click.option(
    "--procesado-dir",
    default="data/processed/calor",
    show_default=True,
    type=click.Path(),
)
@click.option(
    "--bbox-buffer-km",
    default=20.0,
    show_default=True,
    type=float,
    help="Buffer del bbox para incluir rurales en la descarga Landsat.",
)
@click.option("--project", "ee_project", default=None, help="EE project ID.")
@click.option(
    "--fuente",
    type=click.Choice(list(FUENTES_VALIDAS), case_sensitive=False),
    default=FUENTE_MERGED,
    show_default=True,
    help=(
        "Fuente térmica: solo Landsat (legacy), solo CBERS (alternativa), "
        "o merged (Landsat primario + CBERS donde Landsat falla)."
    ),
)
@click.option(
    "--cbers-termico-csv",
    default=CBERS_TERMICO_CSV_DEFAULT,
    show_default=True,
    type=click.Path(),
    help=(
        "Ruta al CSV mensual de CBERS-4 IRS térmico generado por "
        "scripts/45d_cbers_termico.py (T1)."
    ),
)
@click.option(
    "--nivel-log",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    default="INFO",
)
@click.pass_context
def cli(
    ctx_click,
    poligonos_urbanos: str,
    poligonos_rurales: str,
    landsat_dir: str,
    procesado_dir: str,
    bbox_buffer_km: float,
    ee_project: Optional[str],
    fuente: str,
    cbers_termico_csv: str,
    nivel_log: str,
) -> None:
    setup_logger(nivel=nivel_log.upper())
    _instalar_signal_handler()
    ctx_click.ensure_object(dict)
    ctx_click.obj["ctx"] = _cargar_contexto(
        resolve_path(poligonos_urbanos),
        resolve_path(poligonos_rurales),
        resolve_path(landsat_dir),
        resolve_path(procesado_dir),
        ee_project,
        bbox_buffer_km,
        resolve_path(cbers_termico_csv),
        fuente=fuente.lower(),
    )


@cli.command("descargar-landsat")
@click.option(
    "--meses",
    default=None,
    help="Meses YYYY-MM separados por coma. Default: rango completo 2018-01 → mes actual.",
)
@click.option("--cloud-threshold", default=30, show_default=True, type=int)
@click.option("--force", is_flag=True, default=False)
@click.pass_context
def descargar_landsat(ctx_click, meses: Optional[str], cloud_threshold: int, force: bool) -> None:
    """Descarga composites Landsat LST mensuales a ``data/raw/landsat_lst/``."""
    ctx: ContextoCalor = ctx_click.obj["ctx"]
    _inicializar_ee(ctx.ee_project)

    if meses:
        lista = []
        for s in meses.split(","):
            y, m = s.strip().split("-")
            lista.append((int(y), int(m)))
    else:
        ahora = datetime.now()
        lista = _meses_rango("2018-01", f"{ahora.year:04d}-{ahora.month:02d}")
    logger.info(f"Meses a procesar: {len(lista)} ({lista[0]} → {lista[-1]})")

    t0 = time.time()
    resultados: list[dict] = []
    for anio, mes in tqdm(lista, desc="Meses Landsat"):
        try:
            r = _descargar_composite_mensual(ctx, anio, mes, cloud_threshold, force)
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"[{anio}-{mes:02d}] excepción: {exc}")
            r = {"status": "fallo", "error": str(exc)}
        if r is not None:
            r.update({"anio": anio, "mes": mes})
            resultados.append(r)

    # Resumen JSON
    resumen_path = ctx.landsat_raw_dir / "_resumen_descarga.json"
    resumen_path.write_text(json.dumps(resultados, indent=2), encoding="utf-8")
    ok = sum(1 for r in resultados if r.get("status") == "ok")
    cache = sum(1 for r in resultados if r.get("status") == "cache")
    sin_datos = sum(1 for r in resultados if r.get("status") == "sin_datos")
    fallos = sum(1 for r in resultados if r.get("status") == "fallo")
    logger.info("=" * 60)
    logger.info(
        f"Resumen: OK={ok}, cache={cache}, sin_datos={sin_datos}, "
        f"fallos={fallos}. Duración: {time.time() - t0:.1f}s"
    )
    logger.info(f"Resumen JSON: {resumen_path}")


@cli.command("stats-por-poligono")
@click.pass_context
def stats_cmd(ctx_click) -> None:
    """Calcula stats LST por polígono y mes."""
    ctx: ContextoCalor = ctx_click.obj["ctx"]
    t0 = time.time()
    df = _calcular_stats_por_poligono(ctx)
    if df.empty:
        logger.error("No se generaron stats. Saliendo con error.")
        sys.exit(2)
    out = ctx.procesado_dir / "lst_mensual_por_poligono.csv"
    df.to_csv(out, index=False, encoding="utf-8")
    logger.info(f"Stats: {len(df)} filas → {out} ({time.time() - t0:.1f}s)")


@cli.command("calcular-uhi")
@click.pass_context
def uhi_cmd(ctx_click) -> None:
    """Calcula UHI mensual y estacional."""
    ctx: ContextoCalor = ctx_click.obj["ctx"]
    t0 = time.time()
    stats_path = ctx.procesado_dir / "lst_mensual_por_poligono.csv"
    if not stats_path.exists():
        logger.error(f"{stats_path} no existe — corré stats-por-poligono primero.")
        sys.exit(2)
    stats_df = pd.read_csv(stats_path)
    uhi_df = _calcular_uhi(stats_df)
    if uhi_df.empty:
        logger.error("UHI vacía.")
        sys.exit(2)
    out_uhi = ctx.procesado_dir / "uhi_por_poligono_mensual.csv"
    uhi_df.to_csv(out_uhi, index=False, encoding="utf-8")
    logger.info(f"UHI mensual: {len(uhi_df)} filas → {out_uhi}")

    est_df = _agregar_estacional(uhi_df)
    out_est = ctx.procesado_dir / "uhi_estacional.csv"
    est_df.to_csv(out_est, index=False, encoding="utf-8")
    logger.info(f"UHI estacional: {len(est_df)} filas → {out_est}")
    logger.info(f"Duración: {time.time() - t0:.1f}s")


@cli.command("todo")
@click.option(
    "--meses",
    default=None,
    help="Meses YYYY-MM separados por coma. Default: 2018-01 → mes actual.",
)
@click.option("--cloud-threshold", default=30, show_default=True, type=int)
@click.option("--force", is_flag=True, default=False)
@click.pass_context
def todo_cmd(ctx_click, meses: Optional[str], cloud_threshold: int, force: bool) -> None:
    """Corre los 3 subcomandos en orden."""
    ctx_click.invoke(descargar_landsat, meses=meses, cloud_threshold=cloud_threshold, force=force)
    ctx_click.invoke(stats_cmd)
    ctx_click.invoke(uhi_cmd)


if __name__ == "__main__":
    cli(obj={})
