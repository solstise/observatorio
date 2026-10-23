export const dynamic = 'force-dynamic';
// Página de metodología.
// Documenta de manera accesible las fuentes, procesamiento y límites del
// observatorio. Cada fuente describe primero qué aporta al análisis y luego
// la referencia técnica para los lectores académicos.

import type { Metadata } from "next";
import Link from "next/link";

import { DataFreshness } from "@/components/DataFreshness";
import { GlosarioCompleto } from "@/components/GlosarioCompleto";
import {
  DATASET_INFO,
  getManyFreshness,
  listDatasets,
} from "@/lib/data-freshness";

export const metadata: Metadata = {
  title: "Metodología",
  description:
    "Metodología del Observatorio Urbano Posadas: qué muestran las capas, cómo se construyen las cifras, márgenes de error y reproducibilidad.",
  alternates: { canonical: "/datos/metodologia" },
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://sateliteposadas.com";

// JSON-LD Article: schema markup específico de esta página.
// Permite a Google mostrar rich results de tipo "guía técnica".
const ARTICLE_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: "Metodología del Observatorio Urbano Posadas",
  description:
    "Cómo se construyen las cifras: capas satelitales, procesamiento, márgenes de error y reproducibilidad.",
  url: `${SITE_URL}/datos/metodologia`,
  inLanguage: "es-AR",
  isAccessibleForFree: true,
  license: "https://creativecommons.org/licenses/by/4.0/",
  publisher: {
    "@type": "Organization",
    name: "Observatorio Urbano Posadas",
    url: SITE_URL,
  },
  about: [
    "Sentinel-2",
    "Sentinel-1",
    "Landsat",
    "MODIS",
    "Open Buildings",
    "WorldPop",
    "calor urbano",
    "expansión urbana",
  ],
});

interface FuenteEntry {
  nombre: string;
  queHace: string;
  datos: string;
}

