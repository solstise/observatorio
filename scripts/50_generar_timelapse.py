"""Generación de timelapses animados por polígono (Tarea 1.7).

Pipeline:

1. Para un polígono, listar GeoTIFFs RGB ``{poligono_id}_{YYYYMM}_rgb.tif``
   ordenados por fecha.
2. Para cada frame:
   - Abrir con rasterio y normalizar con stretch percentil 2-98 POR BANDA.
   - Convertir a PIL Image 1080x1080 preservando aspect ratio.
   - Overlay: borde del polígono en blanco semi-transparente, fecha en
     esquina sup-izq (Inter Bold 48px con sombra), conteo de viviendas en
     esquina inf-izq (Inter Regular 32px), atribución en esquina inf-der
     (18px). Cada bloque de texto sobre caja semi-transparente negra para
     contraste.
3. Interpolar N frames (cross-fade) entre fechas originales.
4. Exportar GIF (loop infinito) y MP4 H.264.
5. Generar imagen estática comparación 2x2 (2018, 2021, 2024, 2026).

CLI::

    python scripts/50_generar_timelapse.py \\
        --poligono itaembe_mini --formato both

O para todos::

    python scripts/50_generar_timelapse.py --all
"""

from __future__ import annotations

import logging
import signal
import sys
import time
from pathlib import Path
from typing import Sequence

import click
import geopandas as gpd
import imageio.v2 as imageio
import numpy as np
import pandas as pd
import rasterio
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from rasterio.warp import transform_geom
from tqdm import tqdm

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


# --- Constantes de diseño ---------------------------------------------------

FRAME_SIZE = 1080
COLOR_ACENTO = "#1a3a5c"
COLOR_BLANCO = (255, 255, 255)
COLOR_NEGRO = (0, 0, 0)
CAJA_ALPHA = 100
BORDE_POLIGONO_ALPHA = 180

MESES_ES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}


# --- IO y normalización ------------------------------------------------------


def _listar_geotiffs_rgb(sentinel_dir: Path, poligono_id: str) -> list[tuple[str, Path]]:
    """Devuelve ``[(YYYYMM, path), ...]`` ordenados."""
    resultado: list[tuple[str, Path]] = []
    for p in sentinel_dir.glob(f"{poligono_id}_*_rgb.tif"):
        partes = p.stem.split("_")
        if len(partes) >= 3 and partes[-1] == "rgb":
            candidato = partes[-2]
            if len(candidato) == 6 and candidato.isdigit():
                resultado.append((candidato, p))
    return sorted(resultado, key=lambda t: t[0])


def _fecha_humana(yyyymm: str) -> str:
    mes = int(yyyymm[4:6])
    return f"{MESES_ES.get(mes, str(mes))} {yyyymm[:4]}"


def _stretch_p2_p98(arr: np.ndarray) -> np.ndarray:
    """Stretch por banda a 0-255 usando percentiles 2-98.

    ``arr`` shape (bandas, h, w) o (h, w).
    """
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


def _leer_rgb(path: Path) -> tuple[np.ndarray, rasterio.Affine, str | None]:
    """Lee GeoTIFF RGB y devuelve (array uint8 HxWxC, transform, crs_str)."""
    with rasterio.open(path) as ds:
        data = ds.read()  # (bands, h, w)
        transform = ds.transform
        crs_str = ds.crs.to_string() if ds.crs else None
    if data.shape[0] >= 3:
        rgb = data[:3]
    else:
        rgb = np.concatenate([data, data, data], axis=0)[:3]
    # Si ya viene en 8 bits y saturado, respetamos; si no, stretcheamos.
    if rgb.dtype != np.uint8 or rgb.max() < 40:
        rgb = _stretch_p2_p98(rgb)
    rgb_hwc = np.transpose(rgb, (1, 2, 0))
    return rgb_hwc, transform, crs_str


# --- Overlays con PIL --------------------------------------------------------


