"""Descarga pública de capas oficiales argentinas: IGN, IPEC Misiones, IDE Misiones.

Corresponde a la Tarea 4.5 del PROMPT_OBSERVATORIO_POSADAS.md (extensión).

Obtiene datos de acceso libre sin registro ni aprobación desde tres fuentes
oficiales. No intenta scrapear detrás de login, y si una capa sólo existe
en PDF, baja el PDF y lo documenta en el README en vez de simular datos.

Fuentes y canales usados
------------------------
1. IGN Argentina — Servicio WFS público ``https://wms.ign.gob.ar/geoserver/wfs``
   (GeoServer oficial del Instituto Geográfico Nacional). La página
   ``/NuestrasActividades/InformacionGeoespacial/CapasSIG`` usa descargas
   dinámicas por JS (no hay links directos a SHP), pero el mismo repositorio
   publica un WFS 2.0 abierto bajo Ley 27.275, y eso es lo que consumimos.
2. IPEC Misiones — Descarga directa de XLSX/PDF publicados en
   ``www.ipec.misiones.gov.ar/wp-content/uploads/``. El CENSO 2022 de
   Misiones sólo está disponible a nivel municipio/departamento en XLSX
   y temáticos en PDF; **no hay microdatos por radio censal abiertos**
   al 2026-04, así que se baja el XLSX municipal + los PDF temáticos.
3. IDE Misiones — WFS de GeoNode público en
   ``https://ide.ordenamientoterritorial.misiones.gob.ar/geoserver/ows``.

Uso
---
::

    python scripts/45_datos_oficiales_ar.py --todo
    python scripts/45_datos_oficiales_ar.py ign
    python scripts/45_datos_oficiales_ar.py ipec
    python scripts/45_datos_oficiales_ar.py ide-misiones
    python scripts/45_datos_oficiales_ar.py recortar   # recorta lo ya descargado

Salidas
-------
- ``data/raw/ign/ign_{capa}.geojson`` — capas WFS IGN crudas (bbox Posadas).
- ``data/raw/ipec/*.xlsx`` y ``*.pdf`` + ``data/raw/ipec/README.md``.
- ``data/raw/ide_misiones/*.geojson`` — capas WFS IDE Misiones crudas.
- ``data/processed/capas_oficiales/{capa}_posadas.geojson`` — recortes.
- ``data/raw/{fuente}/_metadata/{capa}.json`` — metadata por capa.

Todas las descargas cachean por MD5 y respetan ``--force`` para refrescar.
Licencia: IGN y IDE Misiones se publican como dato abierto nacional/provincial
(Ley 27.275). IPEC también publica bajo régimen de información pública.
"""

from __future__ import annotations

import hashlib
import json
import signal
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

import click
import requests
from loguru import logger

try:
    import geopandas as gpd  # type: ignore
    from shapely.geometry import box  # type: ignore
except ImportError:  # pragma: no cover
    gpd = None  # type: ignore
    box = None  # type: ignore

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
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

from scripts.utils.config import BBox, Settings, load_settings
from scripts.utils.io_geo import cache_check
from scripts.utils.logger import setup_logger
from scripts.utils.paths import ensure_dir, ensure_parent, resolve_path

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

SCRIPT_VERSION = "0.1.0"

HTTP_TIMEOUT_SEC = 60
MAX_RETRIES = 3
BACKOFF_BASE_SEC = 4.0

USER_AGENT = "observatorio-urbano-posadas/0.1 (+datos-oficiales-ar)"

# --- IGN ---
IGN_WFS_ENDPOINT = "https://wms.ign.gob.ar/geoserver/wfs"

