# Metodología — Calidad del aire (multi-gas)

Versión: v0.1.0 · Fecha: 2026-04-24 · Observatorio Urbano Posadas.

## 1. Por qué dos fuentes (y por qué no se mezclan)

La pestaña "Calidad del aire" del observatorio combina **dos fuentes que
miden cosas distintas y operan en escalas de tiempo distintas**. Es
crítico no confundirlas:

| Modo | Qué es | Origen | Frecuencia | Resolución |
|------|--------|--------|------------|------------|
| **Histórico anual** | Medición real del satélite | ESA Sentinel-5P TROPOMI | Anual (agregado) | ~5.5 × 3.5 km |
| **Forecast** | Predicción de un modelo numérico | Copernicus CAMS vía Open-Meteo | Cada 6 h | ~10 km global, valor único Posadas |

- El **histórico** es lo que **realmente** flotaba en la atmósfera durante
  cada año pasado, captado por el espectrómetro TROPOMI a bordo de
  Sentinel-5P. Tiene latencia (~5 días offline para L3) y por eso lo
  publicamos como agregado anual — los promedios anuales son
  estadísticamente robustos a estas escalas.
- El **forecast** es la salida del modelo CAMS (Copernicus Atmosphere
  Monitoring Service) ajustado con asimilación de datos satelitales y
  observaciones de superficie europeas. Pronostica los próximos ~5 días
  para un punto representativo de Posadas centro. Por ser un modelo
  global, no diferencia barrios.

> **No comparar punto a punto**: si el histórico TROPOMI 2024 dice NO₂ =
> 1.6 × 10⁻⁵ mol/m² y el forecast de mañana dice NO₂ = 8 µg/m³, son
> magnitudes en unidades distintas con metodologías distintas. Cada modo
> muestra su propia escala y leyenda.

## 2. Histórico — Sentinel-5P TROPOMI

### 2.1 Sensor y producto

TROPOMI (TROPOspheric Monitoring Instrument) es un espectrómetro de
imagen hyperspectral en UV-VIS-NIR-SWIR a bordo del satélite Sentinel-5
Precursor (lanzado octubre 2017, ESA + KNMI). Mide columnas atmosféricas
de gases trazadores con cobertura global diaria a ~5.5 × 3.5 km de
resolución espacial nativa (mejorada desde 7 × 3.5 km en agosto 2019).

Los productos OFFL (offline) Level-3 que consumimos están grillados a
una malla regular en el catálogo de Earth Engine bajo
`COPERNICUS/S5P/OFFL/L3_*`. Tienen ~5 días de latencia respecto a la
adquisición.

El pipeline que descarga y agrega los datos es
`scripts/48_aire_multigas.py`. Output:
`data/processed/ambiental/aire_multigas_anual.csv` con una fila por
(polígono, año) y todas las medias anuales por gas.

### 2.2 Gases que reportamos

| Gas | Asset Earth Engine | Banda | Unidad CSV | Calidad |
|-----|-------------------|-------|------------|---------|
| NO₂ | `COPERNICUS/S5P/OFFL/L3_NO2` | `tropospheric_NO2_column_number_density` | mol/m² | alta |
| SO₂ | `COPERNICUS/S5P/OFFL/L3_SO2` | `SO2_column_number_density` | mol/m² | alta |
| CO  | `COPERNICUS/S5P/OFFL/L3_CO`  | `CO_column_number_density` | mol/m² | alta |
| HCHO| `COPERNICUS/S5P/OFFL/L3_HCHO`| `tropospheric_HCHO_column_number_density` | mol/m² | alta |
| CH₄ | `COPERNICUS/S5P/OFFL/L3_CH4` | `CH4_column_volume_mixing_ratio_dry_air` | ppb | **baja** |
| O₃  | `COPERNICUS/S5P/OFFL/L3_O3`  | `O3_column_number_density` | DU (Dobson) | **baja** |

Para cada gas, además de la media anual, almacenamos:

- `n_imagenes_<gas>`: cuántas observaciones diarias L3 entraron en el
  promedio. Si es 0 → no hubo cobertura ese año en ese polígono.
- Para NO₂ adicionalmente computamos `no2_relativo_bbox`: el cociente
  entre el NO₂ del polígono y el NO₂ promedio del bbox urbano de
  Posadas. Valores >1 indican peor aire local que el promedio de la
  ciudad; <1 mejor. Es la métrica que el componente `AireGauge` legacy
  sigue exhibiendo.

