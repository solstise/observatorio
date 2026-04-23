# Lecturas recomendadas

Referencias técnicas y metodológicas que informan el diseño del
Observatorio Urbano Posadas. Útiles para quien quiera profundizar en
las decisiones de metodología o validar el trabajo académicamente.

## Detección de edificios desde satélite

**Sirko, W. et al. (2021)**. *Continental-scale building detection from
high resolution satellite imagery*. arXiv preprint arXiv:2107.12283.
https://arxiv.org/abs/2107.12283
— Paper técnico detrás de Google Open Buildings. Explica la arquitectura
del modelo, el dataset de entrenamiento y las métricas de validación.
Lectura obligada para entender las fortalezas y limitaciones del dataset
que usamos como base.

**Google Research (2023)**. *Mapping Africa's Buildings with Satellite
Imagery*. Google AI Blog.
https://blog.research.google/2021/07/mapping-africas-buildings-with.html
— Post de blog que describe la motivación y metodología de Open Buildings
en un lenguaje accesible. Buena introducción antes del paper académico.

## Cruce entre built-up y población

**Sirko, W., Brempong, E. A., & Marcus, J. T. (2023)**. *High-Resolution
Building and Road Detection from Sentinel-2*. arXiv:2310.11622.
https://arxiv.org/abs/2310.11622
— Versión reciente extendiendo Open Buildings con Sentinel-2. Relevante
porque describe cómo combinar imágenes medias-resolución con detección
de edificios.

**Leyk, S. et al. (2019)**. *The spatial allocation of population: a
review of large-scale gridded population data products and their
fitness for use*. Earth System Science Data, 11(3).
https://doi.org/10.5194/essd-11-1385-2019
— Review comparativo de WorldPop, GHS-POP, LandScan. Útil para
fundamentar por qué elegimos WorldPop y sus limitaciones en zonas de
cambio rápido.

## WorldPop y demografía espacial

**Tatem, A. J. (2017)**. *WorldPop, open data for spatial demography*.
Scientific Data, 4(1), 170004.
https://doi.org/10.1038/sdata.2017.4
— Paper fundacional de WorldPop. Describe metodología, dataset de
entrada, validación y limitaciones. Obligado antes de usar WorldPop en
cualquier estudio serio.

## Sentinel-2 y corrección atmosférica

**Main-Knorn, M. et al. (2017)**. *Sen2Cor for Sentinel-2*. Proceedings
of SPIE, 10427.
https://doi.org/10.1117/12.2278218
— Paper de Sen2Cor, el algoritmo de corrección atmosférica usado para
generar los productos Sentinel-2 SR (Surface Reflectance). Explicar por
qué usamos S2_SR_HARMONIZED y no top-of-atmosphere.

**Zhu, Z. & Woodcock, C. E. (2012)**. *Object-based cloud and cloud
shadow detection in Landsat imagery*. Remote Sensing of Environment,
118, 83-94.
https://doi.org/10.1016/j.rse.2011.10.028
— Paper clásico sobre detección de nubes. Aunque es sobre Landsat, los
principios se trasladan a Sentinel-2 y justifican nuestro uso de QA60 +
composite mediano.

## Detección de cambios urbanos

**Florczyk, A. J. et al. (2019)**. *GHSL data package 2019*. Publications
Office of the European Union, JRC117104.
https://publications.jrc.ec.europa.eu/repository/handle/JRC117104
— Documentación del Global Human Settlement Layer. Referencia
comparativa para validar nuestro approach con uno institucional.

**da Silva, C. F. et al. (2021)**. *Urban growth mapping using Sentinel-2
time series in São Paulo, Brazil*. Remote Sensing, 13(14), 2721.
https://doi.org/10.3390/rs13142721
— Caso de estudio LATAM metodológicamente muy cercano al nuestro.
Usan Sentinel-2 y series temporales para mapear crecimiento urbano en
São Paulo. Benchmark directo para comparar resultados.

## Honestidad estadística y comunicación de incertidumbre

**Spiegelhalter, D. et al. (2011)**. *Visualizing uncertainty about the
future*. Science, 333(6048), 1393-1400.
https://doi.org/10.1126/science.1191181
— Paper general sobre cómo visualizar incertidumbre de forma efectiva.
Inspira nuestra elección de reportar siempre bandas de confianza en los
gráficos.

**Wasserstein, R. L. & Lazar, N. A. (2016)**. *The ASA Statement on
p-Values: Context, Process, and Purpose*. The American Statistician,
70(2), 129-133.
https://doi.org/10.1080/00031305.2016.1154108
— No es directamente sobre nuestro dominio, pero el espíritu (no
esconder la incertidumbre) guía nuestro enfoque.

## Catastro y datos urbanos en Argentina

**INDEC (2023)**. *Censo Nacional de Población, Hogares y Viviendas 2022.
Aspectos metodológicos*. Instituto Nacional de Estadística y Censos.
https://www.indec.gob.ar/
— Documentación oficial del último censo. Necesaria para entender cómo
se alinean los radios censales con los polígonos del observatorio.

**Aseff, L. & Kozak, D. (2018)**. *Informalidad urbana en Argentina:
patrones, dinámica y políticas*. Informe Banco Mundial.
— Marco conceptual sobre crecimiento informal en ciudades argentinas,
útil para la interpretación editorial de los datos del observatorio.

## OSM y datos comunitarios

**Arsanjani, J. J. et al. (2015)**. *OpenStreetMap in GIScience:
Experiences, Research, and Applications*. Springer.
— Compilado sobre uso de OSM en ciencia geoespacial. Fundamenta el uso
de Overpass API para capas de servicios públicos.

## Licencias abiertas

**Open Data Commons (2024)**. *Open Database License (ODbL) v1.0*.
https://opendatacommons.org/licenses/odbl/1-0/
— Licencia de OSM. Hay que leerla al menos una vez si se redistribuyen
derivados.

**Creative Commons (2024)**. *Attribution 4.0 International (CC BY 4.0)*.
https://creativecommons.org/licenses/by/4.0/
— Licencia de Open Buildings, WorldPop y los datos derivados del
observatorio.
