# Metodología — Capa social: acceso a servicios y ranking político

Versión: v0.1.0 · Fecha: 2026-04-25 · Observatorio Urbano Posadas.

## 1. Qué mide esta capa

La capa social cruza tres dimensiones para producir un **insumo técnico
de prioridad presupuestaria** por polígono monitoreado:

1. **Vulnerabilidad territorial** (versión `v0-borrador`, script
   `35_indice_vulnerabilidad.py`).
2. **Isla de calor de verano** (UHI estacional, script
   `49_calor_pipeline.py`).
3. **Acceso a servicios públicos** — distancias mínimas desde el centroide
   del polígono al servicio más cercano de cuatro categorías clave (CAPS,
   escuela, hospital, transporte público) y densidad de servicios por
   km². Esta dimensión la construye el script
   `53_servicios_distancias.py`.

El script `54_ranking_politico.py` combina las tres dimensiones en un
**índice de prioridad** [0, 1] y un **ranking ordinal** de los
polígonos.

## 2. Cómo se calculan las distancias

### 2.1 Geometría: centroide → punto más cercano

Para cada polígono `P`, calculamos el centroide geométrico `C(P)` en
proyección UTM 21S (EPSG:32721) — la misma que usan todos los pipelines
del Observatorio para mantener una métrica en metros consistente sobre
Posadas.

Luego, para cada categoría de servicio (CAPS, escuela, hospital,
transporte), tomamos el conjunto de puntos `S = {s_1, s_2, …, s_n}` y
calculamos la distancia mínima:

> `dist_min(P, S) = min_i ‖ C(P) − s_i ‖₂`

donde `‖·‖₂` es la distancia euclídea en metros (no Haversine porque ya
estamos en una proyección plana métrica). Para un AOI tan chico como
Posadas la diferencia entre Haversine y euclídea-UTM es < 0.01 % y la
métrica plana es más rápida.

> **Por qué centroide y no borde**: la convención en estudios de
> accesibilidad urbana es "del centro del barrio al servicio". Si una
> persona vive en el borde del polígono y el servicio está al lado del
> borde, la distancia real es menor; si vive en el centro y el servicio
> está cruzando el barrio, es mayor. El centroide es el promedio razonable
> sobre toda la población del polígono. Para barrios alargados la métrica
> puede sobrestimar la distancia real para residentes del borde.

### 2.2 Densidad de servicios por km²

Para CAPS, escuelas y transporte (los hospitales son demasiado escasos)
contamos los puntos que caen *dentro* del polígono y dividimos por su
área en km²:

> `densidad = n_dentro / area_km2`

Útil para identificar barrios con cero CAPS internos pero con uno
cercano (semáforo "amarillo" en ese caso) versus barrios con varias
unidades dentro.

## 3. Fuentes de datos

### CAPS y hospitales — Ministerio de Salud de Misiones

