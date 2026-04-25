# PROMPT PARA CLAUDE CODE — Extensión "Capa de Calor Urbano"

> **Cómo usar este prompt:** abrí Claude Code en la raíz del repo `observatorio-posadas` (el mismo donde ya está corriendo Fase 2). Pegale este prompt entero. Va a leer el contexto, revisar el estado actual, hacerte las preguntas de setup y empezar por la Tarea 1. Va avanzando tarea por tarea con confirmación tuya entre cada una.

---

## 1. CONTEXTO

Este prompt **extiende** un proyecto existente: el Observatorio Urbano Posadas, ya en producción en https://observatorio.sistemaswinter.com/, en estado Fase 2. Asumí que ya tenemos funcionando:

- Pipeline Python que descarga Sentinel-2 vía Earth Engine, recorta por polígonos definidos en `config/poligonos.geojson`, detecta edificios con Google Open Buildings, estima población con WorldPop, cruza servicios con OSM, y genera timelapses + PDFs.
- Frontend Next.js + Tailwind + Leaflet con páginas `/`, `/comparar`, `/metodologia`, `/descargas`.
- Backend FastAPI mínimo (o servicio de archivos estáticos) que expone los outputs procesados.
- Estructura de carpetas, convenciones de código, sistema de logging y de versionado ya documentados en el README y CLAUDE.md del repo.

**Antes de tocar una sola línea**: leé `README.md`, `METODOLOGIA.md`, `config/settings.yaml` y `config/poligonos.geojson` actuales. Confirmá que entendiste la estructura. Si algo no coincide con lo descrito acá, avisame antes de avanzar.

### 1.1 Qué vamos a construir

Una **capa nueva** llamada **"Calor Urbano Posadas"**, accesible en la ruta `/calor`, que:

1. Mide la **temperatura de superficie terrestre (LST)** por polígono usando Landsat 8 y Landsat 9 (banda térmica TIRS).
2. Calcula la **intensidad de la isla de calor urbana (UHI)** comparando cada polígono contra una baseline rural/vegetada.
3. Genera **mapas mensuales y estacionales** mostrando qué barrios son más calientes.
4. Produce **un PDF anexo por polígono** con la sección "Calor" agregada al reporte existente, o **un PDF dedicado** si se prefiere mantenerlos separados (decisión a tomar — ver Tarea 2.6).
5. Publica una **página `/calor` en el frontend** con mapa coroplético, ranking de barrios, comparación estacional y narrativa "tu barrio está X°C más caliente que el promedio".

### 1.2 Por qué esta capa

- Landsat termal es **gratis** y tiene **30m de resolución** (suficiente para análisis por barrio en Posadas).
- Posadas tiene veranos con sensación térmica de 45°C. La isla de calor urbana es un problema de salud pública real, sub-documentado.
- La capa **reusa los mismos polígonos** del observatorio actual, así que el costo marginal de implementación es bajo.
- Es **mediáticamente fuerte**: cada verano, los medios buscan datos sobre el calor. Vamos a ser la única fuente local con datos por barrio.
- Encaja con la narrativa política del ministro: "barrios pobres = barrios calientes", lo cual está bien documentado en literatura científica y le permite vincular Desarrollo Social con políticas urbanas.

### 1.3 Restricciones que se mantienen del proyecto base

- Costo cero. Toda fuente debe ser gratuita.
- Datos agregados por polígono, nunca individuales.
- Honestidad estadística: bandas de confianza, no números puntuales.
- Reproducibilidad total.
- Logging y caché.
- Documentación metodológica defendible.

### 1.4 Restricciones específicas de esta capa

- **Diferenciar siempre LST (temperatura de superficie) de temperatura del aire**. Son cosas distintas y comunicar mal esto destruye la credibilidad. Más detalle en sección 6.1.
- **Documentar la hora de pasada del satélite** (Landsat pasa ~10:30 AM hora solar). UHI diurno y nocturno son fenómenos distintos.
- **No usar la capa para alertas individuales** (estilo "evacúe su casa"). Es análisis poblacional, no operativo de emergencia.

---

## 2. ARQUITECTURA DE LA EXTENSIÓN

### 2.1 Decisiones técnicas

**Fuente de datos primaria**: Landsat 8 Collection 2 Level 2 + Landsat 9 Collection 2 Level 2, ambas vía Google Earth Engine.

- Colecciones Earth Engine:
  - `LANDSAT/LC08/C02/T1_L2` (Landsat 8, desde abril 2013)
  - `LANDSAT/LC09/C02/T1_L2` (Landsat 9, desde octubre 2021)
