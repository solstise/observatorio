# Casos de uso del Observatorio Urbano Posadas

Cinco casos concretos paso a paso. Cada uno con objetivo claro, archivos
involucrados, comandos sugeridos y una conclusión que resume el valor
generado.

---

## Caso 1: Defender presupuesto para regularización dominial

### Objetivo

El ministerio tiene un programa de regularización dominial (otorgamiento
de títulos de propiedad) con presupuesto en discusión en la Legislatura.
El opositor de turno cuestiona si "realmente hace falta". Hay que
mostrar evidencia objetiva del crecimiento de barrios donde la falta de
títulos es un problema real.

### Archivos que usa

- `config/poligonos.geojson` — define Itaembé Miní, Itaembé Guazú, El Brete.
- `data/processed/conteos/serie_temporal.csv` — serie temporal de
  viviendas por polígono.
- `data/outputs/pdfs/itaembe_mini.pdf` — reporte PDF con gráfico de
  crecimiento.
- `data/processed/timelapses/itaembe_mini.gif` — timelapse para
  presentación visual.

### Comandos sugeridos

```bash
# Asegurarse de que los datos estén actualizados
python scripts/99_pipeline_completo.py --poligonos itaembe_mini,itaembe_guazu

# Regenerar solo los PDFs relevantes
python scripts/60_generar_pdf.py --poligono itaembe_mini
python scripts/60_generar_pdf.py --poligono itaembe_guazu
```

### Conclusión

El reporte PDF muestra que Itaembé Miní pasó de ~14 viviendas (rango 12-16)
en julio 2018 a ~387 (rango 329-445) en julio 2026. Un crecimiento de
27× en ocho años, con tasa compuesta cercana al 50% anual. El gráfico
de línea con banda de confianza lo hace indiscutible visualmente. El
ministro entra a la comisión con un PDF en mano, lo presenta, y
argumenta: "el crecimiento existe, está medido, está público. El
programa no es un lujo, es una respuesta a una realidad documentable."
El opositor puede cuestionar el margen ±15%, pero no puede negar la
tendencia.

---

## Caso 2: Priorizar recorridas del funcionario

### Objetivo

El ministro tiene 3 sábados libres por mes para recorrer barrios. No
puede ir a todos. Quiere ir a los barrios donde su presencia tenga más
impacto político y donde la demanda social sea mayor. Los criterios
combinados (crecimiento + falta de servicios) son un proxy razonable.

### Archivos que usa

- `data/processed/conteos/serie_temporal.csv` — crecimiento por polígono.
- `data/processed/servicios_por_poligono.csv` — servicios cercanos (Fase 2).
- `data/outputs/ranking_prioridades.csv` — ranking compuesto (Fase 2).

### Comandos sugeridos

```bash
# Calcular tasa de crecimiento anualizada por polígono
python scripts/30_estimar_poblacion.py --output data/processed/ranking.csv

# Mostrar top 3
python -c "import pandas as pd; df = pd.read_csv('data/processed/ranking.csv'); print(df.sort_values('crecimiento_3a', ascending=False).head(3))"
```

### Conclusión

El observatorio devuelve, por ejemplo, que los 3 polígonos con mayor
crecimiento en los últimos 3 años son Itaembé Guazú (+145%), Chacra 181
(+89%) y Miguel Lanús (+67%), los tres con distancia al CAPS más cercano
superior a 1.200 m. El ministro visita esos tres sábados, registra la
visita con foto oficial, y el equipo de comunicación publica. La
decisión está fundada en datos: no fue arbitraria, no fue improvisada.

---

## Caso 3: Responder a un cuestionamiento opositor

### Objetivo

Un referente opositor publica en Twitter: "Posadas creció menos que
Resistencia en los últimos 5 años. Gestión fracasada." Hay que
responder con datos en 24 horas antes de que la narrativa se instale.

### Archivos que usa

- `data/processed/conteos/serie_temporal.csv` — datos de Posadas.
- `docs/fuentes_datos.md` — metodología comparable (para construir cifra
  de Resistencia con el mismo método).
- `METODOLOGIA.md` — para citar honestamente las limitaciones.

### Comandos sugeridos