def _cargar_fuente(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Busca Inter en ``templates/static/fonts/``; si no, fallback."""
    candidatos = [
        Path("templates/static/fonts") / ("Inter-Bold.ttf" if bold else "Inter-Regular.ttf"),
        Path("templates/static/fonts") / "Inter.ttf",
    ]
    for c in candidatos:
        if c.exists():
            try:
                return ImageFont.truetype(str(c), size=size)
            except Exception:  # noqa: BLE001
                continue
    # Fallback genérico
    try:
        return ImageFont.truetype("arial.ttf", size=size)
    except Exception:  # noqa: BLE001
        logger.warning(
            "Fuente Inter/Arial no disponible — usando fuente default de PIL (baja calidad)."
        )
        return ImageFont.load_default()


def _coords_a_pixel(geom, transform, img_w: int, img_h: int, src_w: int, src_h: int):
    """Transforma coordenadas georreferenciadas a pixeles del frame redimensionado."""
    def _one(ring):
        pts = []
        for x, y in ring:
            col, row = ~transform * (x, y)
            px = col * (img_w / src_w)
            py = row * (img_h / src_h)
            pts.append((px, py))
        return pts

    if geom.geom_type == "Polygon":
        return [_one(list(geom.exterior.coords))]
    if geom.geom_type == "MultiPolygon":
        return [_one(list(p.exterior.coords)) for p in geom.geoms]
    return []


def _dibujar_caja_con_texto(
    draw: ImageDraw.ImageDraw,
    pos: tuple[int, int],
    texto: str,
    fuente: ImageFont.ImageFont,
    anchor: str = "lt",
    padding: int = 12,
) -> None:
    """Dibuja una caja semi-transparente negra detrás del texto, y el texto."""
    # Calculamos bbox del texto con esa fuente.
    try:
        bbox = draw.textbbox(pos, texto, font=fuente, anchor=anchor)
    except Exception:  # compatibilidad con versiones viejas
        w, h = draw.textsize(texto, font=fuente)
        bbox = (pos[0], pos[1], pos[0] + w, pos[1] + h)
    x0, y0, x1, y1 = bbox
    x0 -= padding
    y0 -= padding
    x1 += padding
    y1 += padding
    draw.rectangle([x0, y0, x1, y1], fill=(0, 0, 0, CAJA_ALPHA))
    # Sombra sutil (offset +2,+2 negro semi)
    try:
        draw.text(
            (pos[0] + 2, pos[1] + 2), texto, font=fuente, anchor=anchor,
            fill=(0, 0, 0, 200),
        )
    except TypeError:
        draw.text((pos[0] + 2, pos[1] + 2), texto, font=fuente, fill=(0, 0, 0))
    try:
        draw.text(pos, texto, font=fuente, anchor=anchor, fill=COLOR_BLANCO)
    except TypeError:
        draw.text(pos, texto, font=fuente, fill=COLOR_BLANCO)


def _dibujar_frame(
    base_rgb: np.ndarray,
    transform,
    src_crs: str | None,
    poligono_geom_4326,
    fecha_humana: str,
    viviendas_texto: str,
    atribucion: str,
) -> Image.Image:
    """Genera el frame final 1080x1080 con overlays."""
    src_h, src_w = base_rgb.shape[:2]
    img = Image.fromarray(base_rgb).convert("RGBA")
    # Resize manteniendo aspect ratio dentro de un lienzo cuadrado.
    ratio = min(FRAME_SIZE / src_w, FRAME_SIZE / src_h)
    new_w = max(1, int(src_w * ratio))
    new_h = max(1, int(src_h * ratio))
    img = img.resize((new_w, new_h), Image.BICUBIC)
    canvas = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), COLOR_NEGRO + (255,))
    off_x = (FRAME_SIZE - new_w) // 2
    off_y = (FRAME_SIZE - new_h) // 2
    canvas.paste(img, (off_x, off_y))

    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # --- Borde polígono ---
    try:
        if poligono_geom_4326 is not None and src_crs is not None:
            geom_src = transform_geom("EPSG:4326", src_crs, poligono_geom_4326.__geo_interface__)
            from shapely.geometry import shape as _shape
            geom_raster = _shape(geom_src)
            anillos = _coords_a_pixel(geom_raster, transform, new_w, new_h, src_w, src_h)
            for ring in anillos:
                ring_canvas = [(x + off_x, y + off_y) for (x, y) in ring]
                draw.line(
                    ring_canvas + [ring_canvas[0]],
                    fill=COLOR_BLANCO + (BORDE_POLIGONO_ALPHA,),
                    width=2,
                )
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"Overlay de polígono falló: {exc}")

    # --- Textos ---
    fuente_fecha = _cargar_fuente(48, bold=True)
    fuente_viviendas = _cargar_fuente(32, bold=False)
    fuente_atrib = _cargar_fuente(18, bold=False)

    margen = 40
    # Fecha sup-izq
    _dibujar_caja_con_texto(
        draw, (margen, margen), fecha_humana, fuente_fecha, anchor="lt", padding=14
    )
    # Viviendas inf-izq
    _dibujar_caja_con_texto(
        draw, (margen, FRAME_SIZE - margen),
        viviendas_texto, fuente_viviendas, anchor="lb", padding=10,
    )
    # Atribución inf-der
    _dibujar_caja_con_texto(
        draw, (FRAME_SIZE - margen, FRAME_SIZE - margen),
        atribucion, fuente_atrib, anchor="rb", padding=8,
    )

    canvas = Image.alpha_composite(canvas, overlay)
    return canvas.convert("RGB")


# --- Cross-fade --------------------------------------------------------------


def _cross_fade(a: Image.Image, b: Image.Image, n: int) -> list[Image.Image]:
    """Genera N frames intermedios entre a y b. No incluye a ni b."""
    if n <= 0:
        return []
    out: list[Image.Image] = []
    for i in range(1, n + 1):
        alpha = i / (n + 1)
        out.append(Image.blend(a, b, alpha))
    return out


# --- Comparación 2x2 ---------------------------------------------------------


FECHAS_COMPARACION = ["2018", "2021", "2024", "2026"]


def _generar_comparacion_2x2(
    poligono_id: str,
    nombre_poligono: str,
    frames_por_anio: dict[str, Image.Image],
    out_path: Path,
) -> None:
    """Arma imagen 2x2 (2018, 2021, 2024, 2026) con sub-títulos."""
    seleccion: list[tuple[str, Image.Image]] = []
    for anio in FECHAS_COMPARACION:
        frame = frames_por_anio.get(anio)
        if frame is None:
            continue
        seleccion.append((anio, frame))
    if len(seleccion) < 2:
        logger.warning(
            "Comparación 2x2 para '%s': solo %d años disponibles, no generamos.",
            poligono_id,
            len(seleccion),
        )
        return
    celda = 720
    gap = 16
    titulo_h = 80
    sub_h = 56
    ancho = celda * 2 + gap * 3
    alto = titulo_h + celda * 2 + gap * 3 + sub_h * 2
    lienzo = Image.new("RGB", (ancho, alto), "white")
    draw = ImageDraw.Draw(lienzo)

    fuente_titulo = _cargar_fuente(40, bold=True)
    fuente_sub = _cargar_fuente(28, bold=True)
    fuente_footer = _cargar_fuente(16, bold=False)

    titulo = f"Evolución urbana — {nombre_poligono}"
    try:
        draw.text((ancho // 2, titulo_h // 2), titulo, font=fuente_titulo,
                  fill=COLOR_ACENTO, anchor="mm")
    except TypeError:
        draw.text((40, 20), titulo, font=fuente_titulo, fill=COLOR_ACENTO)

    for idx, (anio, frame) in enumerate(seleccion[:4]):
        col = idx % 2
        row = idx // 2
        x = gap + col * (celda + gap)
        y = titulo_h + gap + row * (celda + gap + sub_h)
        thumb = frame.copy().resize((celda, celda), Image.BICUBIC)
        lienzo.paste(thumb, (x, y))
        try:
            draw.text(
                (x + celda // 2, y + celda + sub_h // 2),
                anio, font=fuente_sub, fill=COLOR_ACENTO, anchor="mm",
            )
        except TypeError:
            draw.text((x, y + celda + 8), anio, font=fuente_sub, fill=COLOR_ACENTO)

    footer = "Fuente: Sentinel-2 / ESA Copernicus — Observatorio Urbano Posadas"
    try:
        draw.text((ancho // 2, alto - 12), footer, font=fuente_footer,
                  fill=(60, 60, 60), anchor="mb")
    except TypeError:
        draw.text((20, alto - 24), footer, font=fuente_footer, fill=(60, 60, 60))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    lienzo.save(out_path, "PNG")
    logger.info(f"Comparación 2x2 guardada -> {out_path}")


# --- Main por polígono -------------------------------------------------------


def _serie_conteos(serie_path: Path, poligono_id: str) -> dict[str, tuple[int, int, int]]:
    """Devuelve ``{fecha: (min, est, max)}`` para un polígono."""
    if not serie_path.exists():
        return {}
    df = pd.read_csv(serie_path)
    sub = df[df["poligono_id"] == poligono_id]
    return {
        row["fecha"]: (
            int(row["n_edificios_min"]),
            int(row["n_edificios_estimado"]),
            int(row["n_edificios_max"]),
        )
        for _, row in sub.iterrows()
    }


def _generar_para_poligono(
    poligono_id: str,
    poligono_nombre: str,
    poligono_geom,
    sentinel_dir: Path,
    serie_conteos: dict[str, tuple[int, int, int]],
    output_dir: Path,
    formato: str,
    fps: int,
    interpolar: int,
) -> None:
    tiffs = _listar_geotiffs_rgb(sentinel_dir, poligono_id)
    if len(tiffs) < 2:
        logger.warning(
            f"Polígono '{poligono_id}' tiene {len(tiffs)} GeoTIFFs RGB — "
            f"se necesita ≥2. Skip."
        )
        return
    logger.info(f"Polígono '{poligono_id}': {len(tiffs)} frames base")

    atribucion = "Fuente: Sentinel-2 / ESA Copernicus"
    frames: list[Image.Image] = []
    frames_por_anio: dict[str, Image.Image] = {}

    for yyyymm, path in tqdm(tiffs, desc=f"Frames {poligono_id}"):
        try:
            rgb, transform, src_crs = _leer_rgb(path)
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"No se pudo leer {path}: {exc}")
            continue
        fecha_iso = f"{yyyymm[:4]}-{yyyymm[4:6]}"
        cont = serie_conteos.get(fecha_iso)
        if cont:
            n_min, n_est, n_max = cont
            delta = max(n_est - n_min, n_max - n_est)
            viviendas_txt = f"Viviendas: {n_est} ± {delta}"
        else:
            viviendas_txt = "Viviendas: s/d"
        frame = _dibujar_frame(
            rgb, transform, src_crs, poligono_geom,
            _fecha_humana(yyyymm), viviendas_txt, atribucion,
        )
        frames.append(frame)
        frames_por_anio[yyyymm[:4]] = frame

    if len(frames) < 2:
        logger.warning(f"Polígono '{poligono_id}': no hay frames válidos suficientes.")
        return

    # Cross-fade.
    if interpolar > 0:
        extendidos: list[Image.Image] = [frames[0]]
        for i in range(len(frames) - 1):
            extendidos.extend(_cross_fade(frames[i], frames[i + 1], interpolar))
            extendidos.append(frames[i + 1])
        frames_final = extendidos
        fps_efectivo = fps * (interpolar + 1)
    else:
        frames_final = frames
        fps_efectivo = fps

    output_dir.mkdir(parents=True, exist_ok=True)
    formato = formato.lower()

    arrays = [np.array(f) for f in frames_final]

    if formato in ("gif", "both"):
        gif_path = output_dir / f"{poligono_id}.gif"
        try:
            imageio.mimsave(
                gif_path, arrays, duration=1.0 / max(fps_efectivo, 1), loop=0,
            )
            dur_gif = len(arrays) / max(fps_efectivo, 1)
            logger.info(f"GIF -> {gif_path} ({dur_gif:.1f}s)")
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"Error exportando GIF: {exc}")

    if formato in ("mp4", "both"):
        mp4_path = output_dir / f"{poligono_id}.mp4"
        try:
            imageio.mimsave(
                mp4_path, arrays, fps=fps_efectivo, codec="h264", quality=8,
            )
            logger.info(f"MP4 -> {mp4_path}")
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"Error exportando MP4 (necesitás imageio-ffmpeg / ffmpeg "
                f"en PATH): {exc}"
            )

    comp_path = output_dir / f"{poligono_id}_comparacion.png"
    _generar_comparacion_2x2(poligono_id, poligono_nombre, frames_por_anio, comp_path)


# --- CLI ---------------------------------------------------------------------


@click.command(help="Genera timelapse GIF+MP4 por polígono (Tarea 1.7).")
@click.option("--poligono", type=str, default=None, help="ID específico (ej. itaembe_mini)")
@click.option("--all", "all_flag", is_flag=True, default=False, help="Procesar todos")
@click.option(
    "--poligonos",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=Path("config/poligonos.geojson"),
    show_default=True,
)
@click.option(
    "--sentinel-dir",
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    default=Path("data/raw/sentinel2"),
    show_default=True,
)
@click.option(
    "--serie-temporal",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("data/processed/conteos/serie_temporal.csv"),
    show_default=True,
)
@click.option(
    "--output-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("data/processed/timelapses"),
    show_default=True,
)
@click.option("--formato", type=click.Choice(["gif", "mp4", "both"]), default="both")
@click.option("--fps", type=int, default=1, show_default=True,
              help="Frames por segundo en las fechas originales")
@click.option("--interpolar-frames", "interpolar", type=int, default=4, show_default=True,
              help="Frames de cross-fade entre cada par de fechas originales")
def cli(
    poligono: str | None,
    all_flag: bool,
    poligonos: Path,
    sentinel_dir: Path,
    serie_temporal: Path,
    output_dir: Path,
    formato: str,
    fps: int,
    interpolar: int,
) -> None:
    """Entry point CLI."""
    t0 = time.time()
    logger.info("=" * 60)
    logger.info("Observatorio Posadas — Timelapses (Tarea 1.7)")
    logger.info("=" * 60)
    if not poligono and not all_flag:
        raise click.UsageError("Indicá --poligono ID o --all")

    gdf = gpd.read_file(poligonos)
    if gdf.crs is None:
        gdf = gdf.set_crs(epsg=4326)
    else:
        gdf = gdf.to_crs(epsg=4326)

    if all_flag:
        seleccion = gdf
    else:
        seleccion = gdf[gdf["id"].astype(str) == poligono]
        if seleccion.empty:
            logger.error(f"No se encontró polígono '{poligono}' en {poligonos}")
            sys.exit(1)

    def _handler(signum, frame):  # noqa: ANN001
        logger.warning(f"Interrupción ({signum}) — salida.")
        sys.exit(130)

    signal.signal(signal.SIGINT, _handler)

    for _, fila in seleccion.iterrows():
        pid = str(fila["id"])
        nombre = str(fila.get("nombre", pid))
        serie_p = _serie_conteos(serie_temporal, pid)
        try:
            _generar_para_poligono(
                poligono_id=pid,
                poligono_nombre=nombre,
                poligono_geom=fila.geometry,
                sentinel_dir=sentinel_dir,
                serie_conteos=serie_p,
                output_dir=output_dir,
                formato=formato,
                fps=fps,
                interpolar=interpolar,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception(f"Falla en polígono '{pid}': {exc}")

    logger.info(f"Duración total: {time.time() - t0:.1f}s")


if __name__ == "__main__":
    cli()
