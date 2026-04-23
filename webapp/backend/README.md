# Observatorio Urbano Posadas - Backend API

API publica construida con **FastAPI 0.115** + **Pydantic 2** + **slowapi**.

> Este observatorio usa datos publicos y gratuitos (Sentinel-2 ESA, Google
> Open Buildings, WorldPop, OpenStreetMap). Las cifras reportadas tienen un
> margen de error declarado. Ver metodologia para detalles.

## Requisitos

- Python 3.11 o superior
- (Opcional) Docker y docker compose

## Desarrollo local

```bash
cd webapp/backend
python -m venv .venv
source .venv/bin/activate        # en Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn main:app --reload
# Swagger: http://localhost:8000/docs
```

## Variables de entorno

Ver `.env.example`. Claves principales:

- `DATA_ROOT`: carpeta de datos. Default `../../data/outputs/` (repo raiz).
- `ALLOWED_ORIGINS`: CORS, separados por coma.
- `API_KEY`: opcional, habilita rate limit mayor via header `X-API-Key`.
- `RATE_LIMIT_PUBLIC` / `RATE_LIMIT_AUTHED`: formato slowapi (`"100/minute"`).
- `REDIS_URL`: opcional, activa rate limiting distribuido.
- `APP_VERSION`: string mostrado en `/api/version`.

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/api/salud` | Health check |
| GET | `/api/version` | Version y fecha build |
| GET | `/api/poligonos` | Lista resumida |
| GET | `/api/poligonos/geojson` | FeatureCollection completa |
| GET | `/api/poligonos/{id}` | Detalle completo |
| GET | `/api/poligonos/{id}/serie-temporal` | Serie temporal cruda |
| GET | `/api/poligonos/{id}/imagen?fecha=YYYY-MM` | PNG mensual |
| GET | `/api/poligonos/{id}/timelapse.gif` | Timelapse GIF |
| GET | `/api/poligonos/{id}/timelapse.mp4` | Timelapse MP4 |
| GET | `/api/poligonos/{id}/reporte.pdf` | Reporte PDF |

Documentacion interactiva: `/docs` (Swagger) y `/redoc`.

## Rate limiting

Implementado con `slowapi`. Default: **100 requests por minuto por IP**.
Si el request trae un header `X-API-Key` valido, aplica el limite mayor
(`RATE_LIMIT_AUTHED`, default 600/min).

Para produccion con multiples workers, configurar `REDIS_URL` y descomentar
el servicio `redis` en `docker-compose.yml`.

## Docker

```bash
docker compose up --build
# API en http://localhost:8000
```

El `docker-compose.yml` monta `../../data/` (repo raiz) en `/app/data:ro`.
Si el pipeline aun no emitio datos, los endpoints retornan 503 con mensaje
claro.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```

Los tests mockean el data loader; no requieren datos reales.

## Estructura

```
backend/
  main.py            # app FastAPI + endpoints
  models.py          # modelos Pydantic
  data_loader.py     # lectura de GeoJSON/CSV
  rate_limit.py      # slowapi config
  Dockerfile
  docker-compose.yml
  requirements.txt
  requirements-dev.txt
  .env.example
  tests/
    test_endpoints.py
```

## Licencia

Codigo MIT. Datos CC BY 4.0. Ver `LICENSE` del repo raiz.