```bash
# Si ya tenemos Resistencia como ciudad comparada (Fase 3)
python scripts/analisis/comparar_ciudades.py --ciudades posadas,resistencia --periodo 2020-2026

# Exportar tabla comparativa para prensa
python scripts/analisis/exportar_comparativa.py --output data/outputs/comparativa_resistencia.csv
```

### Conclusión

El reporte comparativo devuelve: Posadas creció de ~N viviendas a ~M
entre 2020 y 2026 (tasa X% anualizada). Resistencia, con la misma
metodología aplicada a sus polígonos equivalentes, creció tasa Y%. Si
X > Y, respuesta directa con datos. Si X < Y, contextualizar (porque
Posadas ya está más consolidada, el delta absoluto es distinto, etc.).
La respuesta al tuit es: "con datos del Observatorio Urbano Posadas,
metodología pública y reproducible: Posadas creció Z% en X barrios
analizados, mayoritariamente con vivienda social e IPRODHA. Link al
reporte." La pelota queda en la cancha del opositor para cuestionar la
metodología, lo cual es mucho más complicado que tuitear.

---

## Caso 4: Nota editorial mensual para prensa

### Objetivo

Cada primer lunes del mes, el observatorio publica una nota editorial
de ~500 palabras titulada "Posadas en cifras: [mes] [año]". Medios
locales la levantan, generando eco mediático sin costo.

### Archivos que usa

- `data/processed/conteos/serie_temporal.csv` — actualizado con el mes
  que cierra.
- `data/outputs/editorial/YYYY-MM.md` — draft generado automáticamente
  (Fase 3) y editado manualmente.
- `data/outputs/web/index.json` — metadata del sitio web para link del
  reporte completo.

### Comandos sugeridos

```bash
# Actualizar datos del último mes
python scripts/99_pipeline_completo.py --mes 2026-03

# Generar draft editorial con IA (Gemma local o Claude)
python scripts/editorial/generar_draft.py --mes 2026-03 --output data/outputs/editorial/2026-03.md

# Revisar, editar a mano, publicar en el sitio
```

### Conclusión

La nota, escrita en tono sobrio (sin adjetivos cargados tipo
"preocupante" o "alarmante"), reporta el dato más fuerte del mes
("Posadas creció N viviendas este marzo"), los 3 barrios con mayor
crecimiento del trimestre, y un foco del mes sobre uno de ellos.
Medios como *Misiones Online*, *El Territorio* y *Noticias del Seis*
levantan la nota porque tiene datos concretos y está bien escrita.
Costo del ciclo editorial: 2 horas al mes del equipo. Impacto: 3-5
notas periodísticas gratis.

---

## Caso 5: Coordinación con UNaM para trabajo final de grado

### Objetivo

Un estudiante de la licenciatura en Geografía de UNaM quiere hacer su
trabajo final sobre crecimiento urbano de Posadas. El observatorio
provee datos, el estudiante aporta validación académica. Todos ganan:
el estudiante se gradúa, la facultad gana convenio con proyecto público,
el observatorio gana validación académica independiente y eventual paper.

### Archivos que usa

- Todo el repositorio (abierto, MIT / CC BY 4.0).
- `METODOLOGIA.md` — base metodológica que el estudiante valida.
- `data/processed/` — datasets crudos para análisis.
- `notebooks/02_validacion_conteo.ipynb` — punto de partida para el
  estudiante.

### Comandos sugeridos

```bash
# Onboarding del estudiante
git clone <url-observatorio>
cd observatorio
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt

# El estudiante corre el pipeline completo para reproducir resultados
python scripts/99_pipeline_completo.py

# Luego abre el notebook de validación y diseña el suyo propio
jupyter notebook notebooks/02_validacion_conteo.ipynb
```

### Conclusión

El convenio informal (o formal) con UNaM produce: (a) un trabajo final
de grado defendido usando datos del observatorio, (b) una validación
académica externa de la metodología (publicable como technical note o
contribución en un congreso regional), (c) una pasantía que puede
convertirse en colaboración continua. El observatorio gana credibilidad
institucional: deja de ser "un proyecto de un ministerio" para ser
"un proyecto con aval académico". Esa credibilidad es clave cuando el
ministro cambia de cargo o cuando el observatorio se independiza del
gobierno. El proyecto sobrevive a los cambios políticos porque tiene
raíces académicas y comunitarias.
