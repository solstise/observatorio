"""Generación de comparaciones HD (antes/después) por polígono.

Para cada polígono, arma un PNG único horizontal con:

1. Encabezado con el nombre del barrio + subtítulo del observatorio.
2. Dos imágenes Sentinel-2 RGB lado a lado: primera fecha disponible (antes)
   y última fecha disponible (después) en la serie temporal del CSV.
3. Debajo de cada imagen, la fecha legible en español y el conteo de
   viviendas detectadas tomado de ``data/processed/conteos/serie_temporal.csv``.
4. Footer con fuentes y metodología.

Calidad HD:

- Cada imagen central se upscalea con Lanczos a ``--ancho-imagen`` píxeles
  (default 1200), dando un PNG total ≥ 2400 px de ancho.
- Se aplica stretch de percentiles 2-98 por banda (mismo criterio que
  ``01_descarga_sentinel``).
- Se intenta dibujar el outline del polígono reproyectado al CRS del
  raster; si falla, se deja la imagen sin overlay (mejor limpia que
  desalineada).

Fuentes: busca Inter en ``templates/static/fonts/``; si no está, cae a
DejaVuSans del sistema y loggea un warning.

Ejemplo::

    python scripts/70_generar_comparaciones_hd.py --all
    python scripts/70_generar_comparaciones_hd.py --poligono itaembe_guazu
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

import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import click
import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from PIL import Image, ImageDraw, ImageFont
from rasterio.warp import transform_geom

from scripts.utils.interrupts import graceful_interrupt
from scripts.utils.logger import get_logger, setup_logger
from scripts.utils.paths import ensure_dir, resolve_path


logger = get_logger(__name__)


# --- Constantes de diseño ---------------------------------------------------

COLOR_ACENTO = "#1a3a5c"
COLOR_ACENTO_RGB = (26, 58, 92)
COLOR_GRIS_SUB = (110, 110, 110)
COLOR_GRIS_FOOTER = (85, 85, 85)
COLOR_BLANCO = (255, 255, 255)
COLOR_BORDE = (217, 217, 217)
COLOR_FONDO = (255, 255, 255)

ALTO_ENCABEZADO = 140
ALTO_LABEL_FECHA = 64
ALTO_LABEL_CONTEO = 40
ALTO_FOOTER = 56
GAP_IMAGENES = 24
MARGEN_LATERAL = 48
MARGEN_SUPERIOR = 32
MARGEN_INFERIOR = 24
PADDING_LABEL_TOP = 18
PADDING_LABEL_BOTTOM = 18

BORDE_POLIGONO_ALPHA = 180

MESES_ES = {
    "01": "ENERO", "02": "FEBRERO", "03": "MARZO", "04": "ABRIL",
    "05": "MAYO", "06": "JUNIO", "07": "JULIO", "08": "AGOSTO",
    "09": "SEPTIEMBRE", "10": "OCTUBRE", "11": "NOVIEMBRE", "12": "DICIEMBRE",
}

VERSION_OBSERVATORIO = "0.1.0"


# --- Fuentes ----------------------------------------------------------------


def _candidatos_fuente(bold: bool) -> list[Path]:
    """Lista ordenada de paths a probar para cargar la fuente."""
    nombre_inter = "Inter-Bold.ttf" if bold else "Inter-Regular.ttf"
    nombre_dejavu = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    candidatos = [
        resolve_path(f"templates/static/fonts/{nombre_inter}"),
        resolve_path("templates/static/fonts/Inter.ttf"),
        Path(f"/usr/share/fonts/truetype/dejavu/{nombre_dejavu}"),
        Path(f"/usr/share/fonts/TTF/{nombre_dejavu}"),
        Path(f"C:/Windows/Fonts/{nombre_dejavu.lower()}"),
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
    ]
    return candidatos


_WARN_INTER_EMITIDO = False


def cargar_fuente(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Carga fuente Inter si existe; cae a DejaVuSans y loggea warning.

    Args:
        size: Tamaño en píxeles.
        bold: Si True, pide variante Bold.

    Returns:
        Objeto ``ImageFont`` listo para dibujar. Nunca levanta.
    """
    global _WARN_INTER_EMITIDO
    inter_path = resolve_path(
        f"templates/static/fonts/{'Inter-Bold.ttf' if bold else 'Inter-Regular.ttf'}"
    )
    if not inter_path.exists() and not _WARN_INTER_EMITIDO:
        logger.warning(
            "Fuente Inter no encontrada en templates/static/fonts — "
            "caigo a DejaVuSans / Arial. Descargá Inter para mejor calidad."
        )
        _WARN_INTER_EMITIDO = True

    for candidato in _candidatos_fuente(bold):
        if candidato.exists():
            try:
                return ImageFont.truetype(str(candidato), size=size)
            except Exception as exc:  # noqa: BLE001
                logger.debug(f"No pude cargar fuente {candidato}: {exc}")
                continue

    logger.warning(
        f"Ninguna fuente TTF disponible (size={size}, bold={bold}) — "
        "usando fuente default de PIL (baja calidad)."
    )
    return ImageFont.load_default()


