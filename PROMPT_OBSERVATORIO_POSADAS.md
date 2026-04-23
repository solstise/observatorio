# PROMPT PARA CLAUDE CODE — Proyecto "Observatorio Urbano Posadas"

> **Cómo usar este prompt:** copialo entero al inicio de una sesión nueva de Claude Code, en la carpeta vacía donde querés que viva el proyecto. Claude Code va a leer todo el contexto, hacerte algunas preguntas iniciales (cuentas de Earth Engine, ubicación de carpetas), y arrancar por la Fase 1. Va a ir avanzando fase por fase preguntándote antes de cada salto. Si en algún momento querés que retome donde quedó, dale "continuá donde quedaste" y se orienta solo con los archivos del repo.

---

## 1. CONTEXTO GLOBAL DEL PROYECTO

### 1.1 Quién soy y qué hago

Soy desarrollador en Posadas, Misiones, Argentina. Tengo conocimientos sólidos de programación pero no soy experto en GIS ni en procesamiento satelital. Mi stack habitual es:

- Hardware: Ryzen 9 9900X3D, RTX 3080 (10GB VRAM), 256GB RAM, Windows 11 con WSL2 Ubuntu 24.04 disponible
- Lenguajes: JavaScript/Node.js (mucha experiencia), Python (intermedio), Bash (básico)
- IA local: Ollama corriendo Qwen3, Gemma 4, modelos de visión vía Gemini Flash API como fallback
- Bases de datos: SQLite, PostgreSQL con PostGIS si hace falta
- Front: React, Next.js, Tailwind, Leaflet/Mapbox para mapas
- Backend: Node.js + Express, FastAPI (Python) si conviene por librerías
- Despliegue: Hostinger VPS y máquina local

Trabajo solo. Necesito código mantenible por una sola persona. Priorizo claridad sobre elegancia. Comentá todo en español rioplatense (voseo opcional, no es crítico). Documentá decisiones técnicas en archivos `.md` separados a medida que aparecen.

### 1.2 Qué estamos construyendo

El **Observatorio Urbano Posadas** es un sistema que documenta la expansión urbana de Posadas y su área metropolitana usando imágenes satelitales históricas y actuales, gratuitas y públicas. El objetivo concreto es producir tres tipos de outputs:

1. **Timelapses visuales** (GIF y MP4) de barrios específicos mostrando crecimiento entre 2017 y la fecha actual.
2. **Reportes cuantitativos en PDF de una página por barrio** con conteo de viviendas, estimación de población, y cruce con servicios públicos disponibles.
3. **Dashboard web público** con todos los barrios de Posadas, capa interactiva, y descarga de cada reporte.

El destinatario primario es un funcionario provincial (ministro de Desarrollo Social que aspira a ser candidato a intendente de Posadas) que va a usar los reportes para defensa presupuestaria, priorización de intervenciones del ministerio y comunicación pública. El destinatario secundario es la ciudadanía y la prensa local que pueden consultar el dashboard libremente.

**Importante**: el sistema debe estar diseñado para ser **defendible públicamente**. Eso significa: metodología transparente, fuentes públicas y citables, márgenes de error explícitos, polígonos cubriendo TODA la ciudad y no solo los políticamente convenientes, código abierto en GitHub.

### 1.3 Restricciones y principios no negociables

- **Costos**: el sistema debe poder operar a costo cero o casi cero. Toda fuente de datos debe ser gratuita en su tier free. Si en algún momento necesitamos pagar algo, hay que avisarme y justificarlo.
- **Datos personales**: ningún dato personal individual debe entrar al sistema. Solo agregados por polígono (manzana, barrio o zona). Esto es por la Ley 25.326 argentina y por sentido común político.
- **Reproducibilidad**: cualquier número que el sistema reporte debe ser regenerable desde cero corriendo los scripts. Nada hardcoded "porque sí".
- **Honestidad de incertidumbre**: si el conteo de techos tiene 15% de error, el reporte dice "350-410 viviendas", no "382 viviendas". Si una imagen tiene nubes, se descarta y se documenta por qué. Mejor decir "no tenemos dato de marzo 2022" que mentir.
- **Idempotencia**: correr los scripts dos veces sobre los mismos datos debe producir los mismos resultados. Cachear todo lo descargado.
- **Logs útiles**: cada script logea qué está haciendo, cuántas imágenes descargó, cuánto tardó, qué falló. Logs en español, claros, archivables.

### 1.4 Áreas geográficas de interés

Posadas, Misiones, Argentina. Coordenadas centro aproximado: -27.3667, -55.8967. Área metropolitana incluye también Garupá, Candelaria, Fachinal. Para Fase 1 nos limitamos al ejido municipal de Posadas. Fase 2 expande al área metropolitana. Fase 3 puede incluir comparables (Oberá, Eldorado, Iguazú) si el tiempo permite.

Polígonos prioritarios para Fase 1 (zonas con crecimiento empíricamente conocido por el autor del prompt):

- Itaembé Miní (sur de la ciudad, expansión rápida 2018-2026)
- Itaembé Guazú (continuación de Itaembé Miní, más reciente)
- Chacra 32, 33, 181 (zonas de chacras subdividas)
- Villa Cabello (consolidado pero con crecimiento perimetral)
- Miguel Lanús (norte, con asentamientos)
- Villa Sarita (oeste)
- A1 / A4 / A3-2 (barrios IPRODHA)
- Zona peri-Aeropuerto
- El Brete (costa, tensión por inundabilidad)
- Nemesio Parma
- Centro y costanera (control: zona ya consolidada, debe mostrar poco cambio)

Estos son orientativos. El sistema debe poder agregar polígonos nuevos solo editando un archivo GeoJSON.

---

## 2. ARQUITECTURA GENERAL

### 2.1 Estructura de carpetas propuesta

```
observatorio-posadas/
├── README.md                    # documentación principal del proyecto
├── METODOLOGIA.md               # cómo se calcula cada métrica, fuentes, límites
├── CHANGELOG.md                 # cambios entre versiones
├── .env.example                 # variables de entorno necesarias
├── .gitignore
├── requirements.txt             # dependencias Python
├── package.json                 # dependencias Node si aplica
│
├── config/
│   ├── poligonos.geojson        # definición de barrios/zonas a monitorear
│   ├── servicios.geojson        # CAPS, escuelas, paradas, cloaca
│   └── settings.yaml            # parámetros globales (fechas, resoluciones)
│
├── data/                        # gitignored, datos descargados y derivados
│   ├── raw/
│   │   ├── sentinel2/
│   │   ├── planet_nicfi/
│   │   ├── osm/
│   │   ├── ms_buildings/
│   │   ├── google_buildings/
│   │   └── worldpop/
│   ├── processed/
│   │   ├── recortes/            # imágenes recortadas por polígono y fecha
│   │   ├── conteos/             # CSV con conteo de techos por fecha
│   │   └── timelapses/          # GIF y MP4 por polígono
│   └── outputs/                 # outputs finales para distribución
│       ├── pdfs/
│       └── web/
│
├── scripts/
│   ├── 01_descarga_sentinel.py
│   ├── 02_descarga_nicfi.py
│   ├── 03_descarga_buildings.py
│   ├── 04_descarga_osm.py
│   ├── 05_descarga_worldpop.py
│   ├── 10_recortar_por_poligono.py
│   ├── 20_contar_techos.py
│   ├── 30_estimar_poblacion.py
│   ├── 40_calcular_distancias_servicios.py
│   ├── 50_generar_timelapse.py
│   ├── 60_generar_pdf.py
│   └── 99_pipeline_completo.py  # orquesta todo
│
├── webapp/                      # dashboard público (Fase 3)
│   ├── frontend/                # Next.js + Leaflet
│   └── backend/                 # FastAPI sirviendo datos procesados
│
├── notebooks/                   # exploración y validación
│   ├── 01_exploracion_sentinel.ipynb
│   └── 02_validacion_conteo.ipynb
│
├── docs/
│   ├── poligonos_sugeridos.md
│   ├── fuentes_datos.md
│   ├── interpretacion_resultados.md
│   └── faq.md
│
└── tests/
    ├── test_descarga.py
    ├── test_conteo.py
    └── test_pdf.py
```

### 2.2 Stack técnico decidido

**Lenguaje principal**: Python para todo el pipeline de procesamiento satelital y geoespacial. Razón: ecosistema GIS dominante (geopandas, rasterio, shapely, pyproj, sentinelhub-py, folium, earthengine-api). 

**Lenguaje del frontend**: Next.js + React + Tailwind + Leaflet. Razón: el autor lo conoce, es liviano, hostable en Vercel free tier o en el VPS Hostinger.

**Base de datos**: SQLite para empezar (Fase 1 y 2). PostGIS sobre PostgreSQL si Fase 3 lo requiere por capas vectoriales pesadas.

**Generación de PDFs**: ReportLab si necesitamos control total, WeasyPrint si preferimos generar HTML y convertir. Decisión: WeasyPrint, porque podemos diseñar el reporte como HTML+CSS y se ve más profesional con menos esfuerzo. Vamos a generar plantillas Jinja2 que se renderizan a HTML y luego a PDF.

**Generación de timelapses**: Pillow para frames + imageio para GIF + ffmpeg-python para MP4. Overlays con Pillow o cairo.

