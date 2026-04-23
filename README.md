# Observatorio Urbano Posadas

Sistema de monitoreo de la expansión urbana de Posadas, Misiones, Argentina,
basado en imágenes satelitales públicas y datos abiertos.

> Sistema que documenta la expansión urbana de Posadas con imágenes satelitales
> Sentinel-2 y Planet NICFI, genera timelapses, reportes PDF por barrio y un
> dashboard web público, con metodología transparente y costo cero.

## Estado del proyecto

**Fase 1 en desarrollo** — 2026-04-22. Proof of concept con 5 polígonos piloto
(Itaembé Miní, Itaembé Guazú, Chacra 32, Villa Cabello, El Brete). El pipeline
completo (descarga → conteo → timelapse → PDF) está en construcción.

## Qué hace

- Descarga imágenes satelitales históricas de Posadas (2018 - presente) desde
  Sentinel-2 vía Google Earth Engine, y Planet NICFI a partir de 2020.
- Detecta edificios usando Google Open Buildings v3 e infiere su fecha de
  aparición cruzando con series temporales Sentinel-2.
- Genera **timelapses animados** (GIF y MP4) por barrio mostrando la
  evolución interanual.
- Produce **reportes PDF de una página por barrio** con conteo de viviendas,
  estimación poblacional y cruce con servicios públicos.
- Publica un **dashboard web público** con polígonos, descargas y metadatos.

## Para qué sirve

- **Defensa presupuestaria** con evidencia objetiva.
- **Priorización de intervenciones** del ministerio.
- **Comunicación pública** con datos abiertos y auditables.
- **Investigación urbana** y colaboración académica (UNaM, IPEC, CONICET).

## Requisitos

- **Python 3.11 o 3.12**.
- **GDAL** instalado en el sistema. En Windows usar OSGeo4W o conda; en Linux
  `sudo apt install gdal-bin libgdal-dev`.
- **ffmpeg** en PATH (para exportar timelapses MP4).
- **WeasyPrint** para generar PDFs. **En Windows recomendamos usar WSL2**
  porque WeasyPrint depende de GTK3 y GObject Introspection, que son un dolor
  en Windows nativo. En WSL2 alcanza con
  `sudo apt install python3-cffi python3-brotli libpango-1.0-0 libpangoft2-1.0-0`.
- **Cuenta de Google Cloud** con Earth Engine API habilitada.
- (Opcional, Fase 2) API key de Planet NICFI.

## Instalación paso a paso

```bash
# 1. Cloná el repo
git clone <url-del-repo>
cd observatorio

# 2. Creá el entorno virtual
python -m venv venv

# 3. Activalo
# En Linux / macOS / WSL:
source venv/bin/activate
# En Windows PowerShell:
.\venv\Scripts\Activate.ps1
# En Windows CMD:
venv\Scripts\activate.bat

# 4. Instalá las dependencias
pip install --upgrade pip
pip install -r requirements.txt

# Para desarrollo (tests, lint):
pip install -r requirements-dev.txt

# 5. Copiá el .env de ejemplo y completalo
cp .env.example .env
# editá .env y completá EE_PROJECT_ID con el ID de tu proyecto de Google Cloud
```

### Autenticación con Google Earth Engine

