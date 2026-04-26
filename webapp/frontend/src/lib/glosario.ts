// Glosario de términos técnicos del Observatorio Urbano Posadas.
// Cada entrada cumple el shape definido en `./glosario-types.ts`.
// Consumido por la página /metodologia#glosario y el componente
// <TerminoGlosario id="..." />.

import type { TerminoGlosario } from "./glosario-types";

export const GLOSARIO: TerminoGlosario[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // CALOR URBANO
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "uhi",
    termino: "UHI (Isla de Calor Urbana)",
    resumen_corto:
      "Cuánto más caliente está la ciudad que el campo cercano. El cemento y asfalto retienen calor.",
    descripcion_larga:
      "El fenómeno por el cual el centro urbano es típicamente 2-8°C más caliente que el campo circundante. Causas: el cemento y asfalto absorben radiación solar y la liberan lentamente, mientras la vegetación rural se enfría por evapotranspiración. Para Posadas (subtropical húmedo) registramos UHI diurnas de +2 a +8°C en verano. Métrica estándar de la literatura (Voogt & Oke 2003, *Remote Sensing of Urban Climates*). En este observatorio calculamos 3 variantes: vs baseline rural (la más conservadora), vs promedio ciudad (útil para ranking interno), y anomalía vs histórico (detecta tendencias).",
    categoria: "calor",
    alias: ["isla de calor", "urban heat island", "heat island"],
    fuente_url:
      "https://www.sciencedirect.com/science/article/abs/pii/S0034425703001041",
    fuente_label: "Voogt & Oke 2003, Remote Sensing of Urban Climates",
    relacionados: ["lst", "uhi-vs-rural", "uhi-vs-ciudad", "uhi-anomalia"],
  },
  {
    id: "lst",
    termino: "LST (Land Surface Temperature)",
    resumen_corto:
      "Temperatura del techo, asfalto o suelo (no del aire) medida desde el satélite.",
    descripcion_larga:
      "LST es la temperatura radiométrica de la superficie terrestre — el techo, el asfalto, el suelo desnudo, la copa de los árboles — derivada de la banda térmica infrarroja (TIR) de satélites como Landsat 8/9 (banda ST_B10, 30 m re-muestreada de 100 m) o MODIS (1 km). **No es la temperatura del aire** medida por una estación meteorológica a 2 m: la LST puede estar 10-20°C por encima de la temperatura del aire en superficies oscuras al mediodía. En Posadas observamos LST diurnas de 30-45°C en verano (techos de chapa, asfalto) y 15-28°C en invierno. La emisividad superficial (LSE) y correcciones atmosféricas son aplicadas en los productos Collection 2 Level 2 que consumimos.",
    categoria: "calor",
    alias: [
      "land surface temperature",
      "temperatura superficial",
      "temperatura del suelo",
    ],
    fuente_url:
      "https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-temperature",
    fuente_label: "USGS Landsat C2 L2 Surface Temperature",
    relacionados: ["uhi", "landsat", "modis", "era5"],
  },
  {
    id: "uhi-vs-rural",
    termino: "UHI absoluta (vs baseline rural)",
    resumen_corto:
      "Cuántos grados más caliente está la ciudad comparada con el campo a las afueras.",
    descripcion_larga:
      "Variante más conservadora y comparable internacionalmente. Calculamos LST promedio sobre los píxeles urbanos (mascarados con NDBI > umbral o Dynamic World clase 'built') y restamos la LST promedio del anillo rural circundante (típicamente 5-15 km del límite urbano, excluyendo cuerpos de agua y áreas degradadas). Para Posadas el baseline rural se construye con píxeles agrícolas y de pastura del sur del ejido municipal. Es la métrica que reporta la literatura científica (Voogt & Oke 2003, Stewart & Oke 2012). Útil para comparar Posadas con otras ciudades del mundo. Limitación: si el campo está muy seco y caliente, subestima la UHI real.",
    categoria: "calor",
    alias: ["UHI rural", "delta T rural"],
    relacionados: ["uhi", "uhi-vs-ciudad", "uhi-anomalia", "lst", "ndbi"],
  },
  {
    id: "uhi-vs-ciudad",
    termino: "UHI relativa (vs promedio de ciudad)",
    resumen_corto:
      "Cuántos grados más caliente está un barrio comparado con el promedio de toda la ciudad.",
    descripcion_larga:
      "Métrica útil para ranking interno entre barrios o radios censales: para cada celda urbana calculamos `LST_celda - LST_promedio_ciudad`. No depende de definir un baseline rural y es robusta cuando el campo cambia mucho estación a estación. Permite identificar los hotspots intra-urbanos (típicamente centros comerciales con poca vegetación, polígonos industriales, asentamientos con techos de chapa). Para Posadas, en verano observamos celdas con +3 a +5°C sobre el promedio de la ciudad en zonas sin arbolado urbano. **Limitación**: no es comparable con otras ciudades porque cada una tiene su propio promedio.",
    categoria: "calor",
    alias: ["UHI intra-urbana", "delta T ciudad"],
    relacionados: ["uhi", "uhi-vs-rural", "uhi-anomalia", "lst"],
  },
  {
    id: "uhi-anomalia",
    termino: "UHI anomalía estacional",
    resumen_corto:
      "Cuánto se desvía el calor actual respecto al promedio histórico de la misma época del año.",
    descripcion_larga:
      "Tercera variante: para cada píxel urbano calculamos el promedio histórico de UHI (vs rural) en la misma ventana estacional (ej. enero-febrero) usando 5+ años de datos Landsat/MODIS, y luego computamos la anomalía del año actual respecto a ese baseline. Permite detectar tendencias de calentamiento urbano más allá del ciclo estacional natural. Para Posadas, una anomalía de +1°C sostenida sobre el verano histórico indicaría densificación, pérdida de cobertura arbórea o intensificación del UHI por cambio climático. Se reporta junto a un IC 95% para distinguir señal de ruido.",
    categoria: "calor",
    alias: ["anomalía UHI", "tendencia UHI"],
    relacionados: ["uhi", "uhi-vs-rural", "uhi-vs-ciudad", "ci-95"],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // SATELITAL
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "sentinel-2",
    termino: "Sentinel-2 SR Harmonized",
    resumen_corto:
      "Satélite europeo que fotografía la Tierra cada 5 días con detalle de 10 metros.",
    descripcion_larga:
      "Constelación de la Agencia Espacial Europea (ESA) compuesta por dos satélites gemelos (S2A y S2B) en órbita polar. Captura imágenes ópticas multibanda (13 bandas de 443 nm a 2190 nm) con resoluciones de 10 m (visible + NIR), 20 m (red-edge + SWIR) y 60 m (atmosféricas). Revisita 5 días en el ecuador. La colección **Harmonized Surface Reflectance** (`COPERNICUS/S2_SR_HARMONIZED` en Earth Engine) corrige las diferencias de procesamiento pre/post enero 2022. Para Posadas usamos Sentinel-2 como fuente primaria de NDVI, NDBI y composiciones RGB de alta resolución, dado que el área urbana cabe en una sola escena (110 km de ancho).",
    categoria: "satelital",
    alias: ["S2", "Sentinel-2A", "Sentinel-2B", "ESA Sentinel"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED",
    fuente_label: "GEE Catalog: COPERNICUS/S2_SR_HARMONIZED",
    relacionados: ["ndvi", "ndbi", "sentinel-1", "dynamic-world"],
  },
  {
    id: "sentinel-1",
    termino: "Sentinel-1 SAR",
    resumen_corto:
      "Radar europeo que ve a través de las nubes, día y noche. Útil en temporada de lluvias.",
    descripcion_larga:
      "Radar de Apertura Sintética (SAR) en banda C (5.4 GHz) de la ESA. A diferencia de los sensores ópticos, el radar **atraviesa nubes y opera de noche**, lo que es crítico para Posadas (clima subtropical húmedo con cobertura nubosa frecuente, 1800-2300 mm anuales de precipitación). Captura polarizaciones VV+VH con resolución de 10 m y revisita de 6-12 días. Lo usamos para monitoreo de inundaciones (mapeo rápido tras eventos extremos), detección de cambios estructurales (nuevas construcciones aparecen como retrodispersión brillante) y validación cruzada de cobertura urbana cuando el óptico está nublado.",
    categoria: "satelital",
    alias: ["S1", "SAR", "radar Sentinel"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S1_GRD",
    fuente_label: "GEE Catalog: COPERNICUS/S1_GRD",
    relacionados: ["sentinel-2"],
  },
  {
    id: "landsat",
    termino: "Landsat 8/9 Collection 2 Level 2",
    resumen_corto:
      "Programa satelital de NASA/USGS desde 1972 que mide temperatura del suelo a 30 m de detalle.",
    descripcion_larga:
      "El programa de observación terrestre más antiguo y continuo (Landsat 1 en 1972; actualmente operativos L8 lanzado en 2013 y L9 en 2021). Las colecciones que usamos (`LANDSAT/LC08/C02/T1_L2` y `LANDSAT/LC09/C02/T1_L2`) entregan reflectancia superficial corregida atmosféricamente y, lo más importante para este observatorio, **temperatura superficial (LST)** en la banda térmica `ST_B10` a 30 m (re-muestreada desde el sensor TIRS de 100 m). Revisita combinada de 8 días. Para Posadas es la fuente primaria de LST y por ende del cálculo de UHI. Validación local: ERA5-Land monthly correlaciona r=0.896 con Landsat LST en píxeles rurales.",
    categoria: "satelital",
    alias: ["L8", "L9", "Landsat 8", "Landsat 9", "USGS Landsat"],
    fuente_url:
      "https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products",
    fuente_label: "USGS Landsat Collection 2 L2",
    relacionados: ["lst", "uhi", "modis", "era5"],
  },
  {
    id: "modis",
    termino: "MODIS LST MOD11A2",
    resumen_corto:
      "Producto de temperatura superficial de NASA, 1 km de resolución, promedio cada 8 días.",
    descripcion_larga:
      "El producto `MODIS/061/MOD11A2` (Terra) y `MYD11A2` (Aqua) entrega Land Surface Temperature & Emisividad a 1 km de resolución, agregado en compuestos de 8 días. Cada píxel contiene la mejor observación cielo-claro de la ventana. **Trade-off vs Landsat**: peor resolución espacial (1 km vs 30 m, no resuelve barrios), pero mucho mejor cobertura temporal (4 pasadas diarias, día/noche con Terra+Aqua) y serie histórica desde el año 2000. Lo usamos como serie complementaria para tendencias de largo plazo y validación cruzada con Landsat. Para Posadas, la ciudad ocupa ~50 píxeles MODIS — suficiente para promedios urbano-vs-rural pero no para análisis intra-urbano fino.",
    categoria: "satelital",
    alias: ["MOD11A2", "MYD11A2", "MODIS LST"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD11A2",
    fuente_label: "GEE Catalog: MODIS/061/MOD11A2",
    relacionados: ["lst", "landsat", "uhi"],
  },
  {
    id: "dynamic-world",
    termino: "Dynamic World V1",
    resumen_corto:
      "Mapa de uso del suelo de Google actualizado casi en tiempo real con IA, 9 clases.",
    descripcion_larga:
      "Producto de Google + WRI (`GOOGLE/DYNAMICWORLD/V1`) que aplica una red neuronal sobre cada escena Sentinel-2 para clasificar 9 clases de cobertura: water, trees, grass, flooded_vegetation, crops, shrub_and_scrub, **built**, bare, snow_and_ice. Resolución 10 m, latencia ~2-5 días post-adquisición. Cada píxel incluye la probabilidad por clase, no solo la clase dominante. En este observatorio lo usamos para: definir la máscara urbana (`built > 0.5`), trackear expansión urbana mes a mes, y validar cruzadamente con NDBI y Open Buildings. Limitación: la clase 'built' incluye carreteras y predios industriales, no solo residencial.",
    categoria: "satelital",
    alias: ["DW", "DynamicWorld", "Google Dynamic World"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1",
    fuente_label: "GEE Catalog: GOOGLE/DYNAMICWORLD/V1",
    relacionados: ["sentinel-2", "ndbi", "open-buildings", "mapbiomas"],
  },
  {
    id: "ndvi",
    termino: "NDVI (Índice de Vegetación)",
    resumen_corto:
      "Indicador de cuánta vegetación verde y sana hay. Va de -1 a 1; mayor a 0.4 es vegetación densa.",
    descripcion_larga:
      "Normalized Difference Vegetation Index, fórmula clásica `(NIR - RED) / (NIR + RED)`. Aprovecha que la vegetación sana refleja fuerte en infrarrojo cercano (NIR, ~842 nm en S2 banda B8) y absorbe en rojo (~665 nm, S2 banda B4) por la clorofila. Rangos: agua y nubes <0; suelo desnudo o asfalto 0-0.2; pastura/cultivo 0.2-0.5; bosque denso 0.5-0.9. En Posadas calculamos NDVI por barrio para inferir cobertura arbórea urbana — un proxy directo del potencial de mitigación del UHI por evapotranspiración. Promedios típicos: centro comercial ~0.15-0.25, barrios residenciales con arbolado ~0.35-0.55, costa del Paraná y áreas verdes >0.6.",
    categoria: "satelital",
    alias: [
      "Normalized Difference Vegetation Index",
      "índice de vegetación",
      "vegetación NDVI",
    ],
    fuente_url:
      "https://earthobservatory.nasa.gov/features/MeasuringVegetation",
    fuente_label: "NASA Earth Observatory: Measuring Vegetation",
    relacionados: ["sentinel-2", "ndbi", "uhi", "dynamic-world"],
  },
  {
    id: "ndbi",
    termino: "NDBI (Índice de Construido)",
    resumen_corto:
      "Indicador de cuánta superficie está construida (cemento, asfalto, techos). Mayor = más urbano.",
    descripcion_larga:
      "Normalized Difference Built-up Index (Zha et al. 2003), fórmula `(SWIR - NIR) / (SWIR + NIR)`. Aprovecha que las superficies construidas (asfalto, hormigón, techos) reflejan más en SWIR (~1610 nm, S2 banda B11) que en NIR. Rangos típicos: vegetación negativa, suelo desnudo cerca de 0, urbano denso 0.1-0.4. Lo usamos como métrica complementaria a Dynamic World para definir la máscara urbana en Posadas — particularmente útil porque captura áreas de baja densidad y polvo urbano que DW puede subclasificar. Limitación: suelo desnudo seco también da NDBI alto; se mitiga combinando con NDVI bajo (NDBI alto + NDVI bajo = construido confiable).",
    categoria: "satelital",
    alias: [
      "Normalized Difference Built-up Index",
      "índice construido",
      "built-up index",
    ],
    fuente_url:
      "https://www.tandfonline.com/doi/abs/10.1080/01431160304987",
    fuente_label: "Zha et al. 2003, IJRS",
    relacionados: ["ndvi", "sentinel-2", "dynamic-world", "uhi"],
  },
  {
    id: "viirs",
    termino: "VIIRS Nightlights",
    resumen_corto:
      "Imágenes nocturnas del satélite NOAA: muestran luces de calles, autos y edificios.",
    descripcion_larga:
      "El sensor VIIRS (Visible Infrared Imaging Radiometer Suite) a bordo de los satélites Suomi NPP y NOAA-20 captura emisiones de luz nocturna a 500 m con su banda Day-Night Band (DNB). El producto mensual `NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG` está libre de luz lunar y nubes. Es un proxy de actividad económica, electrificación y densidad poblacional efectiva. Para Posadas trackeamos: brillo total del aglomerado (creció ~X% inter-anual), nuevos focos en bordes peri-urbanos (indicador adelantado de loteos), y deficiencias de iluminación en barrios populares (contraste con Black Marble diario).",
    categoria: "satelital",
    alias: ["nightlights", "luces nocturnas", "VIIRS DNB", "NOAA nightlights"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/NOAA_VIIRS_DNB_MONTHLY_V1_VCMSLCFG",
    fuente_label: "GEE Catalog: NOAA/VIIRS/DNB/MONTHLY_V1",
    relacionados: ["black-marble", "ghsl", "worldpop"],
  },
  {
    id: "era5",
    termino: "ERA5-Land Monthly",
    resumen_corto:
      "Reanálisis climático del centro europeo ECMWF: temperatura, lluvia y viento desde 1950, mensual.",
    descripcion_larga:
      "ERA5-Land (`ECMWF/ERA5_LAND/MONTHLY_AGGR`) es el reanálisis de quinta generación del ECMWF (European Centre for Medium-Range Weather Forecasts) corregido para superficies terrestres, a 0.1° (~9 km) de resolución y serie mensual desde 1950. Incluye temperatura del aire a 2 m, precipitación, evapotranspiración, humedad del suelo y radiación. **No es satelital puro**: combina observaciones meteorológicas, satélites e imodelos físicos. Para Posadas lo usamos como ground-truth de temperatura del aire (vs LST satelital) y como fuente de precipitación de largo plazo. Validación local: ERA5-Land monthly correlaciona r=0.896 con Landsat LST en píxeles rurales (ver §15 metodología).",
    categoria: "satelital",
    alias: ["ERA5", "ECMWF reanalysis", "ERA5-Land"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_MONTHLY_AGGR",
    fuente_label: "GEE Catalog: ECMWF/ERA5_LAND/MONTHLY_AGGR",
    relacionados: ["lst", "chirps", "landsat"],
  },
  {
    id: "firms",
    termino: "FIRMS (focos de incendio)",
    resumen_corto:
      "Sistema de NASA que detecta focos de fuego activos casi en tiempo real desde satélite.",
    descripcion_larga:
      "Fire Information for Resource Management System (FIRMS) entrega detecciones de anomalías térmicas (fuegos activos) desde MODIS (1 km) y VIIRS (375 m), con latencia de ~3 horas (NRT) o calidad estándar a 24 h. En Earth Engine: `FIRMS` (MODIS) y endpoints VIIRS NRT vía API. Cada detección incluye coordenadas, brillo (T4), confianza y FRP (Fire Radiative Power en MW). Para Posadas y la región noreste argentino-paraguaya monitoreamos: quemas agrícolas en el cinturón verde (estacionales agosto-octubre), incendios en humedales del Paraná, y ocasionales focos peri-urbanos. Útil para correlacionar con eventos de mala calidad de aire (cruzar con NO2 / aerosol).",
    categoria: "satelital",
    alias: ["fire", "incendios", "fuegos activos", "NASA FIRMS"],
    fuente_url: "https://firms.modaps.eosdis.nasa.gov/",
    fuente_label: "NASA FIRMS",
    relacionados: ["modis", "viirs", "no2"],
  },
  {
    id: "black-marble",
    termino: "NASA Black Marble VNP46A2",
    resumen_corto:
      "Producto diario de luces nocturnas de NASA, ya corregido por nubes y luz de luna.",
    descripcion_larga:
      "Black Marble (`NASA/VIIRS/002/VNP46A2`) es la versión diaria gap-filled de las luces nocturnas VIIRS, con correcciones de fondo lunar, atmosféricas y de cobertura nubosa ya aplicadas por el equipo de NASA Goddard. Resolución 500 m, banda principal `Gap_Filled_DNB_BRDF-Corrected_NTL`. Frente a la versión mensual VIIRS, **Black Marble diario** permite detectar eventos puntuales: cortes de luz prolongados, picos de actividad por eventos masivos, y cambios estacionales finos. Para Posadas lo usamos para medir la robustez del servicio eléctrico por barrio y crear un índice de equidad lumínica.",
    categoria: "satelital",
    alias: ["VNP46A2", "Black Marble", "NASA nightlights diario"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP46A2",
    fuente_label: "GEE Catalog: NASA/VIIRS/002/VNP46A2",
    relacionados: ["viirs", "ghsl", "worldpop"],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // DATOS PÚBLICOS / FUENTES
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "open-buildings",
    termino: "Google Open Buildings v3",
    resumen_corto:
      "Base de datos de Google con casi todos los techos del mundo, detectados por IA.",
    descripcion_larga:
      "Open Buildings v3 (`GOOGLE/Research/open-buildings/v3/polygons`) entrega ~1.800 millones de footprints de edificios detectados por una red neuronal sobre imágenes satelitales de alta resolución (~50 cm). Cada polígono incluye `confidence` (0-1), `area_in_meters` y `full_plus_code`. Cobertura inicial Global South — Argentina incluida. Para Posadas hacemos: filtrado por `confidence > 0.7`, agregación por radio censal (densidad de edificios por hectárea), y diferencia inter-versión para detectar nuevas construcciones. Limitación: en zonas con techos verdes o de paja la detección es peor. Es el dataset de building footprints más extenso disponible públicamente.",
    categoria: "datos_publicos",
    alias: [
      "open buildings",
      "Google buildings",
      "footprints Google",
      "v3 buildings",
    ],
    fuente_url: "https://sites.research.google/open-buildings/",
    fuente_label: "Google Research: Open Buildings",
    relacionados: ["ms-buildings", "ghsl", "dynamic-world"],
  },
  {
    id: "ms-buildings",
    termino: "Microsoft Building Footprints",
    resumen_corto:
      "Mapa abierto de Microsoft con techos detectados por IA. Complementa al de Google.",
    descripcion_larga:
      "Microsoft publica datasets de footprints de edificios para múltiples países (incluyendo el dataset 'GlobalMLBuildingFootprints' con ~1.400 millones de edificios) detectados con deep learning sobre imágenes de Bing Maps. Cobertura global con calidad heterogénea por región. Para Argentina y Posadas en particular lo usamos como **validación cruzada** de Open Buildings: cuando ambos productos coinciden en un footprint, la confianza sube; cuando solo uno detecta, se marca para revisión manual o se descarta del análisis. Distribución vía GitHub (geojsonl) y Source Cooperative bajo licencia ODbL. La unión Google+Microsoft es la mejor estimación pública de building stock.",
    categoria: "datos_publicos",
    alias: [
      "Microsoft buildings",
      "MS buildings",
      "GlobalMLBuildingFootprints",
      "Bing buildings",
    ],
    fuente_url:
      "https://github.com/microsoft/GlobalMLBuildingFootprints",
    fuente_label: "Microsoft GlobalMLBuildingFootprints (GitHub)",
    relacionados: ["open-buildings", "ghsl"],
  },
  {
    id: "mapbiomas",
    termino: "MapBiomas Argentina Col.1",
    resumen_corto:
      "Mapa argentino de uso del suelo año a año desde el año 2000, hecho por una red de universidades.",
    descripcion_larga:
      "Iniciativa colaborativa que reconstruye el uso y cobertura del suelo de Argentina año a año (1985-presente para algunas colecciones; Col.1 para Argentina cubre desde el año 2000) clasificando series temporales Landsat con clasificadores Random Forest en Google Earth Engine. Categorías incluyen bosque nativo, plantación forestal, agropecuaria (con sub-clases), pastizales, cuerpos de agua y áreas urbanizadas. Para Posadas lo usamos para reconstruir la **cronología de pérdida de selva paranaense** en el periurbano y la conversión bosque → cultivo → urbano. Se actualiza anualmente y es la mejor serie LULC argentina disponible públicamente.",
    categoria: "datos_publicos",
    alias: ["MapBiomas", "MapBiomas Argentina", "MapBiomas Chaco"],
    fuente_url: "https://argentina.mapbiomas.org/",
    fuente_label: "MapBiomas Argentina",
    relacionados: ["dynamic-world", "ghsl", "sentinel-2"],
  },
  {
    id: "ghsl",
    termino: "GHSL P2023A",
    resumen_corto:
      "Mapa global de asentamientos humanos del Joint Research Centre europeo. Trackea expansión urbana.",
    descripcion_larga:
      "Global Human Settlement Layer, productos GHS-BUILT-S y GHS-POP de la versión P2023A producidos por el Joint Research Centre (JRC) de la Unión Europea. Combina Landsat + Sentinel-2 + datos auxiliares para entregar superficie construida (m² por celda) y población residencial estimada a resoluciones de 100 m, 1 km y 30''. Series temporales 1975-2030 (proyectada) con épocas cada 5 años. Para Posadas reconstruimos la curva de expansión histórica del aglomerado (Posadas + Garupá + Candelaria) y validamos contra MapBiomas y datos INDEC. Es el estándar internacional para comparación inter-ciudad de huella urbana.",
    categoria: "datos_publicos",
    alias: ["GHSL", "GHS-BUILT", "GHS-POP", "JRC GHSL", "Global Human Settlement"],
    fuente_url: "https://human-settlement.emergency.copernicus.eu/",
    fuente_label: "EU JRC Global Human Settlement Layer",
    relacionados: ["worldpop", "open-buildings", "mapbiomas", "dynamic-world"],
  },
  {
    id: "chirps",
    termino: "CHIRPS (precipitación)",
    resumen_corto:
      "Estimación de lluvias del USGS combinando satélite y estaciones, desde 1981, todos los días.",
    descripcion_larga:
      "Climate Hazards Group InfraRed Precipitation with Stations (`UCSB-CHG/CHIRPS/DAILY` y `PENTAD`), producto del UCSB y USGS. Combina imagen satelital infrarroja con datos de estaciones meteorológicas para estimar precipitación a 0.05° (~5.5 km) desde 1981 hasta el presente, con latencia ~3 semanas. Para Posadas lo usamos como serie de referencia de largo plazo (precipitación anual típica 1800-2300 mm, fuertemente estacional con picos en verano y otoño) y para construir índices de sequía/exceso hídrico que correlacionan con UHI y NDVI. Validamos contra ERA5-Land y estaciones SMN cercanas.",
    categoria: "datos_publicos",
    alias: ["CHIRPS", "precipitación CHIRPS", "USGS CHIRPS"],
    fuente_url: "https://www.chc.ucsb.edu/data/chirps",
    fuente_label: "UCSB Climate Hazards Center: CHIRPS",
    relacionados: ["era5", "ndvi"],
  },
  {
    id: "no2",
    termino: "Sentinel-5P NO2 troposférico",
    resumen_corto:
      "Satélite europeo que mide gases de la atmósfera. NO2 es el principal indicador de tráfico.",
    descripcion_larga:
      "Sentinel-5 Precursor lleva el instrumento TROPOMI (TROPOspheric Monitoring Instrument), que mide la columna troposférica de NO2 a ~5.5 × 3.5 km por píxel con revisita diaria. Colección Earth Engine: `COPERNICUS/S5P/OFFL/L3_NO2`, banda principal `tropospheric_NO2_column_number_density` en mol/m². El NO2 es subproducto de combustión: tráfico vehicular y plantas térmicas son las fuentes urbanas principales. Para Posadas observamos firmas claras sobre el centro y los corredores de RN12 y RN105; útil para vincular calidad de aire con UHI y planificación del transporte. Los promedios mensuales filtran ruido de pasada única.",
    categoria: "datos_publicos",
    alias: [
      "S5P",
      "Sentinel-5P",
      "TROPOMI",
      "calidad de aire",
      "dióxido de nitrógeno",
    ],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_NO2",
    fuente_label: "GEE Catalog: COPERNICUS/S5P/OFFL/L3_NO2",
    relacionados: ["sentinel-2", "firms"],
  },
  {
    id: "wdpa",
    termino: "WDPA (áreas protegidas)",
    resumen_corto:
      "Base de datos mundial de parques y reservas naturales mantenida por la ONU y la IUCN.",
    descripcion_larga:
      "World Database on Protected Areas (`WCMC/WDPA/current/polygons`), mantenida por UNEP-WCMC y la IUCN. Incluye polígonos y atributos de áreas protegidas globales con categorías IUCN (Ia estricta hasta VI uso sostenible), año de designación, gobernanza y estado de gestión. Para la región de Posadas relevamos: Parque Provincial Cerro Azul, áreas de la cuenca del Paraná y reservas privadas en Misiones. Lo usamos para mascarar baseline rural en cálculos de UHI (excluir áreas protegidas no es lo mismo que campo agrícola normal) y como capa de contexto en mapas. Actualización mensual.",
    categoria: "datos_publicos",
    alias: [
      "WDPA",
      "áreas protegidas",
      "protected areas",
      "IUCN",
      "Protected Planet",
    ],
    fuente_url: "https://www.protectedplanet.net/",
    fuente_label: "UNEP-WCMC + IUCN: Protected Planet",
    relacionados: ["mapbiomas", "uhi-vs-rural"],
  },
  {
    id: "worldpop",
    termino: "WorldPop",
    resumen_corto:
      "Estimación de cuántas personas viven en cada cuadra del mundo, hecha en la Universidad de Southampton.",
    descripcion_larga:
      "WorldPop (Universidad de Southampton) modela densidad poblacional global a 100 m (3'' arc) y 1 km combinando censos nacionales con covariables satelitales (luces nocturnas, edificios, accesibilidad, cobertura del suelo) usando un Random Forest dasimétrico. Productos `WorldPop/GP/100m/pop` en Earth Engine. Para Posadas lo usamos como proxy continuo de densidad poblacional cuando los radios censales INDEC son muy gruesos para análisis intra-barrio, y como input para calcular **población expuesta a UHI** (cruce LST × WorldPop por celda). Validamos contra censo INDEC 2010 y 2022.",
    categoria: "datos_publicos",
    alias: ["WorldPop", "población satelital", "Southampton WorldPop"],
    fuente_url: "https://www.worldpop.org/",
    fuente_label: "WorldPop, University of Southampton",
    relacionados: ["ghsl", "indec-radios-censales", "viirs"],
  },
  {
    id: "indec-radios-censales",
    termino: "Radios censales INDEC 2022",
    resumen_corto:
      "Las celdas más pequeñas con las que el INDEC publica datos de censo en Argentina.",
    descripcion_larga:
      "Los radios censales son la unidad geográfica mínima de difusión del Censo Nacional de Población, Hogares y Viviendas 2022 (INDEC). Cada radio agrupa ~300 viviendas en zonas urbanas (más en rurales) y publica indicadores: población, hogares, NBI, hacinamiento, jefatura femenina, escolaridad, etc. Para el aglomerado Gran Posadas (Posadas + Garupá + Candelaria) trabajamos con los radios provistos por el INDEC vía REDATAM y el portal de datos abiertos. Es el ground-truth socioeconómico que cruzamos con LST, NDVI, building density y luces nocturnas para análisis de equidad ambiental urbana.",
    categoria: "datos_publicos",
    alias: [
      "INDEC",
      "radios censales",
      "censo 2022",
      "Censo Nacional",
      "REDATAM",
    ],
    fuente_url: "https://www.indec.gob.ar/indec/web/Nivel4-Tema-2-41-165",
    fuente_label: "INDEC Censo 2022",
    relacionados: ["worldpop", "ghsl"],
  },
  {
    id: "open-meteo",
    termino: "Open-Meteo Ensemble API",
    resumen_corto:
      "API gratuita que combina varios modelos meteorológicos para predecir el clima.",
    descripcion_larga:
      "Open-Meteo (open-meteo.com) provee una API REST gratuita y sin clave que entrega forecasts y reanálisis horarios desde múltiples modelos numéricos (GFS, ECMWF, ICON, JMA, MeteoFrance) y los ensambla. Para Posadas la usamos como fuente de **temperatura del aire forecasteada** (próximos 7 días) que mostramos en el dashboard junto a la última lectura LST satelital, como contexto para usuarios no técnicos. La ventaja sobre fuentes oficiales es la cobertura ensemble (multimodelo) sin trámite de API key, y el endpoint Historical/Reanalysis ERA5 ya pre-calculado. Limitación: latencia de horas vs minutos de un servicio comercial pago.",
    categoria: "datos_publicos",
    alias: ["Open-Meteo", "OpenMeteo", "ensemble forecast"],
    fuente_url: "https://open-meteo.com/",
    fuente_label: "Open-Meteo (api.open-meteo.com)",
    relacionados: ["era5", "lst"],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // ESTADÍSTICA Y MODELOS
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "percentil",
    termino: "Percentiles (p10, p50, p90)",
    resumen_corto:
      "Si ordenás los datos de menor a mayor, el p10 es el valor que deja al 10% por debajo.",
    descripcion_larga:
      "Un percentil-k es el valor por debajo del cual cae el k% de las observaciones de una distribución. Los más usados en este observatorio: **p50** (la mediana, valor del medio, robusto a outliers), **p10** (deja solo al 10% más bajo por debajo) y **p90** (deja al 90% por debajo, captura el extremo alto). Cuando reportamos por ejemplo 'LST verano del barrio X: p10=29°C, p50=34°C, p90=42°C', estamos describiendo la distribución completa, no solo el promedio. La banda p10-p90 se grafica como **banda de confianza visual** alrededor de la mediana. Mucho más informativo que reportar solo el promedio cuando hay outliers o asimetría.",
    categoria: "estadistica",
    alias: ["percentiles", "p10", "p50", "p90", "mediana", "cuantiles"],
    fuente_url:
      "https://en.wikipedia.org/wiki/Percentile",
    fuente_label: "Wikipedia: Percentile",
    relacionados: ["ci-95", "ols", "r2"],
  },
  {
    id: "r2",
    termino: "R² (coeficiente de determinación)",
    resumen_corto:
      "Indicador de qué tan bien un modelo explica los datos. Va de 0 a 1; mayor a 0.7 es muy bueno.",
    descripcion_larga:
      "El R² o coeficiente de determinación mide la proporción de varianza de la variable dependiente que el modelo explica: `R² = 1 - SSres/SStot`, donde SSres es la suma de cuadrados de los residuos y SStot la varianza total de los datos. Va de 0 (el modelo no explica nada) a 1 (explica perfectamente). Valores típicos por dominio: ciencias sociales 0.2-0.5 ya es decente; física/ingeniería suele esperar >0.9. En este observatorio reportamos R² para validaciones de regresiones (ej. ERA5-Land vs Landsat LST: R²=0.802, equivalente a r=0.896). **Cuidado**: un R² alto no implica causalidad ni que el modelo esté bien especificado.",
    categoria: "estadistica",
    alias: [
      "R cuadrado",
      "R squared",
      "coeficiente de determinación",
      "R²",
      "r2",
    ],
    fuente_url:
      "https://en.wikipedia.org/wiki/Coefficient_of_determination",
    fuente_label: "Wikipedia: Coefficient of determination",
    relacionados: ["ols", "ci-95", "percentil"],
  },
  {
    id: "ci-95",
    termino: "Intervalo de confianza 95%",
    resumen_corto:
      "Rango donde es muy probable que esté el valor real. 'Probable' = 95 de cada 100 mediciones.",
    descripcion_larga:
      "Un intervalo de confianza al 95% (IC 95%) es un rango construido a partir de los datos tal que, si repitiéramos el experimento muchas veces, el 95% de los intervalos calculados contendría el valor poblacional verdadero. Para una media muestral con varianza desconocida (caso usual) usamos la distribución **t-Student**: `IC = x̄ ± t(α/2, n-1) · s/√n`. Con n=30 y α=0.05, `t ≈ 2.045`. En este observatorio reportamos IC 95% en cada métrica agregada (ej. UHI promedio del verano = +3.4°C, IC 95% [+2.9, +3.9]) para que el lector pueda distinguir señal de ruido. Un IC muy ancho indica que necesitamos más datos o hay alta variabilidad.",
    categoria: "estadistica",
    alias: [
      "intervalo de confianza",
      "IC 95",
      "IC95",
      "confidence interval",
      "CI 95",
      "t-Student",
    ],
    fuente_url:
      "https://en.wikipedia.org/wiki/Confidence_interval",
    fuente_label: "Wikipedia: Confidence interval",
    relacionados: ["percentil", "r2", "ols"],
  },
  {
    id: "ols",
    termino: "OLS (Mínimos Cuadrados Ordinarios)",
    resumen_corto:
      "Forma estándar de ajustar una recta a un conjunto de puntos. Minimiza la distancia vertical al cuadrado.",
    descripcion_larga:
      "Ordinary Least Squares es el estimador clásico de regresión lineal: dado un conjunto de pares (x, y), encuentra los coeficientes β que minimizan la suma de cuadrados de los residuos `Σ(yi - β0 - β1·xi)²`. Tiene solución cerrada `β̂ = (XᵀX)⁻¹ Xᵀy` y es el estimador insesgado de menor varianza bajo los supuestos Gauss-Markov (linealidad, exogeneidad, homocedasticidad, no autocorrelación). En este observatorio usamos OLS para tendencias temporales (ej. UHI vs año) y validaciones cruzadas entre datasets (ERA5 vs Landsat). Reportamos siempre β, R², IC 95% sobre β y test de hipótesis H0: β=0. Limitación: sensible a outliers y heterocedasticidad; cuando esto ocurre usamos errores estándar robustos (HC1) o regresión por percentiles.",
    categoria: "estadistica",
    alias: [
      "OLS",
      "mínimos cuadrados",
      "regresión lineal",
      "ordinary least squares",
      "linear regression",
    ],
    fuente_url:
      "https://en.wikipedia.org/wiki/Ordinary_least_squares",
    fuente_label: "Wikipedia: Ordinary least squares",
    relacionados: ["r2", "ci-95", "percentil"],
  },

  // ============================================================
  // ESTADÍSTICA — adicionales (validación, métricas de error)
  // ============================================================

  {
    id: "pearson-r",
    termino: "Pearson r (coeficiente de correlación)",
    resumen_corto:
      "Número entre -1 y 1 que mide qué tan bien dos variables suben o bajan juntas. r=1 perfecto positivo, r=0 sin relación.",
    descripcion_larga:
      "Coeficiente de correlación lineal de Pearson. Mide la fuerza y dirección de la relación lineal entre dos variables continuas. Para Posadas se usó en la validación de campo (sección 15 metodología): r=0.896 entre LST satelital mensual y temperatura del aire ERA5-Land — indica que ambas series suben y bajan juntas con alta consistencia, validando la LST como proxy de variabilidad estacional. Reglas de pulgar: |r|>0.7 fuerte, 0.4-0.7 moderado, <0.4 débil. NO mide igualdad — dos series pueden tener r=1 pero estar offset 10°C; para igualdad usar RMSE y sesgo.",
    categoria: "estadistica",
    alias: ["correlacion", "coeficiente correlación", "pearson"],
    fuente_url:
      "https://en.wikipedia.org/wiki/Pearson_correlation_coefficient",
    fuente_label: "Wikipedia: Pearson correlation",
    relacionados: ["r2", "rmse", "sesgo"],
  },
  {
    id: "rmse",
    termino: "RMSE (raíz del error cuadrático medio)",
    resumen_corto:
      "Promedio de cuánto se equivoca una predicción, en las unidades originales. RMSE menor = predicción más precisa.",
    descripcion_larga:
      "Root Mean Square Error. Mide la magnitud típica del error de una predicción o un modelo respecto a las observaciones reales. Se calcula como `sqrt(mean((pred - real)^2))`, en las mismas unidades que la variable. Para Posadas se reportó RMSE = 10.55°C entre LST satelital y aire ERA5: las temperaturas satelitales se desvían en promedio ±10.5°C de la temperatura del aire — esperable porque LST mide la superficie (techo, asfalto) mientras el aire es más frío. Penaliza errores grandes más que MAE (mean absolute error). Útil para comparar modelos: el menor RMSE gana.",
    categoria: "estadistica",
    alias: ["raiz error cuadratico medio", "root mean square error"],
    fuente_url:
      "https://en.wikipedia.org/wiki/Root-mean-square_deviation",
    fuente_label: "Wikipedia: Root-mean-square deviation",
    relacionados: ["pearson-r", "sesgo", "r2"],
  },
  {
    id: "sesgo",
    termino: "Sesgo (bias)",
    resumen_corto:
      "Diferencia promedio entre lo que predice un modelo y la realidad. Sesgo positivo = sobreestima, negativo = subestima.",
    descripcion_larga:
      "El sesgo (o bias) de una predicción es el promedio simple de los errores: `mean(pred - real)`. A diferencia del RMSE (que mide magnitud), el sesgo conserva el signo y muestra si el modelo sistemáticamente sobreestima (positivo) o subestima (negativo). Para Posadas el sesgo medio LST − T_aire es +9.47°C: la LST satelital sistemáticamente está ~9.5°C arriba del aire, lo cual es físicamente esperable (el suelo absorbe radiación) y confirma que la LST NO debe usarse como temperatura ambiente. Modelos bien calibrados deberían tener sesgo cercano a cero.",
    categoria: "estadistica",
    alias: ["bias", "error sistematico"],
    fuente_url: "https://en.wikipedia.org/wiki/Bias_of_an_estimator",
    fuente_label: "Wikipedia: Bias of an estimator",
    relacionados: ["rmse", "pearson-r"],
  },

  // ============================================================
  // SATELITAL — adicionales (índices, sensores DEM)
  // ============================================================

  {
    id: "ndbi",
    termino: "NDBI (Normalized Difference Built-up Index)",
    resumen_corto:
      "Índice satelital que detecta superficies construidas (concreto, techos, asfalto). Valores altos = más urbano.",
    descripcion_larga:
      "Índice normalizado que distingue áreas construidas usando bandas SWIR e infrarrojo cercano de Sentinel-2 o Landsat: `(SWIR - NIR) / (SWIR + NIR)`. Valores positivos cercanos a 1 indican superficies impermeables (techos, calles, edificios); valores negativos indican vegetación o agua. Se usa como proxy de huella urbana cuando no hay un dataset de buildings. Complemento del NDVI (vegetación) y NDWI (agua). En el observatorio aparece en pipeline interno (no en UI consumidor) para validar que la detección de viviendas es coherente con la firma espectral.",
    categoria: "satelital",
    alias: ["normalized difference built-up index", "indice construido"],
    fuente_url:
      "https://www.sciencedirect.com/topics/earth-and-planetary-sciences/normalized-difference-built-up-index",
    fuente_label: "ScienceDirect: NDBI",
    relacionados: ["ndvi", "sentinel-2", "landsat"],
  },
  {
    id: "srtm",
    termino: "SRTM (Shuttle Radar Topography Mission)",
    resumen_corto:
      "Modelo de elevación del terreno (DEM) de 30 m de resolución generado por el transbordador espacial en el año 2000.",
    descripcion_larga:
      "Modelo digital de elevación global capturado por el transbordador Endeavour en febrero del 2000 usando radar interferométrico. Resolución 30 m (1 arc-second) entre 60°N y 56°S — cubre toda Argentina. Se usa en el observatorio para la vista 3D (`/3d`) como base de relieve, sumado a través de los tiles `terrain-rgb-v2` de MapTiler. Permite ver la depresión costera del Río Paraná y los altos del centro de Posadas (~125 m s.n.m.). Limitación: el dato es del 2000 y NO incluye edificios — solo superficie del terreno.",
    categoria: "satelital",
    alias: ["dem", "shuttle radar topography mission", "modelo elevacion"],
    fuente_url: "https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm",
    fuente_label: "USGS: SRTM archive",
    relacionados: ["landsat"],
  },

  // ============================================================
  // INFRAESTRUCTURA — herramientas y librerías de la webapp
  // ============================================================

  {
    id: "maptiler",
    termino: "MapTiler",
    resumen_corto:
      "Servicio comercial de tiles de mapas. El observatorio usa su capa de relieve gratuita (terrain-rgb) en la vista 3D.",
    descripcion_larga:
      "Plataforma comercial suiza que sirve tiles raster y vectoriales de mapas globales, incluyendo terrain-rgb-v2: tiles que codifican elevación SRTM en RGB para que MapLibre los interprete como DEM. El observatorio lo usa en `/3d` para mostrar relieve real. Free tier: 100k tiles/mes — suficiente para un observatorio público con tráfico moderado. Sin la key configurada, la página /3d degrada gracefully a 2D con extrusión de polígonos pero sin elevación.",
    categoria: "infraestructura",
    alias: ["map tiler", "terrain-rgb"],
    fuente_url: "https://www.maptiler.com/cloud/",
    fuente_label: "MapTiler Cloud",
    relacionados: ["srtm"],
  },
  {
    id: "maplibre",
    termino: "MapLibre GL",
    resumen_corto:
      "Librería open source de mapas web acelerados por GPU. Fork comunitario de Mapbox GL JS desde 2020.",
    descripcion_larga:
      "Librería WebGL para renderear mapas vectoriales y raster en el navegador con aceleración por GPU. Es un fork open source de Mapbox GL JS v1 después de que Mapbox cambió su licencia en diciembre de 2020 a una propietaria. El observatorio la usa en `/3d` por dos motivos: soporte nativo de pitch/bearing para vistas tridimensionales, y consumo de tiles terrain-rgb para renderear DEM como relieve. Sin costos ni cuenta requerida.",
    categoria: "infraestructura",
    alias: ["maplibre gl js", "mapa webgl"],
    fuente_url: "https://maplibre.org/",
    fuente_label: "MapLibre.org",
    relacionados: ["maptiler", "srtm"],
  },
  {
    id: "deck-gl",
    termino: "deck.gl",
    resumen_corto:
      "Librería de visualización geoespacial WebGL desarrollada por Uber. Renderea cientos de miles de puntos a 60 fps.",
    descripcion_larga:
      "Framework de visualización de datos geoespaciales aceleradado por GPU vía WebGL2. Fue creado por Uber para sus dashboards internos y liberado como open source. El observatorio lo usa en `/densidad` para renderear los 217.000 edificios de la base merged Google + Microsoft como un heatmap a 60 fps — algo imposible con Leaflet o canvas tradicional. También tiene HexagonLayer para agregación espacial automática (binning H3) sin pre-cómputo. Compatible con MapLibre y otras bases de tiles.",
    categoria: "infraestructura",
    alias: ["deckgl", "deck.gl uber"],
    fuente_url: "https://deck.gl/",
    fuente_label: "deck.gl docs",
    relacionados: ["h3", "maplibre"],
  },
  {
    id: "h3",
    termino: "H3 (Hexagonal Hierarchical Spatial Index)",
    resumen_corto:
      "Sistema de Uber que divide el planeta en hexágonos jerárquicos. Cada hexágono tiene un ID único en cualquier escala.",
    descripcion_larga:
      "Sistema de indexación espacial jerárquica basada en hexágonos. Divide la Tierra en celdas hexagonales de varios tamaños (16 niveles de resolución, desde 1107 km hasta 0.5 m por arista) con un único identificador por celda. Ventaja sobre cuadrículas: la distancia a vecinos es uniforme. El observatorio lo usa en `/densidad` para agregar 217k edificios en hexágonos de ~200 m antes de pasarlos a deck.gl, lo cual reduce 5x el cómputo manteniendo densidad agregada. Usado también por Foursquare, Snapchat, Tesla.",
    categoria: "infraestructura",
    alias: ["uber h3", "hexagonal index", "h3-js"],
    fuente_url: "https://h3geo.org/",
    fuente_label: "H3 docs",
    relacionados: ["deck-gl"],
  },
  {
    id: "sse",
    termino: "SSE (Server-Sent Events)",
    resumen_corto:
      "Conexión en vivo del navegador al servidor por la cual el servidor empuja eventos cuando hay novedades. Sin polling.",
    descripcion_larga:
      "Server-Sent Events es un estándar HTTP donde el servidor mantiene una conexión abierta y empuja mensajes al cliente cuando ocurren eventos. A diferencia de WebSockets, es unidireccional (solo server → client) y usa HTTP/1.1 normal — funciona detrás de cualquier proxy. El observatorio usa SSE en el endpoint `/api/forecast/stream` para notificar al navegador cuando el cron actualiza el forecast en Upstash, así el `UpdateIndicator` cambia el dot pulsante sin que el usuario refresque. Si SSE falla (proxies viejos), cae a polling cada 5 minutos.",
    categoria: "infraestructura",
    alias: ["server sent events", "eventsource"],
    fuente_url: "https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events",
    fuente_label: "MDN: Server-Sent Events",
    relacionados: [],
  },
  {
    id: "upstash",
    termino: "Upstash Redis",
    resumen_corto:
      "Servicio serverless de Redis con API REST. El observatorio cachea ahí el forecast actual cada 6 horas.",
    descripcion_larga:
      "Base de datos Redis serverless con API HTTP REST en lugar del protocolo Redis nativo. Útil para entornos sin TCP persistente (edge functions, GitHub Actions). El observatorio la usa como cache + canal pub/sub: el cron de GitHub Actions cada 6h descarga el forecast de Open-Meteo y lo publica a `forecast:metadata` y `alertas:activas`; los endpoints `/api/forecast` y `/api/forecast/stream` leen de ahí. Free tier: 256 MB + 500k comandos/mes — uso real <1%. Sin Upstash configurado, la app degrada a leer CSVs locales.",
    categoria: "infraestructura",
    alias: ["redis serverless"],
    fuente_url: "https://upstash.com/docs/redis",
    fuente_label: "Upstash Redis docs",
    relacionados: ["sse"],
  },
  {
    id: "wmo",
    termino: "WMO (Weather Codes)",
    resumen_corto:
      "Códigos numéricos que describen el clima del día (despejado, nublado, lluvia, tormenta) según la Organización Meteorológica Mundial.",
    descripcion_larga:
      "Tabla estandarizada de la World Meteorological Organization que codifica condiciones meteorológicas con un número entre 0 y 99. Por ejemplo: 0 = despejado, 3 = nublado, 61 = lluvia ligera, 95 = tormenta, 99 = tormenta intensa con granizo. Open-Meteo retorna estos códigos en cada forecast horario/diario. El observatorio los traduce a emoji + descripción corta en español en el componente `PronosticoBarrio` para que cualquier usuario entienda sin consultar la tabla.",
    categoria: "estadistica",
    alias: ["weather codes", "wmo codes", "codigos meteo"],
    fuente_url: "https://open-meteo.com/en/docs#weathervariables",
    fuente_label: "Open-Meteo weather variables",
    relacionados: ["open-meteo"],
  },

  // ============================================================
  // CALIDAD DE AIRE — gases TROPOMI + servicios CAMS / AQI
  // ============================================================

  {
    id: "tropomi",
    termino: "TROPOMI (instrumento de Sentinel-5P)",
    resumen_corto:
      "Espectrómetro a bordo del satélite europeo Sentinel-5P que mide gases en la atmósfera todos los días.",
    descripcion_larga:
      "TROPOspheric Monitoring Instrument, espectrómetro de imágenes hiperspectral en UV-VIS-NIR-SWIR a bordo del satélite Sentinel-5 Precursor (lanzado octubre 2017, ESA + Países Bajos). Cubre el globo cada 24 h con resolución espacial nativa de 5.5 × 3.5 km (mejorada de 7×3.5 km en agosto 2019). Mide columnas atmosféricas de NO2, SO2, CO, HCHO, CH4, O3, aerosoles y nubes. Los productos OFFL L3 (offline, ~5 días de latencia) están en el catálogo de Earth Engine bajo `COPERNICUS/S5P/OFFL/L3_*`. Para Posadas usamos las medias anuales por polígono — los promedios mensuales son ruidosos a esta escala porque la ciudad cabe en pocos píxeles TROPOMI.",
    categoria: "satelital",
    alias: [
      "TROPOMI",
      "tropospheric monitoring instrument",
      "sentinel-5p tropomi",
    ],
    fuente_url: "https://sentinels.copernicus.eu/web/sentinel/missions/sentinel-5p",
    fuente_label: "ESA Copernicus Sentinel-5P",
    relacionados: ["no2", "so2", "co-monoxido", "hcho", "ch4", "cams"],
  },
  {
    id: "so2",
    termino: "SO2 (dióxido de azufre)",
    resumen_corto:
      "Gas que aparece cuando se quema combustible con azufre o cuando hay un volcán cerca. En Posadas la señal es muy débil.",
    descripcion_larga:
      "El dióxido de azufre (SO2) se emite por la quema de combustibles fósiles con azufre (carbón, fueloil, gasoil de baja calidad), refinación de petróleo y erupciones volcánicas. En atmósfera se oxida a sulfato y contribuye a la lluvia ácida y al PM2.5 secundario. TROPOMI mide la columna troposférica en mol/m² con el producto `COPERNICUS/S5P/OFFL/L3_SO2`. **Para Posadas la señal típica es muy baja**: no hay industria pesada local (refinerías, termoeléctricas a carbón). Cuando aparezcan picos suelen estar relacionados a incendios upwind o transporte de plumas industriales del centro-sur de Brasil. Lo reportamos por completitud aunque el valor habitual ronde el ruido del instrumento.",
    categoria: "datos_publicos",
    alias: ["dióxido de azufre", "sulphur dioxide", "S5P SO2"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_SO2",
    fuente_label: "GEE Catalog: COPERNICUS/S5P/OFFL/L3_SO2",
    relacionados: ["tropomi", "no2", "co-monoxido"],
  },
  {
    id: "co-monoxido",
    termino: "CO (monóxido de carbono)",
    resumen_corto:
      "Gas tóxico que sale cuando el combustible no se quema bien. Sube fuerte cuando hay quemas o incendios cerca.",
    descripcion_larga:
      "El monóxido de carbono (CO) es producto de combustión incompleta: motores nafteros mal regulados, generadores diésel, fogatas, hornos a leña y especialmente quemas agrícolas e incendios forestales. Es tóxico para los humanos a concentraciones altas porque desplaza al oxígeno en la sangre. TROPOMI mide la columna total atmosférica en mol/m² con `COPERNICUS/S5P/OFFL/L3_CO`. Para Posadas y la región noreste argentino-paraguaya, los picos anuales suelen coincidir con la temporada seca de quemas (agosto-octubre) en humedales y campo paraguayo. Útil cruzar con FIRMS (focos de fuego) para confirmar el origen.",
    categoria: "datos_publicos",
    alias: ["monóxido de carbono", "carbon monoxide", "S5P CO"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_CO",
    fuente_label: "GEE Catalog: COPERNICUS/S5P/OFFL/L3_CO",
    relacionados: ["tropomi", "firms", "no2", "hcho"],
  },
  {
    id: "hcho",
    termino: "HCHO (formaldehído)",
    resumen_corto:
      "Gas mezcla de selva (biogénico) y combustión. En Misiones tiene aporte fuerte de la vegetación.",
    descripcion_larga:
      "Formaldehído (HCHO) es un compuesto orgánico volátil intermedio en la oxidación atmosférica de metano y de hidrocarburos no metánicos (NMHC). En zonas con vegetación densa (selva paranaense en Misiones) hay un aporte biogénico fuerte por isopreno emitido por los árboles. En zonas urbanas se suma una componente antropogénica por tráfico vehicular y quemas. TROPOMI mide la columna troposférica en mol/m² con `COPERNICUS/S5P/OFFL/L3_HCHO`. Para Posadas el valor de fondo es alto durante el verano (estación de actividad biogénica máxima); los anómalos suelen relacionarse con eventos de quemas regionales más que con tránsito local.",
    categoria: "datos_publicos",
    alias: ["formaldehído", "formaldehyde", "S5P HCHO"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_HCHO",
    fuente_label: "GEE Catalog: COPERNICUS/S5P/OFFL/L3_HCHO",
    relacionados: ["tropomi", "no2", "co-monoxido"],
  },
  {
    id: "ch4",
    termino: "CH4 (metano)",
    resumen_corto:
      "Gas de efecto invernadero potente. Sube por ganadería, rellenos sanitarios y fugas de gas natural. La resolución del satélite es muy gruesa.",
    descripcion_larga:
      "Metano (CH4) es el segundo gas de efecto invernadero más importante después del CO2 (~28 veces más potente en horizonte de 100 años). Fuentes principales: ganadería bovina (rumiantes), arrozales, rellenos sanitarios, fugas en infraestructura de gas natural y quemas. TROPOMI mide el mixing ratio columna en partes por mil millones (ppb) con `COPERNICUS/S5P/OFFL/L3_CH4`. **Limitación clave para escalas urbanas**: la resolución espacial efectiva del producto CH4 es ~7 × 7 km — **un solo píxel cubre varios barrios de Posadas**, así que no se puede usar para diferenciar entre asentamientos vecinos. En el observatorio lo marcamos con `ch4_calidad=baja` y solo lo reportamos como referencia regional, no intra-urbana.",
    categoria: "datos_publicos",
    alias: ["metano", "methane", "S5P CH4"],
    fuente_url:
      "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_CH4",
    fuente_label: "GEE Catalog: COPERNICUS/S5P/OFFL/L3_CH4",
    relacionados: ["tropomi", "co-monoxido"],
  },
  {
    id: "cams",
    termino: "CAMS (Copernicus Atmosphere Monitoring Service)",
    resumen_corto:
      "Modelo europeo que predice cómo va a estar la calidad del aire en los próximos días. NO es una medición real.",
    descripcion_larga:
      "Copernicus Atmosphere Monitoring Service (CAMS) es el servicio operacional de calidad de aire del programa Copernicus de la Unión Europea, gestionado por el ECMWF. Combina el modelo IFS-COMPO (química atmosférica global) con asimilación de datos satelitales (incluyendo TROPOMI) y observaciones de superficie para producir **forecasts** de PM10, PM2.5, NO2, SO2, O3 y otros contaminantes a 4 días vista, con resolución horaria y ~10 km espacial. **Es un modelo, no una medición**: dice cómo proyecta el sistema que estará el aire mañana, no cómo está hoy mismo. El observatorio consume los forecasts de CAMS vía la API gratuita de Open-Meteo Air Quality (que internamente usa CAMS), refrescados cada 6 h por un cron de GitHub Actions. El histórico real medido lo provee TROPOMI (Sentinel-5P).",
    categoria: "datos_publicos",
    alias: [
      "Copernicus CAMS",
      "Atmosphere Monitoring",
      "ECMWF CAMS",
      "modelo CAMS",
    ],
    fuente_url: "https://atmosphere.copernicus.eu/",
    fuente_label: "Copernicus Atmosphere Monitoring Service",
    relacionados: ["aqi", "tropomi", "open-meteo"],
  },
  {
    id: "aqi",
    termino: "AQI europeo (Air Quality Index)",
    resumen_corto:
      "Número entre 0 y 100+ que combina varios contaminantes en un solo indicador. Cuanto más bajo, mejor.",
    descripcion_larga:
      "European Air Quality Index, índice publicado por la Agencia Europea del Medio Ambiente (EEA) que combina PM10, PM2.5, NO2, O3 y SO2 en un único valor numérico para comunicar calidad del aire al público general. Bandas: 0-20 muy bueno, 20-40 bueno, 40-60 medio, 60-80 pobre, 80-100 malo, >100 muy malo. La fórmula toma el peor sub-índice entre los contaminantes considerados (regla del eslabón más débil). Para Posadas Open-Meteo entrega el AQI europeo diario forecasteado por CAMS — útil como semáforo simple en la UI cuando no se quiere mostrar 5 contaminantes por separado. Limitación: depende de la calidad del modelo CAMS sobre Sudamérica, y los puntos de calibración originales son europeos.",
    categoria: "datos_publicos",
    alias: ["European AQI", "air quality index", "indice calidad aire"],
    fuente_url: "https://www.eea.europa.eu/themes/air/air-quality-index",
    fuente_label: "EEA European Air Quality Index",
    relacionados: ["cams", "no2", "ozone"],
  },
];