# --- IO y normalización de rasters ------------------------------------------


def _stretch_p2_p98(arr: np.ndarray) -> np.ndarray:
    """Stretch por banda a 0-255 usando percentiles 2-98.

    Descarta ceros y NaN al calcular los percentiles para evitar que
    píxeles vacíos chapeen el histograma.

    Args:
        arr: Array ``(bandas, h, w)`` o ``(h, w)``.

    Returns:
        Array ``uint8`` del mismo shape.
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


def leer_rgb_tiff(path: Path) -> tuple[np.ndarray, rasterio.Affine, Optional[str]]:
    """Lee un GeoTIFF RGB y devuelve ``(array HxWxC uint8, transform, crs_str)``.

    Aplica stretch 2-98 si el GeoTIFF no viene ya saturado en 8 bits.

    Args:
        path: Ruta al GeoTIFF.

    Returns:
        Tupla ``(rgb_hwc, transform, crs_str)`` — ``crs_str`` puede ser None.
    """
    with rasterio.open(path) as ds:
        data = ds.read()  # (bands, h, w)
        transform = ds.transform
        crs_str = ds.crs.to_string() if ds.crs else None

    if data.shape[0] >= 3:
        rgb = data[:3]
    else:
        rgb = np.concatenate([data, data, data], axis=0)[:3]

    # Si viene en uint8 y bien saturado, no hace falta stretch;
    # en caso contrario reestiramos con p2-p98.
    if rgb.dtype != np.uint8 or int(rgb.max()) < 40:
        rgb = _stretch_p2_p98(rgb)

    rgb_hwc = np.transpose(rgb, (1, 2, 0))
    return rgb_hwc, transform, crs_str


# --- Overlay del polígono ---------------------------------------------------


def _coords_a_pixel(geom, transform, dst_w: int, dst_h: int, src_w: int, src_h: int):
    """Convierte geometría georreferenciada a píxeles del canvas redimensionado.

    Devuelve una lista de anillos, cada uno como lista de ``(x, y)`` en
    coordenadas del canvas destino.
    """
    def _un_anillo(ring):
        pts = []
        for x, y in ring:
            col, row = ~transform * (x, y)
            px = col * (dst_w / src_w)
            py = row * (dst_h / src_h)
            pts.append((px, py))
        return pts

    if geom.geom_type == "Polygon":
        return [_un_anillo(list(geom.exterior.coords))]
    if geom.geom_type == "MultiPolygon":
        return [_un_anillo(list(p.exterior.coords)) for p in geom.geoms]
    return []


def dibujar_overlay_poligono(
    img_rgba: Image.Image,
    poligono_geom_4326,
    transform,
    src_crs: Optional[str],
    src_w: int,
    src_h: int,
) -> Image.Image:
    """Dibuja el outline del polígono sobre la imagen (con halo blanco).

    Si algo falla (CRS faltante, geometría rara, etc.), loggea debug y
    devuelve la imagen sin cambios — mejor una imagen limpia que una con
    overlay mal alineado.

    Args:
        img_rgba: Imagen RGBA ya redimensionada al tamaño destino.
        poligono_geom_4326: ``shapely`` geom en EPSG:4326.
        transform: ``rasterio.Affine`` del raster original.
        src_crs: CRS del raster como string.
        src_w, src_h: Dimensiones originales del raster.

    Returns:
        Nueva imagen RGBA con el outline compuesto encima.
    """
    if poligono_geom_4326 is None or src_crs is None:
        return img_rgba

    try:
        from shapely.geometry import shape as _shape

        geom_src = transform_geom("EPSG:4326", src_crs, poligono_geom_4326.__geo_interface__)
        geom_raster = _shape(geom_src)
        dst_w, dst_h = img_rgba.size
        anillos = _coords_a_pixel(geom_raster, transform, dst_w, dst_h, src_w, src_h)
        if not anillos:
            return img_rgba

        overlay = Image.new("RGBA", img_rgba.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        for ring in anillos:
            puntos = ring + [ring[0]]
            # Halo negro sutil para contraste.
            draw.line(puntos, fill=(0, 0, 0, 120), width=5)
            # Línea blanca principal.
            draw.line(puntos, fill=(255, 255, 255, BORDE_POLIGONO_ALPHA), width=3)
        return Image.alpha_composite(img_rgba, overlay)
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"Overlay de polígono no se pudo dibujar: {exc}")
        return img_rgba


# --- Construcción del PNG final ---------------------------------------------


def _fecha_humana(fecha_iso: str) -> str:
    """``'2018-07'`` → ``'JULIO 2018'``."""
    if len(fecha_iso) < 7 or fecha_iso[4] != "-":
        return fecha_iso.upper()
    anio = fecha_iso[:4]
    mes = fecha_iso[5:7]
    return f"{MESES_ES.get(mes, mes)} {anio}"


def _texto_conteo(conteos: Optional[tuple[int, int, int]]) -> str:
    """Formatea el conteo de viviendas para mostrar bajo la imagen."""
    if conteos is None:
        return "sin datos de conteo"
    n_min, n_est, n_max = conteos
    delta = max(n_est - n_min, n_max - n_est)
    return f"{n_est:,} viviendas detectadas (± {delta:,})".replace(",", ".")


def _preparar_panel_imagen(
    tiff_path: Path,
    poligono_geom_4326,
    ancho_target: int,
) -> tuple[Image.Image, int]:
    """Abre GeoTIFF, aplica stretch, upscalea con Lanczos y agrega overlay.

    Returns:
        Tupla ``(imagen_RGBA, alto_result)``. El ancho final es exactamente
        ``ancho_target``. El alto mantiene el aspect ratio del raster.
    """
    rgb_hwc, transform, src_crs = leer_rgb_tiff(tiff_path)
    src_h, src_w = rgb_hwc.shape[:2]

    # Resize con Lanczos para máxima calidad (upscale desde ~200-400 px).
    ratio = ancho_target / src_w
    dst_w = ancho_target
    dst_h = max(1, int(round(src_h * ratio)))

    img = Image.fromarray(rgb_hwc).convert("RGBA")
    img = img.resize((dst_w, dst_h), Image.LANCZOS)

    img = dibujar_overlay_poligono(
        img_rgba=img,
        poligono_geom_4326=poligono_geom_4326,
        transform=transform,
        src_crs=src_crs,
        src_w=src_w,
        src_h=src_h,
    )
    return img, dst_h


def _pegar_panel_con_borde(
    canvas: Image.Image,
    panel: Image.Image,
    x: int,
    y: int,
) -> None:
    """Pega un panel de imagen con un borde sutil de 1px alrededor."""
    canvas.paste(panel, (x, y), panel)
    draw = ImageDraw.Draw(canvas)
    w, h = panel.size
    draw.rectangle([x, y, x + w - 1, y + h - 1], outline=COLOR_BORDE, width=1)


def _dibujar_label_debajo(
    draw: ImageDraw.ImageDraw,
    centro_x: int,
    y_top: int,
    ancho_panel: int,
    fecha_legible: str,
    texto_conteo: str,
    fuente_fecha: ImageFont.ImageFont,
    fuente_conteo: ImageFont.ImageFont,
) -> None:
    """Dibuja label centrado bajo un panel: fecha grande + conteo chico."""
    y = y_top + PADDING_LABEL_TOP
    try:
        draw.text(
            (centro_x, y),
            fecha_legible,
            font=fuente_fecha,
            fill=COLOR_ACENTO_RGB,
            anchor="mt",
        )
    except TypeError:
        draw.text((centro_x - ancho_panel // 2, y), fecha_legible,
                  font=fuente_fecha, fill=COLOR_ACENTO_RGB)

    y += ALTO_LABEL_FECHA - PADDING_LABEL_TOP
    try:
        draw.text(
            (centro_x, y),
            texto_conteo,
            font=fuente_conteo,
            fill=COLOR_GRIS_SUB,
            anchor="mt",
        )
    except TypeError:
        draw.text((centro_x - ancho_panel // 2, y), texto_conteo,
                  font=fuente_conteo, fill=COLOR_GRIS_SUB)


def armar_comparacion(
    poligono_id: str,
    nombre_poligono: str,
    poligono_geom_4326,
    tiff_antes: Path,
    tiff_despues: Path,
    fecha_antes: str,
    fecha_despues: str,
    conteos_antes: Optional[tuple[int, int, int]],
    conteos_despues: Optional[tuple[int, int, int]],
    ancho_imagen: int,
) -> Image.Image:
    """Arma el PNG completo de comparación antes/después para un polígono.

    Args:
        poligono_id: ID para logs.
        nombre_poligono: Nombre legible (ej. "Itaembé Guazú").
        poligono_geom_4326: Geom ``shapely`` en EPSG:4326.
        tiff_antes, tiff_despues: Paths a los GeoTIFF RGB.
        fecha_antes, fecha_despues: Strings ISO ``YYYY-MM``.
        conteos_antes, conteos_despues: ``(min, est, max)`` o None.
        ancho_imagen: Ancho en px de cada imagen central.

    Returns:
        Imagen PIL en modo RGB lista para guardar.
    """
    logger.info(f"Preparando paneles para '{poligono_id}'...")
    panel_antes, alto_antes = _preparar_panel_imagen(
        tiff_antes, poligono_geom_4326, ancho_imagen
    )
    panel_despues, alto_despues = _preparar_panel_imagen(
        tiff_despues, poligono_geom_4326, ancho_imagen
    )

    # Si aspect ratios difieren (no debería, mismo polígono), llevo ambos
    # al alto máximo paddeando con blanco para alinearlos.
    alto_imagen = max(alto_antes, alto_despues)
    if alto_antes != alto_imagen:
        nueva = Image.new("RGBA", (ancho_imagen, alto_imagen), COLOR_FONDO + (255,))
        nueva.paste(panel_antes, (0, (alto_imagen - alto_antes) // 2), panel_antes)
        panel_antes = nueva
    if alto_despues != alto_imagen:
        nueva = Image.new("RGBA", (ancho_imagen, alto_imagen), COLOR_FONDO + (255,))
        nueva.paste(panel_despues, (0, (alto_imagen - alto_despues) // 2), panel_despues)
        panel_despues = nueva

    ancho_total = MARGEN_LATERAL * 2 + ancho_imagen * 2 + GAP_IMAGENES
    alto_total = (
        ALTO_ENCABEZADO
        + alto_imagen
        + ALTO_LABEL_FECHA
        + ALTO_LABEL_CONTEO
        + PADDING_LABEL_BOTTOM
        + ALTO_FOOTER
    )

    canvas = Image.new("RGB", (ancho_total, alto_total), COLOR_FONDO)
    draw = ImageDraw.Draw(canvas)

    # --- Encabezado ---
    fuente_titulo = cargar_fuente(48, bold=True)
    fuente_subtitulo = cargar_fuente(20, bold=False)
    titulo = f"BARRIO: {nombre_poligono}"
    subtitulo = "Observatorio Urbano Posadas"

    try:
        draw.text(
            (ancho_total // 2, MARGEN_SUPERIOR),
            titulo,
            font=fuente_titulo,
            fill=COLOR_ACENTO_RGB,
            anchor="mt",
        )
        draw.text(
            (ancho_total // 2, MARGEN_SUPERIOR + 62),
            subtitulo,
            font=fuente_subtitulo,
            fill=COLOR_GRIS_SUB,
            anchor="mt",
        )
    except TypeError:
        draw.text((MARGEN_LATERAL, MARGEN_SUPERIOR), titulo,
                  font=fuente_titulo, fill=COLOR_ACENTO_RGB)
        draw.text((MARGEN_LATERAL, MARGEN_SUPERIOR + 62), subtitulo,
                  font=fuente_subtitulo, fill=COLOR_GRIS_SUB)

    # --- Paneles de imágenes ---
    y_imagenes = ALTO_ENCABEZADO
    x_antes = MARGEN_LATERAL
    x_despues = MARGEN_LATERAL + ancho_imagen + GAP_IMAGENES

    _pegar_panel_con_borde(canvas, panel_antes, x_antes, y_imagenes)
    _pegar_panel_con_borde(canvas, panel_despues, x_despues, y_imagenes)

    # Re-creo draw porque paste sobre canvas RGB invalida el draw anterior
    # por cache de referencia (no es estrictamente necesario en PIL moderno,
    # pero evita bugs sutiles).
    draw = ImageDraw.Draw(canvas)

    # --- Labels debajo de cada imagen ---
    fuente_fecha = cargar_fuente(36, bold=True)
    fuente_conteo = cargar_fuente(20, bold=False)
    y_labels = y_imagenes + alto_imagen

    _dibujar_label_debajo(
        draw,
        centro_x=x_antes + ancho_imagen // 2,
        y_top=y_labels,
        ancho_panel=ancho_imagen,
        fecha_legible=_fecha_humana(fecha_antes),
        texto_conteo=_texto_conteo(conteos_antes),
        fuente_fecha=fuente_fecha,
        fuente_conteo=fuente_conteo,
    )
    _dibujar_label_debajo(
        draw,
        centro_x=x_despues + ancho_imagen // 2,
        y_top=y_labels,
        ancho_panel=ancho_imagen,
        fecha_legible=_fecha_humana(fecha_despues),
        texto_conteo=_texto_conteo(conteos_despues),
        fuente_fecha=fuente_fecha,
        fuente_conteo=fuente_conteo,
    )

    # --- Footer ---
    fuente_footer = cargar_fuente(14, bold=False)
    fecha_gen = datetime.now().strftime("%Y-%m-%d")
    footer = (
        f"Fuente: Sentinel-2 / ESA Copernicus  -  "
        f"Detección: Google Open Buildings v3  -  "
        f"Margen ±15%  -  "
        f"Observatorio Urbano Posadas v{VERSION_OBSERVATORIO}  -  "
        f"Generado {fecha_gen}"
    )
    y_footer = alto_total - ALTO_FOOTER // 2
    try:
        draw.text(
            (ancho_total // 2, y_footer),
            footer,
            font=fuente_footer,
            fill=COLOR_GRIS_FOOTER,
            anchor="mm",
        )
    except TypeError:
        draw.text((MARGEN_LATERAL, y_footer), footer,
                  font=fuente_footer, fill=COLOR_GRIS_FOOTER)

    return canvas


# --- Serie temporal ---------------------------------------------------------


def _cargar_serie_temporal(path: Path) -> pd.DataFrame:
    """Carga el CSV de serie temporal y valida columnas mínimas."""
    if not path.exists():
        raise FileNotFoundError(f"No existe el CSV de serie temporal: {path}")
    df = pd.read_csv(path)
    requeridas = {"poligono_id", "fecha", "n_edificios_min",
                  "n_edificios_estimado", "n_edificios_max"}
    faltan = requeridas - set(df.columns)
    if faltan:
        raise ValueError(f"CSV {path} le faltan columnas: {sorted(faltan)}")
    return df


def _fechas_extremos_y_conteos(
    df_serie: pd.DataFrame,
    poligono_id: str,
) -> Optional[tuple[str, str, tuple[int, int, int], tuple[int, int, int]]]:
    """Devuelve ``(fecha_antes, fecha_despues, conteos_antes, conteos_despues)``.

    Toma la primera y última fecha disponibles para ese polígono en el CSV
    (ordenando por string ``YYYY-MM``). Si hay una sola fecha o ninguna,
    devuelve None.
    """
    sub = df_serie[df_serie["poligono_id"] == poligono_id].copy()
    if sub.empty:
        return None
    sub = sub.sort_values("fecha")
    if len(sub) < 2:
        logger.warning(
            f"Polígono '{poligono_id}' tiene {len(sub)} fecha(s) en la serie — "
            "se necesitan al menos 2 para comparar."
        )
        return None

    fila_antes = sub.iloc[0]
    fila_despues = sub.iloc[-1]

    def _conteos(fila) -> tuple[int, int, int]:
        return (
            int(fila["n_edificios_min"]),
            int(fila["n_edificios_estimado"]),
            int(fila["n_edificios_max"]),
        )

    return (
        str(fila_antes["fecha"]),
        str(fila_despues["fecha"]),
        _conteos(fila_antes),
        _conteos(fila_despues),
    )


def _buscar_tiff_rgb(sentinel_dir: Path, poligono_id: str, fecha_iso: str) -> Optional[Path]:
    """Resuelve la ruta al GeoTIFF RGB ``{poligono}_{YYYYMM}_rgb.tif``."""
    if len(fecha_iso) < 7:
        return None
    yyyymm = fecha_iso[:4] + fecha_iso[5:7]
    candidato = sentinel_dir / f"{poligono_id}_{yyyymm}_rgb.tif"
    if candidato.exists():
        return candidato
    logger.warning(f"No se encontró GeoTIFF esperado: {candidato}")
    return None


# --- Pipeline por polígono --------------------------------------------------


def generar_comparacion_poligono(
    poligono_id: str,
    nombre_poligono: str,
    poligono_geom_4326,
    df_serie: pd.DataFrame,
    sentinel_dir: Path,
    output_dir: Path,
    ancho_imagen: int,
) -> Optional[Path]:
    """Genera el PNG de comparación para un polígono y lo guarda.

    Returns:
        Path al PNG generado, o None si no se pudo generar.
    """
    logger.info("=" * 60)
    logger.info(f"Procesando polígono: '{poligono_id}' ({nombre_poligono})")

    extremos = _fechas_extremos_y_conteos(df_serie, poligono_id)
    if extremos is None:
        logger.warning(f"Skip '{poligono_id}': sin datos suficientes en la serie.")
        return None

    fecha_antes, fecha_despues, conteos_antes, conteos_despues = extremos
    logger.info(f"  Antes:   {fecha_antes}  |  viviendas est.: {conteos_antes[1]:,}")
    logger.info(f"  Después: {fecha_despues}  |  viviendas est.: {conteos_despues[1]:,}")

    tiff_antes = _buscar_tiff_rgb(sentinel_dir, poligono_id, fecha_antes)
    tiff_despues = _buscar_tiff_rgb(sentinel_dir, poligono_id, fecha_despues)

    if tiff_antes is None or tiff_despues is None:
        logger.warning(f"Skip '{poligono_id}': falta al menos un GeoTIFF RGB.")
        return None

    try:
        imagen = armar_comparacion(
            poligono_id=poligono_id,
            nombre_poligono=nombre_poligono,
            poligono_geom_4326=poligono_geom_4326,
            tiff_antes=tiff_antes,
            tiff_despues=tiff_despues,
            fecha_antes=fecha_antes,
            fecha_despues=fecha_despues,
            conteos_antes=conteos_antes,
            conteos_despues=conteos_despues,
            ancho_imagen=ancho_imagen,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(f"Falla armando comparación de '{poligono_id}': {exc}")
        return None

    output_dir = ensure_dir(output_dir)
    out_path = output_dir / f"{poligono_id}_comparacion_hd.png"
    try:
        # PNG sin pérdida, compresión baja para decode rápido.
        imagen.save(out_path, "PNG", optimize=False, compress_level=1)
    except Exception as exc:  # noqa: BLE001
        logger.exception(f"No se pudo guardar {out_path}: {exc}")
        return None

    size_kb = out_path.stat().st_size / 1024
    logger.info(f"PNG generado -> {out_path} ({size_kb:,.1f} KB, {imagen.size[0]}x{imagen.size[1]} px)")
    return out_path


# --- CLI --------------------------------------------------------------------


@click.command(help="Genera PNGs HD de comparación antes/después por polígono.")
@click.option(
    "--poligono",
    type=str,
    default=None,
    help="ID del polígono a procesar (ej. itaembe_guazu). Excluyente con --all.",
)
@click.option(
    "--all",
    "all_flag",
    is_flag=True,
    default=False,
    help="Procesa todos los polígonos del GeoJSON.",
)
@click.option(
    "--poligonos",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("config/poligonos.geojson"),
    show_default=True,
    help="Ruta al GeoJSON con los polígonos.",
)
@click.option(
    "--serie-temporal",
    type=click.Path(dir_okay=False, path_type=Path),
    default=Path("data/processed/conteos/serie_temporal.csv"),
    show_default=True,
    help="CSV con los conteos de viviendas por polígono y fecha.",
)
@click.option(
    "--sentinel-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("data/raw/sentinel2"),
    show_default=True,
    help="Directorio con los GeoTIFF RGB de Sentinel-2.",
)
@click.option(
    "--output-dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("data/outputs/comparaciones_hd"),
    show_default=True,
    help="Directorio donde se escriben los PNGs.",
)
@click.option(
    "--ancho-imagen",
    type=int,
    default=1200,
    show_default=True,
    help="Ancho en píxeles de CADA imagen central (el PNG total es ~2x este + márgenes).",
)
@click.option(
    "--nivel-log",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    default="INFO",
    show_default=True,
    help="Nivel de verbosidad del logger.",
)
def cli(
    poligono: Optional[str],
    all_flag: bool,
    poligonos: Path,
    serie_temporal: Path,
    sentinel_dir: Path,
    output_dir: Path,
    ancho_imagen: int,
    nivel_log: str,
) -> None:
    """Entry point CLI — arma las comparaciones HD por polígono."""
    setup_logger(nivel=nivel_log.upper())

    t0 = datetime.now()
    logger.info("=" * 60)
    logger.info("Observatorio Urbano Posadas -- Comparaciones HD (antes/después)")
    logger.info("=" * 60)

    if not poligono and not all_flag:
        raise click.UsageError("Indicá --poligono ID o --all.")
    if poligono and all_flag:
        raise click.UsageError("No uses --poligono y --all al mismo tiempo.")
    if ancho_imagen < 200:
        raise click.UsageError("--ancho-imagen debe ser >= 200 px.")

    poligonos_path = resolve_path(poligonos)
    serie_path = resolve_path(serie_temporal)
    sentinel_path = resolve_path(sentinel_dir)
    output_path = resolve_path(output_dir)

    logger.info(f"Polígonos:       {poligonos_path}")
    logger.info(f"Serie temporal:  {serie_path}")
    logger.info(f"Sentinel dir:    {sentinel_path}")
    logger.info(f"Output dir:      {output_path}")
    logger.info(f"Ancho imagen:    {ancho_imagen} px por panel")

    if not poligonos_path.exists():
        logger.error(f"No existe el GeoJSON: {poligonos_path}")
        sys.exit(1)
    if not sentinel_path.exists():
        logger.error(f"No existe el directorio de Sentinel-2: {sentinel_path}")
        sys.exit(1)

    try:
        df_serie = _cargar_serie_temporal(serie_path)
    except (FileNotFoundError, ValueError) as exc:
        logger.error(f"Problema con el CSV de serie temporal: {exc}")
        sys.exit(1)

    gdf = gpd.read_file(poligonos_path)
    if gdf.crs is None:
        gdf = gdf.set_crs(epsg=4326)
    else:
        gdf = gdf.to_crs(epsg=4326)

    if all_flag:
        seleccion = gdf
    else:
        seleccion = gdf[gdf["id"].astype(str) == str(poligono)]
        if seleccion.empty:
            logger.error(f"No se encontró polígono '{poligono}' en {poligonos_path}")
            sys.exit(1)

    resultados: list[Path] = []
    fallos: list[str] = []

    with graceful_interrupt() as state:
        def _resumen_parcial() -> None:
            logger.info(
                f"Resumen parcial: {len(resultados)} PNG(s) generados, "
                f"{len(fallos)} fallo(s)."
            )

        state.on_interrupt(_resumen_parcial)

        for _, fila in seleccion.iterrows():
            pid = str(fila["id"])
            nombre = str(fila.get("nombre", pid))
            try:
                out = generar_comparacion_poligono(
                    poligono_id=pid,
                    nombre_poligono=nombre,
                    poligono_geom_4326=fila.geometry,
                    df_serie=df_serie,
                    sentinel_dir=sentinel_path,
                    output_dir=output_path,
                    ancho_imagen=ancho_imagen,
                )
                if out is not None:
                    resultados.append(out)
                else:
                    fallos.append(pid)
            except Exception as exc:  # noqa: BLE001
                logger.exception(f"Falla inesperada en polígono '{pid}': {exc}")
                fallos.append(pid)

    dt = (datetime.now() - t0).total_seconds()
    logger.info("=" * 60)
    logger.info(f"Terminado. PNGs generados: {len(resultados)} — fallos: {len(fallos)} — {dt:.1f}s")
    for p in resultados:
        logger.info(f"  OK    {p}")
    for pid in fallos:
        logger.info(f"  FAIL  {pid}")

    if not resultados:
        sys.exit(2)


if __name__ == "__main__":
    cli()