- Banda térmica relevante: `ST_B10` en ambos (Land Surface Temperature en Kelvin escalado).
- Conversión a grados Celsius: `LST_celsius = (ST_B10 * 0.00341802 + 149.0) - 273.15`
- Combinando L8 + L9 obtenemos pasada cada ~8 días sobre Posadas.

**Fuente complementaria**: MODIS LST diario (`MODIS/061/MOD11A1` y `MYD11A1`) a 1 km de resolución.
- Útil para serie temporal diaria (no por barrio, sí por ciudad).
- Tiene LST diurno **y nocturno**, lo cual es clave para detectar UHI nocturno (más intenso que el diurno).
- Usalo solo para indicador agregado de Posadas, no para mapa por barrio.

**Fuente secundaria opcional**: ECOSTRESS (NASA, ISS) — LST a 70m con paso variable. No tiene cadencia regular pero ofrece imágenes a horas distintas (no solo mediodía). Solo si Landsat resulta insuficiente.

**No vamos a usar**:
- Sentinel-3 SLSTR (resolución 1km, peor que MODIS a casi todo efecto en zona urbana).
- Estaciones meteorológicas terrestres (no hay red densa en Posadas y mezclar LST satelital con aire terrestre confunde al usuario).

### 2.2 Estructura de archivos a agregar

```
observatorio-posadas/
├── config/
│   ├── settings_calor.yaml           # NUEVO — config específica de calor
│   └── poligonos_baseline_rural.geojson  # NUEVO — polígonos de referencia rural
│
├── data/
│   ├── raw/
│   │   └── landsat_lst/              # NUEVO
│   │       ├── L8/
│   │       └── L9/
│   ├── raw/
│   │   └── modis_lst/                # NUEVO
│   └── processed/
│       └── calor/                    # NUEVO
│           ├── lst_por_poligono_mensual.csv
│           ├── uhi_por_poligono.csv
│           ├── ranking_estacional.csv
│           └── mapas_lst/            # PNG por mes
│
├── scripts/
│   ├── 70_descarga_landsat_lst.py    # NUEVO
│   ├── 71_descarga_modis_lst.py      # NUEVO
│   ├── 72_calcular_lst_por_poligono.py  # NUEVO
│   ├── 73_calcular_uhi.py            # NUEVO
│   ├── 74_generar_mapas_calor.py     # NUEVO
│   ├── 75_generar_pdf_calor.py       # NUEVO
│   └── 99_pipeline_calor.py          # NUEVO — orquestador
│
├── webapp/
│   └── frontend/
│       ├── app/
│       │   └── calor/                # NUEVO — página /calor
│       │       ├── page.tsx
│       │       ├── components/
│       │       │   ├── MapaCalor.tsx
│       │       │   ├── RankingBarrios.tsx
│       │       │   ├── EvolucionEstacional.tsx
│       │       │   └── NarrativaUHI.tsx
│       │       └── loading.tsx
│       └── public/
│           └── data/
│               └── calor/            # NUEVO — datos servidos
│                   ├── lst_actual.json
│                   ├── ranking.json
│                   └── series.json
│
├── templates/
│   └── reporte_calor.html            # NUEVO — template Jinja2
│
└── docs/
    └── metodologia_calor.md          # NUEVO
```

### 2.3 Pipeline lógico de la nueva capa

```
1. INGESTA
   ├── Earth Engine: Landsat 8 + 9 Collection 2 Level 2
   ├── Filtrar por bbox Posadas + 20 km buffer (necesitamos rural baseline)
   ├── Filtrar por nubes (CLOUD_COVER < 30%, máscara QA_PIXEL)
   ├── Para cada mes desde 2018-01 hasta presente:
   │     - Generar composite mediano de LST en grados Celsius
   │     - Exportar como GeoTIFF a data/raw/landsat_lst/{YYYYMM}.tif
   └── Logging: cuántas escenas, % cobertura nubosa promedio

2. RECORTE POR POLÍGONO
   ├── Para cada polígono y cada mes:
   │     - Recortar GeoTIFF al polígono
   │     - Estadísticas: mean, median, p10, p90, max
   │     - Calcular % de pixeles válidos (no enmascarados por nubes)
   └── Output: data/processed/calor/lst_por_poligono_mensual.csv

3. CÁLCULO DE BASELINE RURAL
   ├── Cargar config/poligonos_baseline_rural.geojson (3-5 polígonos rurales
   │   con vegetación dentro de 20 km de Posadas)
   ├── Calcular LST promedio rural por mes
   └── Output: serie temporal de LST rural baseline

4. CÁLCULO DE UHI INTENSITY
   ├── UHI_intensity(barrio, mes) = LST(barrio, mes) - LST_rural(mes)
   ├── Aplicar también UHI vs promedio Posadas: UHI_relativo
   ├── Detectar hotspots: barrios con UHI > +3°C consistentemente
   └── Output: data/processed/calor/uhi_por_poligono.csv

5. AGRUPAMIENTO ESTACIONAL
   ├── Verano: dic-feb, Otoño: mar-may, Invierno: jun-ago, Primavera: sep-nov
   ├── Para cada estación de cada año, promediar mensuales
   └── Output: data/processed/calor/ranking_estacional.csv

6. GENERACIÓN DE MAPAS
   ├── Mapa coroplético LST mensual y estacional
   ├── Escala de color: viridis o YlOrRd (revisar accesibilidad)
   ├── Etiquetas: nombre barrio, valor LST, anomalía respecto a media
   └── Output: data/processed/calor/mapas_lst/*.png

7. GENERACIÓN DE PDF (anexo o dedicado)
   ├── Sección "Calor" en PDF existente, o PDF nuevo según decisión
   └── Output: data/outputs/pdfs/calor/

8. SINCRONIZACIÓN A WEBAPP
   ├── Exportar JSON consumible por frontend
   ├── Estructura: {poligono_id, lst_actual, uhi, ranking, serie}
   └── Output: webapp/frontend/public/data/calor/

9. PUBLICACIÓN
   ├── Build Next.js con la nueva página /calor
   └── Deploy
```

