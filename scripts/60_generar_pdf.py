"""Generación de reportes PDF de una página por polígono (Tarea 1.8).

Pipeline por polígono:

1. Cargar ``serie_temporal.csv``, ``poblacion_estimada.csv`` y
   ``config/poligonos.geojson``.
2. Seleccionar imágenes RGB Sentinel-2 de 2018 y 2026 (o las más cercanas
   disponibles), recortarlas, redimensionarlas a 640x320 y guardarlas como
   PNG temporales.
3. Generar gráfico de crecimiento con matplotlib: eje X = fechas,
   eje Y = viviendas, fill_between con banda min-max. Paleta #1a3a5c /
   #5a7a9c. Guardar PNG.
4. Renderizar la plantilla Jinja2 ``templates/reporte_poligono.html``.
5. WeasyPrint convierte HTML -> PDF en
   ``data/outputs/pdfs/{poligono_id}_v{version}_{YYYYMMDD}.pdf``.
6. Si WeasyPrint falla (Windows sin GTK3, típico), se loguea el error con
   link a la doc oficial y se recomienda WSL2. El pipeline general no aborta.

CLI::

    python scripts/60_generar_pdf.py --poligono itaembe_mini
    python scripts/60_generar_pdf.py --all
"""

from __future__ import annotations

import datetime as dt
import logging
import sys
import tempfile
import time
from pathlib import Path

import click
import geopandas as gpd
import matplotlib
matplotlib.use("Agg")  # backend sin GUI, obligatorio en pipelines batch
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import rasterio
from jinja2 import Environment, FileSystemLoader, select_autoescape
from PIL import Image

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


logger = get_logger(__name__)


VERSION = "0.3.0"
COLOR_PRIMARIO = "#1a3a5c"
COLOR_SECUNDARIO = "#5a7a9c"
PALETA = {
    "primario": COLOR_PRIMARIO,
    "secundario": COLOR_SECUNDARIO,
    "fondo": "#ffffff",
    "texto": "#222222",
    "acento": "#c97d3c",
}
# Nombres de meses en español para formatear fechas (ej. "2018-07" -> "Julio 2018").
MESES_ES = {
    "01": "Enero", "02": "Febrero", "03": "Marzo", "04": "Abril",
    "05": "Mayo", "06": "Junio", "07": "Julio", "08": "Agosto",
    "09": "Septiembre", "10": "Octubre", "11": "Noviembre", "12": "Diciembre",
}

# Mapeo de slug de categoría (del GeoJSON) a texto humano en español.
CATEGORIAS_LEGIBLES = {
    "asentamiento_crecimiento_rapido": "Asentamiento de crecimiento rápido",
    "consolidado_crecimiento": "Barrio consolidado con crecimiento",
    "control_consolidado": "Barrio consolidado (control)",
    "zona_sensible": "Zona sensible",
}


def _categoria_legible(categoria: str) -> str:
    """Traduce el slug de categoría a un texto legible.

    El GeoJSON guarda categoría como slug (p. ej. `asentamiento_crecimiento_rapido`)
    para facilitar comparaciones, pero en el PDF queremos el texto con tildes.
    """
    if not categoria:
        return ""
    if categoria in CATEGORIAS_LEGIBLES:
        return CATEGORIAS_LEGIBLES[categoria]
    return categoria.replace("_", " ").capitalize()


def _fecha_legible(fecha_iso: str) -> str:
    """Formatea 'YYYY-MM' como 'Julio 2018'. Si el formato es inesperado,
    devuelve la cadena original para no perder información."""
    try:
        anio, mes = fecha_iso.split("-")[:2]
        return f"{MESES_ES[mes]} {anio}"
    except (ValueError, KeyError):
        return fecha_iso


def _seleccionar_hitos(serie_pol: pd.DataFrame, n: int = 4) -> list[str]:
    """Devuelve hasta `n` fechas (YYYY-MM) espaciadas uniformemente de la serie."""
    if serie_pol.empty:
        return []
    fechas = sorted(serie_pol["fecha"].unique().tolist())
    if len(fechas) <= n:
        return fechas
    paso = (len(fechas) - 1) / (n - 1)
    idx = [int(round(i * paso)) for i in range(n)]
    # Aseguramos que queden únicos y ordenados.
    idx = sorted(dict.fromkeys(idx))
    return [fechas[i] for i in idx]