**Orquestación**: scripts Python individuales orquestables desde un script master `99_pipeline_completo.py`. No usamos Airflow ni Prefect en Fase 1 y 2; sería sobre-ingeniería. Si Fase 3 requiere scheduling, usamos cron en el VPS.

**Caché**: cada script descargador chequea si el archivo ya existe en `data/raw/...` con el hash correcto antes de redescargar. Cero descargas redundantes.

### 2.3 Fuentes de datos a integrar

| Fuente | Qué provee | Cobertura temporal | Resolución | Acceso | Licencia |
|---|---|---|---|---|---|
| Sentinel-2 (ESA Copernicus) | Imágenes ópticas multiespectrales | 2015 - presente, cada 5 días | 10m RGB+NIR | API + Earth Engine | Copernicus open license |
| Sentinel-1 (ESA Copernicus) | SAR (radar, atraviesa nubes) | 2014 - presente, cada 6-12 días | 10m | API + Earth Engine | Copernicus open license |
| Planet NICFI | Mosaicos ópticos mensuales tropicales | Septiembre 2020 - presente | 4.7m | API con registro | NICFI license (no comercial OK, comercial restringido) |
| Esri Wayback World Imagery | Imágenes aéreas históricas | 2014 - presente | submétrica | Web tile + API | Esri ToS, uso atribución |
| Microsoft Building Footprints | Polígonos de edificios detectados con IA | snapshot 2023 (revisar última versión) | edificio individual | GitHub download | ODbL |
| Google Open Buildings v3 | Polígonos de edificios + altura estimada | snapshot 2023 | edificio individual | Earth Engine + descarga directa | CC BY 4.0 |
| WorldPop | Estimación de población en grilla | 2020 (último año global) | 100m | Descarga directa | CC BY 4.0 |
| OpenStreetMap | Calles, edificios, puntos de interés | continuo, comunidad | vector | Overpass API + Geofabrik | ODbL |
| HOT OSM Tasking Manager | Datos OSM curados para humanitarios | continuo | vector | descarga directa | ODbL |
| GADM | Límites administrativos | actualizado periódicamente | vector | descarga directa | uso académico/no comercial libre |
| ARSAT Datos Abiertos | Si tiene capas catastrales misioneras | variable | vector | sitio Misiones gob.ar | OGL Argentina |
| IDE Posadas (Nodo IDE) | Catastro municipal Posadas | variable | vector | https://posadas.gov.ar/idr | depende de cada capa |

Vamos a priorizar Sentinel-2 + Planet NICFI como fuentes ópticas principales, Google Open Buildings como fuente de edificios (mejor cobertura LATAM que MS), WorldPop para población, OSM para servicios, y si conseguimos catastro municipal de Posadas lo sumamos como capa de validación.

### 2.4 Decisión clave: Earth Engine vs descarga directa

**Decisión recomendada: usar Google Earth Engine para todo el procesamiento de Sentinel-2 y Sentinel-1.**

Razones:

1. Earth Engine tiene Sentinel-2 y Sentinel-1 ya pre-procesados, corregidos atmosféricamente (S2 SR), y filtrables por nubes con un par de líneas.
2. El compute corre en servidores de Google, gratis para uso no comercial. No necesitamos descargar terabytes a casa.
3. Solo descargamos los recortes finales de los polígonos de interés, en GeoTIFF o PNG.
4. Si el ministerio termina queriendo escalar a toda la provincia, Earth Engine escala sin problema.

Para Planet NICFI usamos descarga directa porque NICFI es mensual y los polígonos son pocos: viable bajar todos los meses para Posadas (~ 2GB/año total).

### 2.5 Pipeline lógico end-to-end

Para cada polígono y cada fecha:

```
1. INGESTA
   ├── Earth Engine: get Sentinel-2 SR median compositee (cloud-masked) para mes X
   ├── Earth Engine: export imagen recortada al polígono → GeoTIFF en data/raw/sentinel2/
   ├── Planet NICFI API: download mosaico mes X → GeoTIFF en data/raw/planet_nicfi/
   └── Logging: fecha, polígono, fuente, tamaño, hash MD5

2. DETECCIÓN DE EDIFICIOS
   ├── Cargar Google Open Buildings v3 (descarga única, no por fecha)
   ├── Filtrar edificios cuyo centroide cae dentro del polígono
   ├── Para cada edificio, decidir si es "preexistente" o "nuevo" comparando con Esri Wayback fecha base 2017
   └── Output: CSV con (poligono_id, edificio_id, fecha_aparicion_estimada, area_m2, confidence)

3. CONTEO POR FECHA
   ├── Para cada (poligono, fecha): contar edificios cuya fecha_aparicion_estimada <= fecha
   ├── Aplicar margen de error: rango [n * 0.85, n * 1.15] como banda de confianza
   └── Output: CSV serie temporal (poligono, fecha, n_edificios_min, n_edificios_estimado, n_edificios_max)

4. ESTIMACIÓN DE POBLACIÓN
   ├── Cruzar con WorldPop densidad para el polígono
   ├── Aplicar factor "personas por vivienda" parametrizable (default Misiones: 3.6 según INDEC)
   └── Output: CSV serie temporal (poligono, fecha, poblacion_min, poblacion_estimada, poblacion_max)

5. CRUCE CON SERVICIOS
   ├── Cargar capas OSM para Posadas (CAPS, hospitales, escuelas, paradas, comisarías)
   ├── Para cada polígono: distancia al servicio más cercano de cada tipo
   └── Output: CSV (poligono, tipo_servicio, distancia_metros, nombre_servicio)

6. INDICADORES DERIVADOS
   ├── Tasa de crecimiento anualizada
   ├── Densidad actual
   ├── Score de vulnerabilidad combinado (opcional, ver más abajo)
   └── Output: CSV resumen por polígono

7. GENERACIÓN DE TIMELAPSE
   ├── Recortar cada imagen al bounding box del polígono
   ├── Aplicar overlay: outline del polígono, texto con fecha, contador de edificios
   ├── Componer frames con Pillow
   ├── Exportar GIF (web liviano) y MP4 (calidad alta)
   └── Output en data/processed/timelapses/{poligono_id}.{gif,mp4}

8. GENERACIÓN DE PDF
   ├── Cargar plantilla Jinja2
   ├── Inyectar datos del polígono + serie temporal + servicios + 4 imágenes (2018, 2021, 2024, 2026)
   ├── Renderizar HTML
   ├── Convertir a PDF con WeasyPrint
   └── Output en data/outputs/pdfs/{poligono_id}.pdf

9. PUBLICACIÓN WEB (Fase 3)
   ├── Sincronizar /data/outputs a /webapp/public/data
   ├── Actualizar índice JSON con metadata de cada polígono
   └── Rebuild Next.js o servir estáticamente
```

---

## 3. FASE 1 — PROOF OF CONCEPT (objetivo: 1 fin de semana)

### 3.1 Alcance de Fase 1

Producir **un timelapse animado y un PDF de una página** para **5 polígonos** de Posadas, usando Sentinel-2 vía Earth Engine y conteo de edificios con Google Open Buildings.

Objetivo: tener algo que mostrarle al ministro este lunes. Visual fuerte. Datos directos. Sin sobre-ingeniería.

Aceptamos en Fase 1:
- Resolución 10m (Sentinel-2), no 4.7m (Planet) — más rápido de armar.
- Sin estimación de población detallada (un número grueso).
- Sin cruce de servicios (lo dejamos para Fase 2).
- Sin web (lo dejamos para Fase 3).

NO aceptamos en Fase 1:
- Datos inventados o aproximados sin documentar.
- Imágenes con nubes que confundan el timelapse.
- PDFs feos. Aunque sea simple, debe verse profesional.

### 3.2 Tareas concretas Fase 1

#### Tarea 1.1: Setup inicial del repo

- Crear estructura de carpetas según sección 2.1.
- Inicializar git, .gitignore que excluya `data/`, `.env`, `__pycache__`, `node_modules`, `*.tif`, `*.geotiff`, `venv/`.
- Crear `README.md` con descripción del proyecto, objetivos, estado actual ("Fase 1 en desarrollo"), instrucciones de instalación.
- Crear `requirements.txt` inicial con: `earthengine-api`, `geopandas`, `rasterio`, `shapely`, `pyproj`, `Pillow`, `imageio`, `imageio-ffmpeg`, `numpy`, `pandas`, `requests`, `python-dotenv`, `pyyaml`, `jinja2`, `weasyprint`, `tqdm`, `loguru`.
- Crear `.env.example` con las variables esperadas: `EE_PROJECT_ID`, `PLANET_API_KEY` (para Fase 2), `GOOGLE_MAPS_API_KEY` (opcional Fase 2), `OUTPUT_DIR`.
- Crear entorno virtual Python con `python -m venv venv` y documentar comandos de activación en Windows y Linux.

#### Tarea 1.2: Autenticación con Earth Engine

- Documentar paso a paso cómo el usuario crea un proyecto en Google Cloud, habilita Earth Engine API, y autentica con `earthengine authenticate`.
- Crear script de prueba `scripts/test_ee_auth.py` que importe `ee`, inicialice con el project ID, y haga una query trivial (por ejemplo, obtener el área de Misiones de FAO/GAUL).
- Si la autenticación falla, dar mensajes de error claros con link a la documentación oficial.

#### Tarea 1.3: Definir polígonos iniciales

