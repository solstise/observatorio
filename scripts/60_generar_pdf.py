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


VERSION = "0.1.0"
COLOR_PRIMARIO = "#1a3a5c"
COLOR_SECUNDARIO = "#5a7a9c"
PALETA = {
    "primario": COLOR_PRIMARIO,
    "secundario": COLOR_SECUNDARIO,
    "fondo": "#ffffff",
    "texto": "#222222",
    "acento": "#c97d3c",
}
HITOS_DEFAULT = ["2018", "2021", "2024", "2026"]


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
                "No hay RGB para %s-%s, uso año %s como fallback.",
                poligono_id, anio, a2,
            )
            return c2[0]
    return None


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
        logger.warning("No se pudo generar PNG desde %s: %s", path_tif, exc)
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

    fig, ax = plt.subplots(figsize=(7, 3.2), dpi=160)
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


def _hitos_serie(serie_pol: pd.DataFrame) -> list[dict]:
    """Genera cifras de 2018, 2021, 2024, 2026 (o los años más próximos)."""
    if serie_pol.empty:
        return []
    serie_pol = serie_pol.copy()
    serie_pol["anio"] = serie_pol["fecha"].str[:4]
    hitos: list[dict] = []
    for anio_obj in HITOS_DEFAULT:
        sub = serie_pol[serie_pol["anio"] == anio_obj]
        if sub.empty:
            # fallback: año más cercano disponible
            try:
                idx = (serie_pol["anio"].astype(int) - int(anio_obj)).abs().idxmin()
                sub = serie_pol.loc[[idx]]
            except Exception:  # noqa: BLE001
                continue
        fila = sub.iloc[0]
        est = int(fila["n_edificios_estimado"])
        delta = max(est - int(fila["n_edificios_min"]),
                    int(fila["n_edificios_max"]) - est)
        hitos.append({"anio": anio_obj, "valor": est, "delta": delta})
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
) -> bool:
    serie_pol = serie_df[serie_df["poligono_id"] == poligono_id].copy()
    pob_pol = poblacion_df[poblacion_df["poligono_id"] == poligono_id].copy()

    if serie_pol.empty:
        logger.warning("Sin serie temporal para '%s' — no se genera PDF.", poligono_id)
        return False

    with tempfile.TemporaryDirectory(prefix=f"obsp_{poligono_id}_") as tmpdir:
        tmp = Path(tmpdir)
        img_2018_path = tmp / f"{poligono_id}_2018.png"
        img_2026_path = tmp / f"{poligono_id}_2026.png"
        rgb2018 = _buscar_rgb_cerca(sentinel_dir, poligono_id, "2018")
        rgb2026 = _buscar_rgb_cerca(sentinel_dir, poligono_id, "2026")
        ok18 = _geotiff_a_png(rgb2018, img_2018_path) if rgb2018 else False
        ok26 = _geotiff_a_png(rgb2026, img_2026_path) if rgb2026 else False

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
        # La plantilla del repo espera una tabla `crecimiento` con fecha + min/est/max.
        crecimiento_tabla = [
            {
                "fecha": row["fecha"],
                "n_edificios_estimado": int(row["n_edificios_estimado"]),
                "n_edificios_min": int(row["n_edificios_min"]),
                "n_edificios_max": int(row["n_edificios_max"]),
            }
            for _, row in serie_pol.sort_values("fecha").iterrows()
        ]

        contexto = {
            "poligono": {
                "id": poligono_id,
                "nombre": nombre,
                "descripcion": descripcion,
                "categoria": categoria,
                "categoria_legible": categoria.replace("_", " ").capitalize() if categoria else "",
            },
            # Para la plantilla del repo:
            "crecimiento": crecimiento_tabla,
            "poblacion": pob_ctx,
            "fecha_actual": dt.datetime.now().strftime("%B %Y"),
            # Variables usadas en mi plantilla alternativa:
            "serie_hitos": hitos,
            "poblacion_actual": pob_ctx,
            # Comunes:
            "grafico_crecimiento_path": str(grafico_path.resolve()),
            "imagen_2018_path": str(img_2018_path.resolve()) if ok18 else "",
            "imagen_2026_path": str(img_2026_path.resolve()) if ok26 else "",
            "fecha_generacion": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
            "version": VERSION,
            "paleta": PALETA,
            "supuestos": {
                "personas_por_vivienda": f"{personas_por_vivienda:.1f}",
                "periodo": f"{serie_pol['fecha'].min()} a {serie_pol['fecha'].max()}",
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
            logger.info("PDF -> %s", pdf_path)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "WeasyPrint falló generando PDF para '%s': %s", poligono_id, exc
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
            logger.warning("HTML de diagnóstico -> %s", html_path)
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
    gdf = gpd.read_file(poligonos)

    if all_flag:
        seleccion = gdf
    else:
        seleccion = gdf[gdf["id"].astype(str) == poligono]
        if seleccion.empty:
            logger.error("Polígono '%s' no encontrado en %s", poligono, poligonos)
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
            )
            if exito:
                ok += 1
            else:
                fail += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("Error en polígono '%s': %s", pid, exc)
            fail += 1

    logger.info("Resumen: %d OK, %d FALLO. Duración %.1fs", ok, fail, time.time() - t0)


if __name__ == "__main__":
    cli()