1. Creá un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. Habilitá la **Earth Engine API** en ese proyecto.
3. Registrate en [code.earthengine.google.com](https://code.earthengine.google.com/)
   y aceptá los términos de uso.
4. Autenticá desde la terminal:

   ```bash
   earthengine authenticate
   ```

   Te abre el navegador, pegás el token de vuelta y listo.

5. Abrí `.env` y seteá:

   ```bash
   EE_PROJECT_ID=tu-proyecto-gcp-aqui
   ```

6. Probá que todo esté ok:

   ```bash
   python scripts/test_ee_auth.py
   ```

Si falla, revisá que la cuenta esté aprobada en Earth Engine (puede tardar
5-10 minutos después de aceptar los términos).

## Uso

### Correr el pipeline completo

```bash
python scripts/99_pipeline_completo.py
```

Esto, para cada polígono definido en `config/poligonos.geojson`, hace:
descarga Sentinel-2 → descarga Open Buildings → inferencia de fechas →
conteo → timelapse → PDF.

Los outputs quedan en `data/outputs/`.

### Agregar un polígono nuevo

1. Abrí `config/poligonos.geojson` con cualquier editor (o con QGIS).
2. Agregá una nueva feature con las properties obligatorias:
   - `id` (slug kebab-case, único)
   - `nombre` (texto amigable)
   - `descripcion`
   - `categoria` (uno de:
     `asentamiento_crecimiento_rapido`, `consolidado_crecimiento`,
     `control_consolidado`, `zona_sensible`)
   - `prioridad` (1 = máxima, 5 = mínima)
   - `publicar_en_sitio` (bool)
   - `fecha_creacion_poligono` (YYYY-MM-DD)
   - `sensible` (bool, default false — ver `docs/politica_publicacion.md`)
3. Guardá y corré el pipeline. El sistema procesa solo los polígonos nuevos
   (los ya cacheados se saltean).

Alternativamente, podés dibujar el polígono en
[geojson.io](https://geojson.io/) y pegarlo en el archivo.

### Regenerar un solo PDF

```bash
python scripts/60_generar_pdf.py --poligono itaembe_mini
```

O regenerar todos:

```bash
python scripts/60_generar_pdf.py --all
```

### Regenerar un solo timelapse

```bash
python scripts/50_generar_timelapse.py --poligono el_brete --formato both
```

## Limitaciones conocidas

Este proyecto declara explícitamente sus limitaciones porque la honestidad
metodológica es más importante que la apariencia. Detalles completos en
[`METODOLOGIA.md`](METODOLOGIA.md).

- **Conteo de viviendas**: margen de error declarado **±15%**. Los outputs
  reportan rangos, nunca números puntuales.
- **Resolución Sentinel-2 10m**: puede confundir suelo desnudo recién desmontado
  con construcción. Se mitiga cruzando con Open Buildings.
- **Google Open Buildings es snapshot estático**: no trae fecha de aparición
  del edificio. La inferimos cruzando con series Sentinel-2 y aplicando regla
  de monotonicidad creciente. No es infalible.
- **Techo oscuro** (paja, materiales reciclados): puede no ser detectado.
  Casas muy pegadas se pueden detectar como una sola.
- **Cobertura nubosa**: Posadas promedia 50-60% anual. Usamos composite mediano
  de invierno seco (junio-agosto) para minimizar. Algunos años pueden tener
  gaps; se documentan y no se rellenan con datos inventados.
- **Población**: WorldPop 2020 subestima zonas de cambio rápido. Aplicamos
  corrección por conteo de edificios y, cuando disponemos, calibración
  CENSO 2022.

## Fuentes de datos

Todas gratuitas y con licencias abiertas. Detalle completo en
[`docs/fuentes_datos.md`](docs/fuentes_datos.md).

- **Sentinel-2** ESA Copernicus — https://sentinels.copernicus.eu/ — licencia Copernicus abierta.
- **Planet NICFI** — https://www.planet.com/nicfi/ — licencia NICFI (no comercial OK).
- **Google Open Buildings v3** — https://sites.research.google/gr/open-buildings/ — CC BY 4.0.
- **WorldPop** — https://www.worldpop.org/ — CC BY 4.0.
- **OpenStreetMap** — https://www.openstreetmap.org/ — ODbL 1.0.
- **Esri Wayback World Imagery** — https://livingatlas.arcgis.com/wayback/ — Esri ToS, con atribución.

## Licencia

- **Código**: [MIT](LICENSE).
- **Datos derivados** publicados por el observatorio: CC BY 4.0.
- Los datos de fuentes terceras mantienen su licencia original.

## Contacto

- Mail: `[completar]`
- Issues: usar GitHub Issues del repositorio.
- Política de publicación de polígonos sensibles: ver
  [`docs/politica_publicacion.md`](docs/politica_publicacion.md).