# Capas IGN elegidas por pertinencia urbana. Los nombres salen del
# GetCapabilities oficial (mapa WFS IGN a fecha 2026-04):
#  - provincia, departamento, pais                  → límites administrativos
#  - vial_nacional, vial_provincial, vial_terciaria → red vial
#  - lineas_de_aguas_continentales_perenne          → ríos (línea, perennes)
#  - areas_de_aguas_continentales_perenne           → cuerpos de agua (polígonos)
#  - puntos_de_transporte_aereo_GB005               → aeropuertos
#  - puntos_de_transporte_aereo_GB001               → aeródromos
#  - localidad_bahra                                → localidades BAHRA
IGN_CAPAS: Dict[str, str] = {
    "provincia": "ign:provincia",
    "departamento": "ign:departamento",
    # 'ign:pais' quedó afuera a propósito: es el polígono completo de Argentina
    # (~40 MB GeoJSON) y para un bbox de Posadas no aporta más que 'provincia'.
    # Además pyogrio rechaza por default features > 32 MB.
    "vial_nacional": "ign:vial_nacional",
    "vial_provincial": "ign:vial_provincial",
    "vial_terciaria": "ign:vial_terciaria",
    "hidrografia_lineas": "ign:lineas_de_aguas_continentales_perenne",
    "hidrografia_areas": "ign:areas_de_aguas_continentales_perenne",
    "aeropuertos": "ign:puntos_de_transporte_aereo_GB005",
    "aerodromos": "ign:puntos_de_transporte_aereo_GB001",
    "localidad_bahra": "ign:localidad_bahra",
}

# --- IPEC ---
# Descargas directas conocidas al 2026-04. El sitio de IPEC no tiene API
# estructurada, pero publica los XLSX/PDF bajo /wp-content/uploads/ con URLs
# estables. Confirmadas accesibles sin login.
IPEC_ARCHIVOS: List[Dict[str, str]] = [
    {
        "nombre": "censo_2022_poblacion_viviendas_municipios.xlsx",
        "url": (
            "https://www.ipec.misiones.gov.ar/wp-content/uploads/2025/01/"
            "IPEC_Misiones_MUNICIPIOS-Poblacion-y-Viviendas-por-municipio-CNPHyV-2022.xlsx"
        ),
        "tipo": "xlsx",
        "descripcion": "CENSO 2022: población y viviendas por municipio (nivel municipal).",
    },
    {
        "nombre": "censo_2022_urbano_rural_municipios.xlsx",
        "url": (
            "https://www.ipec.misiones.gov.ar/wp-content/uploads/2025/03/"
            "IPEC_Misiones_MUNICIPIOS-Poblacion-urbana-rural-por-municipio-CNPHyV-2022.xlsx"
        ),
        "tipo": "xlsx",
        "descripcion": "CENSO 2022: población urbana y rural por municipio.",
    },
    {
        "nombre": "censo_2022_procedencia_agua.xlsx",
        "url": (
            "https://www.ipec.misiones.gov.ar/wp-content/uploads/2025/03/"
            "IPEC_Misiones_Poblacion-segun-procedencia-del-agua-por-municipio-CNPHyV-2022.xlsx"
        ),
        "tipo": "xlsx",
        "descripcion": "CENSO 2022: población según procedencia del agua, por municipio.",
    },
    {
        "nombre": "censo_2022_provision_agua.xlsx",
        "url": (
            "https://www.ipec.misiones.gov.ar/wp-content/uploads/2025/03/"
            "IPEC_Misiones_Poblacion-segun-provision-del-agua-por-municipio-CNPHyV-2022.xlsx"
        ),
        "tipo": "xlsx",
        "descripcion": "CENSO 2022: población según provisión del agua, por municipio.",
    },
    {
        "nombre": "censo_2022_indicadores_demograficos.pdf",
        "url": (
            "https://www.ipec.misiones.gov.ar/wp-content/uploads/2023/11/"
            "IPEC-Misiones-Censo-2023-Indicadores-demograficos-por-sexo-y-edad.pdf"
        ),
        "tipo": "pdf",
        "descripcion": "CENSO 2022: indicadores demográficos por sexo y edad (PDF informe).",
    },
    {
        "nombre": "censo_2022_condiciones_habitacionales.pdf",
        "url": (
            "https://www.ipec.misiones.gov.ar/wp-content/uploads/2023/11/"
            "IPEC-Misiones-Censo-2023-Condiciones-habitacionales-de-PHV.pdf"
        ),
        "tipo": "pdf",
        "descripcion": "CENSO 2022: condiciones habitacionales de la población (PDF informe).",
    },
    {
        "nombre": "censo_2022_salud_prevision_social.pdf",
        "url": (
            "https://www.ipec.misiones.gov.ar/wp-content/uploads/2023/11/"
            "IPEC-Misiones-Censo-2022-Salud-y-prevision-social.pdf"
        ),
        "tipo": "pdf",
        "descripcion": "CENSO 2022: salud y previsión social (PDF informe).",
    },
    {
        "nombre": "censo_2022_educacion.pdf",
        "url": (
            "https://ipec.misiones.gov.ar/wp-content/uploads/2023/12/"
            "IPEC-Misiones-Censo-2022-Educacion.pdf"
        ),
        "tipo": "pdf",
        "descripcion": "CENSO 2022: educación (PDF informe).",
    },
    {
        "nombre": "censo_2022_departamentos_variacion.xlsx",
        "url": ("https://censo.gob.ar/wp-content/uploads/2023/11/" "c2022_misiones_est_c1_14.xlsx"),
        "tipo": "xlsx",
        "descripcion": "CENSO 2022: población por departamento y variación 2010-2022 (INDEC).",
    },
    {
        "nombre": "censo_2022_departamentos_densidad.xlsx",
        "url": ("https://censo.gob.ar/wp-content/uploads/2023/11/" "c2022_misiones_est_c2_14.xlsx"),
        "tipo": "xlsx",
        "descripcion": "CENSO 2022: población y densidad por departamento (INDEC).",
    },
]

