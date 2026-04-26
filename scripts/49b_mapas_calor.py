"""Mapas PNG coropléticos + GIF animado de la capa de calor.

Genera:

1. Mapa PNG por estación de cada año con coropleth de UHI o LST.
2. GIF animado mensual de los últimos 24 meses (evolución térmica).
3. Imagen estática de "top 5 barrios más calientes" para usar en PDFs /
   redes sociales.

Calidad visual prioritaria:

- DPI alto (200 para PNG, 120 para GIF por peso).
- Paleta ``magma`` (similar a ``inferno``) para LST — percibida
  profesional y accesible daltónicos.
- Paleta diverging ``RdBu_r`` para UHI — negativo azul, positivo rojo.
- Tipografía Inter (desde templates/static/fonts/) con fallback Arial.
- Etiquetas de barrio con halo blanco para legibilidad.
- Footer con fuente + fecha + versión.

Uso::

    python scripts/49b_mapas_calor.py --tipo estacional   # PNGs estacionales
    python scripts/49b_mapas_calor.py --tipo gif          # GIF 24 meses
    python scripts/49b_mapas_calor.py --tipo top          # PNG ranking
    python scripts/49b_mapas_calor.py --tipo todo         # los 3
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

import io
from datetime import datetime
from pathlib import Path
from typing import Optional

import click
import matplotlib
matplotlib.use("Agg")  # backend sin GUI

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from loguru import logger
from matplotlib.colors import Normalize, TwoSlopeNorm
from matplotlib.patheffects import withStroke

from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.3.0"

# Colormaps elegidos (accesibles + profesionales).
CMAP_LST = "magma"      # secuencial oscuro → claro, transición suave.
CMAP_UHI = "RdBu_r"     # diverging rojo-azul; negativo azul, positivo rojo.

# Paleta institucional (primary/secondary/accent).
COLOR_BORDE = "#1a3a5c"
COLOR_TEXTO_SUAVE = "#5a7a9c"
COLOR_FONDO = "#ffffff"

# Configuración de rango por métrica.
RANGO_LST = (20.0, 45.0)
RANGO_UHI_CENTRADO = (-5.0, 8.0)

# Fuentes (buscamos Inter; si no está, matplotlib cae a su default).
FONT_REGULAR_CANDIDATOS = [
    "templates/static/fonts/Inter-Regular.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]
FONT_BOLD_CANDIDATOS = [
    "templates/static/fonts/Inter-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _configurar_matplotlib() -> None:
    """Aplica config global de alta calidad."""
    plt.rcParams.update({
        "figure.dpi": 120,
        "savefig.dpi": 200,
        "savefig.bbox": "tight",
        "savefig.facecolor": COLOR_FONDO,
        "axes.edgecolor": COLOR_TEXTO_SUAVE,
        "axes.labelcolor": "#222222",
        "axes.titlecolor": COLOR_BORDE,
        "axes.titleweight": "bold",
        "xtick.color": COLOR_TEXTO_SUAVE,
        "ytick.color": COLOR_TEXTO_SUAVE,
        "font.family": "sans-serif",
        "font.sans-serif": ["Inter", "Arial", "DejaVu Sans"],
    })


def _cargar_datos(
    poligonos_path: Path,
    uhi_path: Path,
    estacional_path: Path,
    mensual_path: Path,
):
    import geopandas as gpd

    gdf = gpd.read_file(poligonos_path).to_crs(epsg=4326)
    uhi = pd.read_csv(uhi_path) if uhi_path.exists() else pd.DataFrame()
    est = pd.read_csv(estacional_path) if estacional_path.exists() else pd.DataFrame()
    men = pd.read_csv(mensual_path) if mensual_path.exists() else pd.DataFrame()
    return gdf, uhi, est, men


def _footer(fig, fuente_extra: str = "") -> None:
    """Agrega footer de atribución + fecha + versión al pie del figure."""
    now = datetime.now().strftime("%Y-%m-%d")
    txt = (
        f"Observatorio Urbano Posadas · v{SCRIPT_VERSION} · generado {now}"
    )
    if fuente_extra:
        txt = f"{fuente_extra} · {txt}"
    fig.text(
        0.5, 0.01, txt,
        ha="center", va="bottom",
        fontsize=7, color=COLOR_TEXTO_SUAVE, style="italic",
    )


def _etiquetar_barrios(ax, gdf, columna_nombre: str = "nombre", fontsize: int = 7) -> None:
    """Dibuja nombres centrados en cada polígono, con halo blanco."""
    for _, row in gdf.iterrows():
        pt = row.geometry.representative_point()
        ax.annotate(
            str(row.get(columna_nombre, row.get("id", ""))),
            xy=(pt.x, pt.y),
            ha="center", va="center",
            fontsize=fontsize,
            color="#111111",
            path_effects=[withStroke(linewidth=2.5, foreground="white")],
            zorder=5,
        )


# ---------------------------------------------------------------------------
# Mapa estacional (PNG por año + estación)
# ---------------------------------------------------------------------------


def _construir_dataset_estacional(
    uhi_est: pd.DataFrame, gdf_poligonos, anio: int, estacion: str
) -> "pd.DataFrame":
    import geopandas as gpd

    sub = uhi_est[
        (uhi_est["anio"].astype(int) == anio)
        & (uhi_est["estacion"] == estacion)
    ][["poligono_id", "uhi_vs_rural_mean", "uhi_vs_ciudad_mean", "lst_mean", "n_meses"]]
    g = gdf_poligonos.merge(sub, left_on="id", right_on="poligono_id", how="left")
    return g


def _plot_mapa_estacional(
    gdf_merged,
    metrica: str,
    anio: int,
    estacion: str,
    out_path: Path,
    etiquetas: bool = True,
) -> bool:
    """Guarda un PNG coroplético estacional para una métrica."""
    import geopandas as gpd

    if metrica == "lst":
        col = "lst_mean"
        vmin, vmax = RANGO_LST
        norm = Normalize(vmin=vmin, vmax=vmax)
        cmap = plt.get_cmap(CMAP_LST)
        titulo_metrica = "Temperatura de superficie (°C)"
    elif metrica == "uhi_vs_rural":
        col = "uhi_vs_rural_mean"
        norm = TwoSlopeNorm(vmin=RANGO_UHI_CENTRADO[0], vcenter=0, vmax=RANGO_UHI_CENTRADO[1])
        cmap = plt.get_cmap(CMAP_UHI)
        titulo_metrica = "UHI vs baseline rural (°C)"
    else:  # uhi_vs_ciudad
        col = "uhi_vs_ciudad_mean"
        norm = TwoSlopeNorm(vmin=RANGO_UHI_CENTRADO[0], vcenter=0, vmax=RANGO_UHI_CENTRADO[1])
        cmap = plt.get_cmap(CMAP_UHI)
        titulo_metrica = "UHI vs promedio Posadas (°C)"

    if col not in gdf_merged or gdf_merged[col].dropna().empty:
        logger.warning(
            f"Sin datos para {metrica} en {anio} {estacion} — salteado."
        )
        return False

    fig, ax = plt.subplots(figsize=(9, 7))
    ax.set_facecolor(COLOR_FONDO)

    # Base: polígonos sin dato en gris claro.
    sin_dato = gdf_merged[gdf_merged[col].isna()]
    if len(sin_dato):
        sin_dato.plot(ax=ax, color="#e5e7eb", edgecolor="#9ca3af", linewidth=0.4)

    con_dato = gdf_merged.dropna(subset=[col])
    con_dato.plot(
        ax=ax, column=col, cmap=cmap, norm=norm,
        edgecolor="#222222", linewidth=0.6,
    )

    if etiquetas:
        _etiquetar_barrios(ax, gdf_merged)

    ax.set_axis_off()

    # Colorbar.
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax, fraction=0.035, pad=0.02, orientation="vertical")
    cbar.ax.tick_params(labelsize=8, color=COLOR_TEXTO_SUAVE)
    cbar.outline.set_edgecolor(COLOR_TEXTO_SUAVE)
    cbar.set_label(titulo_metrica, fontsize=9, color="#222222")

    est_legible = {"verano": "Verano", "otono": "Otoño",
                   "invierno": "Invierno", "primavera": "Primavera"}[estacion]
    ax.set_title(
        f"{est_legible} {anio} · {titulo_metrica}",
        fontsize=13, pad=10, color=COLOR_BORDE, fontweight="bold",
    )
    _footer(fig, fuente_extra="Fuente: Landsat 8/9 USGS")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=200, bbox_inches="tight", facecolor=COLOR_FONDO)
    plt.close(fig)
    logger.info(f"PNG estacional → {out_path.name}")
    return True


# ---------------------------------------------------------------------------
# GIF animado mensual
# ---------------------------------------------------------------------------


def _plot_frame_mensual(gdf, uhi_df, anio: int, mes: int, metrica: str):
    """Genera un frame como array RGB para imageio."""
    import geopandas as gpd
    import imageio.v3 as iio

    col_map = {
        "uhi_vs_rural": ("uhi_vs_rural", CMAP_UHI,
                         TwoSlopeNorm(vmin=-5, vcenter=0, vmax=8),
                         "UHI vs rural (°C)"),
        "uhi_vs_ciudad": ("uhi_vs_ciudad", CMAP_UHI,
                          TwoSlopeNorm(vmin=-5, vcenter=0, vmax=8),
                          "UHI vs ciudad (°C)"),
        "lst": ("lst_mean", CMAP_LST, Normalize(vmin=20, vmax=45),
                "LST (°C)"),
    }
    col, cmap_name, norm, titulo = col_map[metrica]
    cmap = plt.get_cmap(cmap_name)

    sub = uhi_df[
        (uhi_df["anio"].astype(int) == anio)
        & (uhi_df["mes"].astype(int) == mes)
    ][["poligono_id", col]]
    g = gdf.merge(sub, left_on="id", right_on="poligono_id", how="left")

    fig, ax = plt.subplots(figsize=(8, 6))
    ax.set_facecolor(COLOR_FONDO)

    sin = g[g[col].isna()]
    if len(sin):
        sin.plot(ax=ax, color="#e5e7eb", edgecolor="#9ca3af", linewidth=0.3)
    con = g.dropna(subset=[col])
    if len(con):
        con.plot(ax=ax, column=col, cmap=cmap, norm=norm,
                 edgecolor="#222222", linewidth=0.5)
    ax.set_axis_off()

    nombre_mes = ["Ene", "Feb", "Mar", "Abr", "May", "Jun",
                  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][mes - 1]
    ax.set_title(f"{nombre_mes} {anio} · {titulo}",
                 fontsize=12, color=COLOR_BORDE, fontweight="bold")

    # Colorbar más chico en GIF.
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=norm)
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax, fraction=0.03, pad=0.02)
    cbar.ax.tick_params(labelsize=7)
    cbar.outline.set_edgecolor(COLOR_TEXTO_SUAVE)

    _footer(fig)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight", facecolor=COLOR_FONDO)
    plt.close(fig)
    buf.seek(0)
    return iio.imread(buf)


def _generar_gif_mensual(
    gdf, uhi_df, out_path: Path, metrica: str,
    n_meses_recientes: int = 24,
) -> bool:
    """Genera GIF animado con los últimos N meses con dato."""
    import imageio.v3 as iio

    if uhi_df.empty:
        logger.warning("UHI mensual vacío — no hay GIF para generar.")
        return False

    meses = (
        uhi_df[["anio", "mes"]]
        .drop_duplicates()
        .sort_values(["anio", "mes"])
        .tail(n_meses_recientes)
    )
    if len(meses) < 3:
        logger.warning(f"Solo hay {len(meses)} meses con datos — GIF salteado.")
        return False

    logger.info(f"GIF: generando {len(meses)} frames para {out_path.name}…")
    frames = []
    for _, row in meses.iterrows():
        frames.append(_plot_frame_mensual(
            gdf, uhi_df, int(row["anio"]), int(row["mes"]), metrica
        ))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    iio.imwrite(out_path, frames, duration=0.6, loop=0)
    logger.info(f"GIF → {out_path.name} ({out_path.stat().st_size / 1024:.0f} KB)")
    return True


# ---------------------------------------------------------------------------
# Top 5 imagen
# ---------------------------------------------------------------------------


def _plot_top5(uhi_est: pd.DataFrame, gdf, out_path: Path,
               estacion: str = "verano",
               anio: Optional[int] = None) -> bool:
    if uhi_est.empty:
        logger.warning("UHI estacional vacío — no hay top5 para generar.")
        return False
    if anio is None:
        anio = int(uhi_est["anio"].max())

    sub = uhi_est[
        (uhi_est["anio"] == anio) & (uhi_est["estacion"] == estacion)
    ]
    if sub.empty:
        logger.warning(f"Sin datos para top5 {estacion} {anio}.")
        return False

    top = sub.sort_values("uhi_vs_ciudad_mean", ascending=False).head(5).copy()
    nombres_map = dict(zip(gdf["id"], gdf["nombre"]))
    top["nombre"] = top["poligono_id"].map(nombres_map).fillna(top["poligono_id"])

    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.set_facecolor(COLOR_FONDO)

    bars = ax.barh(
        top["nombre"][::-1],
        top["uhi_vs_ciudad_mean"][::-1],
        color=[plt.get_cmap("magma")(0.5 + 0.1 * i) for i in range(len(top))],
        edgecolor=COLOR_BORDE,
    )

    ax.set_xlabel("UHI vs promedio Posadas (°C)", fontsize=10, color="#222222")
    ax.set_title(
        f"Top 5 barrios más calientes · {estacion.capitalize()} {anio}",
        fontsize=13, fontweight="bold", color=COLOR_BORDE, pad=10,
    )
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="x", linestyle="--", alpha=0.3)

    for bar, val in zip(bars, top["uhi_vs_ciudad_mean"][::-1]):
        ax.text(
            val + 0.1, bar.get_y() + bar.get_height() / 2,
            f"+{val:.1f} °C",
            va="center", ha="left",
            fontsize=9, fontweight="bold", color="#222222",
        )

    _footer(fig, fuente_extra="Fuente: Landsat 8/9 USGS")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=200, bbox_inches="tight", facecolor=COLOR_FONDO)
    plt.close(fig)
    logger.info(f"Top5 PNG → {out_path.name}")
    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(help="Genera mapas PNG + GIF animado de la capa calor.")
@click.option(
    "--tipo",
    type=click.Choice(["estacional", "gif", "top", "todo"]),
    default="todo",
    show_default=True,
)
@click.option("--output-dir", default="data/processed/calor/mapas",
              show_default=True)
@click.option("--nivel-log",
              type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"],
                                case_sensitive=False),
              default="INFO")
def cli(tipo: str, output_dir: str, nivel_log: str) -> None:
    setup_logger(nivel=nivel_log.upper())
    _configurar_matplotlib()

    out = ensure_dir(resolve_path(output_dir))
    gdf, uhi, est, men = _cargar_datos(
        resolve_path("config/poligonos.geojson"),
        resolve_path("data/processed/calor/uhi_por_poligono_mensual.csv"),
        resolve_path("data/processed/calor/uhi_estacional.csv"),
        resolve_path("data/processed/calor/lst_mensual_por_poligono.csv"),
    )

    logger.info(
        f"Inputs: {len(gdf)} polígonos, {len(uhi)} filas UHI mensual, "
        f"{len(est)} filas UHI estacional, {len(men)} stats LST mensual"
    )

    if tipo in ("estacional", "todo"):
        if est.empty:
            logger.warning("UHI estacional vacío — PNGs salteados.")
        else:
            for anio in sorted(est["anio"].astype(int).unique()):
                for estacion in ["verano", "otono", "invierno", "primavera"]:
                    gm = _construir_dataset_estacional(est, gdf, anio, estacion)
                    for metr in ["lst", "uhi_vs_rural", "uhi_vs_ciudad"]:
                        _plot_mapa_estacional(
                            gm, metr, anio, estacion,
                            out / f"{metr}_{anio}_{estacion}.png",
                        )

    if tipo in ("gif", "todo"):
        if uhi.empty:
            logger.warning("UHI mensual vacío — GIF salteado.")
        else:
            _generar_gif_mensual(
                gdf, uhi, out / "evolucion_uhi_vs_ciudad_24m.gif",
                metrica="uhi_vs_ciudad",
            )

    if tipo in ("top", "todo"):
        if est.empty:
            logger.warning("UHI estacional vacío — top5 salteado.")
        else:
            anio_max = int(est["anio"].max())
            for estacion in ["verano", "invierno"]:
                _plot_top5(
                    est, gdf, out / f"top5_calientes_{estacion}_{anio_max}.png",
                    estacion=estacion, anio=anio_max,
                )

    logger.info("Mapas calor generados.")


if __name__ == "__main__":
    cli()
