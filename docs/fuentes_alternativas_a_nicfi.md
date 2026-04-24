# Fuentes alternativas a Planet NICFI (investigación 2026-04-24)

**Contexto**: El programa Planet NICFI Satellite Data Program terminó el
1 de abril de 2025. El contrato entre Planet y el gobierno de Noruega
expiró y Noruega canceló la licitación del siguiente tranche en septiembre
2025. El dataset `projects/planet-nicfi/assets/basemaps/americas` en Google
Earth Engine dejó de ser accesible para proyectos nuevos. El reemplazo
comercial de Planet, "Tropical Forest Observatory" (TFO), cuesta ~US$180/mes
(EUR 1.620/año) y no tiene tier gratuito.

Este documento registra alternativas investigadas (3 agentes en paralelo,
web search + fetch a fuentes oficiales) para orientar futuras decisiones
del observatorio.

## Tabla consolidada por viabilidad

### Tier 1 — gratis, bajo esfuerzo de integración

| Fuente | URL | Resolución | Cobertura temporal | Integración |
|---|---|---|---|---|
| **IDE Posadas (GeoNode, 138 capas)** | https://www.ide.posadas.gob.ar/ | vector (catastro) | histórico municipal | WMS/WFS sin registro |
| **MapBiomas Argentina / Chaco** | https://argentina.mapbiomas.org/ · https://chaco.mapbiomas.org/ | 30 m (Landsat) | 1985-2023 anual | Descarga GeoTIFF o EE |
| **MapBiomas Argentina-Urbano** (UNNE, 2025) | https://medios.unne.edu.ar/2025/06/12/... | 30 m | serie anual dedicada a urbano | EE / descarga |
| **Dynamic World V1** | `GOOGLE/DYNAMICWORLD/V1` | 10 m | 2015-06 → hoy, 2-5 días | Earth Engine nativo |
| **ESA WorldCover v100/v200** | `ESA/WorldCover/v200` | 10 m | 2020, 2021 | Earth Engine nativo |
| **Sentinel-1 GRD (SAR)** | `COPERNICUS/S1_GRD` | 10 m | 2014-10 → hoy, 6-12 días | Earth Engine nativo |
| **Harmonized Landsat-Sentinel (HLS v2.0)** | https://planetarycomputer.microsoft.com/dataset/hls2-l30 | 30 m | 2013 → hoy, 2-3 días | STAC / EE |
| **Copernicus DEM GLO-30** | `COPERNICUS/DEM/GLO30` | 30 m | estático (actualiz. 2024) | Earth Engine |
| **VIIRS Nighttime Lights** | `NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG` | 464 m | 2014-01 → hoy mensual | Earth Engine |
| **IPEC Misiones repositorio** | https://www.ipec.misiones.gov.ar/ | tabular + mapas | CENSO 2022 definitivo | descarga directa |

### Tier 2 — gratis, esfuerzo medio

| Fuente | URL | Observación |
|---|---|---|
| **GHSL P2023A (Built-up + Pop + SMOD)** | `JRC/GHSL/P2023A/*` | Histórico 1975-2030 a 100m-1km |
| **Microsoft Building Footprints** | https://planetarycomputer.microsoft.com/dataset/ms-buildings | 2.8M edificios Argentina, complementa Google Open Buildings |
| **VIDA Google+Microsoft merge** | https://source.coop/vida/google-microsoft-open-buildings | Union de ambos datasets |
| **Impact Observatory IO-LULC v2** | `io-lulc-annual-v02` (PC) | Uso del suelo 10m anual 2017-2023 |
| **IGN Argentina Capas SIG** | https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG | 255 capas: hidrografía, vial, infra |
| **IDERA geoservicios** | https://www.idera.gob.ar/ | Catálogo federado nacional |
| **IDE Misiones (Ord. Territorial)** | https://ide.ordenamientoterritorial.misiones.gob.ar/ | WMS/WFS provincial |
| **GeoINTA / INTA** | https://inta.gob.ar/paginas/geointa · https://geo.inta.gob.ar/ | Suelos, cobertura, clima |
| **Ministerio Ecología Misiones (DGSIG)** | https://ecologia.misiones.gob.ar/direccion-gral-de-sistemas-de-informacion-geografica/ | Deforestación periurbana (capa por solicitud) |

### Tier 3 — requiere convenio / registro / decisiones de presupuesto

| Fuente | URL | Condiciones |
|---|---|---|
| **CONAE SAOCOM** (SAR banda L) | https://catalog.saocom.conae.gov.ar/ + https://registro.conae.gov.ar/ | Registro + firma licencia (<1h hábil). Gratis con convenio. |
| **Nimbo Earth Discovery** | https://nimbo.earth/pricing/ | Free tier 4.000 créditos/mes (2.5m super-res). Uso "institucional gov" zona gris. |
| **Planet Education & Research** | https://go.planet.com/research | 3m, 3.000 km²/mes. **Excluye gobierno directo**; aplicar vía UNaM. |
| **Brazil Data Cube (INPE)** | https://data.inpe.br/ · https://brazildatacube.dpi.inpe.br/portal/ | STAC con auth token. Cubre parcial lado brasileño frontera. |

## Descartados

- **Planet NICFI**: programa cerrado 2025-04-01.
- **Planet TFO** (reemplazo NICFI): US$180/mes, fuera de presupuesto.
- **Maxar / Vantor Open Data**: solo se activa durante desastres declarados, no sirve para monitoreo rutinario.
- **SABIA-Mar** (CONAE): satélite no lanzado, estimado marzo 2027.
- **Airbus Education & Research (DINAMIS)**: orientado a investigadores académicos con proposal; no es para gobiernos locales.
- **SkySat académico**: requiere Campus license paga.

## Recomendación de integración por impacto para el ministro

1. **IDE Posadas WMS/WFS** → overlay catastral municipal sobre el mapa Leaflet
   del dashboard. Visual inmediato, datos oficiales, sin trámite. ★★★★★
2. **MapBiomas Argentina-Urbano** → serie histórica 1985-2023 de expansión
   urbana del país. Contextualiza Posadas en el tiempo largo y da legitimidad
   académica. ★★★★☆
3. **Dynamic World V1** → cobertura construida probabilística cada 2-5 días.
   Permite detectar expansión "en vivo" entre composites anuales. ★★★★☆
4. **Sentinel-1 SAR** → llenar los meses de oct-mar donde Sentinel-2 queda
   inutilizado por nubes subtropicales. ★★★☆☆
5. **MS Building Footprints + merge VIDA** → cobertura más completa de
   edificios que solo Google Open Buildings. Puede cambiar los conteos
   marginalmente. ★★★☆☆

## Ventana futura (si cambia el contexto)

- Si el gobierno noruego reabre NICFI en una nueva fase → re-evaluar.
- Si se firma convenio con UNaM / FCEQyN → aplicar a Planet E&R vía la
  universidad (habilita PlanetScope 3m para el observatorio).
- Si hay presupuesto para US$180/mes → Planet TFO da 4.77m mensual
  directamente.

## Fuentes consultadas

Ver commits y reportes de investigación del 2026-04-24 en el repo.
Queries hechas con WebSearch y WebFetch desde tres agentes paralelos que
cubrieron: alternativas globales, fuentes oficiales argentinas, catálogo
Earth Engine + Planetary Computer.
