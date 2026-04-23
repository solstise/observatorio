# Fuentes de datos

Tabla completa de fuentes utilizadas por el Observatorio Urbano Posadas,
sus licencias y cómo citarlas.

## Tabla principal

| Fuente | URL | Qué provee | Cobertura temporal | Resolución | Licencia | Cómo citar |
|--------|-----|------------|--------------------|------------|----------|------------|
| **Sentinel-2** (ESA Copernicus) | https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-2-msi | Imágenes ópticas multiespectrales (13 bandas) | 2015 - presente (S2A+S2B desde 2017) | 10 m (visible + NIR), 20 m (SWIR) | Copernicus Open Access | European Space Agency (2025). *Sentinel-2 MSI Level-2A Surface Reflectance*. ESA Copernicus Programme. Obtenido vía Google Earth Engine, colección `COPERNICUS/S2_SR_HARMONIZED`. |
| **Sentinel-1** (ESA Copernicus) | https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-1-sar | SAR (radar, traspasa nubes) | 2014 - presente | 10 m | Copernicus Open Access | European Space Agency (2025). *Sentinel-1 GRD*. ESA Copernicus Programme. |
| **Planet NICFI** | https://www.planet.com/nicfi/ | Mosaicos ópticos mensuales tropicales | Septiembre 2020 - presente | 4.7 m | NICFI (no comercial OK, comercial restringido) | Planet Labs PBC (2025). *Planet NICFI Monthly Mosaics for Tropical Forest Monitoring*. Obtenido bajo el programa NICFI. |
| **Google Open Buildings v3** | https://sites.research.google/gr/open-buildings/ | Polígonos de edificios + área + confianza | Snapshot mayo 2023 | Edificio individual | CC BY 4.0 | Sirko, W., Kashubin, S., Ritter, M., Annkah, A., Bouchareb, Y. S. E., Dauphin, Y., ... & Quinn, J. (2021). *Continental-scale building detection from high resolution satellite imagery*. arXiv preprint arXiv:2107.12283. |
| **Microsoft Building Footprints** | https://github.com/microsoft/GlobalMLBuildingFootprints | Polígonos de edificios globales | Snapshot 2023 | Edificio individual | ODbL | Microsoft (2023). *Global ML Building Footprints*. GitHub Repository. |
| **WorldPop** | https://www.worldpop.org/ | Grilla de población estimada | 2000 - 2020 | 100 m | CC BY 4.0 | Tatem, A. J. (2017). *WorldPop, open data for spatial demography*. Scientific Data, 4(1), 170004. https://doi.org/10.1038/sdata.2017.4 |
| **OpenStreetMap (OSM)** | https://www.openstreetmap.org/ | Calles, edificios, POIs, servicios | Continuo | Vector | ODbL 1.0 | OpenStreetMap contributors (2026). *Planet dump retrieved from https://planet.osm.org*. https://www.openstreetmap.org |
| **HOT OSM Tasking Manager** | https://tasks.hotosm.org/ | Datos OSM humanitarios curados | Continuo | Vector | ODbL 1.0 | Humanitarian OpenStreetMap Team (2026). *HOT Tasking Manager Data*. https://hotosm.org |
| **Esri Wayback World Imagery** | https://livingatlas.arcgis.com/wayback/ | Imágenes aéreas históricas | 2014 - presente | Submétrica | Esri ToS (atribución obligatoria) | Esri (2026). *World Imagery Wayback*. ArcGIS Living Atlas. https://livingatlas.arcgis.com/wayback/ |
| **GADM** | https://gadm.org/ | Límites administrativos | Actualizaciones periódicas | Vector | Uso académico/no comercial libre | Global Administrative Areas (2024). *GADM database of Global Administrative Areas, version 4.1*. https://gadm.org |
| **INDEC Censo 2022** | https://www.indec.gob.ar/indec/web/Nivel4-Tema-2-41-165 | Población a nivel radio censal | 2022 | Radio censal | Uso público con atribución (Ley 17.622) | Instituto Nacional de Estadística y Censos de la República Argentina (2023). *Censo Nacional de Población, Hogares y Viviendas 2022*. INDEC. |

## Capas municipales Posadas

| Capa | URL | Estado | Licencia | Nota |
|------|-----|--------|----------|------|
| IDE Posadas (Nodo IDR) | https://posadas.gov.ar/idr | Por verificar disponibilidad de API pública | Variable por capa | Relevamiento pendiente: catastro, red cloacal, red de agua, pavimentado. |
| Catastro provincial Misiones | https://gobierno.misiones.gob.ar/ | Por verificar | OGL Argentina (esperado) | Confirmar vigencia del portal de datos abiertos. |
| IPEC Misiones (radios censales) | https://ipecmisiones.org/ | Publicación post-Censo 2022 | Uso público con atribución | Clave para calibrar WorldPop. |

## Librerías de software usadas

Todas MIT, BSD, Apache 2.0 o LGPL — compatibles con la distribución MIT
del observatorio.

| Librería | Uso | Licencia |
|----------|-----|----------|
| `earthengine-api` | Cliente Python de Google Earth Engine | Apache 2.0 |
| `geopandas` | Manipulación de GeoDataFrames | BSD 3-Clause |
| `rasterio` | Lectura y escritura de GeoTIFF | BSD 3-Clause |
| `shapely` | Geometría 2D | BSD 3-Clause |
| `pyproj` | Reproyecciones CRS | MIT |
| `Pillow` | Manipulación de imágenes | HPND |
| `imageio-ffmpeg` | Exportación MP4 | BSD 2-Clause |
| `weasyprint` | PDF desde HTML | BSD 3-Clause |
| `jinja2` | Templating | BSD 3-Clause |
| `loguru` | Logging | MIT |

## Atribuciones obligatorias en publicaciones

Cada reporte PDF y el dashboard web muestran el siguiente bloque de
atribuciones:

> Imágenes satelitales: Contains modified Copernicus Sentinel data (2018-2026).
> Imagery © Planet Labs PBC, proporcionada bajo el programa NICFI.
> Edificios: Google Open Buildings v3 (CC BY 4.0).
> Población: WorldPop (CC BY 4.0).
> Datos vectoriales: © OpenStreetMap contributors (ODbL).
> Datos censales: INDEC — Censo Nacional 2022.
