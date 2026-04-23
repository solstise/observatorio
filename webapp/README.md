# Observatorio Urbano Posadas - Webapp

Dos subproyectos independientes pero coordinados:

- **`frontend/`** - Next.js 14 (App Router) + TypeScript + Tailwind + Leaflet + Recharts.
  Dashboard publico con mapa interactivo, fichas de poligono, comparador, metodologia
  y descargas. Ver [`frontend/README.md`](frontend/README.md).

- **`backend/`** - FastAPI 0.115 + Pydantic 2 + slowapi. API publica (Fase 3) que
  expone datos de `data/outputs/` del repo raiz. Ver [`backend/README.md`](backend/README.md).

## Quickstart

```bash
# Terminal 1: backend
cd webapp/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn main:app --reload
# http://localhost:8000/docs

# Terminal 2: frontend
cd webapp/frontend
npm install
cp .env.example .env.local
# editar NEXT_PUBLIC_API_BASE=http://localhost:8000 si se quiere usar backend
npm run dev
# http://localhost:3000
```

## Datos de prueba

`frontend/public/data/` incluye datos **sinteticos** (marcados con `_synthetic: true`
en GeoJSON y con header `# SYNTHETIC` en CSVs) para 5 poligonos:

- `itaembe_mini`
- `itaembe_guazu`
- `chacra_32`
- `villa_cabello`
- `el_brete`

Serie temporal 2018-2026. Al ejecutar el pipeline real se sobreescriben con
`data/outputs/*.{csv,geojson}`.

## Disclaimer

Este observatorio usa datos publicos y gratuitos (Sentinel-2 ESA, Google Open
Buildings, WorldPop, OpenStreetMap). Las cifras reportadas tienen un margen de
error declarado. Ver [`METODOLOGIA.md`](../METODOLOGIA.md) en el repo raiz.