// Cada fuente sigue el patrón "qué hace para Posadas" + "Datos: tech".
// Mantenemos la referencia técnica para uso académico/financiación.
const FUENTES: FuenteEntry[] = [
  {
    nombre: "Sentinel-2 (ESA)",
    queHace:
      "Detecta cambios en cobertura del suelo y vegetación entre años. Es la imagen óptica de mayor calidad pública para América Latina.",
    datos: "ESA Copernicus, multiespectral, 10 m de resolución, 2018–2026.",
  },
  {
    nombre: "Sentinel-1 (ESA)",
    queHace:
      "Detecta nuevas construcciones aún cuando hay nubes — el radar atraviesa la cobertura nubosa, ideal para Posadas (clima subtropical húmedo).",
    datos: "ESA Copernicus, radar SAR GRD, polarización VV.",
  },
  {
    nombre: "Sentinel-5P TROPOMI (ESA)",
    queHace:
      "Mide la calidad del aire — detecta dióxido de nitrógeno (NO₂), principal contaminante del tránsito vehicular y combustión.",
    datos: "ESA Copernicus, NO₂ troposférico, 7 km de resolución.",
  },
  {
    nombre: "Landsat 8/9 (USGS)",
    queHace:
      "Mide qué tan caliente está cada barrio comparado con el campo — identifica las zonas donde faltan árboles y sobra cemento.",
    datos: "USGS Collection 2 Level 2, banda térmica ST_B10, 30 m, mensual.",
  },
  {
    nombre: "MODIS LST (NASA)",
    queHace:
      "Captura el calor nocturno que sufren los barrios densos cuando el cemento libera el calor del día. Complementa Landsat con la lectura de noche.",
    datos: "NASA MOD11A2, día/noche, 1 km, 8-daily, histórico desde 2000.",
  },
  {
    nombre: "Dynamic World V1 (Google)",
    queHace:
      "Identifica el tipo de superficie de cada barrio: cuánto es construcción, cuánto verde, cuánto desnudo, cuánto agua.",
    datos: "Google + WRI, IA sobre Sentinel-2, 9 clases, 10 m.",
  },
  {
    nombre: "VIIRS Nightlights (NOAA)",
    queHace:
      "Mide la actividad económica nocturna — donde hay más luces hay más comercios, servicios y actividad.",
    datos: "NOAA VIIRS DNB, radiancia mensual, ~500 m.",
  },
  {
    nombre: "CHIRPS (USGS)",
    queHace:
      "Cuánta lluvia recibió el barrio cada mes — clave para entender riesgo de inundaciones y patrones de sequía.",
    datos: "USGS Climate Hazards InfraRed, mensual, 5 km.",
  },
  {
    nombre: "FIRMS (NASA)",
    queHace:
      "Alerta de incendios y quemas detectados desde el espacio en los últimos años. Cualquier valor positivo en zona urbana es señal de inspección.",
    datos: "NASA FIRMS (VIIRS / MODIS), focos diarios.",
  },
  {
    nombre: "WDPA (UNEP-WCMC / IUCN)",
    queHace:
      "Identifica si un barrio se solapa con un área protegida legalmente — crítico para política ambiental.",
    datos: "World Database on Protected Areas, IUCN.",
  },
  {
    nombre: "MapBiomas Argentina Col.1",
    queHace:
      "Cómo cambió el uso del suelo desde el año 2000 — selva → urbano, pasturas → cultivos, agua, etc.",
    datos: "MapBiomas Argentina Col.1, 30 m, anual 1998–2022.",
  },
  {
    nombre: "GHSL P2023A (Comisión Europea)",
    queHace:
      "Cuánto creció la huella urbana entre décadas — décadas de referencia: 1975, 1990, 2000, 2015 y 2020.",
    datos: "Global Human Settlement Layer, JRC, 100 m, 1975–2030.",
  },
  {
    nombre: "Google Open Buildings + MS Building Footprints",
    queHace:
      "Cuántas viviendas y edificios hay efectivamente en el barrio. Es nuestra fuente principal de conteo de viviendas para la serie temporal.",
    datos:
      "Google Open Buildings + Microsoft Building Footprints (mergeados, 217k features en bbox Posadas).",
  },
  {
    nombre: "WorldPop",
    queHace:
      "Estimación modelada de cuánta gente vive en cada zona — útil para identificar barrios densamente poblados sin acceso pleno a servicios.",
    datos: "WorldPop, grilla de población, 100 m, anual.",
  },
  {
    nombre: "OpenStreetMap",
    queHace:
      "Aporta la red vial, equipamientos y nombres de calles para contextualizar geográficamente los polígonos.",
    datos: "OpenStreetMap contributors, ODbL.",
  },
];

