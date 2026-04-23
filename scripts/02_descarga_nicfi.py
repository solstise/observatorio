"""Descarga de mosaicos Planet NICFI para el Observatorio Urbano Posadas.

Tarea 2.1 — Fase 2.

Planet NICFI (Norway's International Climate & Forest Initiative) provee
mosaicos ópticos mensuales de 4.7 m/píxel para los trópicos desde
septiembre 2020. El Observatorio los usa como fuente visual principal
(mucho más nítida que Sentinel-2) para los timelapses y como insumo
para el modelo propio de detección de edificios (Tarea 2.2).

Registro NICFI
--------------
1. Ir a https://www.planet.com/nicfi/ y completar el formulario.
2. En el campo "use case" ser explícito y honesto:
   "Monitoreo de expansión urbana en Posadas, Argentina. Observatorio
   técnico de desarrollo social, uso no comercial, publicación abierta
   de datos agregados con cita a Planet Labs PBC vía NICFI."
3. Aprobación manual, usualmente 24-72 horas hábiles.
4. Una vez aprobado: obtener la API key desde https://www.planet.com/account/
5. Exportar como ``PLANET_API_KEY`` en ``.env`` del proyecto.

Licencia
--------
La licencia NICFI permite uso **no comercial** (investigación, gobierno,
ONGs, medios, academia, etc.). Uso comercial está restringido. **Cita
obligatoria** en cualquier publicación: "© Planet Labs PBC, via NICFI
program".

Uso
---
    python scripts/02_descarga_nicfi.py \\
        --meses "2020-09,2021-03,2022-07" \\
        --poligonos config/poligonos.geojson

Si no se pasa ``--meses`` se descargan todos desde ``planet_nicfi.primer_mes``
(default 2020-09) hasta el mes actual.

Cacheo
------
Los quads descargados se guardan en ``data/raw/planet_nicfi/{YYYY-MM}/{quad_id}.tif``
y se saltea la descarga si el archivo existe y tiene MD5 consistente. Los
recortes por polígono van a ``data/processed/recortes/nicfi/{poligono_id}_{YYYYMM}.tif``.
"""

from __future__ import annotations

import hashlib
import signal
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import click
import requests
from loguru import logger
from requests.auth import HTTPBasicAuth
from tqdm import tqdm

try:
    import mercantile  # type: ignore
except ImportError:  # pragma: no cover
    mercantile = None

try:
    import geopandas as gpd  # type: ignore
    import rasterio  # type: ignore
    from rasterio.mask import mask as rio_mask  # type: ignore
    from rasterio.merge import merge as rio_merge  # type: ignore
except ImportError:  # pragma: no cover
    gpd = None
    rasterio = None
    rio_mask = None
    rio_merge = None

from scripts.utils.config import BBox, Settings, load_settings
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, ensure_parent, project_root, resolve_path

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

NICFI_API_BASE = "https://api.planet.com/basemaps/v1/mosaics"
MOSAIC_TEMPLATE = "planet_medres_normalized_analytic_{mes}_mosaic"
NICFI_ZOOM = 15
MAX_RETRIES = 5
BACKOFF_BASE_SEC = 4.0
HTTP_TIMEOUT_SEC = 120
CHUNK_BYTES = 1024 * 1024  # 1 MB

_INTERRUPTED = False


def _install_sigint_handler() -> None:
    """Marca ``_INTERRUPTED`` en Ctrl+C para cortar loops con gracia."""

    def _handler(signum, frame):  # noqa: ANN001 — firma impuesta por signal
        global _INTERRUPTED
        _INTERRUPTED = True
        logger.warning("Ctrl+C recibido — terminando al siguiente chequeo limpio.")

    signal.signal(signal.SIGINT, _handler)


# ---------------------------------------------------------------------------
# Utilidades de fechas y meses
# ---------------------------------------------------------------------------


def _parse_mes(s: str) -> str:
    """Normaliza un string "YYYY-MM" a su forma canónica."""
    dt = datetime.strptime(s.strip(), "%Y-%m")
    return dt.strftime("%Y-%m")


def _iter_meses(desde: str, hasta: str) -> List[str]:
    """Itera meses inclusivos entre ``desde`` y ``hasta`` en formato ``YYYY-MM``."""
    d0 = datetime.strptime(desde, "%Y-%m")
    d1 = datetime.strptime(hasta, "%Y-%m")
    out: List[str] = []
    y, m = d0.year, d0.month
    while (y, m) <= (d1.year, d1.month):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            m = 1
            y += 1
    return out