---

## 3. TAREAS CONCRETAS

### Tarea 1: Setup de la extensión

**Objetivo**: preparar la base sin tocar nada del pipeline existente.

- Crear las nuevas carpetas según sección 2.2.
- Crear `config/settings_calor.yaml` con (estructura sugerida en sección 7.1).
- Agregar a `requirements.txt` las dependencias nuevas que falten: ya deberían estar `earthengine-api`, `rasterio`, `geopandas`, `numpy`, `pandas`. Posiblemente nuevas: `xarray`, `rioxarray` (más cómodas para series temporales raster).
- Actualizar `.env.example` si requiere variables nuevas (no debería).
- Crear branch `feature/capa-calor` desde `dev`.
- Commit inicial: `feat(calor): inicializar estructura para capa de calor urbano`.

**Pregunta para mí antes de avanzar**: ¿confirmás los polígonos rural baseline o querés que te proponga 3-5 ubicaciones?

### Tarea 2: Definir polígonos baseline rural

**Objetivo**: tener 3-5 zonas rurales con vegetación natural cerca de Posadas para usar como referencia "no urbana".

Criterios para los polígonos baseline:
- Dentro de 20 km del centro de Posadas.
- Cobertura predominante: vegetación nativa (selva paranaense remanente) o pasturas.
- Sin desarrollo urbano significativo.
- Tamaño mínimo 1 km² para tener suficientes pixeles.

Candidatos sugeridos (validar con imagen):
- Reserva Natural Provincial Profundidad (oeste de Posadas).
- Zona rural al sur de Garupá.
- Zona rural al norte de Candelaria.
- Selva remanente al este de Fachinal.
- Costa del Paraná río arriba (zona de islas).

Crear `config/poligonos_baseline_rural.geojson` con esos polígonos. Validar visualmente con notebook.

### Tarea 3: Script de descarga Landsat LST

Crear `scripts/70_descarga_landsat_lst.py`.

**Funcionalidad**:

```python
# CLI esperado
python scripts/70_descarga_landsat_lst.py \
    --inicio 2018-01 \
    --fin 2026-04 \
    --bbox-buffer-km 20 \
    --cloud-threshold 30 \
    --output data/raw/landsat_lst/
```

**Lógica**:

1. Inicializar Earth Engine con el project ID del repo.
2. Construir colecciones L8 + L9, mergeadas, filtradas por bbox de Posadas + buffer.
3. Aplicar máscara de nubes usando `QA_PIXEL` (bits 3 y 4 = nubes y sombras).
4. Para cada mes en el rango:
   - Filtrar colección por fecha.
   - Si hay <2 imágenes válidas en el mes, log warning y skip (LST con un solo día puede ser anómalo por meteorología).
   - Calcular composite mediano de la banda `ST_B10` reescalada a Celsius.
   - Exportar como GeoTIFF Float32 al directorio output.
   - Nombre: `lst_{YYYYMM}.tif`.
5. Cachear: si el archivo ya existe y no hay flag `--force`, skip.

**Función de conversión a Celsius**:

```python
def landsat_st_b10_to_celsius(image):
    """Convierte ST_B10 de Landsat C2L2 a temperatura en Celsius."""
    return image.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15)
```

**Función de máscara de nubes**:

