"""Carga unificada de configuración del Observatorio Urbano Posadas.

Lee `config/settings.yaml` y las variables de `.env` (opcional) y las
expone como un objeto `Settings` basado en dataclasses del stdlib
(sin pydantic a propósito, para minimizar dependencias).

Uso:
    from scripts.utils.config import load_settings

    settings = load_settings()
    print(settings.geografia.bbox.oeste, settings.sentinel2.cloud_threshold)

Si `settings.yaml` no existe, se crea un Settings con valores por default
razonables para Posadas. Las variables de entorno relevantes
(EE_PROJECT_ID, PLANET_API_KEY, etc.) se leen con python-dotenv.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import yaml
from dotenv import load_dotenv

from scripts.utils.paths import project_root, resolve_path

# ---------------------------------------------------------------------------
# Dataclasses que estructuran el settings.yaml
# ---------------------------------------------------------------------------


@dataclass
class Proyecto:
    """Metadata del proyecto."""

    nombre: str = "Observatorio Urbano Posadas"
    version: str = "0.1.0"
    autor: str = ""


@dataclass
class BBox:
    """Bounding box en grados decimales (WGS84)."""

    norte: float = -27.30
    sur: float = -27.50
    este: float = -55.80
    oeste: float = -56.00

    def as_tuple(self) -> tuple:
        """Devuelve (oeste, sur, este, norte) — orden rasterio/GEE compatible."""
        return (self.oeste, self.sur, self.este, self.norte)


@dataclass
class Geografia:
    """Configuración geográfica del área de interés."""

    ciudad: str = "Posadas"
    provincia: str = "Misiones"
    pais: str = "Argentina"
    centro_lat: float = -27.3667
    centro_lon: float = -55.8967
    bbox: BBox = field(default_factory=BBox)
    crs_metrico: str = "EPSG:32721"  # UTM 21S


@dataclass
class Sentinel2:
    """Parámetros de descarga y procesamiento Sentinel-2."""

    cloud_threshold: int = 20
    bandas_rgb: List[str] = field(default_factory=lambda: ["B4", "B3", "B2"])
    bandas_analisis: List[str] = field(
        default_factory=lambda: ["B2", "B3", "B4", "B8", "B11", "B12"]
    )
    meses_composite: List[int] = field(default_factory=lambda: [6, 7, 8])
    fechas_target: List[str] = field(
        default_factory=lambda: [
            "2018-07",
            "2019-07",
            "2020-07",
            "2021-07",
            "2022-07",
            "2023-07",
            "2024-07",
            "2025-07",
            "2026-07",
        ]
    )


@dataclass
class PlanetNICFI:
    """Flags de Planet NICFI (Fase 2)."""

    habilitado: bool = False
    primer_mes: str = "2020-09"


@dataclass
class Edificios:
    """Configuración de detección de edificios."""

    fuente_principal: str = "google_open_buildings"
    confidence_threshold: float = 0.70
    margen_error_pct: int = 15


@dataclass
class Poblacion:
    """Configuración de estimación de población."""

    fuente: str = "worldpop_2020"
    personas_por_vivienda_misiones: float = 3.6
    factor_correccion_ninos: float = 0.30


@dataclass
class ServiciosOSM:
    """Servicios OSM a consultar vía Overpass."""

    radio_busqueda_metros: int = 2000
    servicios: List[str] = field(
        default_factory=lambda: [
            "amenity=clinic",
            "amenity=hospital",
            "amenity=school",
            "amenity=kindergarten",
            "amenity=pharmacy",
            "highway=bus_stop",
        ]
    )


@dataclass
class ReportePaleta:
    """Paleta de colores institucional."""

    primario: str = "#1a3a5c"
    secundario: str = "#5a7a9c"
    fondo: str = "#ffffff"
    texto: str = "#222222"
    acento: str = "#c97d3c"


@dataclass
class Reportes:
    """Configuración de reportes PDF."""

    formato_fecha: str = "%B %Y"
    paleta: ReportePaleta = field(default_factory=ReportePaleta)
    fuente: str = "Inter"


@dataclass
class Logging:
    """Configuración de logging."""

    nivel: str = "INFO"
    archivo: str = "logs/observatorio.log"
    rotacion: str = "10 MB"


@dataclass
class Env:
    """Variables de entorno sensibles (cargadas desde .env)."""

    ee_project_id: Optional[str] = None
    ee_service_account_file: Optional[str] = None
    planet_api_key: Optional[str] = None
    google_maps_api_key: Optional[str] = None
    output_dir: Optional[str] = None
    cache_dir: Optional[str] = None


@dataclass
class Settings:
    """Raíz de configuración. Todo el sistema depende de esto."""

    proyecto: Proyecto = field(default_factory=Proyecto)
    geografia: Geografia = field(default_factory=Geografia)
    sentinel2: Sentinel2 = field(default_factory=Sentinel2)
    planet_nicfi: PlanetNICFI = field(default_factory=PlanetNICFI)
    edificios: Edificios = field(default_factory=Edificios)
    poblacion: Poblacion = field(default_factory=Poblacion)
    servicios_osm: ServiciosOSM = field(default_factory=ServiciosOSM)
    reportes: Reportes = field(default_factory=Reportes)
    logging: Logging = field(default_factory=Logging)
    env: Env = field(default_factory=Env)


# ---------------------------------------------------------------------------
# Carga
# ---------------------------------------------------------------------------


def _merge_dict_into_dataclass(dc_instance, data: dict) -> None:
    """Aplica recursivamente valores de un dict sobre una instancia dataclass.

    Solo sobreescribe campos que existan en la dataclass. Si un campo es otra
    dataclass, recurre. Si es una lista o un escalar, asigna directamente.
    Es permisivo: ignora claves desconocidas para no romper con settings.yaml
    que tengan extensiones futuras.
    """
    if not isinstance(data, dict):
        return
    for key, value in data.items():
        if not hasattr(dc_instance, key):
            # Ignoramos claves no reconocidas (forward compat).
            continue
        current = getattr(dc_instance, key)
        # Si el atributo es otra dataclass y value es dict → recursión.
        if hasattr(current, "__dataclass_fields__") and isinstance(value, dict):
            _merge_dict_into_dataclass(current, value)
        else:
            setattr(dc_instance, key, value)


def _load_env(env_path: Optional[Path] = None) -> Env:
    """Carga variables de entorno desde .env (si existe) y arma un Env.

    Args:
        env_path: Ruta al .env. Si es None, busca en la raíz del proyecto.

    Returns:
        Instancia Env con lo que haya encontrado.
    """
    if env_path is None:
        env_path = project_root() / ".env"
    # load_dotenv es no-op si el archivo no existe.
    load_dotenv(dotenv_path=env_path, override=False)
    return Env(
        ee_project_id=os.getenv("EE_PROJECT_ID") or None,
        ee_service_account_file=os.getenv("EE_SERVICE_ACCOUNT_FILE") or None,
        planet_api_key=os.getenv("PLANET_API_KEY") or None,
        google_maps_api_key=os.getenv("GOOGLE_MAPS_API_KEY") or None,
        output_dir=os.getenv("OUTPUT_DIR") or None,
        cache_dir=os.getenv("CACHE_DIR") or None,
    )


def load_settings(
    settings_path: Optional[Path] = None,
    env_path: Optional[Path] = None,
) -> Settings:
    """Carga settings.yaml + .env y devuelve un Settings consolidado.

    Args:
        settings_path: Ruta a settings.yaml. Por default `config/settings.yaml`.
        env_path: Ruta al .env. Por default `.env` en la raíz.

    Returns:
        Settings con todos los campos poblados (con defaults donde falte).
    """
    if settings_path is None:
        settings_path = project_root() / "config" / "settings.yaml"
    else:
        settings_path = resolve_path(settings_path)

    settings = Settings()

    if settings_path.exists():
        with settings_path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        _merge_dict_into_dataclass(settings, data)

    settings.env = _load_env(env_path)
    return settings


__all__ = [
    "BBox",
    "Edificios",
    "Env",
    "Geografia",
    "Logging",
    "PlanetNICFI",
    "Poblacion",
    "Proyecto",
    "ReportePaleta",
    "Reportes",
    "Sentinel2",
    "ServiciosOSM",
    "Settings",
    "load_settings",
]