- Crear `config/poligonos.geojson` con 5 polígonos delimitados manualmente. Coordenadas aproximadas (Claude Code: usar geocoding o referencias OSM para refinar):
  - Itaembé Miní centro: rectángulo aproximado lat -27.41 a -27.43, lon -55.95 a -55.97
  - Itaembé Guazú: extensión sur del anterior
  - Chacra 32: lat -27.40, lon -55.93 (rectángulo de ~1.5km lado)
  - Villa Cabello: zona consolidada para control
  - El Brete: costanera, polígono angosto siguiendo la línea de costa
- Cada feature del GeoJSON debe tener properties: `id`, `nombre`, `descripcion`, `categoria` (asentamiento_nuevo / consolidado_crecimiento / control), `prioridad` (1-5).
- Crear notebook Jupyter `notebooks/00_visualizar_poligonos.ipynb` que carga el GeoJSON y lo grafica sobre un mapa Folium para validación visual antes de procesar.

#### Tarea 1.4: Descarga de imágenes Sentinel-2 vía Earth Engine

Crear `scripts/01_descarga_sentinel.py`. Funcionalidad esperada:

- Argumentos CLI: `--poligonos config/poligonos.geojson`, `--fechas 2018-01,2019-01,2020-01,2021-01,2022-01,2023-01,2024-01,2025-01,2026-01`, `--output data/raw/sentinel2/`, `--cloud-threshold 20`.
- Para cada combinación (polígono, fecha):
  - Construir colección Sentinel-2 SR con filtro por fecha (rango ±60 días alrededor de la fecha objetivo) y por bounds del polígono.
  - Filtrar nubes con la propiedad `CLOUDY_PIXEL_PERCENTAGE < cloud_threshold`.
  - Aplicar máscara de nubes a nivel de pixel usando la banda QA60 o S2 Cloud Probability.
  - Generar composite mediano de la colección filtrada.
  - Recortar al polígono.
  - Exportar bandas RGB (B4, B3, B2) como GeoTIFF de 8 bits para visualización + bandas multispectrales (B2, B3, B4, B8, B11, B12) como GeoTIFF de 16 bits para análisis.
  - Nombre de archivo: `{poligono_id}_{YYYYMM}.tif`
  - Si ya existe en cache, skip.
- Logging con `loguru`: para cada exportación, log con polígono, fecha, número de imágenes en el composite, % de pixels válidos post-mask, ruta de salida.
- Manejo de errores: si una fecha-polígono no tiene imágenes válidas (todo nubes), log warning y continuar. No abortar el pipeline.
- **Importante sobre Earth Engine y exports**: Earth Engine tiene dos modos de export — `Image.getDownloadURL()` para descargas chicas (<32MB, sincrónico) y `ee.batch.Export.image.toDrive()` o `toCloudStorage()` para descargas grandes (asíncrono, hay que esperar y descargar después). Para Fase 1, polígonos chicos (~2x2 km a 10m son ~40000 pixeles, ~1 MB), usá `getDownloadURL`. Si un polígono es más grande, fallback a export por tiles.

#### Tarea 1.5: Descarga de Google Open Buildings

Crear `scripts/03_descarga_buildings.py`. Funcionalidad:

- Google Open Buildings v3 está disponible como FeatureCollection en Earth Engine: `GOOGLE/Research/open-buildings/v3/polygons`.
- Filtrar por bounding box que cubra todos los polígonos de Posadas.
- Exportar como GeoJSON o como tabla CSV con columnas: `building_id`, `latitude`, `longitude`, `area_m2`, `confidence`, `geometry_wkt`.
- Guardar en `data/raw/google_buildings/posadas_buildings.geojson`.
- Si ya existe, skip salvo flag `--force`.
- Documentar en log: cantidad total de edificios descargados, bounding box, fecha de descarga.

**Limitación importante a documentar**: Google Open Buildings es un snapshot estático. No te dice cuándo apareció cada edificio. Para inferir fecha de aparición tenemos que cruzar con imágenes históricas. Eso lo hacemos en Tarea 1.6.

#### Tarea 1.6: Inferir fecha de aparición de cada edificio

Este es el corazón técnico del proyecto. Crear `scripts/20_contar_techos.py`.

Algoritmo:

1. Cargar `posadas_buildings.geojson`.
2. Para cada polígono de interés en `config/poligonos.geojson`:
   a. Filtrar edificios cuyo centroide cae dentro del polígono.
   b. Para cada edificio, en cada fecha histórica (2018-01, 2019-01, ..., 2026-01):
      - Tomar la imagen Sentinel-2 RGB descargada para esa fecha.
      - Recortar un buffer pequeño alrededor del edificio (3x3 píxeles, ~30x30 m).
      - Calcular un índice de "construido" para ese parche: por ejemplo NDBI = (SWIR - NIR) / (SWIR + NIR) usando bandas B11 y B8. Alternativa: simple análisis de albedo (brillo promedio) + textura (varianza local).
      - Decidir: ¿el edificio existía en esa fecha?
   c. La fecha de aparición es la primera fecha donde el índice supera un umbral.

Refinamientos:
- Para edificios que ya están en imagen 2018 (presentes), marcar `fecha_aparicion = '<2018'`.
- Para edificios que no se detectan ni en 2026, hay un problema; investigar (tal vez el polígono de Open Buildings está mal). Marcar `fecha_aparicion = 'desconocida'` y excluir del conteo.
- Usar `multiprocessing` para paralelizar por edificio (Posadas puede tener decenas de miles).

Output: `data/processed/conteos/edificios_con_fecha.csv` con columnas: `edificio_id`, `poligono_id`, `lat`, `lon`, `area_m2`, `fecha_aparicion`, `confianza_open_buildings`.

Y `data/processed/conteos/serie_temporal.csv` con columnas: `poligono_id`, `fecha`, `n_edificios`, `n_edificios_min`, `n_edificios_max`.

**Honestidad metodológica**: documentar en `METODOLOGIA.md` que este método tiene 10-20% de error según validación de la literatura en condiciones similares. Aplicar banda de confianza ±15% al conteo final. Documentar con qué umbral del índice se considera "construido".

#### Tarea 1.7: Generación de timelapse

Crear `scripts/50_generar_timelapse.py`. Funcionalidad:

- Argumentos: `--poligono itaembé_miní`, `--output data/processed/timelapses/`, `--formato gif|mp4|both`.
- Para el polígono dado, cargar todas las imágenes RGB Sentinel-2 procesadas, ordenadas por fecha.
- Para cada frame:
  - Cargar GeoTIFF, normalizar a 0-255 (stretch percentil 2-98 por banda, no min-max).
  - Convertir a RGB Pillow Image.
  - Resize a tamaño objetivo (ej. 1080x1080 si polígono es cuadrado, conservar aspect ratio sino).
  - Aplicar overlay con Pillow:
    - Borde del polígono dibujado en línea blanca semi-transparente.
    - Esquina superior izquierda: texto con fecha grande (ej. "Agosto 2021").
    - Esquina inferior izquierda: texto con conteo de edificios ("Viviendas detectadas: 145 ± 22").
    - Esquina inferior derecha: pequeño logo "Observatorio Posadas" o atribución a la fuente Sentinel-2.
  - Aplicar fade entre frames si la diferencia temporal entre frames adyacentes es grande (ej. interpolar 5 frames intermedios).
- Guardar como GIF (loop infinito, 2 segundos por frame original) y como MP4 H.264 (más liviano para web).
- Generar también una imagen estática de comparación 2x2: 2018, 2021, 2024, 2026 lado a lado, con título y leyenda. Útil para reportes impresos.