```python
def mask_clouds_landsat_c2(image):
    qa = image.select('QA_PIXEL')
    cloud_bit = 1 << 3
    shadow_bit = 1 << 4
    mask = qa.bitwiseAnd(cloud_bit).eq(0).And(qa.bitwiseAnd(shadow_bit).eq(0))
    return image.updateMask(mask)
```

**Importante**: Earth Engine puede tirar timeout en exports grandes. Si el bbox + buffer excede el límite de `getDownloadURL`, usar `ee.batch.Export.image.toDrive()` y un poller que espere finalización.

**Logging requerido**: para cada mes, loggear cantidad de escenas L8 y L9 disponibles, cantidad post-filtro nubes, % cobertura efectiva del bbox después de máscara. Si cobertura efectiva < 60%, advertir que el composite puede tener gaps.

### Tarea 4: Script de descarga MODIS LST

Crear `scripts/71_descarga_modis_lst.py`.

**Por qué MODIS**: cadencia diaria + LST nocturno. No reemplaza Landsat, lo complementa para indicador agregado de ciudad.

- Colecciones: `MODIS/061/MOD11A1` (Terra, ~10:30 AM y 10:30 PM) y `MYD11A1` (Aqua, ~13:30 PM y 01:30 AM).
- Bandas: `LST_Day_1km` y `LST_Night_1km`.
- Conversión: `LST_celsius = LST * 0.02 - 273.15`.
- Filtro de calidad: usar banda `QC_Day_1km` y `QC_Night_1km`, retener solo bits que indiquen "good quality".
- Exportar serie temporal diaria como CSV con columnas: `fecha`, `lst_dia_celsius`, `lst_noche_celsius`, `quality_pixels_pct`.
- Output: `data/raw/modis_lst/posadas_modis_lst_diario.csv`.

### Tarea 5: Cálculo de LST por polígono

Crear `scripts/72_calcular_lst_por_poligono.py`.

- Cargar `config/poligonos.geojson` (todos los polígonos del observatorio existente) + `config/poligonos_baseline_rural.geojson`.
- Para cada polígono y cada GeoTIFF mensual de Landsat:
  - Recortar raster con `rasterio.mask`.
  - Calcular estadísticas: count_pixeles_validos, mean, median, std, p10, p90, max.
  - Si pixeles válidos < 30% del polígono, marcar como `nan` y loggear.
- Output: `data/processed/calor/lst_por_poligono_mensual.csv` con columnas: `poligono_id`, `tipo_poligono` (urbano/rural), `año`, `mes`, `lst_mean`, `lst_median`, `lst_std`, `lst_p90`, `pixeles_validos_pct`.

**Tip de implementación**: usar `rioxarray` y `xarray` hace este paso mucho más limpio que `rasterio` puro. `xr.open_rasterio` + clip por geodataframe + agregaciones nativas.

### Tarea 6: Cálculo de UHI

Crear `scripts/73_calcular_uhi.py`.

**Tres definiciones de UHI a calcular y reportar todas**:

1. **UHI_absoluta** = LST_barrio - LST_baseline_rural_promedio
   - Es la métrica clásica. Indica cuánto más caliente es el barrio que el campo.
   - Valores típicos en ciudades sudamericanas: +2 a +8°C en verano diurno.

2. **UHI_relativa_ciudad** = LST_barrio - LST_promedio_Posadas
   - Compara cada barrio con el promedio de la ciudad.
   - Útil para ranking interno y comunicación al ciudadano.

3. **UHI_anomalía_estacional** = LST_barrio_mes - LST_barrio_mismo_mes_promedio_5años
   - Detecta si un barrio se está calentando más de lo histórico.
   - Útil para detectar tendencias.

**Output**: `data/processed/calor/uhi_por_poligono.csv` con todas las métricas.

**Honestidad estadística**: incluir `std` y `n_observaciones` para que el usuario pueda evaluar significancia. Una UHI de +3°C con std ±2°C y n=4 meses NO es lo mismo que +3°C con std ±0.5°C y n=24 meses.

### Tarea 7: Generación de mapas estáticos

Crear `scripts/74_generar_mapas_calor.py`.

- Usar `geopandas` + `matplotlib` para mapas coropléticos.
- Para cada estación de cada año:
  - Mapa de LST absoluta.
  - Mapa de UHI relativa a Posadas.
- Paleta: usar `cmocean.cm.thermal` o `matplotlib` `inferno`. **NO usar paletas que tengan rojo y verde como extremos** (problema accesibilidad daltonismo).
- Incluir leyenda con escala numérica clara.
- Etiquetas opcionales con nombre de barrio (toggle).
- Footer con fuente, mes, versión.
- Output: PNG en `data/processed/calor/mapas_lst/`.
- También generar un mapa GIF animado mensual de los últimos 24 meses para mostrar evolución.