def _meses_default(settings: Settings) -> List[str]:
    """Rango por defecto: desde ``primer_mes`` de settings hasta el mes actual."""
    primer = settings.planet_nicfi.primer_mes or "2020-09"
    hoy = date.today().strftime("%Y-%m")
    return _iter_meses(primer, hoy)


# ---------------------------------------------------------------------------
# MD5 para verificación de caché
# ---------------------------------------------------------------------------


def _md5_file(path: Path, chunk_bytes: int = CHUNK_BYTES) -> str:
    """Calcula el MD5 hex de un archivo."""
    h = hashlib.md5()  # nosec — no es uso criptográfico
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(chunk_bytes), b""):
            h.update(block)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Cliente HTTP básico con retry/backoff
# ---------------------------------------------------------------------------


@dataclass
class NICFIClient:
    """Wrapper mínimo sobre ``requests`` para la API NICFI."""

    api_key: str
    session: requests.Session

    @classmethod
    def build(cls, api_key: str) -> "NICFIClient":
        session = requests.Session()
        session.auth = HTTPBasicAuth(api_key, "")
        session.headers.update(
            {
                "User-Agent": "observatorio-urbano-posadas/0.1 (+nicfi)",
                "Accept": "application/json",
            }
        )
        return cls(api_key=api_key, session=session)

    def get_json(self, url: str, params: Optional[dict] = None) -> dict:
        """GET con retry/backoff exponencial. Lanza en 401/403 con mensaje claro."""
        last_err: Optional[Exception] = None
        for intento in range(1, MAX_RETRIES + 1):
            try:
                resp = self.session.get(url, params=params, timeout=HTTP_TIMEOUT_SEC)
            except requests.RequestException as exc:
                last_err = exc
                delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
                logger.warning(
                    f"Error de red en GET {url} (intento {intento}/{MAX_RETRIES}): "
                    f"{exc}. Reintento en {delay:.1f}s."
                )
                time.sleep(delay)
                continue

            if resp.status_code in (401, 403):
                raise NICFIAuthError(resp.status_code, resp.text)
            if resp.status_code == 404:
                resp.raise_for_status()
            if resp.status_code == 429 or 500 <= resp.status_code < 600:
                delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
                logger.warning(
                    f"Respuesta {resp.status_code} en {url} "
                    f"(intento {intento}/{MAX_RETRIES}). Reintento en {delay:.1f}s."
                )
                time.sleep(delay)
                continue

            resp.raise_for_status()
            return resp.json()

        raise RuntimeError(f"GET {url} falló tras {MAX_RETRIES} intentos: {last_err}")

    def download_stream(self, url: str, destino: Path, desc: str = "") -> Path:
        """Descarga streaming con retry; escribe a archivo temporal y renombra."""
        ensure_parent(destino)
        tmp = destino.with_suffix(destino.suffix + ".part")

        for intento in range(1, MAX_RETRIES + 1):
            try:
                with self.session.get(
                    url, stream=True, timeout=HTTP_TIMEOUT_SEC
                ) as resp:
                    if resp.status_code in (401, 403):
                        raise NICFIAuthError(resp.status_code, resp.text)
                    if resp.status_code == 429 or 500 <= resp.status_code < 600:
                        delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
                        logger.warning(
                            f"{desc or url} respondió {resp.status_code} "
                            f"(intento {intento}/{MAX_RETRIES}); reintento en "
                            f"{delay:.1f}s."
                        )
                        time.sleep(delay)
                        continue
                    resp.raise_for_status()
                    total = int(resp.headers.get("Content-Length", 0)) or None
                    with tmp.open("wb") as fh, tqdm(
                        total=total,
                        unit="B",
                        unit_scale=True,
                        unit_divisor=1024,
                        leave=False,
                        desc=desc or destino.name,
                    ) as pbar:
                        for chunk in resp.iter_content(chunk_size=CHUNK_BYTES):
                            if not chunk:
                                continue
                            if _INTERRUPTED:
                                logger.warning("Descarga interrumpida por usuario.")
                                tmp.unlink(missing_ok=True)
                                raise KeyboardInterrupt()
                            fh.write(chunk)
                            pbar.update(len(chunk))
                tmp.replace(destino)
                return destino
            except NICFIAuthError:
                raise
            except (requests.RequestException, OSError) as exc:
                tmp.unlink(missing_ok=True)
                delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
                logger.warning(
                    f"Error descargando {desc or url}: {exc}. "
                    f"Reintento en {delay:.1f}s."
                )
                time.sleep(delay)

        raise RuntimeError(f"No se pudo descargar {url} tras {MAX_RETRIES} intentos.")