Detalles de diseño visual:
- Fuente: usar una sans-serif limpia. Si no está disponible localmente, descargar Inter o Open Sans desde Google Fonts.
- Paleta: blanco, gris claro y un acento (azul oscuro #1a3a5c o verde institucional). NADA de rojo, evitar connotaciones.
- El texto debe tener contraste alto (sombra o caja semi-transparente detrás) para ser legible sobre cualquier fondo.

#### Tarea 1.8: Generación de PDF de una página

Crear `scripts/60_generar_pdf.py` y `templates/reporte_poligono.html` con Jinja2.

Estructura del PDF (una página A4):

```
+--------------------------------------------------+
| OBSERVATORIO URBANO POSADAS         [logo opc.]  |
+--------------------------------------------------+
| BARRIO: Itaembé Miní                             |
| Categoría: Asentamiento de crecimiento rápido    |
+--------------------------------------------------+
|                                                  |
| [Imagen 2018]    [Imagen 2026]                   |
|  640x320           640x320                       |
|                                                  |
+--------------------------------------------------+
| CRECIMIENTO DE VIVIENDAS                         |
|                                                  |
| 2018: 14 (±2)     2021: 89 (±13)                 |
| 2024: 256 (±38)   2026: 387 (±58)                |
|                                                  |
| [gráfico de línea con banda de confianza]        |
|                                                  |
+--------------------------------------------------+
| POBLACIÓN ESTIMADA ACTUAL                        |
| 1.398 personas (rango 1.190 - 1.600)             |
| Niños 0-14 estimados: 420                        |
+--------------------------------------------------+
| METODOLOGÍA                                      |
| Imágenes: Sentinel-2 ESA Copernicus              |
| Detección de edificios: Google Open Buildings v3 |
| Población: WorldPop 2020 + factor INDEC          |
| Período: enero 2018 - marzo 2026                 |
| Margen de error conteo: ±15%                     |
|                                                  |
| Generado: [fecha generación]                     |
| Versión sistema: v0.1.0                          |
+--------------------------------------------------+
```

Detalles de implementación:
- Template HTML con Jinja2, CSS embebido para WeasyPrint.
- Cargar datos del polígono desde los CSVs procesados.
- Las imágenes 2018 y 2026 se referencian con paths absolutos en el HTML.
- El gráfico de línea se genera con matplotlib y se exporta como PNG, luego se incrusta.
- WeasyPrint convierte a PDF en /data/outputs/pdfs/{poligono_id}_v{version}_{YYYYMMDD}.pdf
- Script debe poder regenerar todos los PDFs con `--all` o uno específico con `--poligono X`.

#### Tarea 1.9: Script orquestador

Crear `scripts/99_pipeline_completo.py` que:

- Lee config.
- Corre en orden: descarga sentinel → descarga buildings → conteo → timelapse → PDF.
- Para cada polígono.
- Logging maestro con tiempo total.
- Resumen final por consola con tabla de polígonos procesados, OK / FALLO, tiempo.

#### Tarea 1.10: Validación visual

Crear `notebooks/01_validacion_fase1.ipynb`:

- Para cada polígono procesado, mostrar las 9 imágenes Sentinel-2 anuales en grilla.
- Sobre cada imagen, overlay de los edificios detectados con esa fecha de aparición.
- Esto permite a un humano verificar que el algoritmo no esté contando árboles como edificios o cosas raras.

#### Tarea 1.11: Documentación Fase 1

Actualizar `README.md` con:
- Cómo correr el pipeline completo.
- Cómo agregar un polígono nuevo.
- Cómo regenerar un solo PDF.
- Limitaciones conocidas y honestidad metodológica.

Crear `docs/poligonos_sugeridos.md` con la lista de polígonos sugeridos y la razón por la que cada uno es relevante.

Crear `docs/fuentes_datos.md` con la tabla completa de fuentes, sus licencias, y cómo citar cada una.

### 3.3 Criterios de aceptación Fase 1

Fase 1 está completa cuando:

1. Puedo correr `python scripts/99_pipeline_completo.py` y se generan 5 timelapses GIF y 5 PDFs sin errores.
2. Cada PDF se ve profesional, con datos coherentes y honesta declaración de margen de error.
3. Cada timelapse muestra visualmente el crecimiento del barrio entre 2018 y 2026.
4. La carpeta `data/outputs/` tiene todo listo para mostrar al ministro.
5. El README explica todo lo necesario para que un colaborador nuevo entienda y reproduzca.
6. Si algo no funciona (ej. nubes excesivas en algún año), está documentado y el sistema avisa con warning, no se rompe.

---

## 4. FASE 2 — VERSIÓN OPERATIVA DEL MINISTERIO (objetivo: 1 mes)

### 4.1 Alcance de Fase 2

Expandir el sistema para cubrir **toda Posadas con 50-80 polígonos**, integrar **Planet NICFI para mejor resolución**, agregar **estimación de población detallada**, **cruce con servicios públicos** desde OSM, generar **dashboard web interno** para uso del ministerio, y **automatizar la actualización mensual**.

Objetivo: el ministerio tiene una herramienta operativa que actualiza sola y produce reportes nuevos cada mes.

### 4.2 Tareas concretas Fase 2

#### Tarea 2.1: Integración de Planet NICFI

Crear `scripts/02_descarga_nicfi.py`.

- Documentar el proceso de registro en NICFI (es manual: completar formulario, esperar 1-2 días para aprobación). Una vez aprobado, el usuario obtiene API key.
- Planet NICFI API endpoint base: `https://api.planet.com/basemaps/v1/mosaics`
- Cada mosaico tiene un nombre tipo `planet_medres_normalized_analytic_2024-08_mosaic`.
- Para Posadas (lat -27.4, lon -55.9), el quad es uno de los tiles del esquema XYZ de Planet a zoom 15 aprox.
- Script descarga, para cada mes desde 2020-09 hasta el presente, los quads que cubren todos los polígonos de interés.
- Cachear en `data/raw/planet_nicfi/{YYYY-MM}/{quad_id}.tif`.
- Mosaico local recortado a cada polígono → `data/processed/recortes/nicfi/{poligono_id}_{YYYYMM}.tif`.

Una vez que tenemos NICFI, el pipeline de timelapse y conteo puede correr con NICFI como fuente primaria (4.7m, mucho mejor visual) y Sentinel-2 como complemento o histórico pre-2020.

#### Tarea 2.2: Detección de edificios mejorada con modelo propio

Para barrios donde Google Open Buildings tiene gaps o errores conocidos (verificar visualmente en validación), entrenar un modelo segmentación binaria edificio/no-edificio.

Crear `scripts/training/`:
- `prepare_dataset.py`: muestrea N imágenes Planet NICFI de Posadas, descarga máscara de Google Open Buildings como ground truth, recorta tiles 256x256.
- `train_unet.py`: entrena U-Net con backbone ResNet34 usando `segmentation_models_pytorch`. Train en RTX 3080, ~6-12 horas para un modelo decente.
- `predict.py`: aplica modelo a una imagen nueva, genera máscara binaria, vectoriza con `rasterio.features.shapes` para obtener polígonos de edificios detectados.

Output: capacidad de generar conteo de edificios sobre imágenes NICFI mensuales, no solo el snapshot estático de Google.

**Importante**: el modelo entrenado se guarda en `models/edificios_v1.pt`. Documentar en `METODOLOGIA.md` la arquitectura, dataset de entrenamiento, métricas en validación (IoU, F1), y casos de error conocidos.

#### Tarea 2.3: Estimación de población mejorada

Crear `scripts/30_estimar_poblacion.py`:

- Cargar grilla WorldPop para Argentina, recortar a Posadas.
- Cargar también, si existe, capa censal del INDEC nivel radio censal (CENSO 2022). Esto da una calibración local muy superior a WorldPop.
- Para cada polígono y fecha:
  - Tomar densidad WorldPop como base.
  - Aplicar factor de corrección basado en cantidad de edificios detectados respecto del baseline (si baseline tenía 100 edificios y ahora hay 200, multiplicar densidad por 2).
  - Si hay datos del CENSO 2022 para algún radio que intersecta, calibrar.
- Output: serie temporal de población estimada por polígono, con banda de confianza más amplia que la del conteo de edificios (porque incorporamos error de "personas por vivienda").

Documentar todas las suposiciones: factor 3.6 personas/vivienda promedio Misiones, ajustado a 4.2 en barrios con alta presencia de niños inferida (heurística por tamaño de vivienda).

#### Tarea 2.4: Cruce con servicios públicos

Crear `scripts/04_descarga_osm.py` y `scripts/40_calcular_distancias_servicios.py`.

Servicios a cargar desde OSM (Overpass API):
- Centros de salud (`amenity=clinic`, `amenity=doctors`, `healthcare=*`)
- Hospitales (`amenity=hospital`)
- Escuelas (`amenity=school`)
- Jardines (`amenity=kindergarten`)
- Universidades (`amenity=university`)
- Comisarías (`amenity=police`)
- Bomberos (`amenity=fire_station`)
- Paradas de colectivo (`highway=bus_stop`)
- Farmacias (`amenity=pharmacy`)
- Bancos / cajeros (`amenity=bank`, `amenity=atm`)
- Supermercados (`shop=supermarket`)
- Mercados (`amenity=marketplace`)
- Plazas y espacios verdes (`leisure=park`, `leisure=playground`)

Adicionalmente, intentar conseguir capa oficial de:
- Red cloacal Posadas (consultar IDE municipal, si está)
- Red de agua potable
- Pavimentado de calles (puede inferirse de OSM pero no es confiable; intentar dato municipal)
- Recorridos de colectivo (Servicios Urbanos S.A. o GTFS si existe)

Para cada polígono, calcular:
- Distancia mínima al servicio más cercano de cada tipo.
- Cantidad de servicios de cada tipo dentro de un radio (500m, 1km, 2km).
- Indicador binario "tiene cobertura adecuada" según parámetros configurables (ej. CAPS a <1500m, escuela a <800m).

Output: `data/processed/servicios_por_poligono.csv` y `data/processed/servicios_por_poligono.geojson`.

#### Tarea 2.5: Indicador compuesto de vulnerabilidad (cuidado con esto)

**Esto requiere validación académica antes de publicar.** Crear `scripts/35_indice_vulnerabilidad.py` pero explícitamente marcado como **borrador metodológico**.

El indicador combina:
- Crecimiento poblacional (más rápido = más prioritario)
- Densidad actual de viviendas
- Distancia a CAPS
- Distancia a escuela
- Cobertura de pavimento (proxy: % de calles internas en OSM con `surface=paved`)
- Riesgo de inundación (cota del polígono respecto del Paraná, opcional Sentinel-1)

Cada variable se normaliza 0-1, se pesa según parámetros configurables, y se combina en un score 0-100.

**Documentar exhaustivamente las limitaciones**:
- Es un proxy, no un censo.
- No reemplaza la NBI oficial INDEC.
- Los pesos son arbitrarios hasta que se calibren empíricamente.
- Útil para priorización interna, NO para política pública con efectos legales sobre individuos.

Output: `data/processed/vulnerabilidad_v0.csv` con columnas (`poligono_id`, `score`, `componentes_json`).

#### Tarea 2.6: Dashboard web interno

Crear `webapp/` con Next.js 14 + Tailwind + Leaflet:

Páginas:
- `/` — mapa interactivo de Posadas, polígonos coloreados según score de vulnerabilidad o crecimiento. Click en polígono → sidebar con métricas y link al PDF.
- `/poligono/[id]` — vista detallada: timelapse embebido, gráficos, tabla de servicios, link a fuentes.
- `/comparar` — selector de 2-4 polígonos, comparación lado a lado.
- `/metodologia` — página estática con todo el detalle metodológico.
- `/descargas` — todos los PDFs y datos CSV abiertos.

Backend:
- Para Fase 2 podemos servir todo estático: los CSVs y GeoJSONs van como archivos en `webapp/public/data/` y el frontend los carga directamente. Sin necesidad de API ni base de datos.
- Si la cantidad de datos crece mucho, mover a FastAPI + PostgreSQL.

Autenticación:
- Para Fase 2 (uso interno del ministerio), basic auth a nivel de servidor (Nginx) o Vercel password protect. Simple pero efectivo.

Diseño:
- Sobrio. Inspiración: dashboards de ONU, Banco Mundial, IDB. Mucho blanco, tipografía limpia, datos primero.
- Logo "Observatorio Urbano Posadas" simple, generado con un texto en Inter Bold + un ícono geométrico (no usar logos institucionales del gobierno; el observatorio se posiciona como técnico/independiente aunque sea un proyecto del ministerio).
- Disclaimer permanente en footer: fuentes, versión, fecha de actualización.

#### Tarea 2.7: Pipeline automatizado mensual

Crear `scripts/cron/actualizacion_mensual.sh` que:

1. Activa el entorno virtual.
2. Descarga el último mosaico Planet NICFI del mes.
3. Descarga la última imagen Sentinel-2 limpia del mes.
4. Re-corre el conteo de edificios incremental (solo nuevos).
5. Actualiza CSVs.
6. Regenera timelapses incrementales.
7. Regenera PDFs.
8. Sincroniza con webapp.
9. Envía notificación de éxito o fallo a un Slack/Telegram/Email configurado.

Configurar cron en VPS Hostinger para correr el primer lunes de cada mes a las 2 AM.

Si el VPS no tiene RAM suficiente para todo el procesamiento, plan B: correr local en la máquina del autor y subir solo los outputs al VPS.

#### Tarea 2.8: Tests y CI

Crear suite de tests con `pytest`:
- `test_descarga.py`: mockea APIs, verifica manejo de errores y caché.
- `test_conteo.py`: dataset sintético con N edificios, verifica que el conteo sea ±15% de N.
- `test_pdf.py`: genera PDF para polígono dummy, verifica que el archivo existe y es válido.
- `test_geometrias.py`: verifica que los polígonos del config sean válidos, no se solapen, estén dentro del bounding box de Posadas.

Configurar GitHub Actions para correr tests en cada push.

#### Tarea 2.9: Documentación de Fase 2

Actualizar `METODOLOGIA.md` con todos los detalles nuevos. Crear `CASOS_DE_USO.md` con ejemplos concretos: "cómo usar el sistema para defender presupuesto", "cómo usar para priorizar recorridas", "cómo usar para responder a una crítica opositora".

### 4.3 Criterios de aceptación Fase 2

1. El sistema cubre toda Posadas con al menos 50 polígonos definidos.
2. Hay timelapses y PDFs para todos.
3. El dashboard web funciona y se navega bien.
4. La actualización mensual corre automáticamente y notifica.
5. La documentación metodológica es defendible públicamente (un técnico del INDEC o un investigador del CONICET podría revisarla y dar feedback constructivo, no decir "esto es basura").
6. El sistema es reproducible: clonando el repo y siguiendo el README, alguien con conocimiento Python básico llega a outputs equivalentes en menos de un día.

---

## 5. FASE 3 — PRODUCTO PÚBLICO Y ESCALADO (objetivo: 3 meses)

### 5.1 Alcance de Fase 3

El observatorio se convierte en un **servicio público** con sitio web abierto, API documentada, convenio académico con UNaM (o IPEC, o CONICET local), publicación periódica de informes con narrativa, y posiblemente extensión a otras ciudades misioneras (Oberá, Eldorado, Iguazú, Apóstoles).

### 5.2 Tareas Fase 3

#### Tarea 3.1: Sitio público

- Dominio propio, ejemplo `observatorioposadas.org` o `urbano.misiones.gob.ar`.
- SEO: títulos, descriptions, OpenGraph para compartir en redes.
- Contenido editorial: blog con análisis mensual del crecimiento de Posadas.
- Sistema de comentarios moderado (Disqus o Giscus con GitHub Discussions).
- Política de privacidad pública, accesibilidad WCAG AA.

#### Tarea 3.2: API pública

- FastAPI con OpenAPI documentation.
- Endpoints:
  - `GET /api/poligonos` — lista con metadata.
  - `GET /api/poligonos/{id}` — detalle.
  - `GET /api/poligonos/{id}/serie-temporal` — datos crudos.
  - `GET /api/poligonos/{id}/imagen?fecha=YYYY-MM` — PNG de la imagen.
  - `GET /api/poligonos/{id}/timelapse.gif` y `.mp4`.
  - `GET /api/poligonos/{id}/reporte.pdf`.
- Rate limiting con Redis (100 requests/min por IP).
- Autenticación opcional con API key para uso pesado (académicos, periodistas).

#### Tarea 3.3: Validación académica

- Buscar contacto en UNaM (Facultad de Ciencias Exactas, Químicas y Naturales — departamento de Geografía o de Ciencias de la Computación; o Facultad de Humanidades, depto de Geografía).
- Proponer convenio: la facultad valida la metodología, el observatorio cita a la facultad, los estudiantes pueden hacer trabajos finales con los datos.
- Producir un white paper técnico de ~20 páginas describiendo la metodología, validable.
- Eventualmente publicar en una revista o congreso (ejemplo: Congreso Argentino de Sistemas, Reunión Anual de la SAEU).

#### Tarea 3.4: Extensión a otras ciudades

- Refactorizar el código para ser ciudad-agnóstico. La configuración es solo un GeoJSON de límite de ciudad y polígonos internos.
- Generar primer extensión piloto a Oberá. Si funciona, escalar a Eldorado e Iguazú.
- Cada ciudad nueva es una sub-sección del sitio: `observatorioposadas.org/obera`, etc.
- Idealmente conseguir financiamiento de la provincia para mantener todo: presentar proyecto al IPLyC o al gobierno provincial.

#### Tarea 3.5: Reportes editoriales mensuales

- Cada primer lunes de mes, después de la actualización automática, generar un informe editorial:
  - "Posadas creció X manzanas este mes"
  - "Los 3 barrios con mayor crecimiento del trimestre"
  - "Comparativo con el mismo mes del año pasado"
  - "Foco del mes: tal barrio en detalle"
- Generación semi-automática: Gemma local arma el draft con los datos, el autor lo edita, se publica.
- Distribución por newsletter (ConvertKit free tier o similar).

#### Tarea 3.6: Métricas de éxito y dashboards de uso

- Plausible Analytics o Umami self-hosted para no usar Google Analytics (más privado, GDPR-friendly).
- Métricas clave: visitas, descargas de PDF, polígonos más vistos, fuentes de tráfico.
- Reporte mensual interno de uso del observatorio.

### 5.3 Criterios de aceptación Fase 3

1. Sitio público accesible 24/7 con uptime >99%.
2. API pública con al menos 10 consumidores externos al mes.
3. Convenio firmado con UNaM o equivalente.
4. Al menos un medio de prensa nacional (Chequeado, La Nación, Clarín, Página/12) levantó datos del observatorio.
5. El observatorio cubre al menos 3 ciudades de Misiones.
6. Hay un newsletter activo con suscriptores.

---

## 6. INSTRUCCIONES OPERATIVAS PARA CLAUDE CODE

### 6.1 Cómo empezar

Apenas leas este prompt:

1. Resumime en 5-10 líneas qué entendiste del proyecto, para confirmar que estamos alineados.
2. Hacé las preguntas de setup que necesites (no más de 5 preguntas en una sola tanda):
   - ¿Tengo cuenta de Google Cloud y proyecto Earth Engine creado?
   - ¿Tengo o quiero solicitar API key de Planet NICFI ahora o más tarde?
   - ¿En qué carpeta absoluta del sistema querés que viva el proyecto?
   - ¿Querés que cree un repo de GitHub o lo hacemos local primero?
   - ¿Preferís commits frecuentes y atómicos o pocos commits grandes?
3. Una vez respondidas, creá la estructura de carpetas inicial y commiteá.

### 6.2 Cómo proceder durante el desarrollo

- **Trabajá fase por fase**. No mezcles tareas de Fase 2 mientras estamos en Fase 1, salvo que sean triviales.
- **Trabajá tarea por tarea dentro de cada fase**. Después de cada tarea completada, mostrame qué hiciste, qué archivos creaste/modificaste, y preguntame si seguís con la siguiente.
- **Si una tarea requiere decisiones**, no inventes; preguntame. Ejemplo: "¿qué umbral de cobertura nubosa querés tolerar, 10%, 20% o 30%?". Yo decido.
- **Si una tarea es ambigua**, proponé 2-3 alternativas con pros y contras y dejame elegir.
- **Si descubrís un problema técnico** (la API X cambió, la librería Y está deprecada, una fuente de datos no cubre Posadas), pará y avisame antes de inventar workarounds.
- **Validá visualmente cada paso**. Si descargaste imágenes, mostrame una. Si contaste edificios, mostrame el polígono con los edificios overlay. No avances ciego.

### 6.3 Convenciones de código

- Python: PEP 8, type hints obligatorios en funciones públicas, docstrings estilo Google.
- JavaScript/TypeScript: Prettier defaults, ESLint con `next/core-web-vitals`.
- Nombres de variables y funciones: en español si refieren al dominio (`contar_edificios`, `poligonos`), en inglés si son técnicos genéricos (`request`, `response`, `client`).
- Commits: estilo conventional commits en español. Ejemplo: `feat(descarga): agregar soporte para Sentinel-2 cloud masking`.
- Branches: `main` siempre estable. Trabajamos en `dev` y mergeamos cuando una fase está completa.

### 6.4 Cuándo pedir ayuda al usuario

- Cuando una decisión afecta el alcance ("¿agregamos también Garupá en Fase 1 o lo dejamos para Fase 2?").
- Cuando necesitás credenciales o API keys.
- Cuando un script falla y la causa no es obvia después de 2 intentos de debug.
- Cuando una métrica reportada no parece tener sentido (ej. el polígono X creció 1000% en un mes, probablemente hay un bug).
- Cuando estás por agregar una dependencia pesada (>50 MB) o costosa (paid API).

### 6.5 Cuándo NO pedir ayuda

- Para errores de sintaxis o linting: arreglalos solo.
- Para nombres de variables o estructura interna: usá tu criterio según las convenciones.
- Para optimizaciones obvias: aplicalas y mencionalas en el commit.

### 6.6 Tone & estilo en respuestas

- Hablame en español rioplatense, sin formalidad excesiva.
- Sé directo y conciso. No me pidas perdón por errores; arreglalos y seguí.
- Si algo es difícil o tiene riesgo, decímelo crudo. Prefiero "esto puede salir mal por X razón, ¿igual seguimos?" que un optimismo falso.
- Si algo es genial y funciona, también decímelo. Los logros pequeños cuentan.

---

## 7. NOTAS METODOLÓGICAS PROFUNDAS

Esta sección es referencia técnica que puede que necesites consultar mientras programás.

### 7.1 Sobre Sentinel-2 y su uso en detección de cambios urbanos

Sentinel-2 tiene 13 bandas. Para nuestros propósitos las relevantes son:

- B2 (Blue, 490 nm, 10m)
- B3 (Green, 560 nm, 10m)
- B4 (Red, 665 nm, 10m)
- B8 (NIR, 842 nm, 10m)
- B11 (SWIR1, 1610 nm, 20m → resampleado a 10m)
- B12 (SWIR2, 2190 nm, 20m → resampleado a 10m)

Índices útiles para discriminar urbano de no urbano:

- **NDBI** (Normalized Difference Built-up Index) = (SWIR - NIR) / (SWIR + NIR). Valores altos indican superficie construida.
- **NDVI** (vegetación) = (NIR - Red) / (NIR + Red). Valores bajos indican ausencia de vegetación, lo que correlaciona con suelo construido o desnudo.
- **BUI** (Built-up Index) = NDBI - NDVI. Combinación más robusta.
- **MNDWI** (agua) = (Green - SWIR) / (Green + SWIR). Útil para excluir cuerpos de agua del análisis.

En Posadas, suelo expuesto (chacras recién desmontadas) puede confundirse con urbano. Por eso es mejor cruzar con detección de polígonos de edificios reales (Open Buildings) en lugar de usar solo índices.

### 7.2 Sobre cobertura nubosa en Posadas

Posadas es subtropical húmedo. Cobertura nubosa promedio anual ~50-60%. Meses más despejados: junio-agosto (invierno seco). Meses más nublados: noviembre-marzo (verano lluvioso).

Estrategia: para cada año, generar el composite mediano de los 3 meses más despejados (junio, julio, agosto) en lugar de un mes específico. Eso da imágenes mucho más limpias y el cambio interanual es lo que nos interesa, no el cambio mensual.

### 7.3 Sobre Google Open Buildings v3

El dataset v3 fue publicado en mayo 2023. Cubre África, América Latina, Sudeste Asiático. Para LATAM, la cobertura es buena pero variable: ciudades grandes mejor que rurales.

Cada edificio detectado tiene un score de confianza (0-1). Recomendación: filtrar por confidence > 0.7 para conteos serios. Documentar el umbral usado.

El dataset NO te dice fecha de aparición. Para inferirla hay que cruzar con imágenes históricas, que es exactamente lo que hace nuestra Tarea 1.6.

Limitación importante: Open Buildings detecta techos. Casas con techo de paja muy oscuro pueden quedar afuera. Casas adosadas pueden detectarse como un solo polígono. Documentar todo esto.

### 7.4 Sobre WorldPop

WorldPop publica grillas de población a 100m de resolución, derivadas de censos nacionales + modelos. El último año global con cobertura completa es 2020.

Para Argentina, también está disponible el CENSO 2022 a nivel de radio censal vía REDATAM o IPEC. Si conseguimos esa capa, es muy superior para calibrar.

Limitación: WorldPop es un modelo, no una observación. En zonas con cambio rápido (que son justo las que nos interesan), WorldPop subestima la población actual. Por eso aplicamos factor de corrección basado en conteo de edificios.

### 7.5 Sobre la honestidad estadística

El sistema debe siempre reportar bandas de confianza, no números puntuales. Razones:

- Estadística básica: cualquier estimador tiene varianza.
- Política: si decís "382 viviendas" y un opositor encuentra que son 410, te mata. Si decís "350-410", estás cubierto.
- Ética: la honestidad sobre incertidumbre genera confianza a largo plazo. La precisión falsa la destruye.

Implementación: cada estimación carga un objeto con `valor_central`, `intervalo_inferior_95`, `intervalo_superior_95`, `metodo`, `supuestos_clave`. En las visualizaciones, mostrar siempre la banda.

### 7.6 Sobre el riesgo político de publicar coordenadas de asentamientos

Algunos polígonos pueden corresponder a asentamientos informales en tierras en disputa legal. Publicar el dato preciso puede:

- Facilitar desalojos por parte de propietarios privados o el estado.
- Generar estigma sobre los habitantes.
- Crear conflictos políticos no deseados.

Mitigación:

- Para polígonos catalogados como "asentamiento_sensible" en la config, NO publicar el polígono exacto en el sitio público. Solo el dato agregado a nivel barrio amplio.
- El detalle queda solo en la versión interna del ministerio.
- Documentar política de privacidad de polígonos en `docs/politica_publicacion.md`.

### 7.7 Stack alternativo si Earth Engine falla

Si por algún motivo no podemos usar Earth Engine (cuenta no aprobada, límites superados, política institucional), plan B:

- Sentinel-2: descargar directo de Copernicus Open Hub (registro gratuito) o de AWS Open Data (`s3://sentinel-s2-l2a/`). Procesar con `rasterio` y `sentinelhub-py` localmente. Más lento, requiere más espacio en disco.
- Google Open Buildings: descargar como CSV directo desde [sites.research.google/gr/open-buildings/](https://sites.research.google/gr/open-buildings/), procesar con `geopandas`.
- WorldPop: descarga directa.

Todo factible, solo más trabajo.

---

## 8. CHECKLIST DE ARRANQUE

Antes de escribir una línea de código, asegurate de tener:

- [ ] Python 3.11 o 3.12 instalado.
- [ ] Git instalado y configurado.
- [ ] Cuenta de Google con un proyecto en Cloud Console.
- [ ] Earth Engine API habilitada en ese proyecto.
- [ ] Comando `gcloud` instalado y autenticado (opcional pero ayuda).
- [ ] `earthengine-api` instalable (`pip install earthengine-api`).
- [ ] GDAL instalado en el sistema (Windows: usar OSGeo4W o conda; Linux: `sudo apt install gdal-bin libgdal-dev`).
- [ ] WeasyPrint instalable. En Windows requiere GTK3, instrucciones complejas. Alternativa: usar WSL2 para todo el proyecto.
- [ ] FFmpeg instalado y en PATH (para timelapses MP4).
- [ ] Editor con buen soporte Python (VS Code, PyCharm).

---

## 9. RECURSOS DE REFERENCIA

Documentación y ejemplos que probablemente vas a consultar:

- Earth Engine Python API: https://developers.google.com/earth-engine/guides/python_install
- Sentinel-2 product guide: https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-2-msi
- Planet NICFI program: https://www.planet.com/nicfi/
- Google Open Buildings: https://sites.research.google/gr/open-buildings/
- WorldPop: https://www.worldpop.org/
- OpenStreetMap Overpass API: https://wiki.openstreetmap.org/wiki/Overpass_API
- Geopandas: https://geopandas.org/
- Rasterio: https://rasterio.readthedocs.io/
- WeasyPrint: https://weasyprint.org/
- Leaflet: https://leafletjs.com/
- Next.js docs: https://nextjs.org/docs

Lecturas metodológicas recomendadas (poné en `docs/lecturas.md`):

- "Mapping Africa's Buildings with Satellite Imagery" — Google Research blog post sobre Open Buildings.
- "Evaluating the Use of Satellite-Derived Indicators of Built-Up Area for Mapping Urban Population" — paper sobre cruzar built-up con población.
- "WorldPop, open data for spatial demography" — paper sobre WorldPop.
- "Sen2Cor for Sentinel-2" — sobre corrección atmosférica.
- "Cloud Detection in Sentinel-2 Imagery" — varios papers, importante para nuestra máscara de nubes.
- "Urban growth mapping using Sentinel-2 time series in São Paulo, Brazil" — caso de estudio cercano metodológicamente al nuestro.

---

## 10. TROUBLESHOOTING ESPERABLE

Esta sección lista problemas que sé que vas a encontrar, basado en proyectos similares previos. Si los ves, no entres en pánico, ya sabemos cómo manejarlos.

### 10.1 Earth Engine

**Problema**: `ee.Initialize()` falla con error `Not signed up for Earth Engine`.
**Causa**: el proyecto de Google Cloud no tiene la API de Earth Engine habilitada, o la cuenta no fue aceptada.
**Solución**: ir a https://code.earthengine.google.com/ y aceptar términos. Luego habilitar la API en Cloud Console. Esperar 5-10 minutos para propagación.

**Problema**: `Computation timed out` al hacer composites grandes.
**Causa**: Earth Engine tiene límite de 5 minutos para queries interactivas.
**Solución**: usar `ee.batch.Export.image.toDrive()` para exports asíncronos. El resultado aparece en Google Drive y lo bajamos con `gdown` o la API de Drive.

**Problema**: `Pixel limit exceeded`.
**Causa**: el polígono es demasiado grande para `getDownloadURL` (límite ~33 millones de pixeles).
**Solución**: dividir el polígono en tiles, descargar cada uno, y mosaicar localmente con `rasterio.merge`.

**Problema**: imágenes vienen casi todas blancas o casi todas negras.
**Causa**: stretch incorrecto. Sentinel-2 viene en valores de reflectancia 0-10000.
**Solución**: dividir por 10000 y luego stretchear por percentil. NUNCA hacer min-max sobre la imagen completa porque un pixel raro arruina todo.

### 10.2 Planet NICFI

**Problema**: el formulario de NICFI tarda en aprobar.
**Causa**: revisión manual.
**Solución**: ser claro y específico en el formulario sobre el uso ("monitoreo de expansión urbana en Posadas, Argentina, para reportes de desarrollo social, no comercial"). Suelen aprobar en 24-72 horas. Mientras tanto, avanzar con Sentinel-2.

**Problema**: el quad descargado no contiene mi polígono.
**Causa**: confusión con el sistema XYZ de Planet (zoom 15, no zoom 18).
**Solución**: usar la utilidad `mercantile` de Python para calcular qué quads cubren un bbox dado.

### 10.3 GeoPandas y proyecciones

**Problema**: las distancias salen ridículas (millones de metros).
**Causa**: estás calculando distancia en grados (EPSG:4326) en lugar de metros.
**Solución**: reproyectar a un CRS local en metros. Para Misiones: EPSG:5347 (POSGAR 2007 / Argentina 6) o EPSG:32721 (UTM zone 21S). Usá `gdf.to_crs(epsg=32721)` antes de calcular distancias.

**Problema**: `fiona` o `pyproj` se rompen al instalar.
**Causa**: dependencias compiladas que no encuentran GDAL.
**Solución**: en Windows, usar `conda install -c conda-forge geopandas` que trae todo. En Linux, `apt install libgdal-dev` antes del pip.

### 10.4 WeasyPrint

**Problema**: en Windows, `weasyprint` no encuentra GTK3.
**Causa**: WeasyPrint depende de librerías nativas que en Windows son un dolor.
**Solución**: usar WSL2 para todo el proyecto. Se instala `sudo apt install python3-cffi python3-brotli libpango-1.0-0 libpangoft2-1.0-0` y funciona perfecto.

**Problema**: el PDF generado tiene fuentes feas o caracteres rotos.
**Causa**: las fuentes referenciadas en el CSS no están instaladas en el sistema.
**Solución**: descargar las fuentes (Inter desde Google Fonts) y usar `@font-face` con path local. NO confiar en fuentes "del sistema".

### 10.5 Detección de edificios

**Problema**: el conteo de edificios da números muy distintos a la realidad observable en Google Maps.
**Posibles causas**:
- Confidence threshold mal calibrado.
- Polígono no incluye toda la zona que pensás.
- Open Buildings tiene un gap conocido en esa zona.
- Estás contando el polígono de Open Buildings sin filtrar centroides.
**Diagnóstico**: validar visualmente con el notebook `01_validacion_fase1.ipynb`. Si el problema es de Open Buildings, considerar entrenar modelo propio (Tarea 2.2).

**Problema**: el algoritmo de "fecha de aparición" da resultados ruidosos (un edificio aparece y desaparece entre años).
**Causa**: variación de iluminación, máscara de nubes imperfecta, sombras estacionales.
**Solución**: aplicar regla "si aparece en una fecha, asumir que existe en todas las fechas posteriores". O sea, monotonicidad creciente del conteo. Esto es correcto en barrios en crecimiento (no se demuelen casas masivamente). Para barrios consolidados puede no ser exacto pero el efecto es despreciable.

### 10.6 Dashboard web

**Problema**: el mapa de Leaflet con 80 polígonos es lento.
**Solución**: usar `leaflet.markercluster` para puntos, `vector grid` para polígonos a baja resolución, `tippecanoe` para generar tiles vectoriales. Para Fase 2 normalmente alcanza con polígonos GeoJSON estáticos < 5MB.

**Problema**: las imágenes pesadas en el sitio web tardan en cargar.
**Solución**: pre-procesar todas las imágenes a 3 tamaños (thumb 256px, medium 800px, full 1920px) y servir el adecuado según contexto. Usar `next/image` que hace lazy loading automático.

---

## 11. PROMPTS AUXILIARES PARA REUSAR

Cuando estés profundo en el desarrollo y necesites ayuda específica, podés usar estos prompts más chicos. Copialos y pegáselos a Claude Code (o a un Claude separado en chat) según el caso.

### 11.1 Prompt para revisar metodología de un script

```
Revisá el script scripts/20_contar_techos.py con foco en metodología.
Quiero que me digas:
1. ¿Qué supuestos hace que no estén explícitos?
2. ¿Qué fuentes de error pueden afectar el resultado?
3. ¿Cómo cuantificarías la incertidumbre del output?
4. ¿Hay un caso esquina (edge case) geográfico o temporal en Posadas
   que pueda romper esto?
5. ¿Qué tests le agregarías para que un revisor académico no
   te objete la robustez?
Respondé en español, con bullet points, sin código.
```

### 11.2 Prompt para generar el draft de un reporte editorial

```
Tomá los datos del archivo data/processed/serie_temporal.csv
y los datos de data/processed/servicios_por_poligono.csv.
Generá un draft de informe editorial de ~500 palabras titulado:
"Posadas en cifras: [mes] [año]"
Estructura:
- Lead de 2 frases con el dato más fuerte del mes.
- 3 bullets con las cifras destacadas.
- Un párrafo "foco del mes" sobre el polígono con mayor crecimiento.
- Un párrafo "tendencia" comparando con el mismo mes del año pasado.
- Cierre con cita de la fuente y link al reporte completo.
Estilo: periodístico sobrio, oraciones cortas, en español rioplatense
sin voseo (preferir tuteo o impersonal). Sin opiniones políticas.
Sin adjetivos cargados ("alarmante", "preocupante", etc.).
```

### 11.3 Prompt para validar un PR antes de mergearlo

```
Revisá los cambios del PR como si fueras un colaborador externo
con experiencia en GIS y data engineering.
Foco en:
1. ¿Hay tests para los cambios?
2. ¿La documentación se actualizó?
3. ¿Hay regresiones potenciales en el pipeline existente?
4. ¿Los nombres de variables y archivos siguen las convenciones?
5. ¿Hay valores hardcodeados que deberían ir en config?
6. ¿Se introducen dependencias nuevas? ¿Están justificadas?
7. ¿Algo del cambio podría romper la idempotencia del pipeline?
Hacé una lista priorizada de "must fix" vs "nice to have".
```

### 11.4 Prompt para diseñar una visualización nueva

```
Necesito una visualización de [X] que comunique [Y] al destinatario [Z].
Datos disponibles: [describir CSV o estructura].
Restricciones:
- Debe verse profesional impreso en blanco y negro y a color.
- Debe ser entendible en menos de 5 segundos por alguien sin formación técnica.
- Debe ser honesto con la incertidumbre (mostrar bandas, no líneas planas).
Proponé 3 alternativas de visualización con pros y contras.
Para la elegida, escribí el código matplotlib + seaborn que la genere
desde el CSV, listo para integrar al pipeline.
```

---

## 12. PLANTILLAS DE ARCHIVOS CLAVE

Para que arranques rápido, te dejo el contenido inicial de los archivos más importantes.

### 12.1 README.md inicial

```markdown
# Observatorio Urbano Posadas

Sistema de monitoreo de la expansión urbana de Posadas, Misiones, Argentina,
basado en imágenes satelitales públicas y datos abiertos.

## Estado del proyecto

Fase 1: Proof of concept con 5 polígonos, en desarrollo.

## Qué hace

- Descarga imágenes satelitales históricas de Posadas (2018-2026).
- Detecta edificios y estima su fecha de aparición.
- Genera timelapses animados de cada barrio monitoreado.
- Produce reportes PDF de una página con métricas y servicios.

## Para qué sirve

- Defensa presupuestaria con evidencia objetiva.
- Priorización de intervenciones del ministerio.
- Comunicación pública con datos abiertos.
- Investigación urbana y académica.

## Fuentes de datos

Todas las fuentes son públicas y gratuitas. Ver `docs/fuentes_datos.md`.

## Instalación

[completar tras Tarea 1.1]

## Uso

[completar tras Tarea 1.9]

## Licencia

Código: MIT.
Datos generados: CC BY 4.0.

## Contacto

[completar]
```

### 12.2 .gitignore inicial

```
# Python
__pycache__/
*.py[cod]
*$py.class
venv/
.venv/
env/

# Datos pesados
data/raw/
data/processed/
data/outputs/
*.tif
*.geotiff
*.tiff

# Modelos entrenados
models/*.pt
models/*.pth
models/*.h5

# Credenciales
.env
*.key
service-account*.json

# Sistema
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp

# Notebooks
.ipynb_checkpoints/

# Web
node_modules/
.next/
out/
build/

# Logs
*.log
logs/
```

### 12.3 settings.yaml inicial

```yaml
# Configuración global del Observatorio Urbano Posadas

proyecto:
  nombre: "Observatorio Urbano Posadas"
  version: "0.1.0"
  autor: "[completar]"

geografia:
  ciudad: "Posadas"
  provincia: "Misiones"
  pais: "Argentina"
  centro_lat: -27.3667
  centro_lon: -55.8967
  bbox:
    norte: -27.30
    sur: -27.50
    este: -55.80
    oeste: -56.00
  crs_metrico: "EPSG:32721"  # UTM 21S, para cálculos en metros

sentinel2:
  cloud_threshold: 20
  bandas_rgb: ["B4", "B3", "B2"]
  bandas_analisis: ["B2", "B3", "B4", "B8", "B11", "B12"]
  meses_composite: [6, 7, 8]  # invierno seco
  fechas_target:
    - "2018-07"
    - "2019-07"
    - "2020-07"
    - "2021-07"
    - "2022-07"
    - "2023-07"
    - "2024-07"
    - "2025-07"
    - "2026-07"

planet_nicfi:
  habilitado: false  # activar cuando esté la API key
  primer_mes: "2020-09"

edificios:
  fuente_principal: "google_open_buildings"
  confidence_threshold: 0.70
  margen_error_pct: 15

poblacion:
  fuente: "worldpop_2020"
  personas_por_vivienda_misiones: 3.6
  factor_correccion_ninos: 0.30

servicios_osm:
  radio_busqueda_metros: 2000
  servicios:
    - amenity=clinic
    - amenity=hospital
    - amenity=school
    - amenity=kindergarten
    - amenity=pharmacy
    - highway=bus_stop

reportes:
  formato_fecha: "%B %Y"  # "Julio 2026"
  paleta:
    primario: "#1a3a5c"
    secundario: "#5a7a9c"
    fondo: "#ffffff"
    texto: "#222222"
    acento: "#c97d3c"
  fuente: "Inter"

logging:
  nivel: "INFO"
  archivo: "logs/observatorio.log"
  rotacion: "10 MB"
```

### 12.4 Esqueleto de .env.example

```bash
# Earth Engine
EE_PROJECT_ID=tu-proyecto-aqui
EE_SERVICE_ACCOUNT_FILE=  # opcional, si usás service account

# Planet NICFI (Fase 2)
PLANET_API_KEY=

# Google Maps (opcional, para validación)
GOOGLE_MAPS_API_KEY=

# Notificaciones (Fase 2)
SLACK_WEBHOOK_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Paths
OUTPUT_DIR=./data/outputs
CACHE_DIR=./data/raw

# Webapp (Fase 3)
WEBAPP_BASIC_AUTH_USER=
WEBAPP_BASIC_AUTH_PASS=
```

### 12.5 Estructura mínima de un poligonos.geojson válido

```json
{
  "type": "FeatureCollection",
  "name": "poligonos_observatorio_posadas",
  "crs": {
    "type": "name",
    "properties": { "name": "urn:ogc:def:crs:OGC:1.3:CRS84" }
  },
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": "itaembe_mini",
        "nombre": "Itaembé Miní",
        "descripcion": "Zona de expansión rápida sur de Posadas",
        "categoria": "asentamiento_crecimiento_rapido",
        "prioridad": 1,
        "publicar_en_sitio": true,
        "fecha_creacion_poligono": "2026-04-22"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [-55.97, -27.43],
            [-55.95, -27.43],
            [-55.95, -27.41],
            [-55.97, -27.41],
            [-55.97, -27.43]
          ]
        ]
      }
    }
  ]
}
```

---

## 13. PRINCIPIOS DE INTERACCIÓN CON EL USUARIO DURANTE LA EJECUCIÓN

Esta sección complementa la 6.x. Cosas adicionales sobre cómo Claude Code debe comportarse.

### 13.1 Preguntas siempre acompañadas de una opción default

Mal: "¿Qué umbral de confianza preferís para Open Buildings?"
Bien: "¿Qué umbral de confianza preferís para Open Buildings? Por default sugiero 0.70 que es lo que la documentación recomienda. Otras opciones razonables: 0.65 (más permisivo, más falsos positivos) o 0.80 (más estricto, perdés algunos edificios reales)."

### 13.2 Confirmación antes de operaciones destructivas o costosas

- Antes de borrar un directorio entero: confirmar.
- Antes de hacer una descarga >1 GB: estimar tamaño y confirmar.
- Antes de iniciar un entrenamiento de modelo de varias horas: confirmar.
- Antes de hacer commits y pushes a `main`: confirmar (en `dev` no hace falta).

### 13.3 Logging exhaustivo en consola y en archivo

Toda corrida de script debe loguear:
- Hora de inicio.
- Parámetros recibidos.
- Cada paso importante con timestamp.
- Para cada I/O, qué archivo y qué tamaño.
- Errores con stack trace completo.
- Hora de fin y duración total.
- Resumen final con métricas relevantes.

Logs en `logs/observatorio_YYYYMMDD.log` con rotación.

### 13.4 Reportes de progreso en operaciones largas

Cualquier loop sobre más de 100 elementos debe usar `tqdm` con descripción clara. Ejemplo: `for poligono in tqdm(poligonos, desc="Procesando polígonos")`.

### 13.5 Manejo de interrupciones

Si el usuario hace Ctrl+C, el script debe:
- Capturar la señal.
- Loguear "interrupción solicitada".
- Cerrar archivos abiertos limpiamente.
- Guardar estado parcial donde sea posible (CSV con lo procesado hasta ahora).
- Salir con código de salida 130 (convención Unix para SIGINT).

Esto permite reanudar después con idempotencia.

### 13.6 Versionado semántico

El proyecto sigue [SemVer](https://semver.org/lang/es/):
- Major (1.0.0 → 2.0.0): cambios incompatibles en el formato de outputs o en la API.
- Minor (0.1.0 → 0.2.0): nuevas features compatibles. Cada fase completada bumpea el minor.
- Patch (0.1.0 → 0.1.1): bugfixes.

El número de versión va en `settings.yaml`, en el footer de los PDFs, en el footer del sitio web.

### 13.7 Dependencias mínimas

Cada vez que estés tentado de agregar una dependencia, preguntate:
- ¿Lo puedo hacer con la stdlib?
- ¿Lo puedo hacer con una librería que ya tengo?
- ¿La dependencia nueva es activamente mantenida?
- ¿Pesa menos de 50 MB instalada?
- ¿Tiene licencia compatible (MIT, BSD, Apache, MPL)?

Si alguna respuesta es no, justificar antes de agregar al `requirements.txt`.

---

## 14. CIERRE Y ESPÍRITU DEL PROYECTO

Este observatorio no es solo un proyecto técnico. Es una herramienta para que decisiones de política pública en Posadas se tomen con datos y no con anécdotas. Es también una herramienta para que la ciudadanía y la prensa puedan auditar al Estado con datos abiertos.

Eso significa que la **calidad técnica importa**, pero la **honestidad metodológica importa más**. Si en algún momento tenemos que elegir entre un número que se vea bien o un número que sea defendible, elegimos el segundo, siempre.

También significa que el proyecto debe **sobrevivirme a mí** como autor único. El código debe ser claro, la documentación completa, las dependencias bien declaradas. Si dentro de 5 años alguien quiere retomar esto, debe poder hacerlo.

Y finalmente: el ministro es el destinatario inicial pero no el dueño del proyecto. El proyecto es un servicio público. Si el ministro pierde la elección, si cambia de cargo, si se pelea conmigo, el observatorio sigue funcionando porque está bien construido y porque sirve a la ciudad, no a una persona.

Con esto en mente, arrancá. Resumime qué entendiste, hacé las preguntas de setup, y empezamos.

---

**Fin del prompt. Versión 1.0. Si en algún punto del desarrollo este prompt necesita ampliarse o corregirse, lo editamos juntos antes de seguir.**