### Tarea 8: Sincronización a webapp

Crear `scripts/76_sync_calor_webapp.py`.

- Leer todos los CSVs procesados.
- Generar JSONs consumibles por frontend en `webapp/frontend/public/data/calor/`:
  - `lst_actual.json`: último mes con todos los polígonos y sus métricas.
  - `ranking.json`: ranking de barrios más calientes por estación.
  - `series.json`: serie temporal completa por polígono.
  - `baseline_rural.json`: serie temporal de baseline.
  - `metadata.json`: fechas de actualización, versión, fuentes.
- También copiar mapas PNG a `webapp/frontend/public/img/calor/`.

### Tarea 9: Página /calor en frontend

Crear `webapp/frontend/app/calor/page.tsx` y componentes asociados.

**Estructura visual de la página `/calor`**:

```
+-------------------------------------------------------+
| [HEADER del observatorio común]                       |
+-------------------------------------------------------+
|                                                       |
|  Calor Urbano Posadas                                 |
|  Mapa de temperatura de superficie por barrio         |
|                                                       |
|  [Selector estación: Verano | Otoño | Inv | Prim]     |
|  [Selector año: 2024 | 2025 | 2026]                   |
|                                                       |
+-------------------------------------------------------+
|                                                       |
|  [MAPA INTERACTIVO Leaflet]                           |
|                                                       |
|  Polígonos coloreados según LST estacional.           |
|  Click en polígono → tooltip con métricas.            |
|                                                       |
|  Leyenda: 24°C ████████████████████ 38°C              |
|                                                       |
+-------------------------------------------------------+
|                                                       |
|  Top 5 barrios más calientes (verano 2025-2026)       |
|  1. Itaembé Miní    +5.2°C sobre el promedio          |
|  2. Villa Cabello   +4.1°C                            |
|  ...                                                  |
|                                                       |
|  Top 5 más frescos                                    |
|  1. Costanera       -2.3°C                            |
|  ...                                                  |
|                                                       |
+-------------------------------------------------------+
|                                                       |
|  Evolución estacional [gráfico de líneas]             |
|  Líneas: rural | promedio Posadas | barrio top 1      |
|                                                       |
+-------------------------------------------------------+
|                                                       |
|  Sobre estos datos                                    |
|  - Fuente: Landsat 8 y 9 (banda térmica)              |
|  - Resolución: 30m                                    |
|  - Hora de pasada: ~10:30 AM (LST diurna)             |
|  - Limitación: LST ≠ temperatura del aire             |
|  - [Ver metodología completa]                         |
|                                                       |
+-------------------------------------------------------+
```

**Componentes a crear**:

- `MapaCalor.tsx`: wrapper de Leaflet con choropleth dinámico. Usar el mismo estilo de mapa base que `/`.
- `RankingBarrios.tsx`: top y bottom 5, con barras de UHI.
- `EvolucionEstacional.tsx`: gráfico de líneas con `recharts`.
- `NarrativaUHI.tsx`: texto generado dinámicamente por barrio cuando se hace click.
- `LeyendaMapa.tsx`: barra de color con escala.
- `SelectorPeriodo.tsx`: año + estación.
- `loading.tsx`: skeleton mientras cargan los JSONs.

**Diseño visual**:
- Mantener exactamente la identidad visual del observatorio existente.
- Tipografía y colores: heredar de `/`.
- La paleta de calor del mapa es la única excepción: usar escala thermal/inferno.
- Mobile responsive: el mapa ocupa toda la pantalla con un drawer abajo para info.

### Tarea 10: Sección "Calor" en metodología

Actualizar `app/metodologia/page.tsx` agregando una sección nueva con el contenido de `docs/metodologia_calor.md`. Esa metodología debe explicar (ver detalles en sección 6 de este prompt):

- Qué es LST y por qué no es lo mismo que temperatura del aire.
- Cómo se calcula la UHI con tres definiciones.
- Limitaciones (hora de pasada, resolución, frecuencia).
- Cómo interpretar los números.
- Fuentes y licencias.

### Tarea 11: Link en la home y nav

- Agregar `Calor` al menú principal del observatorio.
- En la home (`/`), agregar un widget chico "Top 3 barrios más calientes esta semana" con link a `/calor`.
- En la página de cada polígono individual (si existe), agregar sección "Temperatura de superficie" con el dato relevante.

### Tarea 12: Pipeline orquestador y cron

Crear `scripts/99_pipeline_calor.py` que ejecute en orden los scripts 70 → 76.

Agregar al `actualizacion_mensual.sh` (cron del observatorio) una llamada al pipeline de calor después del pipeline existente.

### Tarea 13: PDF anexo

