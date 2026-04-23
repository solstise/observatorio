# config/servicios.geojson

Este archivo contiene la capa de servicios públicos que el pipeline cruza
con cada polígono monitoreado (CAPS, escuelas, comisarías, paradas, etc.).

## Estado actual (Fase 1)

**Archivo con placeholders de ejemplo.** Los tres puntos presentes
(`caps_itaembe_mini_placeholder`, `escuela_chacra_32_placeholder`,
`comisaria_villa_cabello_placeholder`) son valores ficticios para permitir
que los scripts de Fase 1 puedan correr sin errores de "archivo vacío".

## Cómo se regenera (Fase 2)

Este archivo se regenera con:

```bash
python scripts/04_descarga_osm.py
```

El script consulta la Overpass API de OSM con las queries definidas en
`config/settings.yaml` bajo `servicios_osm.servicios`, y escribe el
resultado acá reemplazando completamente los placeholders.

Tipos de `tipo` esperados:

- `caps` (amenity=clinic, amenity=doctors, healthcare=*)
- `hospital` (amenity=hospital)
- `escuela` (amenity=school)
- `jardin` (amenity=kindergarten)
- `universidad` (amenity=university)
- `comisaria` (amenity=police)
- `bomberos` (amenity=fire_station)
- `parada_colectivo` (highway=bus_stop)
- `farmacia` (amenity=pharmacy)
- `banco` (amenity=bank, amenity=atm)
- `supermercado` (shop=supermarket)
- `mercado` (amenity=marketplace)
- `plaza` (leisure=park, leisure=playground)

## Properties esperadas por feature

- `id` — identificador único del registro
- `tipo` — una de las categorías listadas arriba
- `nombre` — nombre oficial o texto descriptivo
- `descripcion` — opcional, texto libre
- `fuente` — "osm", "municipal", "placeholder", etc.
- `verificado` — bool, indica validación cruzada manual