# --- IDE Misiones ---
IDE_MISIONES_WFS = "https://ide.ordenamientoterritorial.misiones.gob.ar/geoserver/ows"

# Del GetCapabilities WFS (2026-04). El GeoNode expone pocas capas y varias
# tienen hashes al final del nombre (son IDs internos de GeoNode).
IDE_MISIONES_CAPAS: Dict[str, str] = {
    "departamentos_misiones": "geonode:departamentos_2023",
    "municipios_misiones": "geonode:municipios_2023_aa769cb642b553a91c78e51f745ba037",
    "areas_protegidas": "geonode:anp_nov2023_wgs84",
    "comunidades_mbya": "geonode:comunidades_mbya",
    "corredor_verde": "geonode:corredor_verde_d15d752827fdd8ff59656584b476d4d3",
    "redes_viales_misiones": "geonode:redes_misiones_v2",
    "mojones_km_asfaltadas": "geonode:mojones_kilometricos_asfaltadas",
    "agua_potable_accesorios": "geonode:accesorios_agua_potable",
    "agua_potable_infraestructura": "geonode:infraestructura_agua_potable",
    "planta_tratamiento_posadas": "geonode:planta_tratamiento_posadas",
    "edafologico": "geonode:edafologico",
}


_INTERRUPTED = False


def _install_sigint_handler() -> None:
    """Instala handler SIGINT para cortar entre descargas, sin kill abrupto."""

    def _handler(signum, frame):  # noqa: ANN001
        global _INTERRUPTED
        _INTERRUPTED = True
        logger.warning("Ctrl+C recibido — termino tras la descarga actual.")

    signal.signal(signal.SIGINT, _handler)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


# Hosts gov.ar que sirven la cadena TLS mal armada (no publican intermediates
# Sectigo) y para los que aceptamos degradar la verificación a nivel transport.
# La lista se arma runtime: entran hosts acá cuando un intento inicial falla
# por SSLError. Se loggea con WARNING para que quede traza.
_SSL_INSECURE_HOSTS: Set[str] = set()


def _normalizar_url(url: str) -> str:
    """Normaliza URLs conocidas con problemas (ej. falta de ``www.``)."""
    # ipec.misiones.gov.ar sin www responde con cert válido sólo para
    # www.ipec.misiones.gov.ar. Forzamos el www al menos.
    if url.startswith("https://ipec.misiones.gov.ar/"):
        return url.replace("https://ipec.misiones.gov.ar/", "https://www.ipec.misiones.gov.ar/", 1)
    return url


def _build_session() -> requests.Session:
    """Session de requests con User-Agent del proyecto y Accept genérico."""
    # Silenciamos la advertencia repetitiva de urllib3 cuando degradamos a
    # verify=False (ya loggeamos nosotros con WARNING la primera vez).
    try:
        import urllib3

        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
        }
    )
    return s


