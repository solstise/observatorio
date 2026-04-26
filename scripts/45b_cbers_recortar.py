"""Recorta el pansharpen CBERS-4A WPM por cada polígono del Observatorio.

Script complementario a ``45_cbers_descarga.py``. Lee el GeoTIFF
``data/raw/cbers/posadas_{yyyymm}_pansharpen.tif`` (RGB 8-bit, 2 m, EPSG:32721)
y produce, por cada polígono publicable de ``config/poligonos.geojson``:

- ``data/processed/cbers/{poligono_id}_cbers_{yyyymm}.tif`` (GeoTIFF
  georreferenciado, RGB 8-bit, recortado a la geometría con máscara y
  reproyectado a EPSG:4326).
- ``data/processed/cbers/{poligono_id}_cbers_{yyyymm}.png` (PNG 8-bit,
  ancho fijo 1200 px, calidad alta para mostrar en frontend).
- ``data/processed/cbers/{poligono_id}_cbers_latest.png`` (alias
  estable, copia del último mes — el frontend lo referencia siempre con
  este nombre).

Si CBERS no cubre un polígono (caída de tiles, borde de pasada), genera
un PNG placeholder con leyenda *"Sin imagen CBERS disponible para
{nombre} en {yyyymm}"* para que el frontend no rompa.

Excluye automáticamente ``posadas_completa`` (sólo barrios).

Uso
---
::

    # corrida normal sobre el último pansharpen disponible
    python scripts/45b_cbers_recortar.py

    # forzar regeneración aunque ya exista el output
    python scripts/45b_cbers_recortar.py --force

    # apuntar a un pansharpen específico
    python scripts/45b_cbers_recortar.py \\
        --pansharpen data/raw/cbers/posadas_202604_pansharpen.tif

Outputs auxiliares
------------------
Actualiza ``data/processed/cbers/_metadata.json`` con
``n_poligonos_cubiertos`` (los que tienen al menos un píxel CBERS válido).
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

import json
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import click
from loguru import logger

from scripts.utils.io_geo import cache_check, load_geojson
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, resolve_path

SCRIPT_VERSION = "0.1.0"

# Directorio de entrada (raw cbers) — donde 45_cbers_descarga.py escribe
RAW_DIR = "data/raw/cbers"
# Directorio procesados
PROC_DIR = "data/processed/cbers"

# Polígonos excluidos del recorte (cubren toda la ciudad)
POLIGONOS_EXCLUIR = {"posadas_completa"}

# Ancho objetivo del PNG (alto se calcula proporcional)
PNG_WIDTH = 1200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _detectar_pansharpen_mas_reciente(raw_dir: Path) -> Optional[Path]:
    """Busca el último ``posadas_{yyyymm}_pansharpen.tif`` en raw_dir.

    Devuelve el de mayor yyyymm, o None si no existe ninguno.
    """
    candidatos = sorted(raw_dir.glob("posadas_*_pansharpen.tif"))
    if not candidatos:
        return None
    return candidatos[-1]


_YYYYMM_RE = re.compile(r"posadas_(\d{6})_pansharpen\.tif$")


def _yyyymm_de_path(p: Path) -> str:
    """Extrae el ``YYYYMM`` del nombre del pansharpen."""
    m = _YYYYMM_RE.search(p.name)
    if m:
        return m.group(1)
    raise ValueError(f"No se pudo extraer YYYYMM de {p.name}")


# ---------------------------------------------------------------------------
# Recorte por polígono
# ---------------------------------------------------------------------------


def recortar_poligono(
    pansharpen_path: Path,
    geom_geojson: dict,
    poligono_id: str,
    yyyymm: str,
    out_dir: Path,
    force: bool = False,
) -> Tuple[bool, Dict[str, Any]]:
    """Recorta el pansharpen por la geometría del polígono y exporta TIFF + PNG.

    Args:
        pansharpen_path: Path al .tif RGB pansharpen (EPSG:32721).
        geom_geojson: Diccionario GeoJSON de la geometría del polígono
            (asumido en EPSG:4326).
        poligono_id: Slug del polígono.
        yyyymm: YYYYMM string para el nombre.
        out_dir: Directorio de salida.
        force: Si True, sobreescribe outputs existentes.

    Returns:
        Tupla (cubierto, info) donde:
          - cubierto: True si hay al menos un píxel válido tras el recorte.
          - info: dict con tamaño, transform, etc.
    """
    import geopandas as gpd
    import numpy as np
    import rasterio
    from rasterio.mask import mask as rio_mask
    from rasterio.warp import Resampling, calculate_default_transform, reproject
    from shapely.geometry import shape

    info: Dict[str, Any] = {
        "poligono_id": poligono_id,
        "yyyymm": yyyymm,
        "tif_path": None,
        "png_path": None,
        "n_pixels_validos": 0,
        "ancho_px": 0,
        "alto_px": 0,
    }

    tif_dest = out_dir / f"{poligono_id}_cbers_{yyyymm}.tif"
    png_dest = out_dir / f"{poligono_id}_cbers_{yyyymm}.png"
    latest_png = out_dir / f"{poligono_id}_cbers_latest.png"

    if cache_check(tif_dest) and cache_check(png_dest) and cache_check(latest_png) and not force:
        logger.debug(f"  {poligono_id}: cache hit → skip")
        info["tif_path"] = str(tif_dest)
        info["png_path"] = str(png_dest)
        info["cache_hit"] = True
        return True, info

    # Reproyectar la geometría del polígono al CRS del raster (UTM 21S)
    geom_4326 = shape(geom_geojson)
    gdf = gpd.GeoDataFrame(geometry=[geom_4326], crs="EPSG:4326")

    with rasterio.open(pansharpen_path) as src:
        gdf_src = gdf.to_crs(src.crs)
        try:
            out_image, out_transform = rio_mask(
                src,
                [gdf_src.geometry.iloc[0].__geo_interface__],
                crop=True,
                filled=True,
                nodata=0,
            )
        except ValueError as exc:
            # ValueError típico: "Input shapes do not overlap raster"
            logger.warning(f"  {poligono_id}: {exc}")
            return False, info
        out_meta = src.meta.copy()
        out_meta.update(
            {
                "height": out_image.shape[1],
                "width": out_image.shape[2],
                "transform": out_transform,
            }
        )

        # Validar que no quedó vacío
        valid_mask = (out_image[0] > 0) | (out_image[1] > 0) | (out_image[2] > 0)
        n_valid = int(valid_mask.sum())
        info["n_pixels_validos"] = n_valid
        info["ancho_px"] = int(out_image.shape[2])
        info["alto_px"] = int(out_image.shape[1])
        if n_valid == 0:
            logger.warning(
                f"  {poligono_id}: 0 pixels válidos tras recorte (probable fuera de cobertura)"
            )
            return False, info

    # Reproyectar a EPSG:4326 para el GeoTIFF final (consistente con conv. del repo)
    src_crs = out_meta["crs"]
    src_transform = out_meta["transform"]
    src_width = out_meta["width"]
    src_height = out_meta["height"]
    dst_crs = "EPSG:4326"
    dst_transform, dst_width, dst_height = calculate_default_transform(
        src_crs,
        dst_crs,
        src_width,
        src_height,
        *rasterio.transform.array_bounds(src_height, src_width, src_transform),
    )
    reproj = np.zeros((3, dst_height, dst_width), dtype="uint8")
    for i in range(3):
        reproject(
            source=out_image[i],
            destination=reproj[i],
            src_transform=src_transform,
            src_crs=src_crs,
            dst_transform=dst_transform,
            dst_crs=dst_crs,
            resampling=Resampling.bilinear,
            src_nodata=0,
            dst_nodata=0,
        )

    tif_meta = out_meta.copy()
    tif_meta.update(
        {
            "height": dst_height,
            "width": dst_width,
            "transform": dst_transform,
            "crs": dst_crs,
            "compress": "deflate",
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
            "photometric": "RGB",
        }
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    with rasterio.open(tif_dest, "w", **tif_meta) as dst:
        dst.write(reproj)
        dst.update_tags(
            fuente="CBERS-4A WPM via INPE/AWS Open Data Registry",
            poligono_id=poligono_id,
            yyyymm=yyyymm,
            algoritmo_pansharpen="Brovey",
            version_script=SCRIPT_VERSION,
        )

    # Generar PNG con ancho fijo PNG_WIDTH (alto proporcional)
    _generar_png(reproj, png_dest, ancho_px=PNG_WIDTH)

    # Alias estable
    shutil.copy2(png_dest, latest_png)

    info["tif_path"] = str(tif_dest)
    info["png_path"] = str(png_dest)
    return True, info


def _generar_png(rgb_array, png_path: Path, ancho_px: int = PNG_WIDTH) -> None:
    """Convierte un array RGB uint8 a PNG redimensionado a ancho_px.

    Args:
        rgb_array: Array shape (3, h, w) dtype uint8.
        png_path: Path destino.
        ancho_px: Ancho objetivo en pixels. Alto se calcula manteniendo aspecto.
    """
    import numpy as np
    from PIL import Image

    # Transponer a (h, w, 3) para PIL
    h, w = rgb_array.shape[1], rgb_array.shape[2]
    img_arr = np.transpose(rgb_array, (1, 2, 0))
    img = Image.fromarray(img_arr, mode="RGB")
    if w != ancho_px:
        scale = ancho_px / w
        new_h = max(1, int(round(h * scale)))
        img = img.resize((ancho_px, new_h), Image.Resampling.LANCZOS)
    png_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(png_path, "PNG", optimize=True)


def _generar_png_placeholder(
    poligono_id: str,
    nombre_legible: str,
    yyyymm: str,
    png_path: Path,
    latest_png: Path,
) -> None:
    """Genera un PNG placeholder cuando el polígono no tiene cobertura CBERS.

    Args:
        poligono_id: Slug del polígono.
        nombre_legible: Nombre humano del polígono.
        yyyymm: YYYYMM del último intento.
        png_path: PNG con sufijo de fecha.
        latest_png: Alias estable.
    """
    from PIL import Image, ImageDraw, ImageFont

    width, height = PNG_WIDTH, int(PNG_WIDTH * 9 / 16)  # ratio 16:9
    img = Image.new("RGB", (width, height), color=(35, 40, 55))
    draw = ImageDraw.Draw(img)

    # Intentar fuente del sistema; si falla, usar default
    try:
        font_big = ImageFont.truetype("DejaVuSans.ttf", 32)
        font_small = ImageFont.truetype("DejaVuSans.ttf", 20)
    except OSError:
        font_big = ImageFont.load_default()
        font_small = ImageFont.load_default()

    titulo = "Sin imagen CBERS disponible"
    sub = f"para {nombre_legible} en {yyyymm[:4]}-{yyyymm[4:]}"
    fuente = "Fuente esperada: CBERS-4A WPM via INPE/AWS"

    # Centrar textos
    def _centrar(texto: str, font: ImageFont.ImageFont, y: int) -> None:
        bbox = draw.textbbox((0, 0), texto, font=font)
        tw = bbox[2] - bbox[0]
        draw.text(((width - tw) / 2, y), texto, fill=(220, 220, 220), font=font)

    _centrar(titulo, font_big, height // 2 - 60)
    _centrar(sub, font_small, height // 2 - 10)
    _centrar(fuente, font_small, height // 2 + 30)

    png_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(png_path, "PNG", optimize=True)
    shutil.copy2(png_path, latest_png)


# ---------------------------------------------------------------------------
# Metadata refresh
# ---------------------------------------------------------------------------


def actualizar_metadata(
    metadata_origen: Optional[Path],
    metadata_destino: Path,
    n_poligonos_cubiertos: int,
    yyyymm: str,
) -> None:
    """Copia/actualiza ``_metadata.json`` en ``data/processed/cbers/``.

    Si existe el de origen (escrito por 45_cbers_descarga.py), lo usa como base
    y actualiza ``n_poligonos_cubiertos``. Si no, escribe un metadata mínimo.
    """
    base: Dict[str, Any]
    if metadata_origen is not None and metadata_origen.exists():
        base = json.loads(metadata_origen.read_text(encoding="utf-8"))
    else:
        base = {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "sensor": "CBERS-4A WPM",
            "resolucion_pan_m": 2,
            "resolucion_ms_m": 8,
            "resolucion_pansharpen_m": 2,
            "fecha_imagen": f"{yyyymm[:4]}-{yyyymm[4:6]}",
            "fuente": "INPE / AWS Open Data Registry (s3://brazil-eosats)",
            "algoritmo_pansharpen": "Brovey",
            "version_script": SCRIPT_VERSION,
        }
    base["n_poligonos_cubiertos"] = n_poligonos_cubiertos
    base["recortes_actualizados_en"] = datetime.now().isoformat(timespec="seconds")
    metadata_destino.parent.mkdir(parents=True, exist_ok=True)
    metadata_destino.write_text(json.dumps(base, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"Metadata actualizada → {metadata_destino}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command()
@click.option(
    "--pansharpen",
    "pansharpen_path",
    default=None,
    help="Path al .tif pansharpen. Default: el último en data/raw/cbers/.",
)
@click.option(
    "--poligonos",
    "poligonos_path",
    default="config/poligonos.geojson",
    show_default=True,
    help="Path al GeoJSON de polígonos.",
)
@click.option(
    "--output",
    "output_dir",
    default=PROC_DIR,
    show_default=True,
    help="Directorio de salida.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Sobreescribir outputs existentes.",
)
@click.option(
    "--nivel-log",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Nivel de logging.",
)
def main(
    pansharpen_path: Optional[str],
    poligonos_path: str,
    output_dir: str,
    force: bool,
    nivel_log: str,
) -> None:
    """Recorta el pansharpen CBERS-4A por polígono y produce TIFF + PNG."""
    setup_logger(nivel=nivel_log.upper())
    raw_dir = ensure_dir(resolve_path(RAW_DIR))
    out = ensure_dir(resolve_path(output_dir))

    logger.info("=" * 60)
    logger.info(f"CBERS-4A WPM — Recorte por polígono (v{SCRIPT_VERSION})")
    logger.info("=" * 60)

    # Resolver pansharpen
    if pansharpen_path:
        pansharpen = resolve_path(pansharpen_path)
        if not pansharpen.exists():
            logger.error(f"No existe el pansharpen indicado: {pansharpen}")
            sys.exit(2)
    else:
        pansharpen = _detectar_pansharpen_mas_reciente(raw_dir)
        if pansharpen is None:
            logger.error(
                f"No se encontró ningún posadas_*_pansharpen.tif en {raw_dir}. "
                "Corré primero: python scripts/45_cbers_descarga.py"
            )
            sys.exit(2)

    yyyymm = _yyyymm_de_path(pansharpen)
    logger.info(f"Pansharpen:    {pansharpen}")
    logger.info(f"YYYYMM:        {yyyymm}")
    logger.info(f"Output dir:    {out}")
    logger.info(f"Force:         {force}")

    # Cargar polígonos
    gdf = load_geojson(poligonos_path)
    if "id" not in gdf.columns:
        logger.error("El GeoJSON no tiene la columna 'id'. No se puede continuar.")
        sys.exit(2)

    # Filtrar polígonos publicables (excluir posadas_completa)
    total_features = len(gdf)
    gdf_pub = gdf[~gdf["id"].astype(str).isin(POLIGONOS_EXCLUIR)].reset_index(drop=True)
    logger.info(
        f"Polígonos a recortar: {len(gdf_pub)} (de {total_features} totales, "
        f"excluido posadas_completa)"
    )

    cubiertos: List[Dict[str, Any]] = []
    sin_cobertura: List[str] = []
    errores: List[str] = []

    t_inicio = time.time()
    for _, row in gdf_pub.iterrows():
        pid = str(row["id"])
        nombre = str(row.get("nombre") or pid)
        geom_geojson = row.geometry.__geo_interface__
        try:
            ok, info = recortar_poligono(
                pansharpen_path=pansharpen,
                geom_geojson=geom_geojson,
                poligono_id=pid,
                yyyymm=yyyymm,
                out_dir=out,
                force=force,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(f"  {pid}: excepción → {exc}")
            errores.append(pid)
            continue

        if ok:
            cubiertos.append(info)
            logger.info(
                f"  OK {pid}: {info['ancho_px']}x{info['alto_px']} px, "
                f"{info['n_pixels_validos']:,} pix válidos"
            )
        else:
            sin_cobertura.append(pid)
            # Generar placeholder
            png = out / f"{pid}_cbers_{yyyymm}.png"
            latest = out / f"{pid}_cbers_latest.png"
            try:
                _generar_png_placeholder(pid, nombre, yyyymm, png, latest)
                logger.info(f"  Placeholder {pid}: PNG sintético generado")
            except Exception as exc:  # noqa: BLE001
                logger.error(f"  {pid}: falló placeholder → {exc}")
                errores.append(pid)

    elapsed = time.time() - t_inicio

    # Actualizar metadata
    metadata_origen = raw_dir / f"posadas_{yyyymm}_metadata.json"
    metadata_destino = out / "_metadata.json"
    actualizar_metadata(
        metadata_origen=metadata_origen if metadata_origen.exists() else None,
        metadata_destino=metadata_destino,
        n_poligonos_cubiertos=len(cubiertos),
        yyyymm=yyyymm,
    )

    logger.info("=" * 60)
    logger.info("Resumen recorte CBERS-4A")
    logger.info("=" * 60)
    logger.info(f"  Polígonos OK:           {len(cubiertos)}")
    logger.info(f"  Sin cobertura (placeholder): {len(sin_cobertura)}")
    logger.info(f"  Errores:                {len(errores)}")
    if sin_cobertura:
        logger.warning(f"  Sin CBERS: {', '.join(sin_cobertura)}")
    if errores:
        logger.error(f"  Errores: {', '.join(errores)}")
    logger.info(f"  Tiempo total:           {elapsed:.1f}s")
    logger.info(f"  Output dir:             {out}")
    sys.exit(0 if not errores else 1)


if __name__ == "__main__":
    main()
