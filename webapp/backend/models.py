"""Modelos Pydantic del backend del Observatorio Urbano Posadas.

Son espejo de los tipos TypeScript del frontend (webapp/frontend/src/lib/types.ts).
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

CategoriaPoligono = Literal[
    "expansion_activa",
    "emergente",
    "consolidado",
    "desconocido",
]


class PoligonoProperties(BaseModel):
    """Propiedades agregadas de un poligono de analisis."""

    id: str
    nombre: str
    categoria: CategoriaPoligono
    score_expansion: float = Field(ge=0, le=1)
    superficie_km2: float = Field(ge=0)
    poblacion_estimada: int = Field(ge=0)
    edificios_2018: int = Field(ge=0)
    edificios_2026: int = Field(ge=0)
    synthetic: Optional[bool] = Field(default=None, alias="_synthetic")

    model_config = {"populate_by_name": True}


class GeoJSONGeometry(BaseModel):
    """Geometria GeoJSON (Polygon / MultiPolygon). No validamos coords a fondo."""

    type: Literal["Polygon", "MultiPolygon"]
    coordinates: list


class PoligonoFeature(BaseModel):
    """Feature GeoJSON con propiedades tipadas."""

    type: Literal["Feature"] = "Feature"
    properties: PoligonoProperties
    geometry: GeoJSONGeometry


class PoligonosCollection(BaseModel):
    """FeatureCollection publicada por el observatorio."""

    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[PoligonoFeature]
    synthetic: Optional[bool] = Field(default=None, alias="_synthetic")
    generated_at: Optional[str] = Field(default=None, alias="_generated_at")
    note: Optional[str] = Field(default=None, alias="_note")

    model_config = {"populate_by_name": True}


class PoligonoListItem(BaseModel):
    """Item del listado resumido /api/poligonos."""

    id: str
    nombre: str
    categoria: CategoriaPoligono
    score_expansion: float
    superficie_km2: float
    poblacion_estimada: int
    reporte_pdf_url: str


class SerieTemporalRow(BaseModel):
    """Fila de superficie construida / vegetacion anual por poligono."""

    poligono_id: str
    anio: int
    superficie_construida_km2: float
    superficie_vegetacion_km2: float
    edificios_total: int
    confianza_inferior: float
    confianza_superior: float


class PoblacionRow(BaseModel):
    """Fila de poblacion estimada (WorldPop modelado)."""

    poligono_id: str
    anio: int
    poblacion_estimada: int
    densidad_hab_km2: float
    confianza_inferior: float
    confianza_superior: float


class ServicioRow(BaseModel):
    """Cobertura declarada de un servicio para un poligono."""

    poligono_id: str
    servicio: str
    cobertura_pct: float = Field(ge=0, le=100)
    fuente: str
    anio_referencia: int


class VulnerabilidadRow(BaseModel):
    """Indices compuestos de vulnerabilidad (escala 0-1)."""

    poligono_id: str
    indice_vulnerabilidad: float = Field(ge=0, le=1)
    carencia_servicios: float
    riesgo_inundacion: float
    accesibilidad_salud: float
    accesibilidad_educacion: float
    confianza_inferior: float
    confianza_superior: float


class PoligonoDetalle(BaseModel):
    """Respuesta completa de /api/poligonos/{id}."""

    properties: PoligonoProperties
    serie_temporal: list[SerieTemporalRow]
    poblacion: list[PoblacionRow]
    servicios: list[ServicioRow]
    vulnerabilidad: Optional[VulnerabilidadRow]


class HealthResponse(BaseModel):
    """Respuesta de /api/salud."""

    status: Literal["ok", "degraded"]
    data_root_exists: bool
    poligonos_disponibles: int


class VersionResponse(BaseModel):
    """Respuesta de /api/version."""

    version: str
    fecha_build: str
    fuentes: list[str]