export default async function MetodologiaPage() {
  // Resolvemos frescura de TODOS los datasets registrados para alimentar
  // la sección "Frescura de datos". Una sola ronda I/O en paralelo —
  // build cache la maneja con `revalidate=0`/`force-dynamic` si quisiera
  // actualizarse en cada visit, pero por defecto el build estático ya
  // sirve para una página de meta-documentación.
  const slugs = listDatasets();
  const freshness = await getManyFreshness(slugs);

  return (
    <article className="container-obs py-10">
      {/* JSON-LD inline para que Google indexe la página como TechArticle. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ARTICLE_LD }}
      />
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
        Metodología
      </p>
      <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
        Cómo construimos las cifras
      </h1>
      <p className="mt-3 lead text-neutral-text max-w-3xl dark:text-dk-text">
        Cada cifra del observatorio surge de combinar múltiples capas
        satelitales públicas, validarlas contra fuentes oficiales y publicar
        bandas de incertidumbre cuando corresponde. Esta página explica qué
        aporta cada capa, cómo se procesan y qué limitaciones declaramos.
      </p>

      <section aria-labelledby="capas" className="mt-10">
        <h2
          id="capas"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Qué muestra cada capa
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Listamos primero el aporte de cada capa al análisis urbano y luego la
          referencia técnica del dataset. La intención es que tanto un
          tomador de decisiones como un revisor académico encuentren la
          información que necesitan.
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {FUENTES.map((f) => (
            <li
              key={f.nombre}
              className="card transition-shadow hover:shadow-md focus-within:shadow-md"
            >
              <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
                {f.nombre}
              </h3>
              <p className="mt-1.5 text-sm text-neutral-text dark:text-dk-text">
                {f.queHace}
              </p>
              <p className="mt-2 text-xs italic text-neutral-muted dark:text-dk-muted">
                Datos: {f.datos}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="procesamiento" className="mt-12 space-y-3">
        <h2
          id="procesamiento"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Cómo se procesan
        </h2>
        <p className="max-w-3xl text-neutral-text dark:text-dk-text">
          Los datos crudos se descargan mediante <code>scripts/</code> del
          repositorio. Para cada barrio se recorta la imagen satelital, se
          calculan agregados (superficies, conteos, porcentajes) y se emiten a{" "}
          <code>data/outputs/</code>. El frontend consume esos archivos
          directamente o vía la API FastAPI. Toda la cadena es
          determinística: la misma entrada produce la misma salida.
        </p>
      </section>

      <section aria-labelledby="margen" className="mt-12 space-y-3">
        <h2
          id="margen"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Margen de error declarado
        </h2>
        <p className="max-w-3xl text-neutral-text dark:text-dk-text">
          Cada serie temporal publica una banda de confianza{" "}
          (<code>confianza_inferior</code>, <code>confianza_superior</code>)
          que refleja la incertidumbre combinada de la clasificación
          Sentinel-2 y la detección de footprints. Las estimaciones de
          población heredan el error del modelo WorldPop y suelen estar
          subestimadas en zonas de expansión reciente. Los meses con menos de
          dos escenas Landsat útiles se declaran sin dato — no se interpolan.
        </p>
        <p className="max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Donde es posible, validamos los indicadores comparándolos contra
          un sensor independiente. La{" "}
          <Link
            href="/datos/validacion"
            className="text-primary underline dark:text-dk-primary"
          >
            validación cruzada NDBI/NDVI
          </Link>{" "}
          (Sentinel-2 vs CBERS-4A) cuantifica cuánto coinciden ambos
          satélites por barrio: cuando dos sensores distintos llegan al
          mismo número, la confianza del indicador sube; cuando difieren
          mucho, hay que investigar antes de tomarlo como verdad.
        </p>
      </section>

      <section aria-labelledby="limites" className="mt-12 space-y-3">
        <h2
          id="limites"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Para qué NO sirve
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-neutral-text dark:text-dk-text">
          <li>
            Para alertas individuales de salud o decisiones inmobiliarias
            automáticas. Los datos son agregados por polígono.
          </li>
          <li>
            Como reemplazo de un censo oficial — la población se modela a
            partir de WorldPop, no de relevamiento puerta a puerta.
          </li>
          <li>
            Como límite administrativo — los polígonos son delineados ad hoc
            para facilitar el análisis y no coinciden con barrios oficiales.
          </li>
          <li>
            Para identificar lotes o personas — la resolución mínima es 10 m
            (Sentinel-2) y los datos son siempre agregados.
          </li>
        </ul>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────
          METODOLOGÍAS POR CAPA TEMÁTICA
          Cada una de las 3 capas nuevas (tipología, riesgos, calidad de vida)
          merece su propia explicación: qué fórmula usamos, qué fuentes cruzamos
          y — sobre todo — qué limitaciones honestas tiene el dato. La idea es
          que un lector técnico pueda reproducir y un lector general entienda
          dónde NO confiar a ciegas.
          ───────────────────────────────────────────────────────────────────── */}
      <section
        id="capa-tipologia"
        aria-labelledby="capa-tipologia-h"
        className="mt-12 scroll-mt-20 space-y-3 border-t border-neutral-border pt-10 dark:border-dk-border"
      >
        <h2
          id="capa-tipologia-h"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Capa 1 — Tipología edificatoria
        </h2>
        <p className="max-w-3xl text-neutral-text dark:text-dk-text">
          Estimamos el material predominante de los techos (chapa galvanizada,
          teja colorada, losa de hormigón) cruzando tres señales independientes
          sobre cada polígono: <strong>firma espectral RGB</strong> de
          Sentinel-2 (10 m), <strong>inercia térmica</strong> derivada de la
          banda ST_B10 de Landsat 8/9 (la chapa calienta y enfría rápido; la
          losa retiene calor de noche) y <strong>tamaño del footprint</strong>{" "}
          de Google Open Buildings + Microsoft Footprints. La fórmula resumida
          es{" "}
          <code>
            pct_material = f(RGB_S2, ΔLST_día_noche, footprint_m²)
          </code>
          , reportada como mezcla porcentual con confianza por celda. La
          densidad volumétrica complementaria —{" "}
          <code>Σ(footprint × altura_estimada) / km²</code> — usa sombras
          Sentinel-2 + 3.5 m por planta residencial como fallback cuando el
          catastro municipal no devuelve altura.
        </p>
        <p className="max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          <strong>Limitaciones honestas.</strong> Es una heurística satelital,
          no un censo de materiales: la verdad de campo requiere relevamiento
          puerta a puerta. Píxeles mixtos (varios materiales en 10 m × 10 m)
          se reportan como{" "}
          <em>indeterminado</em>. La detección de fibrocemento legacy (chapa
          ondulada gris-cemento + edad &gt; 25 años cruzada con archivo CBERS
          pre-2000) es una <strong>señal de prioridad sanitaria</strong>, no un
          diagnóstico — la presencia real de asbesto solo se confirma con
          muestreo de laboratorio. Ver{" "}
          <Link
            href="/datos/metodologia#glosario-tipologia-techos"
            className="text-primary underline dark:text-dk-primary"
          >
            tipologia-techos
          </Link>{" "}
          y{" "}
          <Link
            href="/datos/metodologia#glosario-asbesto"
            className="text-primary underline dark:text-dk-primary"
          >
            asbesto
          </Link>{" "}
          en el glosario.
        </p>
      </section>

      <section
        id="capa-riesgos"
        aria-labelledby="capa-riesgos-h"
        className="mt-12 scroll-mt-20 space-y-3 border-t border-neutral-border pt-10 dark:border-dk-border"
      >
        <h2
          id="capa-riesgos-h"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Capa 2 — Riesgos urbanos
        </h2>
        <p className="max-w-3xl text-neutral-text dark:text-dk-text">
          Cuatro riesgos se computan en paralelo por polígono:{" "}
          <strong>dengue</strong> ={" "}
          <code>
            f(LST 22-32°C, anomalía SAR negativa, densidad WorldPop, focos BIV)
          </code>
          ; <strong>calor-salud</strong> con umbrales OMS-SMN de 32°C
          (mortalidad ↑) y 35°C × 3 días (emergencia sanitaria); {" "}
          <strong>anegamiento</strong> ={" "}
          <code>
            f(% impermeable, lluvia CHIRPS 48 h, pendiente SRTM, drenajes OSM)
          </code>{" "}
          en 5 niveles; y <strong>gentrificación</strong> como señal temprana
          de cambio acelerado de tejido (ΔNDBI &gt; 0.05/año + anomalía SAR
          positiva persistente + renovación de tipología de techos sobre
          ventana de 24-36 meses). El núcleo estadístico es la{" "}
          <strong>anomalía SAR</strong>:{" "}
          <code>z = (backscatter_actual − μ_histórico) / σ_histórico</code>
          {" "}sobre los últimos 24-36 meses de Sentinel-1 en la misma órbita;{" "}
          <code>|z| &gt; 2</code> marca cambio significativo y permite ver
          obra/inundación/desmonte aunque haya nubes durante semanas.
        </p>
        <p className="max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          <strong>Limitaciones honestas.</strong> Los riesgos son{" "}
          <strong>capas de priorización</strong>, no diagnósticos individuales:
          el satélite no ve el interior de las viviendas (donde Aedes prospera
          de verdad), no reemplaza a la vigilancia entomológica de campo ni a
          los partes de Defensa Civil. El módulo de gentrificación detecta
          cambio edilicio pero <strong>no afirma desplazamiento</strong> de
          vecinos originales — eso requiere datos de mercado inmobiliario y
          encuestas. El anegamiento urbano no predice crecidas del Paraná (para
          eso usamos otra capa con hidrométricos del INA). Ver{" "}
          <Link
            href="/datos/metodologia#glosario-anomalia-sar"
            className="text-primary underline dark:text-dk-primary"
          >
            anomalia-sar
          </Link>
          ,{" "}
          <Link
            href="/datos/metodologia#glosario-dengue"
            className="text-primary underline dark:text-dk-primary"
          >
            dengue
          </Link>{" "}
          y{" "}
          <Link
            href="/datos/metodologia#glosario-anegamiento"
            className="text-primary underline dark:text-dk-primary"
          >
            anegamiento
          </Link>
          .
        </p>
      </section>

      <section
        id="capa-calidad-vida"
        aria-labelledby="capa-calidad-vida-h"
        className="mt-12 scroll-mt-20 space-y-3 border-t border-neutral-border pt-10 dark:border-dk-border"
      >
        <h2
          id="capa-calidad-vida-h"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Capa 3 — Calidad de vida urbana
        </h2>
        <p className="max-w-3xl text-neutral-text dark:text-dk-text">
          La capa 3 sintetiza calor, verde, aire y acceso en un único score{" "}
          <strong>habitabilidad</strong> 0-100 por polígono:{" "}
          <code>
            habitabilidad = 0.30·(1 − UHI*) + 0.25·verde* + 0.20·(1 − NO₂*) +
            0.25·acceso*
          </code>
          , donde cada componente se normaliza por z-score contra el promedio
          de Posadas y se invierten los indicadores donde mayor valor = peor
          (UHI, NO₂). El componente <em>acceso</em> opera la idea de{" "}
          <strong>ciudad 15 min</strong> (Moreno 2021): contamos cuántas de las
          7 categorías Moreno (vivienda, trabajo, comercio, salud, educación,
          ocio, cultura) caen dentro de una isócrona peatonal de 15 min
          (≈1.2 km) sobre la red OSM. Reportamos en paralelo equidad verde con
          umbral OMS (9 m² verdes/hab, óptimo 15) y un <strong>Gini espacial</strong>{" "}
          sobre las métricas críticas para detectar si el promedio de la
          ciudad oculta barrios bajo umbral. La resiliencia climática agrega
          absorción + adaptación + recuperación según el marco IPCC AR6 WG2
          Cap. 6.
        </p>
        <p className="max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          <strong>Limitaciones honestas.</strong> Habitabilidad es un{" "}
          <strong>composite heurístico</strong> útil para conversación pública,
          no un diagnóstico definitivo — los pesos están justificados por
          literatura UN-Habitat / JRC EU Urban Audit pero son discutibles, por
          eso publicamos un slider en{" "}
          <Link
            href="/indicadores/calidad-vida"
            className="text-primary underline dark:text-dk-primary"
          >
            /calidad-vida
          </Link>{" "}
          para re-equilibrarlos. Los m² verdes por habitante no descuentan
          accesibilidad real (un parque privado o sin acceso peatonal cuenta
          igual) ni distancia (los 9 m² OMS deberían estar dentro de 300-500 m
          de caminata, no en el otro extremo de la ciudad). Reportamos IC 95%
          propagando errores de cada capa. Ver{" "}
          <Link
            href="/datos/metodologia#glosario-habitabilidad"
            className="text-primary underline dark:text-dk-primary"
          >
            habitabilidad
          </Link>
          ,{" "}
          <Link
            href="/datos/metodologia#glosario-ciudad-15-min"
            className="text-primary underline dark:text-dk-primary"
          >
            ciudad-15-min
          </Link>{" "}
          y{" "}
          <Link
            href="/datos/metodologia#glosario-gini"
            className="text-primary underline dark:text-dk-primary"
          >
            gini
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="reproducibilidad" className="mt-12 space-y-3">
        <h2
          id="reproducibilidad"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Reproducibilidad
        </h2>
        <p className="max-w-3xl text-neutral-text dark:text-dk-text">
          Todo el pipeline es de código abierto. Los datos agregados se
          publican bajo CC BY 4.0 y el código bajo MIT. El observatorio usa
          exclusivamente datos públicos: no incluye fuentes censales
          restringidas ni datos personales.
        </p>
        <p className="max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Para descargar los datasets agregados visitá la{" "}
          <Link
            href="/datos/descargas"
            className="text-primary underline dark:text-dk-primary"
          >
            sección de descargas
          </Link>
          .
        </p>
      </section>

      <section id="anegamiento-v2" className="mt-12 scroll-mt-20 space-y-4 border-t border-neutral-border pt-10 dark:border-dk-border">
        <h2 className="text-2xl font-bold">Anegamiento v2 y exposición hídrica</h2>
        <p>Calibración inicial a revisar. No emite alertas oficiales. El pronóstico es común a toda Posadas: Open-Meteo no resuelve celdas convectivas a escala de barrio. No predice crecidas del Paraná.</p>
        <p>Se calculan máximos móviles de 1, 3, 24 y 48 horas en las próximas 72 horas. Atención: ≥20 mm/1 h o ≥50 mm/24 h; alto: ≥40 o ≥80; muy alto: ≥70 o ≥120. Desde el 23/10/2026 el valor central es la mediana de los máximos de cada miembro del ensemble, y el escenario alto es su percentil 90. Antes se tomaba el máximo de la mediana hora por hora: como cada miembro ubica las tormentas a distinta hora, ese método aplanaba los picos (con el pronóstico del 22/10 daba 20,6 mm en 24 h contra 38,9 mm del método actual). El gráfico horario muestra la media del ensemble y la banda P10–P90. Los totales por día local suman las horas de cada miembro y se resumen con P10, P50 y P90. La probabilidad es la proporción de miembros con al menos una superación por nivel, descartando miembros incompletos. No está calibrada con eventos locales.</p>
        <p>Datos en vivo de la sala, todos automáticos y de fuentes oficiales, sin reportes de redes ni de vecinos. Alertas y avisos a muy corto plazo del SMN (CAP, licencia CC BY 4.0): una alerta afecta a Posadas solo si su polígono contiene el punto de la ciudad; los avisos a muy corto plazo se muestran como cercanos hasta 50 km. Estado del tiempo del SMN (datos abiertos) y METAR del aeropuerto (vía NOAA Aviation Weather), con tormenta y granizo informados. Lluvia medida en la estación SMN Posadas Aero (SYNOP 87178, vía Ogimet): bloques de 6 horas; el bloque de 06 a 12 UTC se obtiene restando al total de 24 h los otros tres, y si falta alguno queda sin dato y el total se marca incompleto. El registro diario usa el día pluviométrico de 9 a 9 h. Es un solo punto: no representa la lluvia de cada barrio. Rayos del detector GLM del satélite GOES-19 (NOAA), procesados cada 3 minutos; la ubicación puede variar algunos kilómetros y no todos los rayos se detectan. Suelo: con 30 mm o más medidos en 72 horas se informa suelo mojado y con 60 mm o más, muy mojado; es una calibración inicial, no una medición de humedad del suelo. Río Paraná: altura de Prefectura Naval Argentina en el puerto de Posadas e historial diario del Instituto Nacional del Agua. Modelo de alta resolución: WRF determinístico de 4 km del SMN (datos abiertos en AWS), leído cada 6 horas en una caja de 7 × 7 celdas alrededor de Posadas; se informa el valor del centro y el máximo de la caja. No hay imágenes de radar de acceso automático.</p>
        <p>Antecedentes: <a className="underline" href="https://www.primeraedicion.com.ar/nota/101045786/en-solo-una-hora-en-posadas-llovio-40-milimetros-y-hubo-anegamientos/">40 mm en una hora</a> y <a className="underline" href="https://www.lavozdesanjusto.com.ar/fuerte-temporal-en-posadas-afecto-a-mas-de-200-familias-48576">126 mm en menos de dos horas</a>. Estos reportes periodísticos orientan los umbrales iniciales; no constituyen validación del modelo.</p>
        <p>Exposición: distancia de centroides de footprints Google + Microsoft a cursos OSM, en UTM 21S. Altura relativa aproximada = cota del centroide − mínima cota de drenajes muestreados cada 30 m y del punto geométrico más cercano del curso, siempre dentro de 300 m, limitada a cero. No se modelan direcciones de flujo ni alcantarillado: no es un HAND hidrológico. Muy expuesto: distancia &lt;50 m y altura &lt;2 m; expuesto: distancia &lt;100 m o altura &lt;4 m. Las clases son excluyentes y el total expuesto incluye a los muy expuestos.</p>
        <p>Se usa Copernicus GLO-30 Public 2021 en su grilla nativa, recortado sobre los barrios más un margen de 600 m. El recorte anterior del script 46 no cubría toda el área. El punto más cercano del curso evita huecos artificiales del muestreo cada 30 m; no se amplía el radio ni se interpolan alturas. Es un modelo de superficie (DSM), que puede incluir vegetación y construcciones. SRTM es del año 2000, pero no es la fuente de este cálculo. La resolución de 30 m y el error vertical del DEM impiden interpretar los cortes de 2–4 m como cotas de seguridad. OSM puede estar incompleto. Sin altura válida dentro del radio de cálculo, la clasificación queda a verificar salvo exposición demostrada por distancia. Las zonas son una grilla de 60 m disuelta por barrio; no muestran edificios individuales.</p>
        <p>Población expuesta = suma WorldPop 2020 del polígono × proporción de footprints expuestos. La distribución uniforme es una aproximación y un edificio no equivale necesariamente a una vivienda. Se muestra banda orientativa ±20%, no intervalo de confianza validado. Se usa el raster nacional WorldPop 2020 ya disponible, porque el recorte local anterior no cubría todos los polígonos. Si una celda interior es nodata o falta cobertura, la población queda a verificar; no se sustituye por cero ni se presenta una suma parcial como total. Los polígonos solapados se asignan una sola vez por identificador estable; no se deben sumar áreas geográficas distintas sin revisar su cobertura.</p>
        <p>Impacto v2 = 100 × min(1, max(máx.1h/70, máx.24h/120)) × (0,25 + 0,75 × proporción expuesta). Los denominadores se leen del umbral muy alto configurable. Categorías de impacto: atención ≥20, alto ≥50, muy alto ≥75. Una lluvia nula produce impacto nulo. Sin exposición completa el impacto queda a verificar. La impermeabilidad no se usa en v2: la probabilidad media built de Dynamic World no es porcentaje impermeable. Se exporta la proporción de píxeles built ≥0,5 como proxy de superficie construida, sin fallback. El score anterior se conserva como anegamiento_v1 para comparación y no es directamente comparable en escala.</p>
        <p>Datos públicos: <a className="underline" href="https://www.smn.gob.ar/alertas">SMN</a>, <a className="underline" href="https://registry.opendata.aws/smn-ar-wrf-dataset/">SMN WRF (AWS Open Data)</a>, <a className="underline" href="https://www.goes-r.gov/spacesegment/glm.html">NOAA GOES-19 GLM</a>, <a className="underline" href="https://contenidosweb.prefecturanaval.gob.ar/alturas/">Prefectura Naval Argentina</a>, <a className="underline" href="https://alerta.ina.gob.ar/">INA</a>, <a className="underline" href="https://open-meteo.com/en/docs/ensemble-api">Open-Meteo Ensemble</a>, <a className="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap (ODbL)</a>, Google Open Buildings, Microsoft Building Footprints, Copernicus DEM y WorldPop. La emisión y los faltantes se pueden consultar en <Link className="underline" href="/nino">la sala de situación</Link>. Ante una emergencia: 103; alertas oficiales del SMN.</p>
      </section>

      {/* Frescura de datos: tabla completa con cada dataset, su última
          actualización, frecuencia esperada y fuente. El destino estable
          /metodologia#frescura es referenciado desde el footer y desde
          páginas individuales. `scroll-mt-20` compensa el header sticky. */}
      <section
        id="frescura"
        aria-labelledby="frescura-heading"
        className="mt-12 scroll-mt-20 border-t border-neutral-border pt-10 dark:border-dk-border"
      >
        <h2
          id="frescura-heading"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Frescura de datos
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Cuándo se actualizó por última vez cada dataset y con qué
          frecuencia se espera que se refresque. El indicador de color
          señala la salud del pipeline:{" "}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            verde
          </span>{" "}
          dentro del periodo esperado,{" "}
          <span className="font-semibold text-amber-600 dark:text-amber-400">
            amarillo
          </span>{" "}
          atrasado entre 1 y 2 periodos,{" "}
          <span className="font-semibold text-rose-600 dark:text-rose-400">
            rojo
          </span>{" "}
          más de 2 periodos sin actualizar.
        </p>

        <div className="mt-6 overflow-x-auto rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Tabla de frescura de datasets: nombre, última actualización,
              frecuencia esperada, próxima actualización y fuente.
            </caption>
            <thead className="border-b border-neutral-border bg-neutral-50 text-left text-xs uppercase tracking-wider text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Dataset
                </th>
                <th scope="col" className="px-3 py-2">
                  Última actualización
                </th>
                <th scope="col" className="px-3 py-2">
                  Frecuencia
                </th>
                <th scope="col" className="px-3 py-2">
                  Estado
                </th>
                <th scope="col" className="px-3 py-2">
                  Fuente
                </th>
              </tr>
            </thead>
            <tbody>
              {slugs.map((slug) => {
                const info = DATASET_INFO[slug];
                const f = freshness[slug];
                if (!info || !f) return null;
                return (
                  <tr
                    key={slug}
                    className="border-b border-neutral-border/60 last:border-0 hover:bg-neutral-50 dark:border-dk-border/60 dark:hover:bg-dk-elevated/60"
                  >
                    <th
                      scope="row"
                      className="px-3 py-2 text-left font-medium text-primary dark:text-dk-primary"
                    >
                      {info.label}
                      <p className="font-mono text-[10px] font-normal text-neutral-muted dark:text-dk-muted">
                        {slug}
                      </p>
                    </th>
                    <td className="px-3 py-2 align-top text-neutral-text dark:text-dk-text">
                      {f.lastUpdated ? (
                        <time
                          dateTime={f.lastUpdated}
                          title={f.lastUpdated}
                          className="tabular-nums"
                        >
                          {new Date(f.lastUpdated).toLocaleString("es-AR", {
                            year: "numeric",
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "America/Argentina/Cordoba",
                          })}
                        </time>
                      ) : (
                        <span className="text-rose-600 dark:text-rose-400">
                          sin datos
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-neutral-text dark:text-dk-text">
                      {f.frequency}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <DataFreshness
                        dataset={slug}
                        lastUpdated={f.lastUpdated}
                        frequency={f.frequency}
                        compact
                      />
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-neutral-muted dark:text-dk-muted">
                      {info.fuente}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 max-w-3xl text-xs text-neutral-muted dark:text-dk-muted">
          La frescura se calcula contra el timestamp embebido en cada
          dataset (campo <code>generated_at</code> en JSON,{" "}
          <code>fecha_calculo</code> en CSV) o, si no existe, contra la
          fecha de modificación del archivo. Los pipelines con frecuencia{" "}
          <em>cada 6 horas</em> son automáticos vía cron en GitHub Actions;
          los <em>mensuales</em> y <em>anuales</em> requieren ejecución
          manual del script correspondiente.
        </p>
      </section>

      {/* Glosario de términos técnicos. Se monta en el bottom de la página
          para que sea el destino estable de los anchors `#glosario-*`
          generados por <TerminoGlosario> en otras páginas. `scroll-mt-20`
          compensa la altura del header sticky al saltar al ancla. */}
      <section
        id="glosario"
        aria-labelledby="glosario-heading"
        className="mt-12 scroll-mt-20 border-t border-neutral-border pt-10 dark:border-dk-border"
      >
        <h2
          id="glosario-heading"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Glosario de términos
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Definiciones cortas de los conceptos técnicos que aparecen en el
          observatorio. Usá la búsqueda o navegá por categorías. Los enlaces{" "}
          <code className="rounded bg-primary-50 px-1 py-0.5 text-[0.85em] text-primary dark:bg-dk-elevated dark:text-dk-primary">
            #glosario-uhi
          </code>{" "}
          de los tooltips llevan acá.
        </p>
        <GlosarioCompleto />
      </section>
    </article>
  );
}