# --- Utilidades imágenes -----------------------------------------------------


def _stretch_p2_p98(arr: np.ndarray) -> np.ndarray:
    if arr.ndim == 2:
        arr = arr[np.newaxis, :, :]
    out = np.zeros_like(arr, dtype=np.uint8)
    for i in range(arr.shape[0]):
        banda = arr[i].astype(np.float64)
        finite = banda[np.isfinite(banda) & (banda > 0)]
        if finite.size == 0:
            continue
        lo, hi = np.percentile(finite, [2, 98])
        if hi <= lo:
            hi = lo + 1
        scaled = np.clip((banda - lo) / (hi - lo), 0, 1)
        out[i] = (scaled * 255).astype(np.uint8)
    return out


def _buscar_rgb_cerca(sentinel_dir: Path, poligono_id: str, anio: str) -> Path | None:
    candidatos = sorted(sentinel_dir.glob(f"{poligono_id}_{anio}*_rgb.tif"))
    if candidatos:
        return candidatos[0]
    # Fallback: año +/- 1.
    for delta in (-1, 1, -2, 2):
        a2 = str(int(anio) + delta)
        c2 = sorted(sentinel_dir.glob(f"{poligono_id}_{a2}*_rgb.tif"))
        if c2:
            logger.warning(
                f"No hay RGB para {poligono_id}-{anio}, uso año {a2} como fallback."
            )
            return c2[0]
    return None


def _buscar_rgb_por_fecha_iso(sentinel_dir: Path, poligono_id: str, fecha_iso: str) -> Path | None:
    """Busca el GeoTIFF RGB que corresponde a una fecha YYYY-MM exacta."""
    yyyymm = fecha_iso.replace("-", "")[:6]
    candidatos = sorted(sentinel_dir.glob(f"{poligono_id}_{yyyymm}_rgb.tif"))
    if candidatos:
        return candidatos[0]
    # Fallback: sólo por año.
    anio = fecha_iso[:4]
    return _buscar_rgb_cerca(sentinel_dir, poligono_id, anio)


def _geotiff_a_png(path_tif: Path, out_png: Path, size: tuple[int, int] = (640, 320)) -> bool:
    try:
        with rasterio.open(path_tif) as ds:
            data = ds.read()
        if data.shape[0] >= 3:
            rgb = data[:3]
        else:
            rgb = np.concatenate([data, data, data], axis=0)[:3]
        if rgb.dtype != np.uint8 or rgb.max() < 40:
            rgb = _stretch_p2_p98(rgb)
        rgb_hwc = np.transpose(rgb, (1, 2, 0))
        img = Image.fromarray(rgb_hwc).convert("RGB")
        img.thumbnail(size, Image.BICUBIC)
        canvas = Image.new("RGB", size, (240, 240, 240))
        off_x = (size[0] - img.width) // 2
        off_y = (size[1] - img.height) // 2
        canvas.paste(img, (off_x, off_y))
        out_png.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out_png, "PNG")
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"No se pudo generar PNG desde {path_tif}: {exc}")
        return False


# --- Gráfico crecimiento -----------------------------------------------------


def _grafico_crecimiento(
    serie_pol: pd.DataFrame, nombre_poligono: str, out_png: Path
) -> bool:
    if serie_pol.empty:
        return False
    serie_pol = serie_pol.sort_values("fecha")
    fechas = pd.to_datetime(serie_pol["fecha"], format="%Y-%m", errors="coerce")
    est = serie_pol["n_edificios_estimado"].astype(float)
    minv = serie_pol["n_edificios_min"].astype(float)
    maxv = serie_pol["n_edificios_max"].astype(float)

    fig, ax = plt.subplots(figsize=(6.8, 2.4), dpi=150)
    ax.fill_between(fechas, minv, maxv, color=COLOR_SECUNDARIO, alpha=0.35,
                    label="Banda ±15%")
    ax.plot(fechas, est, color=COLOR_PRIMARIO, linewidth=2.2, marker="o",
            markersize=4, label="Viviendas detectadas")
    ax.set_title(f"Viviendas detectadas — {nombre_poligono}",
                 color=COLOR_PRIMARIO, fontsize=12, pad=10)
    ax.set_xlabel("")
    ax.set_ylabel("Viviendas")
    ax.grid(True, linestyle="--", alpha=0.3)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(loc="upper left", frameon=False, fontsize=8)
    fig.autofmt_xdate()
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=160, bbox_inches="tight")
    plt.close(fig)
    return True