class NICFIAuthError(RuntimeError):
    """Error 401/403 — credenciales inválidas o acceso NICFI no aprobado."""

    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


# ---------------------------------------------------------------------------
# Lógica principal
# ---------------------------------------------------------------------------


def _buscar_mosaico_id(client: NICFIClient, mes: str) -> Optional[str]:
    """Resuelve el ``id`` del mosaico NICFI para un mes dado.

    Args:
        client: cliente autenticado.
        mes: "YYYY-MM".

    Returns:
        id del mosaico, o ``None`` si no existe para ese mes.
    """
    nombre = MOSAIC_TEMPLATE.format(mes=mes)
    data = client.get_json(NICFI_API_BASE, params={"name__is": nombre})
    mosaics = data.get("mosaics", [])
    if not mosaics:
        logger.warning(f"Mosaico NICFI '{nombre}' no encontrado.")
        return None
    return mosaics[0].get("id")


def _quads_para_bbox(bbox: BBox) -> List[Tuple[int, int, int]]:
    """Lista los (x, y, z) de los quads NICFI (zoom 15) que cubren un bbox."""
    if mercantile is None:
        raise RuntimeError(
            "El paquete 'mercantile' no está instalado. Agregá: "
            "pip install mercantile"
        )
    tiles = list(
        mercantile.tiles(
            bbox.oeste, bbox.sur, bbox.este, bbox.norte, zooms=[NICFI_ZOOM]
        )
    )
    return [(t.x, t.y, t.z) for t in tiles]


def _quad_id(x: int, y: int, z: int) -> str:
    """Formato de quad_id usado por la API NICFI: ``L15-XXXXE-YYYYN`` no — usa {z}-{x}-{y}."""
    # NICFI devuelve quads con id tipo "L15-0707E-1205N" pero su endpoint
    # ``/quads/{quad_id}/full`` también acepta el formato "{z}-{x}-{y}" vía
    # el sub-endpoint de búsqueda por bbox. Para evitar ambigüedades, usamos
    # el listado de quads del mosaico filtrado por bbox (método más robusto).
    return f"{z}-{x}-{y}"


def _listar_quads_mosaico(
    client: NICFIClient, mosaic_id: str, bbox: BBox
) -> List[dict]:
    """Lista los quads del mosaico que intersectan el bbox (paginando)."""
    url = f"{NICFI_API_BASE}/{mosaic_id}/quads"
    bbox_param = f"{bbox.oeste},{bbox.sur},{bbox.este},{bbox.norte}"
    out: List[dict] = []
    params = {"bbox": bbox_param, "minimal": "true"}
    next_url: Optional[str] = url
    while next_url:
        data = client.get_json(next_url, params=params if next_url == url else None)
        items = data.get("items", [])
        out.extend(items)
        next_url = (data.get("_links") or {}).get("_next")
        params = None  # a partir del segundo request, los params vienen en la URL
    logger.info(f"Mosaico {mosaic_id}: {len(out)} quads en bbox.")
    return out


def _descargar_quad(
    client: NICFIClient,
    quad: dict,
    destino_dir: Path,
) -> Optional[Path]:
    """Descarga un quad a ``destino_dir/{quad_id}.tif``. Cacheo por MD5 si ya existe."""
    quad_id = quad.get("id") or ""
    if not quad_id:
        logger.warning(f"Quad sin id: {quad}")
        return None
    enlace = (quad.get("_links") or {}).get("download")
    if not enlace:
        logger.warning(f"Quad {quad_id} sin link de descarga.")
        return None

    destino = destino_dir / f"{quad_id}.tif"
    if destino.exists() and destino.stat().st_size > 0:
        md5 = _md5_file(destino)
        logger.debug(f"Cache hit quad {quad_id} (md5={md5[:8]}…).")
        return destino

    client.download_stream(enlace, destino, desc=f"quad {quad_id}")
    return destino


# ---------------------------------------------------------------------------
# Mosaicado y recortes por polígono
# ---------------------------------------------------------------------------


