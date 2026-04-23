# Cómo leer los resultados

Guía dirigida a destinatarios no técnicos (funcionarios, prensa,
ciudadanía). Si querés el detalle técnico completo, andá a
`METODOLOGIA.md`.

## Lo esencial en tres frases

1. El observatorio estima cuántas viviendas hay en cada barrio en cada
   año, a partir de imágenes satelitales públicas.
2. Todas las cifras tienen un **margen de error declarado de ±15%**. Por
   eso los reportes muestran **rangos** (ej. "350 - 450 viviendas"), no
   números exactos.
3. Si querés un dato puntual para repetir en una conferencia, usá el
   **valor central**. Si querés un dato para defender públicamente,
   citá el rango.

---

## ¿Qué significa el margen ±15%?

Significa que la cantidad real de viviendas está, con alta probabilidad,
dentro de ese rango. El valor central es la mejor estimación posible con
los datos disponibles.

**Ejemplo:** el reporte dice que Itaembé Miní tiene **387 viviendas (rango
329 - 445)**. Eso quiere decir:

- Lo más probable es que haya alrededor de 387.
- Pero no sería raro que alguien que vaya casa por casa encuentre 340 o
  440. Cualquiera de esos valores está "dentro de margen".
- Sí sería raro (y debería preocupar) que encuentren 200 o 600.

**Por qué reportamos rangos:**

- Porque **todos los sistemas de medición tienen error**, y ocultarlo es
  deshonesto.
- Porque **si un opositor encuentra 410** y nosotros dijimos 387, tenemos
  un problema. Si dijimos "329 - 445", no.
- Porque **la honestidad genera confianza** a largo plazo. La precisión
  falsa la destruye.

---

## Cómo leer el timelapse

El timelapse es la animación (GIF o MP4) que muestra el barrio cambiando
año a año, con el polígono dibujado en blanco y el conteo de viviendas
superpuesto.

**Qué buscar cuando lo mirás:**

- **Manchas marrones o grises que crecen** = construcciones nuevas. Si ves
  rápidamente que el barrio se vuelve "más marrón/gris", hay crecimiento
  rápido.
- **Verde persistente** = vegetación, lote sin construir.
- **Manchas que aparecen y desaparecen** = probablemente ruido por nubes
  o por diferencias de iluminación estacional. Por eso el sistema aplica
  la regla de monotonicidad (ver abajo).
- **Fade entre frames** = es una transición suave que el sistema agrega
  para que la animación no sea abrupta. No es cambio real.

**El contador de viviendas** en la esquina inferior izquierda te dice
cuántas viviendas estima el sistema que existían en esa fecha.
Siempre con banda de confianza.

---

## Cómo diferenciar crecimiento real de ruido

El sistema aplica varios filtros automáticos, pero es útil saber leer
con ojo crítico:

- **Si el conteo salta y vuelve** (ej. 100 → 150 → 90 → 180), algo anda
  mal. Probable causa: nubes, sombras, máscara imperfecta. El sistema
  fuerza **monotonicidad creciente** (una vez que un edificio aparece, se
  asume presente en años siguientes) para mitigar esto. Si igual ves
  saltos, reportá el caso.
- **Si el crecimiento es lineal y suave**, es probablemente real.
- **Si hay un salto grande de un año a otro** (ej. 100 → 400), validá
  visualmente en el notebook de validación, puede ser real (loteo masivo)
  o error.

---

## Cuándo el sistema puede **subestimar** (contar menos viviendas que la realidad)

- **Techos de paja o de material muy oscuro**: el algoritmo los confunde
  con sombra.
- **Casas muy adosadas**: pueden detectarse como un solo polígono grande.
- **Construcciones recientes**: si una casa se construyó después del
  snapshot de Google Open Buildings (mayo 2023), no figura. El sistema
  igual la detecta en Sentinel-2, pero con menor precisión.
- **Edificios de varios pisos**: cuentan como 1 edificio, aunque tengan
  10 familias adentro. Esto afecta la estimación de población, no del
  conteo de edificios.

---

## Cuándo el sistema puede **sobreestimar** (contar más viviendas que la realidad)

- **Galpones, tinglados, depósitos**: tienen firma espectral similar a un
  techo. El sistema aplica filtro por área (edificios entre 20 y 500 m²
  aproximadamente) pero algunos se cuelan.
- **Quintas con casa principal + galpón + cobertizo**: pueden contarse
  como 3 viviendas.
- **Suelo recién desmontado**: puede dar firma similar a construcción en
  Sentinel-2 (por eso cruzamos con Google Open Buildings, que solo
  detecta edificios reales, no suelo).
- **Estacionamientos pavimentados grandes**: en zonas comerciales, pueden
  generar falsos positivos si el polígono los incluye.

---

## Cómo usar los datos en una presentación pública

**Lenguaje recomendado:**

- ✅ "Itaembé Miní pasó de unas 14 viviendas en 2018 a entre 329 y 445 en
  2026, con una tasa de crecimiento anual compuesta cercana al 50%."
- ❌ "Itaembé Miní creció un 2,650% en ocho años" (técnicamente cierto
  pero suena a exageración; la base 14 es pequeña y el número se infla).

**Qué siempre acompañar:**

- La fecha exacta del reporte.
- La fuente ("imágenes satelitales Sentinel-2, edificios Google Open
  Buildings v3, procesamiento Observatorio Urbano Posadas").
- El rango de confianza.

**Qué nunca hacer:**

- No citar el valor central sin el rango.
- No comparar con otros observatorios usando metodologías distintas sin
  aclararlo.
- No presentar los datos como "verdad absoluta" — son estimaciones de
  buena fe con su incertidumbre declarada.

---

## ¿Qué hago si un dato no parece creíble?

1. Abrí el notebook `notebooks/02_validacion_conteo.ipynb` y buscá el
   polígono en cuestión.
2. Comparalo visualmente con Google Maps o con las imágenes aéreas
   municipales.
3. Si ves que el sistema está claramente errado, abrí un **issue** en el
   repositorio con el nombre del polígono, la fecha y una captura.
4. Mientras se investiga, **no uses ese dato en comunicación pública**.
   Mejor "estamos verificando" que un número incorrecto.