def _http_get(
    session: requests.Session,
    url: str,
    *,
    stream: bool = False,
    params: Optional[Dict[str, str]] = None,
) -> requests.Response:
    """GET con retry/backoff. Devuelve Response o levanta tras MAX_RETRIES.

    Si detecta un ``SSLError`` por cadena incompleta (común en servidores
    ``*.gob.ar`` mal configurados), marca el host como "cadena rota" y
    reintenta con ``verify=False`` dejando traza en log. No se hace silencioso:
    cada degradación queda loggeada con WARNING.
    """
    url = _normalizar_url(url)
    host = urlparse(url).hostname or ""

    last_err: Optional[Exception] = None
    for intento in range(1, MAX_RETRIES + 1):
        if _INTERRUPTED:
            raise KeyboardInterrupt()
        verify = host not in _SSL_INSECURE_HOSTS
        try:
            resp = session.get(
                url,
                stream=stream,
                params=params,
                timeout=HTTP_TIMEOUT_SEC,
                allow_redirects=True,
                verify=verify,
            )
        except requests.exceptions.SSLError as exc:
            # Degradamos este host y reintentamos sin verify inmediatamente.
            if host and host not in _SSL_INSECURE_HOSTS:
                _SSL_INSECURE_HOSTS.add(host)
                logger.warning(
                    f"SSL roto en {host} ({exc.__class__.__name__}). "
                    f"Cadena de certs incompleta (común en *.gob.ar). "
                    f"Continúo sin verificación TLS SÓLO para este host."
                )
                continue  # reintenta sin contar como reintento
            last_err = exc
            delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
            logger.warning(
                f"GET {url} SSL falló otra vez ({exc}). "
                f"Retry {intento}/{MAX_RETRIES} en {delay:.1f}s."
            )
            time.sleep(delay)
            continue
        except requests.RequestException as exc:
            last_err = exc
            delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
            logger.warning(
                f"GET {url} falló ({exc.__class__.__name__}: {exc}). "
                f"Retry {intento}/{MAX_RETRIES} en {delay:.1f}s."
            )
            time.sleep(delay)
            continue

        if resp.status_code == 200:
            return resp
        if resp.status_code in (429, 500, 502, 503, 504):
            delay = BACKOFF_BASE_SEC * (2 ** (intento - 1))
            logger.warning(f"GET {url} → {resp.status_code}. Retry en {delay:.1f}s.")
            time.sleep(delay)
            continue

        # 4xx distintos a 429 → no reintento, error del cliente o URL rota.
        raise RuntimeError(f"GET {url} respondió {resp.status_code}: {resp.text[:300]}")

    raise RuntimeError(f"GET {url} agotó {MAX_RETRIES} intentos. Último error: {last_err}")


def _download_to_file(
    session: requests.Session,
    url: str,
    dest: Path,
    *,
    params: Optional[Dict[str, str]] = None,
) -> Tuple[int, str]:
    """Descarga ``url`` a ``dest`` en streaming. Devuelve (bytes, md5)."""
    ensure_parent(dest)
    resp = _http_get(session, url, stream=True, params=params)
    md5 = hashlib.md5()
    total = 0
    with dest.open("wb") as fh:
        for chunk in resp.iter_content(chunk_size=65536):
            if not chunk:
                continue
            fh.write(chunk)
            md5.update(chunk)
            total += len(chunk)
    return total, md5.hexdigest()


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


@dataclass
class CapaMetadata:
    """Metadata persistida por cada capa/archivo descargado."""

    capa: str
    fuente: str
    licencia: str
    url: str
    archivo: str
    bytes: int
    md5: str
    fecha_descarga: str
    extras: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "capa": self.capa,
            "fuente": self.fuente,
            "licencia": self.licencia,
            "url": self.url,
            "archivo": self.archivo,
            "bytes": self.bytes,
            "md5": self.md5,
            "fecha_descarga": self.fecha_descarga,
            "script_version": SCRIPT_VERSION,
        }
        d.update(self.extras)
        return d


def _write_metadata(meta: CapaMetadata, base_dir: Path) -> Path:
    """Escribe la metadata en ``_metadata/{capa}.json`` bajo ``base_dir``."""
    meta_dir = ensure_dir(base_dir / "_metadata")
    out = meta_dir / f"{meta.capa}.json"
    with out.open("w", encoding="utf-8") as fh:
        json.dump(meta.to_dict(), fh, ensure_ascii=False, indent=2)
    return out


# ---------------------------------------------------------------------------
# IGN — WFS
# ---------------------------------------------------------------------------