Decidir conmigo (ver pregunta abierta más abajo): ¿agregamos sección "Calor" al PDF existente o generamos PDF separado?

Asumiendo que decidimos PDF separado:
- Crear `templates/reporte_calor.html` con estructura similar al existente: identidad visual común, una página A4, foto del barrio, mapa térmico, ranking, narrativa.
- Crear `scripts/75_generar_pdf_calor.py`.
- Output en `data/outputs/pdfs/calor/{poligono_id}_calor.pdf`.

### Tarea 14: Tests

Agregar a `tests/`:

- `test_lst_conversion.py`: verificar que la fórmula Landsat ST_B10 → Celsius da valores razonables (15-50°C para Posadas).
- `test_uhi_calculo.py`: con dataset sintético, verificar que UHI = LST_urbano - LST_rural se calcula correctamente.
- `test_mascara_nubes.py`: verificar que la máscara QA_PIXEL excluye los bits correctos.

### Tarea 15: Documentación

- Actualizar `README.md` con sección "Capa Calor".
- Crear `docs/metodologia_calor.md` con todo el detalle metodológico (sección 6 de este prompt + lo que descubras durante implementación).
- Actualizar `CHANGELOG.md` con el feature.
- Bump versión en `settings.yaml` a `0.2.0` (es un feature minor, no breaking).
- Actualizar el footer de la web con la nueva versión.

---

## 4. CRITERIOS DE ACEPTACIÓN

La extensión está completa cuando:

1. Puedo correr `python scripts/99_pipeline_calor.py` y se procesa toda la serie 2018-2026 sin errores.
2. La página `/calor` carga, el mapa se renderiza, los selectores funcionan, los rankings son coherentes.
3. La metodología explica claramente la diferencia LST vs aire.
4. Hay PDFs generados para cada polígono.
5. La actualización mensual cron incluye el pipeline de calor.
6. Tests pasan en CI.
7. Si una temporada no tiene datos suficientes (muchos meses con nubes), el sistema lo declara explícitamente en lugar de mostrar valores espurios.

---

## 5. DECISIONES PENDIENTES (preguntá antes de empezar)

1. **PDF integrado o separado**: ¿la sección "Calor" se anexa al PDF existente del polígono (segunda página) o se genera PDF dedicado?
2. **Período inicial**: ¿procesamos toda la serie 2018-2026 o arrancamos solo con últimos 3 años para validar?
3. **MODIS sí o no**: ¿incluimos MODIS para LST nocturno y daily series, o lo dejamos para una versión posterior?
4. **Ranking público de barrios**: ¿mostramos nombre real del barrio en el ranking de "más calientes" o usamos identificadores genéricos? Estigmatización es un riesgo a considerar.
5. **Polígonos baseline rural**: ¿proponés vos las coordenadas o querés que las defina yo después de validar con imágenes?

---

## 6. NOTAS METODOLÓGICAS PROFUNDAS

### 6.1 LST vs temperatura del aire — esto es crítico

Landsat mide **temperatura de la superficie** (Land Surface Temperature, LST). Eso es:
- La temperatura del techo de chapa, del asfalto, del césped, del agua que ve el satélite desde arriba.
- A las 10:30 AM hora solar, en pleno verano, el asfalto puede estar a 50°C mientras el aire a 1.5m del suelo está a 32°C.
- Diferencias LST - T_aire pueden ser de +5°C a +20°C según superficie.

**Implicancia comunicacional**:
- Nunca decir "tu barrio tiene 38°C". Decir "tu barrio tiene una temperatura de superficie promedio de 38°C en verano, lo cual indica una isla de calor más intensa que el promedio".
- La narrativa correcta es **comparativa**: "tu barrio está 5°C más caliente que el campo, lo cual implica mayor estrés térmico para sus habitantes".
- En la página `/calor` y en la metodología, dejar **explícito y visible** que LST ≠ aire. Una sola línea de aclaración bien colocada salva al observatorio de críticas legítimas.

### 6.2 Hora de pasada del satélite

Landsat 8 y 9 cruzan el ecuador a las 10:00 AM hora solar local. Para Posadas eso es entre 9:50 y 10:30 AM hora local.

**Limitación**: la UHI **diurna** es real pero menos intensa que la **nocturna**. La isla de calor urbana clásica se manifiesta sobre todo de noche, cuando el asfalto y concreto liberan el calor acumulado y los barrios urbanos no se enfrían tanto como las zonas rurales.

**Cómo lo abordamos**:
- Documentar claramente que medimos LST diurna ~10:30 AM.
- Complementar con MODIS LST_Night a 1km para tener un indicador agregado de UHI nocturna en Posadas.
- En la metodología, explicar que UHI diurna y nocturna son fenómenos correlacionados pero distintos.

