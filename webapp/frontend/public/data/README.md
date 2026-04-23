# Datos del frontend

Esta carpeta se sincroniza desde `data/outputs/` del repo raiz. El frontend lee los
archivos directamente via `fetch('/data/...')`.

Archivos esperados (todos versionados aca como datos **sinteticos de prueba**):

- `poligonos.geojson` - FeatureCollection con un Feature por poligono de analisis.
  Propiedades minimas: `id`, `nombre`, `categoria`, `score_expansion`, `superficie_km2`,
  `poblacion_estimada`, `edificios_2018`, `edificios_2026`.
- `serie_temporal.csv` - superficie construida y vegetacion por anio y poligono, con
  banda de confianza (`confianza_inferior`, `confianza_superior`).
- `poblacion.csv` - estimaciones de poblacion por poligono y anio.
- `servicios.csv` - cobertura de servicios por poligono (agua, cloaca, gas, electricidad,
  alumbrado, transporte).
- `vulnerabilidad.csv` - indices compuestos (0-1) de vulnerabilidad por poligono.
- `updated_at.txt` - fecha ISO de ultima actualizacion.

## Marcado sintetico

Todos los archivos de este directorio estan marcados como **sinteticos** para evitar
confusiones con datos reales:

- `poligonos.geojson`: campos `_synthetic: true` a nivel raiz y por feature.
- CSVs: header `# SYNTHETIC - Datos sinteticos de prueba. Observatorio Urbano Posadas.`

## Sincronizacion con el pipeline real

Cuando el pipeline real (ver `scripts/` y `models/` del repo raiz) termine de generar
los datos en `data/outputs/`, reemplazar este contenido con:

```bash
# Desde el repo raiz
cp data/outputs/poligonos.geojson webapp/frontend/public/data/
cp data/outputs/*.csv webapp/frontend/public/data/
date -Idate > webapp/frontend/public/data/updated_at.txt
```

El campo `_synthetic` desaparece automaticamente al copiar los archivos reales.