# --- Core PDF ----------------------------------------------------------------


def _clasifica_uhi(delta: float) -> tuple[str, str]:
    """Devuelve (color_hex, etiqueta) usando los umbrales estándar UHI."""
    if delta > 2:
        return "#dc2626", "Isla de calor marcada"
    if delta >= 0:
        return "#c97d3c", "Isla de calor leve"
    return "#1a3a5c", "Enfriamiento neto"


def _calor_contexto(
    poligono_id: str,
    uhi_mensual_df: pd.DataFrame,
    uhi_estacional_df: pd.DataFrame,
) -> dict:
    """Construye el bloque `calor` del contexto Jinja para la capa calor.

    Devuelve ``{"disponible": False}`` si no hay datos del polígono.
    Si hay datos, agrega UHI verano/invierno promedio (de `uhi_estacional`)
    y la última medición mensual disponible.
    """
    if uhi_mensual_df.empty and uhi_estacional_df.empty:
        return {"disponible": False}

    men = uhi_mensual_df[uhi_mensual_df["poligono_id"] == poligono_id].copy()
    est = uhi_estacional_df[uhi_estacional_df["poligono_id"] == poligono_id].copy()
    if men.empty and est.empty:
        return {"disponible": False}

    # Último mes disponible del polígono.
    ultimo_ctx = {}
    if not men.empty:
        men["_orden"] = men["anio"].astype(int) * 100 + men["mes"].astype(int)
        ultima = men.sort_values("_orden").iloc[-1]
        fecha_iso = f"{int(ultima['anio']):04d}-{int(ultima['mes']):02d}"
        ultimo_ctx = {
            "lst_mean": f"{float(ultima['lst_mean']):.1f}",
            "uhi_vs_rural": f"{float(ultima['uhi_vs_rural']):.1f}",
            "fecha_legible": _fecha_legible(fecha_iso),
        }

    # UHI estacional promedio: último año disponible por estación.
    def _ultima_estacion(df: pd.DataFrame, estacion: str) -> dict:
        sub = df[df["estacion"] == estacion]
        if sub.empty:
            return {"uhi_vs_rural": "s/d", "etiqueta": "sin dato", "delta": 0.0}
        fila = sub.sort_values("anio").iloc[-1]
        delta = float(fila["uhi_vs_rural_mean"])
        _, etiqueta = _clasifica_uhi(delta)
        return {
            "uhi_vs_rural": f"{delta:.1f}",
            "etiqueta": etiqueta,
            "delta": delta,
        }

    verano = _ultima_estacion(est, "verano")
    invierno = _ultima_estacion(est, "invierno")
    color_verano, _ = _clasifica_uhi(verano["delta"])
    color_invierno, _ = _clasifica_uhi(invierno["delta"])

    # Ranking dentro de Posadas (por UHI vs rural verano promedio, último año).
    ranking_texto = "s/d"
    if not uhi_estacional_df.empty:
        verano_all = uhi_estacional_df[uhi_estacional_df["estacion"] == "verano"]
        if not verano_all.empty:
            ultimo_anio = int(verano_all["anio"].max())
            top = verano_all[verano_all["anio"] == ultimo_anio].copy()
            top = top.sort_values("uhi_vs_rural_mean", ascending=False).reset_index(drop=True)
            if poligono_id in top["poligono_id"].values:
                pos = int(top.index[top["poligono_id"] == poligono_id][0]) + 1
                total = len(top)
                ranking_texto = f"{pos}º de {total} barrios (verano {ultimo_anio})"

    return {
        "disponible": True,
        "verano": verano,
        "invierno": invierno,
        "color_verano": color_verano,
        "color_invierno": color_invierno,
        "signo_verano": "+" if verano["delta"] > 0 else "",
        "signo_invierno": "+" if invierno["delta"] > 0 else "",
        "ultimo": ultimo_ctx or {
            "lst_mean": "s/d",
            "uhi_vs_rural": "s/d",
            "fecha_legible": "s/d",
        },
        "ranking_texto": ranking_texto,
    }