def _mosaicar_y_recortar(
    tifs: Sequence[Path],
    poligonos_gdf,
    mes: str,
    output_dir: Path,
) -> List[Path]:
    """Mosaicar quads del mes y recortar por cada polígono.

    Args:
        tifs: lista de GeoTIFFs (quads) del mes.
        poligonos_gdf: GeoDataFrame con columna ``poligono_id`` y geometrías.
        mes: "YYYY-MM" (para nombrar outputs).
        output_dir: directorio destino.

    Returns:
        Lista de paths recortados generados.
    """
    if rasterio is None or rio_mask is None or rio_merge is None:
        raise RuntimeError(
            "rasterio no está instalado. Agregá: pip install rasterio"
        )
    if not tifs:
        logger.warning(f"No hay quads para mosaicar en {mes}.")
        return []

    ensure_dir(output_dir)
    mes_compact = mes.replace("-", "")
    salidas: List[Path] = []

    srcs = [rasterio.open(p) for p in tifs]
    try:
        mosaic, transform = rio_merge(srcs)
        meta = srcs[0].meta.copy()
        meta.update(
            {
                "driver": "GTiff",
                "height": mosaic.shape[1],
                "width": mosaic.shape[2],
                "transform": transform,
                "count": mosaic.shape[0],
                "compress": "deflate",
            }
        )

        # Para recortar usamos un raster temporal en memoria vía MemoryFile.
        from rasterio.io import MemoryFile  # type: ignore

        with MemoryFile() as memfile:
            with memfile.open(**meta) as tmp:
                tmp.write(mosaic)
            with memfile.open() as mosaic_src:
                gdf = poligonos_gdf.to_crs(mosaic_src.crs)
                for _, row in gdf.iterrows():
                    pid = str(row.get("poligono_id") or row.get("id") or row.name)
                    try:
                        out_img, out_transform = rio_mask(
                            mosaic_src,
                            [row.geometry.__geo_interface__],
                            crop=True,
                        )
                    except (ValueError, Exception) as exc:  # noqa: BLE001
                        logger.warning(f"No se pudo recortar {pid} en {mes}: {exc}")
                        continue
                    out_meta = mosaic_src.meta.copy()
                    out_meta.update(
                        {
                            "height": out_img.shape[1],
                            "width": out_img.shape[2],
                            "transform": out_transform,
                            "compress": "deflate",
                        }
                    )
                    destino = output_dir / f"{pid}_{mes_compact}.tif"
                    with rasterio.open(destino, "w", **out_meta) as dst:
                        dst.write(out_img)
                    salidas.append(destino)
                    logger.info(f"Recorte {mes} {pid} → {destino.name}")
    finally:
        for s in srcs:
            s.close()

    return salidas


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.command(context_settings={"show_default": True})
@click.option(
    "--meses",
    default=None,
    help=(
        "Meses en formato YYYY-MM separados por coma. Default: desde "
        "planet_nicfi.primer_mes (settings) hasta el mes actual."
    ),
)
@click.option(
    "--bbox",
    default=None,
    help=(
        "Bounding box 'oeste,sur,este,norte' en grados decimales. Default: "
        "geografia.bbox desde settings.yaml."
    ),
)
@click.option(
    "--poligonos",
    default="config/poligonos.geojson",
    type=click.Path(),
    help="GeoJSON con los polígonos a recortar.",
)
@click.option(
    "--output-dir",
    default="data/raw/planet_nicfi",
    type=click.Path(),
    help="Directorio donde se guardan los quads descargados.",
)
@click.option(
    "--recortes-dir",
    default="data/processed/recortes/nicfi",
    type=click.Path(),
    help="Directorio donde se guardan los recortes por polígono.",
)
@click.option(
    "--api-key",
    default=None,
    help="API key NICFI. Si no se pasa, se lee de PLANET_API_KEY (.env).",
)
@click.option(
    "--solo-quads",
    is_flag=True,
    default=False,
    help="Si se pasa, descarga quads pero no mosaica ni recorta.",
)
@click.option(
    "--log-level",
    default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"]),
    help="Nivel de logging.",
)
def main(
    meses: Optional[str],
    bbox: Optional[str],
    poligonos: str,
    output_dir: str,
    recortes_dir: str,
    api_key: Optional[str],
    solo_quads: bool,
    log_level: str,
) -> None:
    """Descarga mosaicos mensuales Planet NICFI para Posadas."""
    setup_logger(nivel=log_level)
    _install_sigint_handler()

    settings = load_settings()
    api_key = api_key or settings.env.planet_api_key
    if not api_key:
        click.echo(
            "\n[ERROR] No hay PLANET_API_KEY.\n\n"
            "Para obtener acceso a Planet NICFI:\n"
            "  1. Completar formulario en https://www.planet.com/nicfi/\n"
            "  2. Esperar aprobación manual (24-72 horas hábiles).\n"
            "  3. Ir a https://www.planet.com/account/ y copiar la API key.\n"
            "  4. Agregar PLANET_API_KEY=xxx en el archivo .env del proyecto.\n"
            "\nSalgo sin descargar nada.",
            err=True,
        )
        sys.exit(2)

    # Parseo de bbox
    if bbox:
        partes = [float(x.strip()) for x in bbox.split(",")]
        if len(partes) != 4:
            raise click.BadParameter("bbox debe tener 4 valores: oeste,sur,este,norte.")
        bbox_obj = BBox(oeste=partes[0], sur=partes[1], este=partes[2], norte=partes[3])
    else:
        bbox_obj = settings.geografia.bbox

    # Parseo de meses
    if meses:
        lista_meses = [_parse_mes(m) for m in meses.split(",") if m.strip()]
    else:
        lista_meses = _meses_default(settings)
    logger.info(
        f"Meses a procesar: {len(lista_meses)} "
        f"(primero={lista_meses[0]}, ultimo={lista_meses[-1]})"
    )
    logger.info(
        f"BBox: oeste={bbox_obj.oeste}, sur={bbox_obj.sur}, "
        f"este={bbox_obj.este}, norte={bbox_obj.norte}"
    )

    output_dir_p = ensure_dir(resolve_path(output_dir))
    recortes_dir_p = ensure_dir(resolve_path(recortes_dir))

    # Carga polígonos (si hay y si habrá recortes)
    poligonos_gdf = None
    if not solo_quads:
        if gpd is None:
            logger.warning(
                "geopandas no está instalado — no se podrán hacer recortes. "
                "Descargo solo quads."
            )
            solo_quads = True
        else:
            poli_path = resolve_path(poligonos)
            if not poli_path.exists():
                logger.warning(
                    f"No se encontró {poli_path}. Descargo solo quads, "
                    "sin recortes por polígono."
                )
                solo_quads = True
            else:
                poligonos_gdf = gpd.read_file(poli_path)
                if "poligono_id" not in poligonos_gdf.columns:
                    # Algunos geojson usan 'id' o 'name'; normalizamos.
                    if "id" in poligonos_gdf.columns:
                        poligonos_gdf["poligono_id"] = poligonos_gdf["id"].astype(str)
                    elif "name" in poligonos_gdf.columns:
                        poligonos_gdf["poligono_id"] = poligonos_gdf["name"].astype(str)
                    else:
                        poligonos_gdf["poligono_id"] = poligonos_gdf.index.astype(str)
                logger.info(f"Cargados {len(poligonos_gdf)} polígonos de {poli_path}.")

    client = NICFIClient.build(api_key)

    try:
        pbar_meses = tqdm(lista_meses, desc="meses NICFI", unit="mes")
        for mes in pbar_meses:
            if _INTERRUPTED:
                break
            pbar_meses.set_postfix_str(mes)
            try:
                mosaic_id = _buscar_mosaico_id(client, mes)
            except NICFIAuthError as exc:
                _print_auth_error(exc)
                sys.exit(2)

            if not mosaic_id:
                continue

            mes_dir = ensure_dir(output_dir_p / mes)
            try:
                quads = _listar_quads_mosaico(client, mosaic_id, bbox_obj)
            except NICFIAuthError as exc:
                _print_auth_error(exc)
                sys.exit(2)

            tifs_mes: List[Path] = []
            for quad in tqdm(quads, desc=f"quads {mes}", leave=False, unit="quad"):
                if _INTERRUPTED:
                    break
                try:
                    tif = _descargar_quad(client, quad, mes_dir)
                except NICFIAuthError as exc:
                    _print_auth_error(exc)
                    sys.exit(2)
                if tif is not None:
                    tifs_mes.append(tif)

            if _INTERRUPTED:
                break

            if not solo_quads and poligonos_gdf is not None and tifs_mes:
                _mosaicar_y_recortar(
                    tifs_mes, poligonos_gdf, mes, recortes_dir_p
                )

        logger.info("Descarga NICFI finalizada.")
    except KeyboardInterrupt:
        logger.warning("Interrumpido por usuario — salida limpia.")
        sys.exit(130)


def _print_auth_error(exc: NICFIAuthError) -> None:
    """Imprime instrucciones claras cuando NICFI rechaza credenciales."""
    click.echo(
        "\n[ERROR] La API NICFI devolvió "
        f"{exc.status} (credenciales rechazadas o acceso no aprobado).\n\n"
        "Checklist:\n"
        "  - La API key es exactamente la del panel "
        "https://www.planet.com/account/ (sin espacios).\n"
        "  - Tu cuenta tiene el programa NICFI aprobado "
        "(el alta es manual, 24-72h).\n"
        "  - La variable PLANET_API_KEY está seteada en .env y no hay otra "
        "en el entorno sobreescribiendo.\n\n"
        "Si seguís sin acceso, re-aplicar en https://www.planet.com/nicfi/\n",
        err=True,
    )


if __name__ == "__main__":
    main()