### 2.3 Por qué importa cada gas para Posadas

- **NO₂ — tránsito vehicular**. La firma más limpia de actividad humana
  urbana. Picos sobre RN12, RN105 y el centro. Es el indicador que más
  responde a planificación del transporte: corredores BRT, peatonalización,
  flotas eléctricas.

- **SO₂ — industria pesada**. Para Posadas la señal típica es
  **muy débil**: no hay refinerías, termoeléctricas a carbón, ni
  smelters locales. Cuando aparezcan picos suelen ser plumas
  transportadas desde el centro-sur de Brasil o eventos volcánicos
  esporádicos (Andes). Lo reportamos por completitud y
  comparabilidad con otras ciudades, no porque esperemos hallazgos
  intra-urbanos.

- **CO — combustión incompleta + quemas**. Sube fuerte durante la
  temporada seca (agosto-octubre) por quemas agrícolas en humedales
  y campo paraguayo. Útil como proxy de calidad de aire por humo
  cuando se cruza con FIRMS (focos de incendio).

- **HCHO — biogénico + secundario**. Misiones tiene aporte fuerte
  por la selva paranaense (isopreno emitido por árboles → HCHO por
  oxidación). En verano el fondo es alto por esta razón natural;
  los anómalos suelen ser quemas regionales más que tránsito local.

- **CH₄ — agropecuario y gas natural**. Reportado pero **etiquetado
  con calidad baja**. La resolución espacial efectiva del producto
  CH₄ TROPOMI es ~7 × 7 km — un solo píxel cubre varios barrios de
  Posadas. **No diferencia entre asentamientos vecinos**. Útil como
  referencia regional, no intra-urbana. Las fugas de gas natural
  requieren sensores in-situ o satélites dedicados (GHGSat, MethaneSat).

- **O₃ — reportado solo por completitud, calidad baja**. TROPOMI
  reporta la **columna total atmosférica** (estratosférica +
  troposférica), dominada por la primera (~90%). La fracción
  troposférica (la que importa para health urbana) no se separa
  fácilmente sin algoritmos adicionales. **No usar este O₃ para
  decisiones urbanas**: usá el O₃ de superficie del forecast CAMS
  para eso, que sí es troposférico.

### 2.4 Cálculo de la media anual por polígono

Para cada (polígono, año, gas):

1. Filtramos la `ImageCollection` del asset por rango de fechas
   `[YYYY-01-01, (YYYY+1)-01-01)`.
2. Aplicamos `mean()` sobre la colección — promedio temporal de las
   pasadas diarias dentro del año.
3. Aplicamos `reduceRegion(reducer=mean(), geometry=poligono,
   scale=1113, maxPixels=1e10, bestEffort=True)` para obtener la
   media espacial dentro del polígono.

La escala 1113 m es la nominal del producto OFFL L3 NO₂; las demás
bandas se rasterizan a la misma malla. `bestEffort=True` deja que EE
adapte la escala si la región es muy grande.

### 2.5 Limitaciones conocidas

1. **Los polígonos chicos (<2 km²) caen dentro de pocos píxeles
   TROPOMI**, por lo que la varianza intra-anual es alta. Recomendado
   leer la serie 2019-2025 como tendencia, no obsesionarse con el
   valor de un año aislado.
2. **Cobertura nubosa**: TROPOMI no penetra nubes. En la temporada
   lluviosa (verano) la cantidad de observaciones válidas baja. La
   columna `n_imagenes_<gas>` permite filtrar polígonos con muy
   pocas pasadas.
3. **Edge effects**: los polígonos en el borde del bbox de Posadas
   pueden compartir píxeles con áreas rurales — el promedio espacial
   los diluye. Mitigado por `reduceRegion` que pondera por área de
   intersección.
4. **No separamos día/noche** ni estacionalidad porque la frecuencia
   de pasada y la cobertura nubosa de Posadas no lo permiten con
   significancia estadística a nivel de polígono.

## 3. Forecast — CAMS vía Open-Meteo Air Quality

### 3.1 Modelo y servicio

CAMS (Copernicus Atmosphere Monitoring Service) es el servicio
operacional de calidad de aire del programa Copernicus, gestionado por
el ECMWF (European Centre for Medium-Range Weather Forecasts). Combina:

- **Modelo IFS-COMPO**: química atmosférica global con esquema
  CB05+aerosoles, acoplado al modelo meteorológico IFS.
- **Asimilación de datos**: incluye observaciones satelitales (entre
  ellas TROPOMI) y observaciones de superficie europeas (red EEA AirBase).
- **Salida**: forecasts a 4 días vista, resolución horaria, ~10 km
  espacial global.

El observatorio consume el endpoint gratuito de Open-Meteo Air Quality
(`https://air-quality-api.open-meteo.com/v1/air-quality`) que internamente
sirve datos CAMS. Un cron de GitHub Actions corre cada 6 h y guarda en
`data/processed/forecast/aqi_diario.csv` los próximos ~5-7 días con
columnas: `fecha, pm10, pm2_5, no2, so2, ozone, european_aqi`.

Pipeline: `scripts/57_forecast_clima.py` (no se modifica en este paquete).

### 3.2 AQI europeo

El **European Air Quality Index** (EEA) combina PM10, PM2.5, NO₂, O₃ y
SO₂ en un único valor numérico para comunicación pública:

| Rango | Banda | Color UI |
|-------|-------|----------|
| 0-20  | Muy bueno | Verde |
| 20-40 | Bueno | Verde claro |
| 40-60 | Medio | Amarillo |
| 60-80 | Pobre | Naranja |
| 80-100 | Malo | Rojo |
| >100 | Muy malo | Bordó |

El AQI usa la regla del eslabón más débil: el peor sub-índice define
el valor general.

### 3.3 Limitaciones del forecast en Posadas

1. **Los puntos de calibración originales del modelo CAMS son europeos**.
   La asimilación sobre Sudamérica depende casi exclusivamente de
   satélites — menor densidad de observaciones de superficie reduce la
   precisión local respecto a Europa.
2. **No diferencia barrios**. El valor reportado es para Posadas centro
   (lat -27.3667, lon -55.8967). Suponer homogeneidad espacial dentro
   del aglomerado.
3. **Es predicción**: la incertidumbre crece con el horizonte. Día +5
   tiene errores 2-3× mayores que día +1.

## 4. UI — toggle real-time vs histórico

El componente `AireMultigasCard.tsx` (en
`webapp/frontend/src/components/`) presenta los dos modos en un único
card con un selector tipo radio:

- **Forecast hoy + 5 días**: tabla compacta con PM10, PM2.5, NO₂, O₃ y
  el chip semáforico del AQI europeo. Badge "🌬️ Modelo CAMS · Open-Meteo
  · refresh 6 h".
- **Histórico anual (satélite)**: gráfico de líneas multi-serie con
  NO₂, SO₂, CO y HCHO en función del año (recharts), más una grilla con
  el último valor disponible de cada gas. Badge "🛰️ Medido por
  Sentinel-5P TROPOMI · agregado anual". Una sección expandible al pie
  muestra CH₄ y O₃ con la advertencia de calidad baja.

El header del card incluye una nota didáctica explícita:

> Histórico = mediciones reales del satélite. Forecast = predicción del
> modelo. Son cosas distintas — no las comparés punto a punto.

Si el CSV multi-gas (script 48) aún no se generó en un polígono, el
componente cae al CSV legacy `no2.csv` (script 47) y solo dibuja NO₂,
con un aviso explicando que SO₂/CO/HCHO aparecerán cuando corra el cron
mensual.

## 5. Citas y fuentes

- ESA Copernicus Sentinel-5P TROPOMI:
  <https://sentinels.copernicus.eu/web/sentinel/missions/sentinel-5p>
- Veefkind, J.P. et al. (2012). *TROPOMI on the ESA Sentinel-5
  Precursor: A GMES mission for global observations of the atmospheric
  composition for climate, air quality and ozone layer applications*.
  Remote Sensing of Environment 120, 70-83.
  DOI: 10.1016/j.rse.2011.09.027
- Copernicus Atmosphere Monitoring Service (CAMS):
  <https://atmosphere.copernicus.eu/>
- Open-Meteo Air Quality API:
  <https://open-meteo.com/en/docs/air-quality-api>
- European Environment Agency (EEA) Air Quality Index:
  <https://www.eea.europa.eu/themes/air/air-quality-index>
- Earth Engine catálogo S5P:
  <https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P>