def _hitos_serie(serie_pol: pd.DataFrame) -> list[dict]:
    """Cuatro hitos equidistantes de la serie temporal real (no hardcodeados)."""
    if serie_pol.empty:
        return []
    fechas_hitos = _seleccionar_hitos(serie_pol, n=4)
    hitos: list[dict] = []
    for fecha in fechas_hitos:
        fila = serie_pol[serie_pol["fecha"] == fecha].iloc[0]
        est = int(fila["n_edificios_estimado"])
        delta = max(est - int(fila["n_edificios_min"]),
                    int(fila["n_edificios_max"]) - est)
        hitos.append({
            "fecha": fecha,
            "fecha_legible": _fecha_legible(fecha),
            "anio": fecha[:4],
            "valor": est,
            "delta": delta,
        })
    return hitos


def _generar_pdf_poligono(
    poligono_id: str,
    nombre: str,
    descripcion: str,
    categoria: str,
    serie_df: pd.DataFrame,
    poblacion_df: pd.DataFrame,
    sentinel_dir: Path,
    output_dir: Path,
    template_path: Path,
    personas_por_vivienda: float,
    uhi_mensual_df: pd.DataFrame,
    uhi_estacional_df: pd.DataFrame,
) -> bool:
    serie_pol = serie_df[serie_df["poligono_id"] == poligono_id].copy()
    pob_pol = poblacion_df[poblacion_df["poligono_id"] == poligono_id].copy()

    if serie_pol.empty:
        logger.warning(f"Sin serie temporal para '{poligono_id}' — no se genera PDF.")
        return False

    # Fechas dinámicas a partir de la serie temporal real (no hardcodeadas).
    fechas_disponibles = sorted(serie_pol["fecha"].unique().tolist())
    fecha_inicio = fechas_disponibles[0]
    fecha_fin = fechas_disponibles[-1]
    fecha_inicio_legible = _fecha_legible(fecha_inicio)
    fecha_fin_legible = _fecha_legible(fecha_fin)
    periodo_legible = f"{fecha_inicio_legible} - {fecha_fin_legible}"

    with tempfile.TemporaryDirectory(prefix=f"obsp_{poligono_id}_") as tmpdir:
        tmp = Path(tmpdir)
        img_inicio_path = tmp / f"{poligono_id}_{fecha_inicio}.png"
        img_fin_path = tmp / f"{poligono_id}_{fecha_fin}.png"
        rgb_inicio = _buscar_rgb_por_fecha_iso(sentinel_dir, poligono_id, fecha_inicio)
        rgb_fin = _buscar_rgb_por_fecha_iso(sentinel_dir, poligono_id, fecha_fin)
        ok_inicio = _geotiff_a_png(rgb_inicio, img_inicio_path) if rgb_inicio else False
        ok_fin = _geotiff_a_png(rgb_fin, img_fin_path) if rgb_fin else False

        grafico_path = tmp / f"{poligono_id}_grafico.png"
        _grafico_crecimiento(serie_pol, nombre, grafico_path)

        # Población actual = fila más reciente.
        def _fmt_miles(n: int) -> str:
            return f"{int(n):,}".replace(",", ".")

        if not pob_pol.empty:
            pob_pol = pob_pol.sort_values("fecha")
            ultima = pob_pol.iloc[-1]
            pob_ctx = {
                # Claves usadas por la plantilla existente (poblacion.central/min/max/ninos).
                "central": _fmt_miles(int(ultima["poblacion_estimada"])),
                "min": _fmt_miles(int(ultima["poblacion_min"])),
                "max": _fmt_miles(int(ultima["poblacion_max"])),
                "metodo": str(ultima.get("metodo", "n/d")),
                "ninos": _fmt_miles(int(ultima["poblacion_estimada"] * 0.30)),
                # Compat alterno (si alguna otra plantilla lo espera):
                "estimada": _fmt_miles(int(ultima["poblacion_estimada"])),
                "minimo": _fmt_miles(int(ultima["poblacion_min"])),
                "maximo": _fmt_miles(int(ultima["poblacion_max"])),
            }
        else:
            pob_ctx = {
                "central": "s/d", "min": "s/d", "max": "s/d",
                "metodo": "n/d", "ninos": "s/d",
                "estimada": "s/d", "minimo": "s/d", "maximo": "s/d",
            }

        hitos = _hitos_serie(serie_pol)
        # Tabla compacta con 4 hitos equidistantes (en lugar de cada año),
        # para que el PDF quepa en una página A4. El gráfico de abajo
        # muestra la serie completa.
        fechas_hitos = [h["fecha"] for h in hitos]
        serie_hitos_df = serie_pol[serie_pol["fecha"].isin(fechas_hitos)]
        crecimiento_tabla = [
            {
                "fecha": _fecha_legible(row["fecha"]),
                "n_edificios_estimado": f"{int(row['n_edificios_estimado']):,}".replace(",", "."),
                "n_edificios_min": f"{int(row['n_edificios_min']):,}".replace(",", "."),
                "n_edificios_max": f"{int(row['n_edificios_max']):,}".replace(",", "."),
            }
            for _, row in serie_hitos_df.sort_values("fecha").iterrows()
        ]

        calor_ctx = _calor_contexto(poligono_id, uhi_mensual_df, uhi_estacional_df)

        contexto = {
            "poligono": {
                "id": poligono_id,
                "nombre": nombre,
                "descripcion": descripcion,
                "categoria": categoria,
                "categoria_legible": _categoria_legible(categoria),
            },
            # Para la plantilla del repo:
            "crecimiento": crecimiento_tabla,
            "poblacion": pob_ctx,
            "calor": calor_ctx,
            "fecha_actual": _fecha_legible(fecha_fin),
            # Variables usadas en mi plantilla alternativa:
            "serie_hitos": hitos,
            "poblacion_actual": pob_ctx,
            # Fechas dinámicas de la serie — REEMPLAZAN los hardcodeos anteriores.
            "fecha_inicio": fecha_inicio,
            "fecha_fin": fecha_fin,
            "fecha_inicio_legible": fecha_inicio_legible,
            "fecha_fin_legible": fecha_fin_legible,
            "periodo_legible": periodo_legible,
            # Comunes:
            "grafico_crecimiento_path": str(grafico_path.resolve()),
            "imagen_inicio_path": str(img_inicio_path.resolve()) if ok_inicio else "",
            "imagen_fin_path": str(img_fin_path.resolve()) if ok_fin else "",
            # Alias compatibles con la plantilla existente (que espera imagen_2018/_2026).
            "imagen_2018_path": str(img_inicio_path.resolve()) if ok_inicio else "",
            "imagen_2026_path": str(img_fin_path.resolve()) if ok_fin else "",
            "fecha_generacion": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "version": VERSION,
            "paleta": PALETA,
            "supuestos": {
                "personas_por_vivienda": f"{personas_por_vivienda:.1f}",
                "periodo": periodo_legible,
                "banda_edificios_pct": 15,
                "banda_poblacion_pct": 20,
            },
        }

        env = Environment(
            loader=FileSystemLoader(str(template_path.parent)),
            autoescape=select_autoescape(["html", "xml"]),
        )
        template = env.get_template(template_path.name)
        html = template.render(**contexto)

        fecha_stamp = dt.datetime.now().strftime("%Y%m%d")
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = out_dir / f"{poligono_id}_v{VERSION}_{fecha_stamp}.pdf"

        try:
            from weasyprint import HTML  # import diferido para no reventar si falta
            HTML(string=html, base_url=str(tmp)).write_pdf(str(pdf_path))
            logger.info(f"PDF -> {pdf_path}")
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error(
                f"WeasyPrint falló generando PDF para '{poligono_id}': {exc}"
            )
            logger.error(
                "Ver instrucciones Windows/GTK3: "
                "https://doc.courtbouillon.org/weasyprint/stable/first_steps.html#windows"
            )
            logger.error(
                "Recomendación: correr este script en WSL2 con "
                "'sudo apt install python3-cffi python3-brotli libpango-1.0-0 libpangoft2-1.0-0'."
            )
            # Fallback: guardar el HTML al menos, para diagnóstico.
            html_path = out_dir / f"{poligono_id}_v{VERSION}_{fecha_stamp}.html"
            html_path.write_text(html, encoding="utf-8")
            logger.warning(f"HTML de diagnóstico -> {html_path}")
            return False