def _wfs_getfeature_params(
    type_name: str,
    bbox: BBox,
    *,
    srs: str = "EPSG:4326",
    version: str = "2.0.0",
) -> Dict[str, str]:
    """Params WFS GetFeature con bbox correcto para GeoServer 2.x.

    El orden del bbox en WFS 2.0 con ``EPSG:4326`` depende del servidor; IGN
    acepta ``oeste,sur,este,norte,EPSG:4326`` como el resto de los GeoServers
    en modo compatible, así que lo pasamos así (confirmado empíricamente).
    """
    bbox_str = f"{bbox.oeste},{bbox.sur},{bbox.este},{bbox.norte},{srs}"
    return {
        "service": "WFS",
        "version": version,
        "request": "GetFeature",
        "typeNames": type_name,
        "srsName": srs,
        "outputFormat": "application/json",
        "bbox": bbox_str,
    }


def _descargar_wfs(
    session: requests.Session,
    endpoint: str,
    capa_alias: str,
    type_name: str,
    bbox: BBox,
    out_dir: Path,
    fuente: str,
    licencia: str,
    *,
    force: bool = False,
) -> Optional[CapaMetadata]:
    """Descarga una capa WFS como GeoJSON al bbox pedido.

    Devuelve ``None`` si la capa no trae features (se loggea pero no se escribe
    el archivo para no generar placeholders vacíos).
    """
    out_path = out_dir / f"{fuente}_{capa_alias}.geojson"
    if not force and cache_check(out_path):
        size = out_path.stat().st_size
        logger.info(f"Cache hit: {out_path.name} ({size:,} bytes)")
        return None

    params = _wfs_getfeature_params(type_name, bbox)
    logger.info(f"WFS GetFeature {fuente}/{capa_alias} → {type_name}")
    try:
        bytes_dl, md5 = _download_to_file(session, endpoint, out_path, params=params)
    except Exception as exc:
        logger.error(f"Falló descarga {fuente}/{capa_alias}: {exc}")
        # Limpio archivo parcial si quedó
        if out_path.exists():
            try:
                out_path.unlink()
            except OSError:
                pass
        return None

    # Validar JSON y contar features. Si no es JSON, lo marcamos como basura.
    try:
        with out_path.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        logger.error(
            f"{fuente}/{capa_alias} no devolvió JSON válido "
            f"(primeros 200 bytes: {out_path.read_bytes()[:200]!r}). Error: {exc}"
        )
        out_path.unlink(missing_ok=True)
        return None

    features = data.get("features") or []
    n = len(features)
    if n == 0:
        logger.warning(f"{fuente}/{capa_alias}: 0 features dentro del bbox — borro archivo vacío.")
        out_path.unlink(missing_ok=True)
        return None

    meta = CapaMetadata(
        capa=capa_alias,
        fuente=fuente,
        licencia=licencia,
        url=f"{endpoint}?{_querystring(params)}",
        archivo=(
            str(out_path.relative_to(resolve_path(".")))
            if out_path.is_absolute()
            else str(out_path)
        ),
        bytes=bytes_dl,
        md5=md5,
        fecha_descarga=datetime.now(timezone.utc).isoformat(),
        extras={"n_features": n, "type_name": type_name},
    )
    _write_metadata(meta, out_dir)
    logger.success(f"{fuente}/{capa_alias}: {n} features, {bytes_dl/1024:.1f} KB → {out_path.name}")
    return meta


def _querystring(params: Dict[str, str]) -> str:
    """Arma querystring simple (sin url-encode agresivo, sólo para log/meta)."""
    return "&".join(f"{k}={v}" for k, v in params.items())


def cmd_ign(settings: Settings, *, force: bool) -> List[CapaMetadata]:
    """Descarga las capas IGN seleccionadas al bbox de Posadas."""
    if gpd is None:
        raise RuntimeError("geopandas no está instalado — abortando IGN.")
    out_dir = ensure_dir(resolve_path("data/raw/ign"))
    session = _build_session()
    results: List[CapaMetadata] = []
    licencia = "Ley 27.275 — Datos públicos IGN (acceso, uso y redistribución libres)."
    for alias, type_name in IGN_CAPAS.items():
        if _INTERRUPTED:
            logger.warning("IGN: interrumpido por el usuario.")
            break
        m = _descargar_wfs(
            session,
            IGN_WFS_ENDPOINT,
            alias,
            type_name,
            settings.geografia.bbox,
            out_dir,
            fuente="ign",
            licencia=licencia,
            force=force,
        )
        if m is not None:
            results.append(m)
    return results


