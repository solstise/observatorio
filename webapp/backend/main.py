"""API publica del Observatorio Urbano Posadas (Fase 3).

Este observatorio usa datos publicos y gratuitos (Sentinel-2 ESA, Google
Open Buildings, WorldPop, OpenStreetMap). Las cifras reportadas tienen un
margen de error declarado. Ver metodologia para detalles.

Endpoints (ver OpenAPI en /docs y /redoc):

- GET /api/poligonos
- GET /api/poligonos/{id}
- GET /api/poligonos/{id}/serie-temporal
- GET /api/poligonos/{id}/imagen?fecha=YYYY-MM
- GET /api/poligonos/{id}/timelapse.gif
- GET /api/poligonos/{id}/timelapse.mp4
- GET /api/poligonos/{id}/reporte.pdf
- GET /api/salud
- GET /api/version
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

import data_loader
import rate_limit
from models import (
    HealthResponse,
    PoligonoDetalle,
    PoligonoListItem,
    PoligonosCollection,
    SerieTemporalRow,
    VersionResponse,
)


APP_VERSION = os.getenv("APP_VERSION", "0.1.0-fase3")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

FUENTES = [
    "Sentinel-2 (ESA)",
    "Planet NICFI",
    "Google Open Buildings",
    "WorldPop",
    "OpenStreetMap",
]

DISCLAIMER = (
    "Este observatorio usa datos publicos y gratuitos (Sentinel-2 ESA, "
    "Google Open Buildings, WorldPop, OpenStreetMap). Las cifras reportadas "
    "tienen un margen de error declarado. Ver metodologia para detalles."
)


limiter = rate_limit.build_limiter()


def create_app() -> FastAPI:
    """Factory de la aplicacion FastAPI.

    Se expone como factory para facilitar tests con dependencias mockeadas.
    """
    app = FastAPI(
        title="Observatorio Urbano Posadas - API publica",
        description=DISCLAIMER,
        version=APP_VERSION,
        contact={"name": "Observatorio Urbano Posadas"},
        license_info={"name": "MIT", "url": "https://opensource.org/licenses/MIT"},
        docs_url="/docs",
        redoc_url="/redoc",
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)
    app.add_middleware(SlowAPIMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["X-API-Key", "Content-Type"],
    )

    _register_routes(app)
    return app


def _rate_limit_handler(_request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit excedido: {exc.detail}"},
    )


def _register_routes(app: FastAPI) -> None:
    """Registra los endpoints en la app. Separado para testeabilidad."""

    @app.get("/api/salud", response_model=HealthResponse, tags=["sistema"])
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def salud(request: Request) -> HealthResponse:
        """Health check simple. Informa si los datos estan disponibles."""
        paths = data_loader.resolve_paths()
        try:
            collection = data_loader.load_poligonos()
            n = len(collection.get("features", []))
            return HealthResponse(
                status="ok",
                data_root_exists=True,
                poligonos_disponibles=n,
            )
        except data_loader.DataNotAvailableError:
            return HealthResponse(
                status="degraded",
                data_root_exists=paths.root.exists(),
                poligonos_disponibles=0,
            )

    @app.get("/api/version", response_model=VersionResponse, tags=["sistema"])
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def version(request: Request) -> VersionResponse:
        """Devuelve version publicada y fuentes de datos."""
        return VersionResponse(
            version=APP_VERSION,
            fecha_build=datetime.now(timezone.utc).date().isoformat(),
            fuentes=FUENTES,
        )

    @app.get(
        "/api/poligonos",
        response_model=list[PoligonoListItem],
        tags=["poligonos"],
    )
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def list_poligonos(request: Request) -> list[PoligonoListItem]:
        """Lista resumida de poligonos con link al reporte PDF."""
        try:
            collection = data_loader.load_poligonos()
        except data_loader.DataNotAvailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        items: list[PoligonoListItem] = []
        for feature in collection.get("features", []):
            props = feature.get("properties", {}) or {}
            if "id" not in props:
                continue
            items.append(
                PoligonoListItem(
                    id=props["id"],
                    nombre=props.get("nombre", props["id"]),
                    categoria=props.get("categoria", "desconocido"),
                    score_expansion=float(props.get("score_expansion", 0.0)),
                    superficie_km2=float(props.get("superficie_km2", 0.0)),
                    poblacion_estimada=int(props.get("poblacion_estimada", 0)),
                    reporte_pdf_url=f"/api/poligonos/{props['id']}/reporte.pdf",
                )
            )
        return items

    @app.get(
        "/api/poligonos/geojson",
        response_model=PoligonosCollection,
        tags=["poligonos"],
    )
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def geojson_poligonos(request: Request) -> PoligonosCollection:
        """Devuelve la FeatureCollection completa."""
        try:
            collection = data_loader.load_poligonos()
        except data_loader.DataNotAvailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return PoligonosCollection.model_validate(collection)

    @app.get(
        "/api/poligonos/{poligono_id}",
        response_model=PoligonoDetalle,
        tags=["poligonos"],
    )
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def detalle_poligono(request: Request, poligono_id: str) -> PoligonoDetalle:
        """Detalle completo: propiedades + serie + poblacion + servicios + vulnerabilidad."""
        feature = _require_feature(poligono_id)
        try:
            serie = data_loader.load_serie_temporal(poligono_id)
            poblacion = data_loader.load_poblacion(poligono_id)
            servicios = data_loader.load_servicios(poligono_id)
            vulnerabilidad = data_loader.load_vulnerabilidad(poligono_id)
        except data_loader.DataNotAvailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

        return PoligonoDetalle.model_validate(
            {
                "properties": feature["properties"],
                "serie_temporal": serie,
                "poblacion": poblacion,
                "servicios": servicios,
                "vulnerabilidad": vulnerabilidad[0] if vulnerabilidad else None,
            }
        )

    @app.get(
        "/api/poligonos/{poligono_id}/serie-temporal",
        response_model=list[SerieTemporalRow],
        tags=["poligonos"],
    )
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def serie_temporal(request: Request, poligono_id: str) -> list[SerieTemporalRow]:
        """Serie temporal cruda del poligono."""
        _require_feature(poligono_id)
        try:
            rows = data_loader.load_serie_temporal(poligono_id)
        except data_loader.DataNotAvailableError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return [SerieTemporalRow.model_validate(r) for r in rows]

    @app.get("/api/poligonos/{poligono_id}/imagen", tags=["poligonos"])
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def imagen_mensual(
        request: Request,
        poligono_id: str,
        fecha: str = Query(
            ...,
            pattern=r"^\d{4}-\d{2}$",
            description="Mes objetivo en formato YYYY-MM.",
        ),
    ) -> FileResponse:
        """Imagen PNG mensual para el poligono."""
        _require_feature(poligono_id)
        path = data_loader.image_path(poligono_id, fecha)
        if not path:
            raise HTTPException(
                status_code=404,
                detail=f"No hay imagen para {poligono_id} en {fecha}.",
            )
        return _stream_file(path, media_type="image/png")

    @app.get("/api/poligonos/{poligono_id}/timelapse.gif", tags=["poligonos"])
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def timelapse_gif(request: Request, poligono_id: str) -> FileResponse:
        """Timelapse GIF del poligono."""
        _require_feature(poligono_id)
        path = data_loader.timelapse_path(poligono_id, "gif")
        if not path:
            raise HTTPException(
                status_code=404,
                detail=f"No hay timelapse GIF para {poligono_id}.",
            )
        return _stream_file(path, media_type="image/gif")

    @app.get("/api/poligonos/{poligono_id}/timelapse.mp4", tags=["poligonos"])
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def timelapse_mp4(request: Request, poligono_id: str) -> FileResponse:
        """Timelapse MP4 del poligono."""
        _require_feature(poligono_id)
        path = data_loader.timelapse_path(poligono_id, "mp4")
        if not path:
            raise HTTPException(
                status_code=404,
                detail=f"No hay timelapse MP4 para {poligono_id}.",
            )
        return _stream_file(path, media_type="video/mp4")

    @app.get("/api/poligonos/{poligono_id}/reporte.pdf", tags=["poligonos"])
    @limiter.limit(rate_limit.PUBLIC_LIMIT)
    def reporte_pdf(request: Request, poligono_id: str) -> FileResponse:
        """Reporte PDF generado por el pipeline."""
        _require_feature(poligono_id)
        path = data_loader.report_path(poligono_id)
        if not path:
            raise HTTPException(
                status_code=404,
                detail=f"No hay reporte PDF para {poligono_id}.",
            )
        return _stream_file(
            path,
            media_type="application/pdf",
            filename=f"{poligono_id}-reporte.pdf",
        )


def _require_feature(poligono_id: str) -> dict[str, Any]:
    """Devuelve el feature o eleva 404/503 segun corresponda."""
    try:
        feature = data_loader.find_poligono(poligono_id)
    except data_loader.DataNotAvailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not feature:
        raise HTTPException(
            status_code=404,
            detail=f"Poligono '{poligono_id}' no encontrado.",
        )
    return feature


def _stream_file(path: Path, media_type: str, filename: str | None = None) -> FileResponse:
    """Envia un archivo con FileResponse. Se usa para PDFs, GIFs, MP4 y PNGs."""
    return FileResponse(
        path=path,
        media_type=media_type,
        filename=filename,
    )


# Instancia global para uvicorn: `uvicorn main:app`.
app = create_app()