# --- CLI ---------------------------------------------------------------------


@click.command(help="Genera PDF de una página por polígono (Tarea 1.8).")
@click.option("--poligono", type=str, default=None)
@click.option("--all", "all_flag", is_flag=True, default=False)
@click.option(
    "--poligonos",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=Path("config/poligonos.geojson"),
    show_default=True,
)
@click.option(
    "--serie-temporal",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("data/processed/conteos/serie_temporal.csv"),
    show_default=True,
)
@click.option(
    "--poblacion",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("data/processed/poblacion_estimada.csv"),
    show_default=True,
)
@click.option(
    "--sentinel-dir",
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    default=Path("data/raw/sentinel2"),
    show_default=True,
)
@click.option(
    "--output-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("data/outputs/pdfs"),
    show_default=True,
)
@click.option(
    "--template",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=Path("templates/reporte_poligono.html"),
    show_default=True,
)
@click.option(
    "--uhi-mensual",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("data/processed/calor/uhi_por_poligono_mensual.csv"),
    show_default=True,
)
@click.option(
    "--uhi-estacional",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("data/processed/calor/uhi_estacional.csv"),
    show_default=True,
)
@click.option("--personas-por-vivienda", type=float, default=3.6, show_default=True)
def cli(
    poligono: str | None,
    all_flag: bool,
    poligonos: Path,
    serie_temporal: Path,
    poblacion: Path,
    sentinel_dir: Path,
    output_dir: Path,
    template: Path,
    uhi_mensual: Path,
    uhi_estacional: Path,
    personas_por_vivienda: float,
) -> None:
    """Entry point CLI."""
    t0 = time.time()
    logger.info("=" * 60)
    logger.info("Observatorio Posadas — Generación de PDF (Tarea 1.8)")
    logger.info("=" * 60)
    if not poligono and not all_flag:
        raise click.UsageError("Indicá --poligono ID o --all")

    serie_df = pd.read_csv(serie_temporal) if serie_temporal.exists() else pd.DataFrame()
    poblacion_df = pd.read_csv(poblacion) if poblacion.exists() else pd.DataFrame(
        columns=["poligono_id", "fecha", "poblacion_min", "poblacion_estimada",
                 "poblacion_max", "metodo"]
    )
    uhi_mensual_df = (
        pd.read_csv(uhi_mensual) if uhi_mensual.exists() else pd.DataFrame()
    )
    uhi_estacional_df = (
        pd.read_csv(uhi_estacional) if uhi_estacional.exists() else pd.DataFrame()
    )
    if uhi_mensual_df.empty and uhi_estacional_df.empty:
        logger.info(
            "Capa de calor no disponible (sin CSVs) — PDFs sin sección UHI."
        )
    gdf = gpd.read_file(poligonos)

    if all_flag:
        seleccion = gdf
    else:
        seleccion = gdf[gdf["id"].astype(str) == poligono]
        if seleccion.empty:
            logger.error(f"Polígono '{poligono}' no encontrado en {poligonos}")
            sys.exit(1)

    ok = 0
    fail = 0
    for _, fila in seleccion.iterrows():
        pid = str(fila["id"])
        nombre = str(fila.get("nombre", pid))
        desc = str(fila.get("descripcion", "") or "")
        cat = str(fila.get("categoria", "") or "")
        try:
            exito = _generar_pdf_poligono(
                poligono_id=pid,
                nombre=nombre,
                descripcion=desc,
                categoria=cat,
                serie_df=serie_df,
                poblacion_df=poblacion_df,
                sentinel_dir=sentinel_dir,
                output_dir=output_dir,
                template_path=template,
                personas_por_vivienda=personas_por_vivienda,
                uhi_mensual_df=uhi_mensual_df,
                uhi_estacional_df=uhi_estacional_df,
            )
            if exito:
                ok += 1
            else:
                fail += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"Error en polígono '{pid}': {exc}")
            fail += 1

    logger.info(f"Resumen: {ok} OK, {fail} FALLO. Duración {time.time() - t0:.1f}s")


if __name__ == "__main__":
    cli()