# ---------------------------------------------------------------------------
# IDE Misiones — WFS
# ---------------------------------------------------------------------------


def cmd_ide_misiones(settings: Settings, *, force: bool) -> List[CapaMetadata]:
    """Descarga las capas IDE Misiones al bbox de Posadas."""
    if gpd is None:
        raise RuntimeError("geopandas no está instalado — abortando IDE Misiones.")
    out_dir = ensure_dir(resolve_path("data/raw/ide_misiones"))
    session = _build_session()
    results: List[CapaMetadata] = []
    licencia = "Dato abierto IDE Misiones / GeoNode provincial (uso público)."
    for alias, type_name in IDE_MISIONES_CAPAS.items():
        if _INTERRUPTED:
            logger.warning("IDE Misiones: interrumpido por el usuario.")
            break
        m = _descargar_wfs(
            session,
            IDE_MISIONES_WFS,
            alias,
            type_name,
            settings.geografia.bbox,
            out_dir,
            fuente="ide_misiones",
            licencia=licencia,
            force=force,
        )
        if m is not None:
            results.append(m)
    return results


# ---------------------------------------------------------------------------
# IPEC — descarga directa de XLSX/PDF
# ---------------------------------------------------------------------------


def cmd_ipec(*, force: bool) -> List[CapaMetadata]:
    """Descarga los archivos XLSX/PDF publicados por IPEC Misiones (CENSO 2022)."""
    out_dir = ensure_dir(resolve_path("data/raw/ipec"))
    session = _build_session()
    results_nuevos: List[CapaMetadata] = []
    cached: List[Dict[str, Any]] = []
    licencia = (
        "IPEC Misiones + INDEC: publicaciones CENSO 2022 bajo régimen de "
        "información pública (Ley 27.275). Uso con atribución."
    )
    fallos: List[Tuple[str, str]] = []

    for item in IPEC_ARCHIVOS:
        if _INTERRUPTED:
            logger.warning("IPEC: interrumpido por el usuario.")
            break
        nombre = item["nombre"]
        url = item["url"]
        dest = out_dir / nombre
        if not force and cache_check(dest):
            size = dest.stat().st_size
            logger.info(f"Cache hit IPEC {nombre} ({size:,} bytes)")
            cached.append({**item, "bytes": size})
            continue
        logger.info(f"IPEC → {nombre}")
        try:
            bytes_dl, md5 = _download_to_file(session, url, dest)
        except Exception as exc:
            logger.error(f"Falló {nombre}: {exc}")
            fallos.append((nombre, str(exc)))
            if dest.exists():
                try:
                    dest.unlink()
                except OSError:
                    pass
            continue
        meta = CapaMetadata(
            capa=Path(nombre).stem,
            fuente="ipec",
            licencia=licencia,
            url=url,
            archivo=str(dest),
            bytes=bytes_dl,
            md5=md5,
            fecha_descarga=datetime.now(timezone.utc).isoformat(),
            extras={
                "tipo": item["tipo"],
                "descripcion": item["descripcion"],
            },
        )
        _write_metadata(meta, out_dir)
        results_nuevos.append(meta)
        logger.success(f"IPEC {nombre}: {bytes_dl/1024:.1f} KB")

    _escribir_readme_ipec(out_dir, results_nuevos, cached, fallos)
    return results_nuevos


