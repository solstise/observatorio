# Preguntas frecuentes

## 1. ¿De dónde salen las imágenes?

De dos fuentes principales, ambas gratuitas y públicas:

- **Sentinel-2** del programa Copernicus de la Agencia Espacial Europea.
  Resolución 10 metros, revisita cada 5 días, desde 2015 en adelante.
- **Planet NICFI**, imágenes mensuales de 4,7 metros de resolución,
  disponibles desde septiembre de 2020 para uso no comercial.

Las procesamos en Google Earth Engine (Sentinel-2) y descargamos
directamente de Planet (NICFI). Toda la cadena está documentada en
`METODOLOGIA.md`.

## 2. ¿Por qué los números tienen un rango en lugar de ser exactos?

Porque toda medición indirecta tiene error. El nuestro es **±15%**,
calibrado a partir de validación con literatura académica y cruce con
Google Maps. Reportar rangos es más honesto y, paradójicamente, más
creíble: si decimos "entre 329 y 445 viviendas", estamos protegidos
ante el hallazgo de que eran 400; si decimos "387", quedamos expuestos
a cualquier recuento más fino.

## 3. ¿Puedo pedir un barrio nuevo?

Sí. Cualquiera puede proponer un polígono agregándolo a
`config/poligonos.geojson` con un pull request, o abriendo un issue en
GitHub con una descripción del barrio y por qué es relevante. Ver
`docs/poligonos_sugeridos.md` para la lista de candidatos ya
identificados y el criterio de selección.

## 4. ¿Cuánto sale esto?

**Costo cero.** Todas las fuentes de datos son gratuitas en su tier
libre:

- Sentinel-2: libre uso vía Google Earth Engine (free tier para
  proyectos no comerciales).
- Planet NICFI: gratis para ONGs, investigadores y gobiernos tras
  aprobación de formulario.
- Google Open Buildings, WorldPop, OSM: descarga libre.

El único costo asociado es el tiempo de cómputo local o el hosting del
sitio web, que también se resuelve con plan gratuito en Vercel o un
VPS económico.

## 5. ¿Cómo lo valido?

Tres caminos complementarios:

1. **Reproducibilidad**: clonás el repo, corrés
   `python scripts/99_pipeline_completo.py` y comparás tus outputs con
   los publicados. Deberían coincidir hasta el último dígito.
2. **Validación visual**: el notebook
   `notebooks/02_validacion_conteo.ipynb` muestra cada polígono con
   los edificios detectados, año por año. Podés cruzar contra Google
   Maps visualmente.
3. **Validación académica**: convenios en curso con UNaM para que la
   facultad valide independientemente la metodología.

## 6. ¿Qué pasa si hay nubes?

Las nubes son el enemigo natural de Sentinel-2. Dos estrategias:

- **Composite mediano**: para cada año, combinamos todas las imágenes
  de junio-julio-agosto (invierno seco, menos nubes) y para cada píxel
  tomamos el valor mediano. Eso "promedia" las nubes y deja un mosaico
  limpio.
- **Máscara de nubes por píxel**: usamos la banda QA60 de Sentinel-2
  para enmascarar píxeles nublados en cada escena antes del composite.

Si un año queda con menos de 3 escenas válidas, se documenta como
"año incompleto" y **no se reemplaza con datos inventados**. Aparecerá
un gap en el gráfico, que es lo correcto.

## 7. ¿Por qué no usan Google Maps directamente?

Porque Google Maps no provee **series temporales**. Es un snapshot del
presente. Para ver cómo era Itaembé Miní en 2018, necesitás imágenes
satelitales históricas, que Google Earth Pro y Esri Wayback tienen,
pero con términos de uso restrictivos que impiden redistribuir.

Sentinel-2 y Planet NICFI son abiertos, redistribuibles y están
pensados para análisis científico, no para navegar una ciudad.

## 8. ¿Tengo que ser técnico para leer los reportes?

**No.** Los reportes PDF están diseñados para ser entendidos por
cualquier persona: dos imágenes, un gráfico simple, una tabla con
rangos, una población estimada. Si sabés leer un diario, leés un
reporte del observatorio. Ver `docs/interpretacion_resultados.md`
para una guía extendida.

Si querés entrar al detalle técnico (cómo se calculan los números,
qué índices espectrales se usan, qué algoritmo infiere la fecha de
aparición), `METODOLOGIA.md` te explica todo.

## 9. ¿Los datos están disponibles?

**Sí, todo.** El repositorio es público:

- Código: licencia MIT.
- Datos derivados del observatorio: CC BY 4.0.
- Los datos de las fuentes originales (Sentinel-2, NICFI, Open
  Buildings, WorldPop, OSM) mantienen su licencia original y se
  referencian según corresponde.

Podés descargar los CSVs, los GeoJSONs y los PDFs directamente del
sitio web o del repositorio GitHub, sin registrarte.

## 10. ¿Puedo comparar Posadas con otra ciudad?

No todavía, pero está planeado para Fase 3. El sistema está diseñado
para ser ciudad-agnóstico: la única configuración específica de
Posadas son los polígonos en `config/poligonos.geojson`. Reemplazando
ese archivo por los polígonos de Oberá, Eldorado o Iguazú y ajustando
el nombre del proyecto, el pipeline corre igual.

Fase 3 incluye la extensión piloto a Oberá y, si funciona, a otras
ciudades de Misiones.

## 11. ¿Cómo se usa para defender presupuesto?

El observatorio convierte "intuición política" en "evidencia mostrable".
Si querés más plata para regularización dominial, podés llegar al
funcionario de Hacienda con el reporte PDF de Itaembé Miní, que
muestra crecimiento objetivo medido con metodología auditable. Ver
`CASOS_DE_USO.md` para ejemplos paso a paso.

## 12. ¿Y si alguien cuestiona la metodología?

Mejor todavía: los invitamos a auditar. La metodología está
documentada, el código es público, los datos son reproducibles. Si un
técnico del INDEC, un investigador del CONICET o un periodista quiere
revisar, todo está abierto. Preferimos crítica técnica sobre una
metodología honesta que aplausos sobre un número inventado.

## 13. ¿Cómo se actualiza el observatorio?

Hoy (Fase 1) manualmente, corriendo el pipeline cuando hay datos
nuevos. En Fase 2 automatizamos una corrida mensual el primer lunes
de cada mes con cron, que descarga las imágenes del mes anterior y
regenera todos los reportes y timelapses.

## 14. ¿Incluye datos personales?

**No.** El sistema solo reporta agregados por polígono (cuántas
viviendas hay, cuánta población estimada). Nunca se identifica un
edificio específico ni a sus habitantes. Esto cumple con la Ley
25.326 de Argentina y con el principio de mínima información que
guía el proyecto.

## 15. ¿Por qué un observatorio "urbano" y no "de vivienda" o "de pobreza"?

Porque lo que observamos es urbanización (cambios en la forma
construida de la ciudad). Vivienda, pobreza, NBI y otros indicadores
requieren encuestas, censos y estudios que exceden lo que se puede
inferir desde satélite. El observatorio provee **una capa de
evidencia geoespacial** que alimenta esos análisis, pero no los
reemplaza.