### 6.3 Cobertura nubosa

Posadas es subtropical húmedo. Cobertura nubosa promedio anual ~50%. En meses lluviosos puede haber meses enteros sin una imagen Landsat válida.

**Estrategias**:
- Composite mediano mensual de **todas** las escenas L8 + L9 disponibles del mes.
- Si un mes tiene <2 escenas válidas, marcar `nan` y NO interpolar.
- Si una temporada tiene <60% de meses con datos, marcar la temporada como "datos insuficientes" en el reporte.
- Para análisis de tendencia, usar agregados estacionales o anuales, no mensuales individuales.

### 6.4 Resolución espacial 30m

Landsat termal originalmente es 100m, pero Collection 2 lo entrega resampleado a 30m. Para Posadas:
- Un polígono de 1 km² tiene ~1100 pixeles de 30m. Suficiente para estadísticas robustas.
- Polígonos chicos (<0.1 km²) tienen <100 pixeles. Marcar con warning, las estimaciones serán ruidosas.

### 6.5 Validación con literatura

Antes de publicar, validar que los rangos obtenidos sean consistentes con literatura para climas similares:
- UHI diurna en ciudades subtropicales sudamericanas: típicamente +2 a +6°C.
- UHI nocturna: típicamente +3 a +8°C.
- LST veraniega máxima en superficies impermeables: 45-55°C.
- LST veraniega en vegetación densa: 28-32°C.

Si los números nuestros caen muy fuera de esos rangos, hay un bug. Buscarlo antes de publicar.

### 6.6 Equidad y comunicación

Es esperable y está bien documentado que **los barrios más pobres son los más calientes** porque:
- Menos arbolado.
- Más superficie impermeable.
- Más densidad construida.
- Materiales de construcción más absorbentes.

Esto convierte la capa en una herramienta de **justicia ambiental**: documenta una desigualdad invisible que los datos hacen visible.

**Cómo comunicar sin caer en sensacionalismo**:
- Reportar el dato crudo con contexto.
- Vincular con literatura científica (citar 2-3 papers en metodología).
- Proponer (en la página) acciones que el municipio puede tomar: arbolado urbano, techos blancos, espacios verdes, refugios climáticos.
- Evitar lenguaje alarmista ("infierno", "muerte por calor"). Usar lenguaje técnico-empático.

### 6.7 Riesgo de uso operativo

Esta capa **no debe usarse** para:
- Alertas individuales de salud ("si vivís en X barrio, evacúa").
- Decisiones inmobiliarias automáticas ("este barrio vale menos por ser caliente").
- Estigmatización de poblaciones.

Documentar el uso apropiado en `docs/uso_apropiado_calor.md`. Si el ministerio o un usuario pretende usar la capa para alguno de los anteriores, advertir claramente.

---

## 7. PLANTILLAS DE ARCHIVOS CLAVE

### 7.1 settings_calor.yaml inicial

```yaml
calor:
  fuente_principal: "landsat_c2_l2"
  fuentes_secundarias:
    - "modis_lst_diario"

  landsat:
    colecciones:
      - "LANDSAT/LC08/C02/T1_L2"
      - "LANDSAT/LC09/C02/T1_L2"
    banda_termica: "ST_B10"
    cloud_threshold_pct: 30
    pixeles_validos_minimo_pct: 30
    escenas_minimas_por_mes: 2

  modis:
    colecciones:
      - "MODIS/061/MOD11A1"
      - "MODIS/061/MYD11A1"
    bandas:
      - "LST_Day_1km"
      - "LST_Night_1km"

  baseline_rural:
    archivo: "config/poligonos_baseline_rural.geojson"
    buffer_km: 20

  estaciones:
    verano: [12, 1, 2]
    otono: [3, 4, 5]
    invierno: [6, 7, 8]
    primavera: [9, 10, 11]

  rangos_validacion:
    lst_min_celsius: 5
    lst_max_celsius: 60
    uhi_max_alerta_bug: 15  # si UHI > 15°C, probable bug

  visualizacion:
    paleta: "inferno"
    rango_lst: [20, 45]
    rango_uhi: [-5, 8]
```

### 7.2 Esqueleto de poligonos_baseline_rural.geojson

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": "rural_oeste_profundidad",
        "nombre": "Reserva Profundidad",
        "tipo": "selva_remanente"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[ /* coordenadas */ ]]
      }
    }
  ]
}
```

### 7.3 Snippet base para Tarea 3 (descarga Landsat)

```python
import ee
from datetime import datetime
from dateutil.relativedelta import relativedelta
from loguru import logger

ee.Initialize(project=EE_PROJECT_ID)