def _escribir_readme_ipec(
    out_dir: Path,
    nuevos: List[CapaMetadata],
    cached: List[Dict[str, Any]],
    fallos: List[Tuple[str, str]],
) -> Path:
    """Escribe un README.md con estado de descargas IPEC y limitaciones.

    Incluye los archivos descargados en esta corrida ``nuevos`` + los que
    estaban cacheados ``cached`` + los que fallaron ``fallos``, para que el
    README refleje el estado completo del directorio y no sólo el delta.
    """
    lines: List[str] = []
    lines.append("# IPEC Misiones — CENSO 2022 (descargas oficiales)")
    lines.append("")
    lines.append(
        "Este directorio contiene los archivos CENSO 2022 publicados por "
        "IPEC Misiones y el INDEC, descargados en forma pública directa."
    )
    lines.append("")
    lines.append("## Limitaciones detectadas")
    lines.append("")
    lines.append(
        "- **Microdatos por radio censal**: IPEC no publica a la fecha "
        "(2026-04) un dataset abierto con desagregación por radio censal "
        "ni por fracción. Toda la información cuantitativa pública es a "
        "nivel municipio o departamento, en XLSX. No se descargó CSV de "
        "radios censales porque no existe como recurso público directo."
    )
    lines.append(
        "- Algunos informes temáticos (salud, educación, condiciones "
        "habitacionales, indicadores demográficos) sólo están en PDF; se "
        "descargaron igual para consulta, pero no son datos estructurados."
    )
    lines.append(
        "- URLs bajo ``wp-content/uploads/`` son estables pero no versionadas; "
        "si IPEC re-sube con otro nombre, hay que actualizar este script."
    )
    lines.append(
        "- El dominio ``ipec.misiones.gov.ar`` sin ``www.`` presenta "
        "certificado TLS inválido; el script reescribe la URL al host con "
        "``www.`` al vuelo. ``censo.gob.ar`` sirve cadena TLS incompleta "
        "(no publica intermediate), por lo que se degrada la verificación "
        "TLS SÓLO para ese host (se loggea con WARNING)."
    )
    lines.append("")
    lines.append("## Archivos descargados (esta corrida)")
    lines.append("")
    if not nuevos:
        lines.append("_(ninguno — todos eran cache hit o todos fallaron)_")
    for m in nuevos:
        size_kb = m.bytes / 1024
        tipo = m.extras.get("tipo", "?")
        desc = m.extras.get("descripcion", "")
        lines.append(f"- **{m.capa}** ({tipo}, {size_kb:.1f} KB) — {desc}")
        lines.append(f"  - URL: {m.url}")
    lines.append("")
    lines.append("## Archivos en caché (corridas previas)")
    lines.append("")
    if not cached:
        lines.append("_(ninguno)_")
    for item in cached:
        size_kb = item.get("bytes", 0) / 1024
        nombre = Path(item["nombre"]).stem
        tipo = item.get("tipo", "?")
        desc = item.get("descripcion", "")
        lines.append(f"- **{nombre}** ({tipo}, {size_kb:.1f} KB) — {desc}")
        lines.append(f"  - URL: {item['url']}")
    lines.append("")
    lines.append("## Descargas fallidas")
    lines.append("")
    if not fallos:
        lines.append("_(ninguna)_")
    else:
        for nombre, err in fallos:
            lines.append(f"- **{nombre}** — {err}")
    lines.append("")
    lines.append(f"_Generado por scripts/45_datos_oficiales_ar.py v{SCRIPT_VERSION}._")
    readme = out_dir / "README.md"
    readme.write_text("\n".join(lines), encoding="utf-8")
    logger.info(f"README IPEC escrito: {readme}")
    return readme


# ---------------------------------------------------------------------------
# Recorte al bbox Posadas (step post-proceso)
# ---------------------------------------------------------------------------


def cmd_recortar(settings: Settings) -> List[Path]:
    """Recorta todo GeoJSON en data/raw/{ign,ide_misiones} al bbox Posadas.

    Las descargas WFS ya vienen filtradas por bbox, pero puede haber features
    cuyas geometrías crucen el bbox. Usamos ``gpd.clip()`` para dejarlas
    exactamente dentro. Salida en ``data/processed/capas_oficiales/``.
    """
    if gpd is None or box is None:
        raise RuntimeError("geopandas/shapely no disponibles — abortando recorte.")
    bbox = settings.geografia.bbox
    clip_geom = box(bbox.oeste, bbox.sur, bbox.este, bbox.norte)
    clip_gdf = gpd.GeoDataFrame(geometry=[clip_geom], crs="EPSG:4326")

    out_dir = ensure_dir(resolve_path("data/processed/capas_oficiales"))
    entradas: List[Tuple[str, Path]] = []
    for fuente in ("ign", "ide_misiones"):
        src = resolve_path(f"data/raw/{fuente}")
        if not src.exists():
            continue
        for p in sorted(src.glob("*.geojson")):
            entradas.append((fuente, p))

    escritos: List[Path] = []
    for fuente, src in entradas:
        if _INTERRUPTED:
            logger.warning("Recorte: interrumpido por el usuario.")
            break
        capa_nombre = src.stem  # ej. "ign_provincia"
        dest = out_dir / f"{capa_nombre}_posadas.geojson"
        try:
            gdf = gpd.read_file(src)
        except Exception as exc:
            logger.error(f"No pude leer {src}: {exc}")
            continue
        if gdf.empty:
            logger.warning(f"{src.name}: GeoDataFrame vacío, salteo.")
            continue
        if gdf.crs is None:
            gdf = gdf.set_crs(epsg=4326)
        elif gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(epsg=4326)

        try:
            clipped = gpd.clip(gdf, clip_gdf.to_crs(gdf.crs), keep_geom_type=False)
        except Exception as exc:
            logger.error(f"clip() falló en {src.name}: {exc}")
            continue

        if clipped.empty:
            logger.warning(f"{src.name}: sin features tras clip al bbox Posadas — salteo.")
            continue

        ensure_parent(dest)
        # Sobrescribo siempre; el recorte es barato y evita archivos stale.
        clipped.to_file(dest, driver="GeoJSON")
        logger.success(
            f"Recortado {src.name} → {dest.name} "
            f"({len(clipped)} features, {dest.stat().st_size/1024:.1f} KB)"
        )
        escritos.append(dest)

    return escritos


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