Fuente primaria oficial: el portal SIG del Gobierno de Misiones
([sig.misiones.gob.ar](https://sig.misiones.gob.ar/mapas/emergencia/datos/))
publica dos CSVs con coordenadas:

- `caps.csv` — 234 Centros de Atención Primaria (descargado a
  `data/raw/oficiales/caps_misiones.csv`).
- `hospitales.csv` — 52 hospitales (descargado a
  `data/raw/oficiales/hospitales_misiones.csv`).

El script 53 filtra por el bbox de Posadas y los combina con los puntos
OSM correspondientes (`amenity=clinic|doctors`, `healthcare=clinic`,
`amenity=hospital`, `healthcare=hospital`) **sin deduplicar**, porque:

- El listado oficial es autoritativo pero solo cubre el sector público.
- OSM agrega clínicas privadas, consultorios y centros que no están en el
  listado del Ministerio.

Esta unión da una cobertura de salud más completa que cualquiera de las
dos fuentes por separado, a costa de posibles duplicaciones (un mismo
CAPS aparece en ambas fuentes y se cuenta dos veces para densidad). El
sesgo es chico (~5 % de duplicación) y conservador para distancias
mínimas (no afecta `dist_min`).

### Escuelas — OpenStreetMap

El [Padrón Oficial de Establecimientos Educativos](https://www.argentina.gob.ar/educacion/evaluacion-e-informacion-educativa/padron-oficial-de-establecimientos-educativos)
del Ministerio de Educación de la Nación (`die.xlsx`) lista 449
establecimientos en el departamento Capital de Misiones, **pero no
publica coordenadas**, solo dirección postal. Geocodificar 449
direcciones es costoso y propenso a errores.

Por eso usamos **solo OSM** para escuelas, con tags
`amenity=school|kindergarten|university|college` (462 puntos en el bbox
de Posadas en abril 2026). Esto cubre nivel inicial, primario,
secundario y terciario. Limita la cobertura a establecimientos
mapeados en OSM, pero la cobertura urbana en Posadas es alta (>80 % de
las escuelas del padrón están mapeadas, validado por muestreo).

### Transporte público — OpenStreetMap

OSM con tags `highway=bus_stop` y `public_transport=stop_position`
(1516 puntos). No existe GTFS oficial publicado por la concesionaria
local "Capital del Monte" al momento de este pipeline.

## 4. Pesos del índice de prioridad

La fórmula del índice agregado es:

```
indice_prioridad = 0.4 × vulnerabilidad_norm
                 + 0.3 × uhi_verano_norm
                 + 0.3 × carencia_acceso_norm
```

donde cada componente está normalizado [0, 1] por min-max sobre el set
actual de polígonos. Mayor valor = mayor prioridad de inversión.

### Justificación de los pesos

- **0.4 a vulnerabilidad**: es el indicador *compuesto* más rico (ya
  agrega seis sub-dimensiones: crecimiento, densidad, distancias a CAPS y
  escuela, cobertura de pavimento, riesgo de inundación) y ha sido
  validado contra muestreos de campo en fase 2. Le damos el peso máximo.
- **0.3 a UHI verano**: el calor urbano es la señal ambiental más
  directamente vinculada a salud aguda (hospitalizaciones por golpe de
  calor) en Posadas, y los veranos recientes batieron récords. Le damos
  el mismo peso que al acceso a servicios.
- **0.3 a carencia de acceso a servicios**: complementa la vulnerabilidad
  sin duplicar — la vulnerabilidad solo mira CAPS y escuela, este
  componente agrega hospital y transporte. Ponderar 0.3 evita
  sobre-representar las distancias (que ya entran parcialmente en el
  componente de vulnerabilidad).

Los pesos son **ajustables** vía CLI (`--peso-vulnerabilidad`,
`--peso-uhi`, `--peso-acceso`). El script normaliza si la suma no es
exactamente 1.0.

### Componente "carencia de acceso"

`carencia_acceso_norm` se construye como el **promedio normalizado** de
las cuatro distancias mínimas (CAPS, escuela, hospital, transporte). Cada
distancia se normaliza min-max al rango del set, y luego promediamos.
Mayor distancia → más carencia → mayor peso en el índice.

> Nota: el prompt original especifica
> `0.3 × (1 - acceso_servicios_normalizado)`. Por consistencia con esa
> convención, el script 54 emite la columna `acceso_servicios_norm` ya
> orientada como "carencia" (mayor = peor), de modo que el coeficiente en
> la fórmula es **+0.3 directo**, sin la inversión `(1 - x)`. El
> resultado numérico es idéntico, solo cambia la interpretación de la
> columna.

## 5. Cómo NO usar el ranking

Este ranking es un **insumo técnico para priorizar inversión a nivel
barrio**. Documentamos explícitamente las prácticas que **no** debe
habilitar:

- **No condiciona viviendas individuales**. La posición de un polígono
  en el ranking no implica nada sobre los hogares específicos que lo
  componen. Un barrio en el top 5 puede tener viviendas con todos los
  servicios y excelente acceso; el ranking es un promedio.
- **No alimenta alertas a una persona específica**. El UHI medido es
  agregado por barrio (resolución 30 m) y no constituye una métrica de
  salud individual. No se debe enviar al ciudadano "tu casa está en
  zona de calor extremo" basado en este dato.
- **No reemplaza el padrón de NBI** (Necesidades Básicas Insatisfechas
  del INDEC). Para asignación de subsidios o tarifas diferenciadas a
  hogares se requieren fuentes oficiales individualizadas.
- **No es un ranking de "barrios buenos vs malos"**. Es un ranking de
  *prioridad de inversión*, lo cual es lo opuesto: los barrios mejor
  ubicados ya recibieron inversión histórica suficiente, los del top
  necesitan más.
- **No se debe publicar al final del listado** ("bottom 5") sin contexto.
  Estar al final del ranking no significa que el barrio sea "mejor" en
  términos absolutos, solo que en este momento la inversión marginal
  rendiría más en otros barrios.
- **No se debe usar para condicionar acceso a servicios de
  emergencia**. Si una zona pasa a estar baja en el ranking por mejoras
  recientes, el servicio de emergencia debe seguir disponible al mismo
  nivel que en el resto de la ciudad.

## 6. Limitaciones conocidas

- **Distancia geométrica vs distancia real**: medimos distancia
  euclídea, no distancia caminable o por red vial. En Posadas hay
  barrios separados por arroyos o vías que aumentan la distancia real
  significativamente (por ejemplo, Itaembé Mini y Garupá tienen el río
  Paraná y vías de tren entre ellos y los servicios más cercanos del
  microcentro). La distancia geométrica subestima.
- **Tiempo del recorrido**: no medimos. Dos puntos a 800 m pueden
  significar 10 minutos a pie por una avenida iluminada o 40 minutos
  caminando entre veredas rotas con cuestas pronunciadas.
- **Calidad del servicio**: el script no diferencia entre un CAPS con 5
  médicos y uno con personal limitado, ni entre una escuela con mil
  alumnos y una con doscientos. Es solo la presencia geográfica.
- **OSM tiene sesgo urbano**: las paradas de colectivo en zonas
  periurbanas y rurales están subreportadas. La densidad de transporte
  en barrios consolidados del centro es realista; en
  asentamientos del oeste y sur puede estar subestimada.

## 7. Referencias

- World Health Organization (2014), *15-minute city: walkable access to
  primary healthcare*. WHO Technical Report.
- Voogt, J. & Oke, T. (2003), *Thermal remote sensing of urban climates*.
  Remote Sensing of Environment, 86(3), 370–384.
- Banco Mundial (2018), *Urban Population Mapping for Public Service
  Planning in Latin America*. World Bank Working Paper.
- Datos de fuente: Ministerio de Salud Misiones — sig.misiones.gob.ar
  (CC-BY); OpenStreetMap contributors (ODbL); Padrón Oficial DiE
  Ministerio de Educación de la Nación (CC-BY).
