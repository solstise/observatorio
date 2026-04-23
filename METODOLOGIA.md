# Metodología — Observatorio Urbano Posadas

Este documento describe en detalle **cómo** se produce cada número que el
observatorio reporta. Es deliberadamente exhaustivo porque la honestidad
metodológica es un principio no negociable del proyecto.

Cualquier persona (investigador, funcionario, periodista, ciudadano) debería
poder leer este documento, ir al código, y reproducir los resultados.

## 1. Fuentes de datos y licencias

### 1.1 Sentinel-2 (ESA Copernicus)

- **Qué aporta**: imágenes ópticas multiespectrales, 13 bandas, resolución
  10m (visibles + NIR) y 20m (SWIR), revisita cada 5 días.
- **Cobertura temporal**: 2015 - presente (S2A), 2017 - presente con dos
  satélites (S2A + S2B).
- **Licencia**: [Copernicus open access](https://scihub.copernicus.eu/twiki/do/view/SciHubWebPortal/TermsConditions).
  Uso libre, requiere atribución.
- **Cómo lo usamos**: procesamiento en Google Earth Engine, colección
  `COPERNICUS/S2_SR_HARMONIZED`. Composite mediano de los meses junio,
  julio y agosto (invierno seco), filtrado por `CLOUDY_PIXEL_PERCENTAGE < 20`
  y máscara de nubes a nivel pixel con la banda `QA60` o S2 Cloud Probability.

### 1.2 Planet NICFI

- **Qué aporta**: mosaicos ópticos mensuales de alta resolución (4.7m) para
  zonas tropicales.
- **Cobertura temporal**: septiembre 2020 - presente.
- **Licencia**: programa [NICFI](https://www.planet.com/nicfi/). Uso no
  comercial permitido, comercial restringido. Obligatoria atribución a
  "Imagery © Planet Labs PBC, provided through the NICFI program".
- **Cómo lo usamos**: descarga directa vía API de Planet con API key
  personal, quads del esquema XYZ a zoom 15. Cacheamos en
  `data/raw/planet_nicfi/{YYYY-MM}/{quad_id}.tif`.

### 1.3 Google Open Buildings v3

- **Qué aporta**: polígonos de edificios detectados con modelos de IA, con
  área y score de confianza por edificio.
- **Cobertura temporal**: snapshot, versión v3 publicada en mayo 2023.
  **No incluye fecha de aparición por edificio.**
- **Licencia**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Cómo lo usamos**: disponible como `FeatureCollection` en Earth Engine
  (`GOOGLE/Research/open-buildings/v3/polygons`), o descarga directa desde
  [sites.research.google/gr/open-buildings/](https://sites.research.google/gr/open-buildings/).
  Filtramos por `confidence > 0.70`.

### 1.4 WorldPop

- **Qué aporta**: grillas de población estimada a 100m de resolución,
  derivadas de censos nacionales y modelos.
- **Cobertura temporal**: 2000 - 2020 global. Último año con cobertura
  completa: 2020.
- **Licencia**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Cómo lo usamos**: descarga del raster de Argentina, recorte a Posadas,
  uso como base para densidad poblacional con factor de corrección por
  conteo de edificios.

### 1.5 OpenStreetMap (OSM)

- **Qué aporta**: calles, edificios, puntos de interés, servicios públicos
  (CAPS, escuelas, paradas, farmacias, etc.), mantenido por la comunidad.
- **Cobertura temporal**: continuo, actualizado en tiempo real por
  voluntarios.
- **Licencia**: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  Requiere atribución y copyleft de datos derivados.
- **Cómo lo usamos**: queries a Overpass API, cacheado local, reutilizado
  con cutoff trimestral.

### 1.6 Esri Wayback World Imagery

- **Qué aporta**: imágenes aéreas históricas a resolución submétrica,
  capa mundial.
- **Cobertura temporal**: 2014 - presente, actualizada con cada release de
  World Imagery.
- **Licencia**: [Esri Terms of Use](https://www.esri.com/en-us/legal/terms/full-master-agreement).
  Uso con atribución; no redistribuible como tiles.
- **Cómo lo usamos**: validación visual (snapshots cualitativos), no se
  incluye en el pipeline automático para evitar issues de licencia.

### 1.7 Capas municipales Posadas

- **IDE Posadas (Nodo IDR)**: [posadas.gov.ar/idr](https://posadas.gov.ar/idr).
  Cobertura variable, **por verificar disponibilidad y licencia por capa**.
- **IPEC Misiones**: CENSO 2022 a nivel radio censal, si disponible.

## 2. Índices espectrales usados

Sentinel-2 tiene 13 bandas. Las relevantes para este sistema son:

| Banda | Nombre | Longitud de onda | Resolución |
|-------|--------|------------------|------------|
| B2    | Blue   | 490 nm           | 10 m       |
| B3    | Green  | 560 nm           | 10 m       |
| B4    | Red    | 665 nm           | 10 m       |
| B8    | NIR    | 842 nm           | 10 m       |
| B11   | SWIR1  | 1610 nm          | 20 m → resampleado a 10 m |
| B12   | SWIR2  | 2190 nm          | 20 m → resampleado a 10 m |

### Fórmulas

- **NDBI** (Normalized Difference Built-up Index):

  ```
  NDBI = (SWIR - NIR) / (SWIR + NIR)
       = (B11 - B8) / (B11 + B8)
  ```

  Valores altos (> 0) indican superficie construida (asfalto, concreto,
  techos). Útil pero ambiguo porque suelo desnudo también da NDBI alto.

- **NDVI** (Normalized Difference Vegetation Index):

  ```
  NDVI = (NIR - Red) / (NIR + Red)
       = (B8 - B4) / (B8 + B4)
  ```

  Valores altos (> 0.4) indican vegetación saludable. Complementa NDBI:
  donde baja NDVI + sube NDBI, probablemente hay construcción.

- **BUI** (Built-up Index):

  ```
  BUI = NDBI - NDVI
  ```

  Combinación más robusta. Positivo = construido, negativo = vegetado.

- **MNDWI** (Modified Normalized Difference Water Index):

  ```
  MNDWI = (Green - SWIR) / (Green + SWIR)
        = (B3 - B11) / (B3 + B11)
  ```

  Valores altos indican agua. Lo usamos para **excluir** cuerpos de agua
  del análisis de construcción (evitar falsos positivos en la costanera,
  arroyos, bañados).

## 3. Algoritmo de inferencia de fecha de aparición

El dataset Google Open Buildings es un snapshot estático sin fecha de
aparición por edificio. Para inferirla hacemos lo siguiente:

1. Cargar los polígonos de Open Buildings y filtrar por `confidence > 0.70`.
2. Para cada polígono de interés, filtrar edificios cuyo **centroide** cae
   dentro.
3. Para cada edificio y cada fecha histórica (composites anuales
   2018-07, 2019-07, ..., 2026-07), tomar un buffer de 3×3 píxeles Sentinel-2
   (~30×30 m) alrededor del centroide del edificio.
4. Calcular el NDBI promedio del buffer.
5. El umbral de "existe edificio" es **NDBI > 0.05** con verificación
   adicional: que BUI también sea positivo y que no haya agua detectada
   por MNDWI.
6. La **fecha de aparición** es la primera fecha en la que se cumple el
   criterio.

### Regla de monotonicidad creciente

Los edificios que aparecen un año **se asumen presentes en todos los años
posteriores**. Esto es correcto en barrios en crecimiento (no se demuelen
casas masivamente en Posadas). Esta regla corrige el ruido temporal causado
por:

- Variaciones estacionales de iluminación.
- Máscaras de nubes imperfectas.
- Sombras largas en invierno que pueden oscurecer techos.

### Casos borde

- Edificios que ya aparecen en 2018 → `fecha_aparicion = "<2018"` (preexistente).
- Edificios que no se detectan en ninguna fecha → `fecha_aparicion = "desconocida"`,
  se excluyen del conteo y se reportan en logs.

## 4. Estimación de población

### Base WorldPop

Tomamos la grilla WorldPop 2020 recortada a Posadas, que provee habitantes
por píxel de 100 m. Para un polígono dado, sumamos los píxeles que
intersectan.

### Factor "personas por vivienda"

Aplicamos el factor promedio **3.6 personas por vivienda** para Misiones,
basado en microdatos del Censo INDEC. Este factor es conservador y se
puede ajustar por polígono si existen datos locales.

### Calibración con Censo 2022

Si el polígono intersecta radios censales del Censo 2022 (publicación
IPEC/INDEC), usamos la población oficial de ese radio como ancla y
distribuimos proporcionalmente al conteo de edificios detectados.

### Factor de corrección temporal

En zonas de cambio rápido, WorldPop subestima la población actual porque
su baseline es 2020. Aplicamos:

```
poblacion_estimada(t) = poblacion_worldpop * (n_edificios(t) / n_edificios(2020))
                      * personas_por_vivienda
```

### Rango reportado

Por la naturaleza de las estimaciones, el output se reporta como rango:

```
poblacion_min = round(poblacion_estimada * 0.85)
poblacion_max = round(poblacion_estimada * 1.15)
```

## 5. Cobertura nubosa y composite mediano

Posadas es subtropical húmedo. Cobertura nubosa promedio **~50-60% anual**.

- Meses más despejados: **junio, julio, agosto** (invierno seco).
- Meses más nublados: noviembre - marzo.

**Estrategia**: para cada año objetivo, tomar la colección Sentinel-2 SR de
junio-julio-agosto, filtrar escenas con `CLOUDY_PIXEL_PERCENTAGE < 20`,
aplicar máscara de nubes por píxel (banda `QA60`), y calcular el
**composite mediano** píxel a píxel. Eso da una imagen mucho más limpia que
cualquier escena individual.

Si un año no tiene suficientes escenas válidas (< 3 post filtros), se
reporta en logs como "año incompleto" y se excluye del timelapse de ese año.
**No se rellena con datos interpolados.**

## 6. Margen de error

### ±15% en conteos

Basado en validación de literatura (Google Open Buildings paper, casos de
estudio LATAM) y validación propia cruzando con Google Maps visual en
notebooks `notebooks/02_validacion_conteo.ipynb`.

El error proviene de:

- Edificios omitidos por Open Buildings (techos oscuros, casas adosadas).
- Falsos positivos (galpones, tinglados contados como viviendas).
- Error del algoritmo de fecha de aparición (~10-20%).

Todos los outputs reportan **rangos**, no números puntuales. Ejemplo:

| Fecha     | Conteo estimado | Rango (±15%) |
|-----------|-----------------|--------------|
| 2018-07   | 14              | 12 - 16      |
| 2021-07   | 89              | 76 - 102     |
| 2024-07   | 256             | 218 - 294    |
| 2026-07   | 387             | 329 - 445    |

### Bandas de confianza en visualizaciones

En los gráficos de serie temporal (matplotlib), la banda ±15% se dibuja
como área sombreada alrededor de la línea central. Nunca se oculta.

## 7. Sistemas de coordenadas (CRS)

- **Almacenamiento**: todos los GeoJSON en **EPSG:4326 (WGS84)**, coords
  `[lon, lat]`. Es el estándar de GeoJSON y el que usan Earth Engine y
  los browsers.
- **Cálculos de distancia y área**: reproyectar a
  **EPSG:32721 (UTM zona 21 Sur)** o **EPSG:5347 (POSGAR 2007 / Argentina 6)**.
  Usar `gdf.to_crs(epsg=32721)` antes de calcular metros.
- **Rasters Sentinel-2**: llegan ya georreferenciados, típicamente
  EPSG:32721 para Misiones. Se conservan en su CRS original.

**Error común a evitar**: calcular distancias directamente en EPSG:4326
devuelve grados, no metros. El sistema aborta si detecta que el CRS de un
GeoDataFrame es geográfico y se pide una operación métrica.

## 8. Reporte de incertidumbre en outputs

Cada output del pipeline carga con metadatos:

- `valor_central`: estimación puntual.
- `intervalo_inferior`: valor central × 0.85.
- `intervalo_superior`: valor central × 1.15.
- `metodo`: identificador del algoritmo usado (ej. `"open_buildings_v3+ndbi_monotonic"`).
- `supuestos_clave`: lista de supuestos explícitos (ej. `["personas_vivienda=3.6", "confidence_threshold=0.70"]`).
- `fecha_calculo`: timestamp ISO 8601.
- `version_sistema`: SemVer del observatorio.

Estos metadatos se incluyen en los CSVs, en el JSON del dashboard web, y
en el footer del PDF.

## 9. Limitaciones conocidas

### Por fuente

- **Google Open Buildings**: snapshot estático sin fecha. No detecta bien
  techos de paja muy oscuros ni casas adosadas. Cobertura LATAM variable
  (ciudades grandes mejor que rurales).
- **Sentinel-2**: resolución 10m, puede confundir suelo recién desmontado
  con construcción. Sensible a sombras en invierno.
- **Planet NICFI**: solo desde septiembre 2020, no sirve para el tramo
  histórico 2015-2020.
- **WorldPop**: subestima poblaciones en zonas de cambio rápido post-2020.
- **OSM**: completitud variable por barrio. Centros de salud municipales
  pueden no estar todos mapeados.

### Por el sistema

- No diferencia entre **vivienda** y **otro tipo de construcción** (galpón,
  tinglado, quinta). Aplicamos filtros por área (rango razonable 20 - 500 m²)
  pero no es perfecto.
- No detecta **crecimiento en altura** (edificios de varios pisos). Un
  edificio de 10 pisos cuenta como 1.
- **No diferencia viviendas permanentes de temporales**. Una casa de fin
  de semana cuenta igual que una casa habitada todo el año.

## 10. Validación

### Notebook de validación visual

`notebooks/02_validacion_conteo.ipynb`:

- Para cada polígono procesado, muestra las imágenes Sentinel-2 anuales en
  grilla.
- Overlay de los edificios detectados con su fecha de aparición, coloreados
  por año.
- Al lado, un tile de Esri Wayback o Google Satellite para comparación
  visual.
- Permite a un humano verificar que el algoritmo no esté contando árboles
  como edificios ni perdiendo casas evidentes.

### Cruce con Google Maps

Para cada polígono, se toma una muestra aleatoria de 20 edificios
detectados y 10 píxeles donde el sistema reporta "no hay edificio". Un
revisor humano verifica en Google Maps / Esri Wayback / imágenes aéreas
si coinciden con la realidad. Los resultados se registran en
`data/processed/validacion/<poligono_id>.csv` con columnas
`caso_id`, `prediccion_sistema`, `verificacion_visual`, `coincide`.

Precisión y recall calculados sobre esa muestra se reportan en
`METODOLOGIA.md` cuando el proyecto avanza a Fase 2.

## 11. Glosario

- **BSP / built-up**: superficie construida o pavimentada (edificios,
  calles, patios impermeables).
- **Composite mediano**: imagen que para cada píxel toma la mediana de los
  valores de todas las escenas disponibles en un rango temporal. Elimina
  nubes y artefactos transitorios.
- **CRS**: Coordinate Reference System. Define cómo las coordenadas se
  mapean al globo (proyección, datum, unidades).
- **GeoTIFF**: formato raster georreferenciado, estándar GIS.
- **GeoJSON**: formato vectorial basado en JSON. CRS default EPSG:4326.
- **NDBI, NDVI, MNDWI, BUI**: índices espectrales, ver sección 2.
- **Open Buildings**: dataset de Google Research, polígonos de edificios
  detectados con IA.
- **Polígono de interés**: zona geográfica que monitoreamos (barrio,
  asentamiento, manzana).
- **Serie temporal**: secuencia de mediciones en el tiempo (conteo de
  edificios año a año).
- **SR** (Surface Reflectance): nivel de procesamiento Sentinel-2 con
  corrección atmosférica aplicada. Lo que usamos en Earth Engine es
  `COPERNICUS/S2_SR_HARMONIZED`.
- **SWIR**: Shortwave Infrared. Bandas B11 y B12 de Sentinel-2. Claves
  para NDBI.
- **Timelapse**: animación (GIF o MP4) que muestra el cambio de una zona
  en el tiempo.
- **WorldPop**: dataset de población en grilla a 100m.