@click.group(invoke_without_command=True)
@click.option(
    "--todo",
    is_flag=True,
    default=False,
    help="Ejecuta ign + ipec + ide-misiones + recortar en orden.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Ignora caché y re-descarga todo.",
)
@click.pass_context
def cli(ctx: click.Context, todo: bool, force: bool) -> None:
    """Descarga de datos oficiales argentinos: IGN + IPEC + IDE Misiones."""
    setup_logger()
    _install_sigint_handler()
    ctx.ensure_object(dict)
    ctx.obj["force"] = force
    ctx.obj["settings"] = load_settings()

    if todo and ctx.invoked_subcommand is None:
        _run_todo(ctx.obj["settings"], force=force)
        return

    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


def _run_todo(settings: Settings, *, force: bool) -> None:
    """Ejecuta los cuatro pasos en secuencia, con resumen al final."""
    logger.info(f"=== --todo: IGN + IPEC + IDE Misiones + recorte (force={force}) ===")
    ign_res: List[CapaMetadata] = []
    ide_res: List[CapaMetadata] = []
    ipec_res: List[CapaMetadata] = []
    recortes: List[Path] = []
    try:
        ign_res = cmd_ign(settings, force=force)
    except Exception as exc:
        logger.exception(f"IGN falló entero: {exc}")
    try:
        ipec_res = cmd_ipec(force=force)
    except Exception as exc:
        logger.exception(f"IPEC falló entero: {exc}")
    try:
        ide_res = cmd_ide_misiones(settings, force=force)
    except Exception as exc:
        logger.exception(f"IDE Misiones falló entero: {exc}")
    try:
        recortes = cmd_recortar(settings)
    except Exception as exc:
        logger.exception(f"Recorte falló: {exc}")

    logger.info("=== Resumen ===")
    logger.info(f"IGN capas descargadas: {len(ign_res)}")
    logger.info(f"IPEC archivos descargados: {len(ipec_res)}")
    logger.info(f"IDE Misiones capas descargadas: {len(ide_res)}")
    logger.info(f"Recortes generados: {len(recortes)}")


@cli.command("ign")
@click.pass_context
def cli_ign(ctx: click.Context) -> None:
    """Descarga capas IGN (provincia, vial, hidrografía, aeropuertos)."""
    cmd_ign(ctx.obj["settings"], force=ctx.obj["force"])


@cli.command("ipec")
@click.pass_context
def cli_ipec(ctx: click.Context) -> None:
    """Descarga archivos IPEC Misiones CENSO 2022 (XLSX + PDF)."""
    cmd_ipec(force=ctx.obj["force"])


@cli.command("ide-misiones")
@click.pass_context
def cli_ide(ctx: click.Context) -> None:
    """Descarga capas IDE Misiones (departamentos, áreas protegidas, red vial)."""
    cmd_ide_misiones(ctx.obj["settings"], force=ctx.obj["force"])


@cli.command("recortar")
@click.pass_context
def cli_recortar(ctx: click.Context) -> None:
    """Recorta los GeoJSON ya descargados al bbox Posadas."""
    cmd_recortar(ctx.obj["settings"])


if __name__ == "__main__":
    cli(obj={})
