# `public/data/` — datos servidos al frontend

Este directorio **NO se versiona en git**: contiene ~1 GB de CSVs,
GeoJSONs, PNGs y GIFs derivados del pipeline. Son **regenerables** desde
`scripts/` corriendo el pipeline completo.

## Estructura

- `poligonos.geojson` — 44 polígonos de barrios + contorno ciudad
- `serie_temporal.csv`, `poblacion.csv`, `servicios.csv`, `vulnerabilidad.csv`
- `dynamic_world.csv`, `sentinel1.csv`, `mapbiomas.csv`, `ghsl.csv`,
  `viirs.csv`, `chirps.csv`, `no2.csv`, `lst.csv`, `firms.csv`, `wdpa.csv`
- `calor/` — LST mensual, UHI mensual, UHI estacional + 104 mapas PNG + GIF
- `social/` — distancias servicios, ranking político
- `forecast/` — Tmin/Tmax/AQI por barrio + alertas activas + metadata
- `proyecciones/` — proyecciones 2027/2030/2035 por barrio
- `media/` — PDFs por barrio, timelapses GIF/MP4, comparaciones HD
- `updated_at.txt` — timestamp ISO

## Cómo regenerar localmente

```bash
source venv/bin/activate

# Pipeline completo (toma ~30 min la primera vez)
python scripts/49_calor_pipeline.py todo
python scripts/57_forecast_clima.py
python scripts/58_alertas_clima.py
python scripts/53_servicios_distancias.py
python scripts/54_ranking_politico.py --vulnerabilidad data/processed/vulnerabilidad_v43.csv
python scripts/59_proyecciones_futuras.py

# Sincronizar al frontend
python scripts/80_sync_webapp.py \
  --serie data/processed/conteos_v43/serie_temporal.csv \
  --poblacion data/processed/poblacion_estimada_v43.csv \
  --vulnerabilidad data/processed/vulnerabilidad_v43.csv
```

## En CI / cron automático

El workflow `.github/workflows/refresh-forecast.yml` corre cada 6 h:
descarga forecast, detecta alertas, publica a Upstash Redis, deploya al
VPS. Genera el contenido de `public/data/forecast/` y `alertas_activas.json`
en cada run.

## Para deploy al VPS

`bash deploy-vps.sh` tarea el frontend (incluyendo `public/data/`
generado localmente) y lo extrae en `/opt/apps/observatorio/`. El
container Docker buildea desde ahí. Los datos viven solo en el VPS, no
en git.