POSADAS_BBOX = ee.Geometry.Rectangle([-56.10, -27.55, -55.70, -27.25])

def get_landsat_lst_collection(start_date, end_date, cloud_threshold=30):
    l8 = (ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
          .filterBounds(POSADAS_BBOX)
          .filterDate(start_date, end_date)
          .filter(ee.Filter.lt('CLOUD_COVER', cloud_threshold)))
    l9 = (ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
          .filterBounds(POSADAS_BBOX)
          .filterDate(start_date, end_date)
          .filter(ee.Filter.lt('CLOUD_COVER', cloud_threshold)))
    return l8.merge(l9)

def to_celsius(image):
    lst = image.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15)
    return lst.rename('LST_C').copyProperties(image, ['system:time_start'])

def mask_clouds(image):
    qa = image.select('QA_PIXEL')
    cloud = qa.bitwiseAnd(1 << 3).eq(0)
    shadow = qa.bitwiseAnd(1 << 4).eq(0)
    return image.updateMask(cloud.And(shadow))

def monthly_composite(year, month):
    start = ee.Date.fromYMD(year, month, 1)
    end = start.advance(1, 'month')
    coll = get_landsat_lst_collection(start, end)
    n_scenes = coll.size().getInfo()
    if n_scenes < 2:
        logger.warning(f"{year}-{month:02d}: solo {n_scenes} escenas, skip")
        return None
    masked = coll.map(mask_clouds).map(to_celsius)
    return masked.median().clip(POSADAS_BBOX)
```

### 7.4 Estructura JSON esperada para frontend

```json
{
  "metadata": {
    "version": "0.2.0",
    "actualizado": "2026-04-22",
    "fuente": "Landsat 8/9 Collection 2 Level 2",
    "resolucion_metros": 30,
    "hora_pasada_aprox": "10:30 AM hora local"
  },
  "estacion_actual": "verano_2025_2026",
  "baseline_rural_lst_celsius": 28.4,
  "promedio_posadas_lst_celsius": 32.1,
  "poligonos": [
    {
      "id": "itaembe_mini",
      "nombre": "Itaembé Miní",
      "lst_promedio": 35.8,
      "uhi_vs_rural": 7.4,
      "uhi_vs_ciudad": 3.7,
      "ranking_calor": 1,
      "n_observaciones": 18,
      "std": 1.2,
      "confianza": "alta"
    }
  ]
}
```

---

## 8. TROUBLESHOOTING ESPERABLE

### 8.1 Earth Engine

- **Computation timed out** en composites largos: dividir en chunks anuales y mosaicar localmente.
- **Pixel limit exceeded** en exports: usar `Export.image.toDrive` asíncrono.
- **No images returned** para algún mes: verificar que tanto L8 como L9 tengan escenas; si Posadas cae en una zona de overlap pueden faltar.

### 8.2 Procesamiento

- **Valores Celsius absurdos** (<-50 o >80): probablemente la fórmula de conversión está mal aplicada o no se filtró por `QA_PIXEL` correctamente.
- **Polígonos con todo `nan`**: cobertura nubosa total en ese mes, comportamiento esperado, no es un bug.
- **UHI negativa** en algún mes invernal: posible y correcta. Las zonas urbanas pueden ser ligeramente más frescas que el campo de día en invierno por sombras de edificios.

### 8.3 Frontend

- **Mapa lento** con muchos polígonos: usar `react-leaflet` con `LayerGroup` y memoización.
- **Choropleth no se ve bien en mobile**: agregar slider de opacidad y leyenda colapsable.

---

## 9. CIERRE

Esta capa debería ocupar 1-2 fines de semana de trabajo si todo va bien. La complejidad técnica es mediana porque reusamos la mayoría de la infraestructura del observatorio.

El valor que aporta es alto:
- Encaja con la narrativa política existente (vulnerabilidad social = vulnerabilidad climática).
- Tiene gancho mediático garantizado en cada verano.
- Sienta precedente arquitectónico para sumar más capas (incendios, deforestación) con la misma lógica federada.

Cuando termines, **la primera publicación pública** debería ser un thread/post con:
1. El mapa de top 5 más calientes.
2. La aclaración LST vs aire bien visible.
3. Link al observatorio.
4. Una recomendación concreta de acción municipal (más arbolado en X zona).

Eso convierte el dato en propuesta, no solo en denuncia. Mejor recibido por todos los actores.

Empezá. Resumime qué entendiste, hacé las 5 preguntas pendientes de la sección 5, y arrancamos por Tarea 1.

---

**Fin del prompt. Versión 1.0 de la extensión "Calor Urbano". Compatible con Observatorio Posadas v0.1.0-fase2.**
