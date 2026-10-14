// Pagina de detalle de un poligono.
// Renderiza server-side para buen SEO. Si el id no existe, muestra 404.
//
// Refactor "tabs": en lugar de scrollear 12 secciones lineales, agrupamos
// el contenido en 5 tabs deeplinkables (?tab=diagnostico|pronostico|...).
// Toda la data sigue cargándose en un único Promise.all server-side; los
// "paneles" se pre-renderizan acá como ReactNode y se pasan al cliente
// <PoligonoTabs>, que decide cuál mostrar. Eso preserva SSR/SEO sin que
// el browser tenga que volver a buscar nada cuando el usuario cambia tab.

import Link from "next/link";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AccesoServiciosCard } from "@/components/AccesoServiciosCard";
import { CapaTipologiaSection } from "@/components/poligono/CapaTipologiaSection";
import { CapaRiesgosSection } from "@/components/poligono/CapaRiesgosSection";
import { CapaCalidadVidaSection } from "@/components/poligono/CapaCalidadVidaSection";
import { PoligonoStatStrip } from "@/components/poligono/PoligonoStatStrip";
import { PoligonoTabs } from "@/components/poligono/PoligonoTabs";
import { PoligonoDatosTab } from "@/components/poligono/PoligonoDatosTab";
// El card principal de aire ahora es AireMultigasCard (toggle histórico
// real vs forecast modelado), montado más abajo via dynamic import. El
// componente legacy `AireGauge` (NO2 únicamente) sigue exportado en
// `@/components/AireGauge` por si otra página lo necesita.
import { AreaProtegidaNotice } from "@/components/AreaProtegidaNotice";
import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { FirmsBadge } from "@/components/FirmsBadge";
import { IslaCalorBadge } from "@/components/IslaCalorBadge";
import { HiResComparacion } from "@/components/HiResComparacion";
import { MapaDescriptionImage } from "@/components/MapaDescriptionImage";
import { RankingPoliticoBadge } from "@/components/RankingPoliticoBadge";
import { SarDeltaBadge } from "@/components/SarDeltaBadge";
import { PoligonoTotalCiudad } from "@/components/PoligonoTotalCiudad";
import { ServiceTable } from "@/components/ServiceTable";
import { TerminoGlosario } from "@/components/TerminoGlosario";

// Charts pesados (Recharts ~80 KB gzipped). Los cargamos dinámicamente
// para que Next genere chunks async — el HTML llega rápido y los charts
// se hidratan después. Mantenemos SSR (default true) porque la ficha de
// barrio prioriza SEO: los crawlers tienen que ver la serie temporal.
const TimelineChart = dynamic(() =>
  import("@/components/TimelineChart").then((m) => ({ default: m.TimelineChart })),
);
const HistoriaLargaChart = dynamic(() =>
  import("@/components/HistoriaLargaChart").then((m) => ({
    default: m.HistoriaLargaChart,
  })),
);
const ClimaChart = dynamic(() =>
  import("@/components/ClimaChart").then((m) => ({ default: m.ClimaChart })),
);
const DynamicWorldGauge = dynamic(() =>
  import("@/components/DynamicWorldGauge").then((m) => ({
    default: m.DynamicWorldGauge,
  })),
);
// AireMultigasCard es client component (toggle + recharts + fetch
// browser-side a aqi_diario.csv). Lo cargamos dinámicamente para chunks
// async y evitar inflar el bundle inicial del servidor.
const AireMultigasCard = dynamic(() =>
  import("@/components/AireMultigasCard").then((m) => ({
    default: m.AireMultigasCard,
  })),
);
// Recharts-based CBERS coverage card. Cargado on-demand para no inflar el
// bundle inicial; el card vive en la sección satelital de cada barrio.
const CoberturaSatelitalMensual = dynamic(() =>
  import("@/components/CoberturaSatelitalMensual").then((m) => ({
    default: m.CoberturaSatelitalMensual,
  })),
);
// Mini ProyeccionChart en la pestaña de pronóstico — solo carga si hay
// proyecciones del script 59 para este barrio.
const ProyeccionChart = dynamic(() =>
  import("@/components/ProyeccionChart").then((m) => ({
    default: m.ProyeccionChart,
  })),
);
import {
  getAnegamiento,
  getAnomalias,
  getCalorSalud,
  getCalorSaludDiario,
  getCanopy,
  getChirps,
  getCoberturaAwfi,
  getDensidadVolumetrica,
  getDengue,
  getDistanciasSociales,
  getDynamicWorld,
  getFirms,
  getGentrificacion,
  getGhsl,
  getGreenEquity,
  getHabitabilidad,
  getLst,
  getLstCbers,
  getMapBiomas,
  getNo2,
  getPoblacion,
  getPoligonoDetalle,
  getPoligonos,
  getPoligonosBarrios,
  getProyecciones,
  getQuinceMinutos,
  getRankingPolitico,
  getResiliencia,
  getSaturacion,
  getSentinel1,
  getSerieTemporal,
  getTechos,
  getUhiMensual,
  getViirs,
  getVulnerabilidad,
  getWdpa,
} from "@/lib/data.server";
import { getManyFreshness } from "@/lib/data-freshness";
import { formatIndice } from "@/lib/format";

interface PageProps {
  params: { id: string };
}

export async function generateStaticParams() {
  try {
    const collection = await getPoligonos();
    return collection.features.map((f) => ({ id: f.properties.id }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: PageProps) {
  const detalle = await safeDetalle(params.id);
  if (!detalle) {
    return { title: "Poligono no encontrado" };
  }
  const { nombre, categoria, superficie_km2, poblacion_estimada } =
    detalle.properties;
  // Subtítulo enriquecido para preview de redes y SERP de Google.
  const description =
    `Barrio ${nombre} en Posadas (Misiones, AR) — categoría ${categoria.replace("_", " ")}, ` +
    `${superficie_km2.toFixed(1)} km², población estimada ${poblacion_estimada.toLocaleString("es-AR")}. ` +
    `Datos satelitales 2018–2026.`;
  return {
    title: nombre,
    description,
    alternates: { canonical: `/poligono/${params.id}` },
    openGraph: {
      title: `${nombre} · Ficha de barrio`,
      description,
      type: "article",
      url: `/poligono/${params.id}`,
    },
    twitter: {
      card: "summary_large_image" as const,
      title: `${nombre} · Observatorio Urbano Posadas`,
      description,
    },
  };
}

async function safeDetalle(id: string) {
  try {
    return await getPoligonoDetalle(id);
  } catch {
    return null;
  }
}

export default async function PoligonoPage({ params }: PageProps) {
  const detalle = await safeDetalle(params.id);
  if (!detalle) notFound();

  // Branch dedicado para el polígono "posadas_completa": agrega los 43
  // barrios y muestra una vista de totales en lugar de la ficha barrio
  // por barrio. Mostrar UHI/clima del barrio "ciudad completa" rompe la
  // lectura porque mezcla zona urbana y rural.
  if (params.id === "posadas_completa") {
    const [
      barriosCollection,
      rankingRows,
      distancias,
      poblacionAll,
      serieAllRows,
      vulnAll,
    ] = await Promise.all([
      getPoligonosBarrios(),
      getRankingPolitico(),
      getDistanciasSociales(),
      getPoblacion(),
      getSerieTemporal(),
      getVulnerabilidad(),
    ]);
    return (
      <PoligonoTotalCiudad
        properties={detalle.properties}
        barrios={barriosCollection.features}
        ranking={rankingRows}
        distancias={distancias}
        poblacion={poblacionAll}
        serieTemporal={serieAllRows}
        vulnerabilidad={vulnAll}
      />
    );
  }

  const { properties, serie_temporal, poblacion, servicios, vulnerabilidad } =
    detalle;

  // Datasets satelitales complementarios. Los cargamos en paralelo y
  // degradamos graciosamente si alguno no existe (las funciones devuelven
  // [] ante errores de lectura, ver data.server.ts).
  const [
    mapbiomas,
    ghsl,
    viirs,
    dynamicWorld,
    sentinel1,
    chirps,
    no2,
    lst,
    firms,
    wdpa,
    uhiLandsat,
    lstCbers,
    cobertura,
    distancias,
    rankingRows,
    rankingTotal,
    // Capas 1, 2, 3 — sub-secciones de la ficha
    canopyRows,
    techosRows,
    densidadRows,
    anomaliaRows,
    dengueRows,
    calorSaludRows,
    calorSaludDiarioRows,
    anegamientoRows,
    saturacionRows,
    quinceRows,
    habitabilidadRows,
    resilienciaRows,
    gentrificacionRows,
    greenEquityRows,
    proyeccionesRows,
    freshness,
  ] = await Promise.all([
    getMapBiomas(properties.id),
    getGhsl(properties.id),
    getViirs(properties.id),
    getDynamicWorld(properties.id),
    getSentinel1(properties.id),
    getChirps(properties.id),
    getNo2(properties.id),
    getLst(properties.id),
    getFirms(properties.id),
    getWdpa(properties.id),
    getUhiMensual(properties.id),
    // CBERS térmico (T1) — backup para el badge UHI. Si T1 aún no
    // publicó, devuelve [] y IslaCalorBadge degrada al comportamiento
    // legacy (Landsat + MODIS).
    getLstCbers(properties.id),
    // Cobertura S2 + AWFI mensual (T1). El CSV es global a Posadas, no
    // se filtra por polígono, pero lo pre-cargamos acá para que el
    // componente no haga un fetch extra browser-side.
    getCoberturaAwfi(),
    getDistanciasSociales(properties.id),
    getRankingPolitico(properties.id),
    getRankingPolitico(),
    // --- Capa 1 (Tipología urbana) ---
    getCanopy(properties.id),
    getTechos(properties.id),
    getDensidadVolumetrica(properties.id),
    getAnomalias(properties.id),
    // --- Capa 2 (Riesgos próximos 14 días) ---
    getDengue(properties.id),
    getCalorSalud(properties.id),
    getCalorSaludDiario(properties.id),
    getAnegamiento(properties.id),
    getSaturacion(properties.id),
    // --- Capa 3 (Calidad de vida) ---
    getQuinceMinutos(properties.id),
    getHabitabilidad(properties.id),
    getResiliencia(properties.id),
    getGentrificacion(properties.id),
    // Equidad verde (m²/hab, brecha OMS) — alimenta el KPI del strip top.
    getGreenEquity(properties.id),
    // Proyecciones (script 59) para el mini-bloque en pestaña Pronóstico.
    getProyecciones(properties.id),
    // Freshness por sección. Pedimos todos los datasets que aparecen en
    // la ficha y luego los enchufamos al chip de cada sección. Una sola
    // ronda I/O en paralelo — no impacta TTFB.
    // El tab "Datos" consume todas estas claves; mantenemos la lista
    // sincronizada con la tabla maestra de datasets más abajo.
    getManyFreshness([
      "viviendas",
      "calor_landsat",
      "aire_no2",
      "firms",
      "chirps",
      "dynamic_world",
      "sentinel1",
      "ranking",
      "mapbiomas",
      "ghsl",
      "viirs",
      "cbers_pansharpen",
      "cbers_pan5",
      "cbers_termico",
      "cbers_awfi",
    ]),
  ]);

  const distanciasRow = distancias[0] ?? null;
  const rankingRow = rankingRows[0] ?? null;
  const totalPoligonos = rankingTotal.length || undefined;

  // Capas 1-3: el getter devuelve un array (puede estar vacío). Tomamos
  // la primera fila y degradamos a null si no hay dato para el barrio.
  const canopyRow = canopyRows[0] ?? null;
  const techosRow = techosRows[0] ?? null;
  const densidadRow = densidadRows[0] ?? null;
  const anomaliaRow = anomaliaRows[0] ?? null;
  const dengueRow = dengueRows[0] ?? null;
  const calorSaludRow = calorSaludRows[0] ?? null;
  const anegamientoRow = anegamientoRows[0] ?? null;
  const saturacionRow = saturacionRows[0] ?? null;
  const quinceRow = quinceRows[0] ?? null;
  const habitabilidadRow = habitabilidadRows[0] ?? null;
  const resilienciaRow = resilienciaRows[0] ?? null;
  const gentrificacionRow = gentrificacionRows[0] ?? null;
  const greenEquityRow = greenEquityRows[0] ?? null;

  const poblacionUltima = [...poblacion].sort((a, b) => b.anio - a.anio)[0];
  const primerAnio = [...serie_temporal].sort((a, b) => a.anio - b.anio)[0];
  const ultimoAnio = [...serie_temporal].sort((a, b) => b.anio - a.anio)[0];

  // --- KPIs para el strip superior ---
  // % construido del último período Dynamic World. Tomamos la fila más
  // reciente por fecha (campo "YYYY-MM"). Si el mean viene como
  // fracción 0-1 lo escalamos a porcentaje 0-100 para mostrarlo.
  const dynamicWorldOrdenado = [...dynamicWorld].sort((a, b) =>
    a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0,
  );
  const dynamicWorldUltimo =
    dynamicWorldOrdenado[dynamicWorldOrdenado.length - 1];
  const pctConstruido = (() => {
    if (!dynamicWorldUltimo) return null;
    // dw_built_pct_ge_50 ya viene en escala 0-100 (porcentaje de pixeles
    // con prob ≥ 0.5 de ser "built"). Es nuestra mejor proxy.
    const v = dynamicWorldUltimo.dw_built_pct_ge_50;
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    // Fallback: dw_built_mean (0-1 prob) escalado a 0-100.
    const m = dynamicWorldUltimo.dw_built_mean;
    if (typeof m === "number" && !Number.isNaN(m)) return m * 100;
    return null;
  })();

  // Métrica disponible más reciente para el mini chart de proyección.
  // ProyeccionMetrica acepta "viviendas" | "poblacion" | "urbano" |
  // "uhi_verano". Preferimos "urbano" (avance de la huella urbana, que
  // es lo que el lector espera en "hacia dónde va el barrio"), después
  // viviendas, después cualquiera disponible.
  const proyUrbano = proyeccionesRows.filter((r) => r.metrica === "urbano");
  const proyViviendas = proyeccionesRows.filter(
    (r) => r.metrica === "viviendas",
  );
  const proyParaChart =
    proyUrbano.length > 0
      ? proyUrbano
      : proyViviendas.length > 0
        ? proyViviendas
        : proyeccionesRows.slice(0, 3);
  const metricaProy = proyParaChart[0]?.metrica;

  // ============================================================
  // RENDER DE PANELES (uno por tab). Cada uno es ReactNode aislado.
  // ============================================================

  const panelDiagnostico: ReactNode = (
    <>
      <section
        aria-labelledby="resumen"
        className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      >
        <h2 id="resumen" className="sr-only">
          Resumen de métricas
        </h2>
        <MetricCard
          label="Score expansión"
          value={
            formatIndice(
              properties.score_expansion === 0
                ? null
                : properties.score_expansion,
            )
          }
          hint="0 a 1, mayor = más expansión"
        />
        <MetricCard
          label="Superficie analizada"
          value={`${properties.superficie_km2.toFixed(1)} km²`}
        />
        <MetricCard
          label="Población estimada"
          value={
            poblacionUltima
              ? poblacionUltima.poblacion_estimada.toLocaleString("es-AR")
              : "s/d"
          }
          hint={
            poblacionUltima ? (
              <>
                <TerminoGlosario id="worldpop">WorldPop</TerminoGlosario>{" "}
                {poblacionUltima.anio}
              </>
            ) : undefined
          }
        />
        <MetricCard
          label="Vulnerabilidad"
          value={
            vulnerabilidad
              ? formatIndice(vulnerabilidad.indice_vulnerabilidad)
              : "s/d"
          }
          hint="índice 0 a 1"
        />
      </section>

      <section aria-labelledby="cobertura" className="mt-10">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2
            id="cobertura"
            className="text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Cobertura satelital mensual
          </h2>
          <DataFreshness
            dataset="cbers_awfi"
            lastUpdated={freshness.cbers_awfi.lastUpdated}
            frequency={freshness.cbers_awfi.frequency}
            compact
          />
        </div>
        <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Cuántas observaciones limpias entraron en el composite cada mes,
          combinando <TerminoGlosario id="sentinel-2">Sentinel-2</TerminoGlosario>{" "}
          (10 m, revisita 5 d) y{" "}
          <TerminoGlosario id="awfi">CBERS-4A AWFI</TerminoGlosario>{" "}
          (64 m, swath 866 km). Cuando S2 está nublado, AWFI rellena.
        </p>
        <div className="card">
          <CoberturaSatelitalMensual rows={cobertura} />
        </div>
      </section>

      <section aria-labelledby="servicios" className="mt-10">
        <h2
          id="servicios"
          className="mb-2 text-xl font-semibold text-primary dark:text-dk-primary"
        >
          Cobertura de servicios públicos
        </h2>
        <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Porcentaje del barrio cubierto por agua de red, cloacas, gas, luz,
          alumbrado y transporte. Fuente y año de referencia declarados por
          servicio.
        </p>
        <div className="card overflow-x-auto">
          <ServiceTable rows={servicios} />
        </div>
      </section>

      <section aria-labelledby="acceso-servicios" className="mt-10">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2
            id="acceso-servicios"
            className="text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Acceso a servicios públicos
          </h2>
          <DataFreshness
            dataset="ranking"
            lastUpdated={freshness.ranking.lastUpdated}
            frequency={freshness.ranking.frequency}
            compact
          />
        </div>
        <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Distancia mínima desde este barrio al servicio más cercano de
          cuatro categorías clave (CAPS, escuela, hospital, transporte) y
          posición en el ranking de prioridad de inversión política.{" "}
          <Link
            href="/decision/prioridades"
            className="text-primary underline dark:text-dk-primary"
          >
            Ver ranking completo
          </Link>
          .
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <AccesoServiciosCard row={distanciasRow} />
          <RankingPoliticoBadge
            row={rankingRow}
            totalPoligonos={totalPoligonos}
          />
        </div>
      </section>

      {vulnerabilidad && (
        <section aria-labelledby="vulnerabilidad" className="mt-10">
          <h2
            id="vulnerabilidad"
            className="mb-4 text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Vulnerabilidad territorial
          </h2>
          <div className="card grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <VulnBlock
              label="Índice general"
              value={vulnerabilidad.indice_vulnerabilidad}
              descripcion="Combina los otros 4 componentes en un solo número 0-1. Cuanto más alto, más vulnerable."
            />
            <VulnBlock
              label="Carencia servicios"
              value={vulnerabilidad.carencia_servicios}
              descripcion="Qué tan lejos está el barrio del CAPS, escuela y transporte más cercanos respecto a los otros barrios. 0 = cerca de todo, 1 = muy aislado."
            />
            <VulnBlock
              label="Riesgo inundación"
              value={vulnerabilidad.riesgo_inundacion}
              descripcion="Probabilidad de inundación según pendiente, distancia al río y ubicación en valles bajos. 0 = sin riesgo, 1 = alto riesgo."
            />
            <VulnBlock
              label="Accesibilidad salud"
              value={vulnerabilidad.accesibilidad_salud}
              descripcion="1 - distancia normalizada al CAPS más cercano. 0 = el CAPS más cercano queda lejos comparado con otros barrios; 1 = excelente cercanía."
            />
            <VulnBlock
              label="Accesibilidad educación"
              value={vulnerabilidad.accesibilidad_educacion}
              descripcion="1 - distancia normalizada a la escuela más cercana."
            />
          </div>
          <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
            Banda de confianza: {vulnerabilidad.confianza_inferior.toFixed(2)} a{" "}
            {vulnerabilidad.confianza_superior.toFixed(2)}. Pasá el mouse
            sobre cada métrica para ver qué mide.
          </p>
        </section>
      )}

      <section aria-labelledby="ambiental" className="mt-10">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2
            id="ambiental"
            className="text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Salud ambiental del barrio
          </h2>
          <DataFreshness
            dataset="calor_landsat"
            lastUpdated={freshness.calor_landsat.lastUpdated}
            frequency={freshness.calor_landsat.frequency}
            compact
          />
          <DataFreshness
            dataset="firms"
            lastUpdated={freshness.firms.lastUpdated}
            frequency={freshness.firms.frequency}
            compact
          />
        </div>
        <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Calor urbano, calidad del aire, riesgo de incendios, lluvias y
          relación con áreas protegidas. Cada tarjeta muestra qué señal
          entrega y de qué satélite proviene.
        </p>
        <AreaProtegidaNotice rows={wdpa} variant="banner" />
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="card">
            <IslaCalorBadge
              rows={lst}
              uhiLandsat={uhiLandsat}
              lstCbers={lstCbers}
            />
          </div>
          <div className="card">
            <AireMultigasCard
              poligonoId={properties.id}
              poligonoNombre={properties.nombre}
            />
          </div>
          <div className="card">
            <FirmsBadge rows={firms} />
          </div>
          <div className="card">
            <AreaProtegidaNotice rows={wdpa} variant="card" />
          </div>
        </div>
        <div className="card mt-4">
          <ClimaChart rows={chirps} />
        </div>
      </section>

      <CapaTipologiaSection
        canopy={canopyRow}
        techos={techosRow}
        densidad={densidadRow}
        anomalia={anomaliaRow}
      />
    </>
  );

  const panelPronostico: ReactNode = (
    <>
      <CapaRiesgosSection
        dengue={dengueRow}
        calorSalud={calorSaludRow}
        calorSaludDiario={calorSaludDiarioRows}
        anegamiento={anegamientoRow}
        saturacion={saturacionRow}
      />

      {proyParaChart.length > 0 && metricaProy && (
        <section aria-labelledby="proyecciones-mini" className="mt-10">
          <h2
            id="proyecciones-mini"
            className="mb-2 text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Hacia dónde va este barrio
          </h2>
          <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
            Proyección basada en la serie histórica de los últimos años. La
            banda gris es el intervalo de confianza al 95 %.{" "}
            <Link
              href="/pronostico/proyecciones"
              className="text-primary underline dark:text-dk-primary"
            >
              Ver todas las métricas
            </Link>
            .
          </p>
          <div className="card">
            <ProyeccionChart
              historico={serie_temporal.map((s) => ({
                anio: s.anio,
                valor: s.edificios_total,
              }))}
              proyecciones={proyParaChart}
              metrica={metricaProy}
              nombreBarrio={properties.nombre}
              height={280}
            />
          </div>
        </section>
      )}
    </>
  );

  const panelCalidad: ReactNode = (
    <CapaCalidadVidaSection
      habitabilidad={habitabilidadRow}
      quince={quinceRow}
      resiliencia={resilienciaRow}
      gentrificacion={gentrificacionRow}
    />
  );

  const panelHistoria: ReactNode = (
    <>
      <section aria-labelledby="serie">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2
            id="serie"
            className="text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Cómo creció la edificación
          </h2>
          <DataFreshness
            dataset="viviendas"
            lastUpdated={freshness.viviendas.lastUpdated}
            frequency={freshness.viviendas.frequency}
            compact
          />
        </div>
        <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Cantidad de viviendas detectadas por año desde imágenes satelitales,
          con banda de confianza ±15%.{" "}
          <em>
            Datos: Google{" "}
            <TerminoGlosario id="open-buildings">Open Buildings</TerminoGlosario>{" "}
            +{" "}
            <TerminoGlosario id="ms-buildings">
              Microsoft Building Footprints
            </TerminoGlosario>
            .
          </em>
        </p>
        <div className="card">
          <TimelineChart rows={serie_temporal} />
          {primerAnio && ultimoAnio && (
            <p className="mt-3 text-sm text-neutral-muted dark:text-dk-muted">
              Entre {primerAnio.anio} y {ultimoAnio.anio} la superficie
              construida pasó de {primerAnio.superficie_construida_km2.toFixed(2)} a{" "}
              {ultimoAnio.superficie_construida_km2.toFixed(2)} km².
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="hires" className="mt-10">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2
            id="hires"
            className="text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Imagen satelital alta resolución
          </h2>
          <DataFreshness
            dataset="cbers_pansharpen"
            lastUpdated={freshness.cbers_pansharpen.lastUpdated}
            frequency={freshness.cbers_pansharpen.frequency}
            compact
          />
          <DataFreshness
            dataset="cbers_pan5"
            lastUpdated={freshness.cbers_pan5.lastUpdated}
            frequency={freshness.cbers_pan5.frequency}
            compact
          />
        </div>
        <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Tres sensores complementarios:{" "}
          <strong>Sentinel-2</strong> (10 m color, mensual),{" "}
          <TerminoGlosario id="cbers">CBERS WPM</TerminoGlosario> (8 m
          color, trimestral) y{" "}
          <TerminoGlosario id="pan5">CBERS PAN5</TerminoGlosario> (5 m
          blanco/negro, trimestral).
        </p>
        <HiResComparacion
          poligonoId={properties.id}
          nombre={properties.nombre}
        />
      </section>

      <section aria-labelledby="historia-larga" className="mt-10">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2
            id="historia-larga"
            className="text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Historia larga (1975–2030)
          </h2>
          <DataFreshness
            dataset="ghsl"
            lastUpdated={freshness.ghsl.lastUpdated}
            frequency={freshness.ghsl.frequency}
            compact
          />
        </div>
        <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Combina cobertura del suelo, huella construida y luces nocturnas.
          Permite ver de un vistazo si el barrio creció más por densificación
          o por expansión sobre verde.
        </p>
        <div className="card">
          <HistoriaLargaChart
            poligonoId={properties.id}
            mapbiomas={mapbiomas}
            ghsl={ghsl}
            viirs={viirs}
          />
        </div>
      </section>

      <section aria-labelledby="indicadores-compl" className="mt-10">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2
            id="indicadores-compl"
            className="text-xl font-semibold text-primary dark:text-dk-primary"
          >
            Cómo cambia la urbanización
          </h2>
          <DataFreshness
            dataset="dynamic_world"
            lastUpdated={freshness.dynamic_world.lastUpdated}
            frequency={freshness.dynamic_world.frequency}
            compact
          />
          <DataFreshness
            dataset="sentinel1"
            lastUpdated={freshness.sentinel1.lastUpdated}
            frequency={freshness.sentinel1.frequency}
            compact
          />
        </div>
        <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Mide qué proporción del barrio es construcción y detecta cambios
          estructurales recientes — incluso cuando el cielo está nublado.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card">
            <DynamicWorldGauge rows={dynamicWorld} />
          </div>
          <div className="card">
            <SarDeltaBadge rows={sentinel1} />
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-primary dark:text-dk-primary">
          Comparación alta resolución (antes / después)
        </h3>
        <MapaDescriptionImage
          src={`/data/media/${properties.id}_comparacion_hd.png`}
          filename={`${properties.id}_comparacion.png`}
          fallbackAlt={`Comparación HD de ${properties.nombre}`}
          className="w-full rounded-lg border border-neutral-border shadow-sm dark:border-dk-border"
          loading="lazy"
        />
      </section>

      <section className="mt-8 flex flex-wrap gap-3">
        <Link href="/datos/historia" className="btn-outline">
          Línea de tiempo 1999-2026
        </Link>
        <Link href="/datos/validacion" className="btn-outline">
          Validación cruzada de índices
        </Link>
      </section>
    </>
  );

  // Payload JSON descargable para el barrio. Lo armamos compacto pero
  // completo: properties + todos los CSV rows ya filtrados a este id.
  const jsonPayload: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    poligono: properties,
    poblacion,
    serie_temporal,
    servicios,
    vulnerabilidad,
    dynamic_world: dynamicWorld,
    sentinel1,
    mapbiomas,
    ghsl,
    viirs,
    chirps,
    no2,
    lst,
    firms,
    wdpa,
    uhi_mensual: uhiLandsat,
    lst_cbers: lstCbers,
    distancias_sociales: distanciasRow,
    ranking_politico: rankingRow,
    canopy: canopyRow,
    techos: techosRow,
    densidad_volumetrica: densidadRow,
    anomalias: anomaliaRow,
    dengue: dengueRow,
    calor_salud: calorSaludRow,
    calor_salud_diario: calorSaludDiarioRows,
    anegamiento: anegamientoRow,
    saturacion: saturacionRow,
    quince_minutos: quinceRow,
    habitabilidad: habitabilidadRow,
    resiliencia: resilienciaRow,
    gentrificacion: gentrificacionRow,
    green_equity: greenEquityRow,
    proyecciones: proyeccionesRows,
  };

  const datasets = [
    {
      label: "Serie temporal de edificios",
      href: "/data/serie_temporal.csv",
      lastUpdated: freshness.viviendas.lastUpdated,
      frequency: freshness.viviendas.frequency,
      rowsForBarrio: serie_temporal.length,
    },
    {
      label: "Población WorldPop",
      href: "/data/poblacion.csv",
      rowsForBarrio: poblacion.length,
    },
    {
      label: "Servicios públicos",
      href: "/data/servicios.csv",
      rowsForBarrio: servicios.length,
    },
    {
      label: "Vulnerabilidad territorial",
      href: "/data/vulnerabilidad.csv",
      rowsForBarrio: vulnerabilidad ? 1 : 0,
    },
    {
      label: "Dynamic World (uso del suelo)",
      href: "/data/dynamic_world.csv",
      lastUpdated: freshness.dynamic_world.lastUpdated,
      frequency: freshness.dynamic_world.frequency,
      rowsForBarrio: dynamicWorld.length,
    },
    {
      label: "Sentinel-1 SAR (cambios estructurales)",
      href: "/data/sentinel1.csv",
      lastUpdated: freshness.sentinel1.lastUpdated,
      frequency: freshness.sentinel1.frequency,
      rowsForBarrio: sentinel1.length,
    },
    {
      label: "MapBiomas (cobertura del suelo)",
      href: "/data/mapbiomas.csv",
      lastUpdated: freshness.mapbiomas.lastUpdated,
      frequency: freshness.mapbiomas.frequency,
      rowsForBarrio: mapbiomas.length,
    },
    {
      label: "GHSL (huella construida 1975-2030)",
      href: "/data/ghsl.csv",
      lastUpdated: freshness.ghsl.lastUpdated,
      frequency: freshness.ghsl.frequency,
      rowsForBarrio: ghsl.length,
    },
    {
      label: "VIIRS (luces nocturnas)",
      href: "/data/viirs.csv",
      lastUpdated: freshness.viirs.lastUpdated,
      frequency: freshness.viirs.frequency,
      rowsForBarrio: viirs.length,
    },
    {
      label: "CHIRPS (precipitación)",
      href: "/data/chirps.csv",
      lastUpdated: freshness.chirps.lastUpdated,
      frequency: freshness.chirps.frequency,
      rowsForBarrio: chirps.length,
    },
    {
      label: "TROPOMI NO₂ (aire)",
      href: "/data/no2.csv",
      lastUpdated: freshness.aire_no2.lastUpdated,
      frequency: freshness.aire_no2.frequency,
      rowsForBarrio: no2.length,
    },
    {
      label: "Landsat LST (temperatura superficie)",
      href: "/data/lst.csv",
      lastUpdated: freshness.calor_landsat.lastUpdated,
      frequency: freshness.calor_landsat.frequency,
      rowsForBarrio: lst.length,
    },
    {
      label: "FIRMS (focos de calor / fuegos)",
      href: "/data/firms.csv",
      lastUpdated: freshness.firms.lastUpdated,
      frequency: freshness.firms.frequency,
      rowsForBarrio: firms.length,
    },
    {
      label: "WDPA (áreas protegidas)",
      href: "/data/wdpa.csv",
      rowsForBarrio: wdpa.length,
    },
    {
      label: "CBERS térmico (LST backup)",
      href: "/data/cbers_termico/lst_cbers.csv",
      lastUpdated: freshness.cbers_termico.lastUpdated,
      frequency: freshness.cbers_termico.frequency,
      rowsForBarrio: lstCbers.length,
    },
    {
      label: "Capa 1 — Cobertura verde",
      href: "/data/tipologia/canopy.csv",
      rowsForBarrio: canopyRow ? 1 : 0,
    },
    {
      label: "Capa 1 — Tipología de techos",
      href: "/data/tipologia/techos.csv",
      rowsForBarrio: techosRow ? 1 : 0,
    },
    {
      label: "Capa 1 — Densidad volumétrica",
      href: "/data/tipologia/densidad_volumetrica.csv",
      rowsForBarrio: densidadRow ? 1 : 0,
    },
    {
      label: "Capa 1 — Anomalías SAR",
      href: "/data/tipologia/anomalias.csv",
      rowsForBarrio: anomaliaRow ? 1 : 0,
    },
    {
      label: "Capa 2 — Riesgo dengue",
      href: "/data/riesgos/dengue.csv",
      rowsForBarrio: dengueRow ? 1 : 0,
    },
    {
      label: "Capa 2 — Calor & salud",
      href: "/data/riesgos/calor_salud.csv",
      rowsForBarrio: calorSaludRow ? 1 : 0,
    },
    {
      label: "Capa 2 — Calor diario (14 d)",
      href: "/data/riesgos/calor_salud_diario.csv",
      rowsForBarrio: calorSaludDiarioRows.length,
    },
    {
      label: "Capa 2 — Anegamiento",
      href: "/data/riesgos/anegamiento.csv",
      rowsForBarrio: anegamientoRow ? 1 : 0,
    },
    {
      label: "Capa 2 — Saturación urbana",
      href: "/data/riesgos/saturacion.csv",
      rowsForBarrio: saturacionRow ? 1 : 0,
    },
    {
      label: "Capa 3 — 15-minute city",
      href: "/data/calidad/quince_minutos.csv",
      rowsForBarrio: quinceRow ? 1 : 0,
    },
    {
      label: "Capa 3 — Habitabilidad",
      href: "/data/calidad/habitabilidad.csv",
      rowsForBarrio: habitabilidadRow ? 1 : 0,
    },
    {
      label: "Capa 3 — Resiliencia climática",
      href: "/data/calidad/resiliencia.csv",
      rowsForBarrio: resilienciaRow ? 1 : 0,
    },
    {
      label: "Capa 3 — Gentrificación",
      href: "/data/calidad/gentrificacion.csv",
      rowsForBarrio: gentrificacionRow ? 1 : 0,
    },
    {
      label: "Capa 3 — Equidad verde",
      href: "/data/calidad/green_equity.csv",
      rowsForBarrio: greenEquityRow ? 1 : 0,
    },
    {
      label: "Proyecciones (script 59)",
      href: "/data/proyecciones/proyecciones.csv",
      rowsForBarrio: proyeccionesRows.length,
    },
    {
      label: "Acceso a servicios (distancias)",
      href: "/data/social/distancias.csv",
      rowsForBarrio: distanciasRow ? 1 : 0,
    },
    {
      label: "Ranking político de prioridad",
      href: "/data/social/ranking.csv",
      lastUpdated: freshness.ranking.lastUpdated,
      frequency: freshness.ranking.frequency,
      rowsForBarrio: rankingRow ? 1 : 0,
    },
  ];

  const panelDatos: ReactNode = (
    <PoligonoDatosTab
      poligonoId={properties.id}
      poligonoNombre={properties.nombre}
      jsonPayload={jsonPayload}
      datasets={datasets}
      extra={
        <section className="flex flex-wrap gap-3">
          <a
            href={`/data/media/${properties.id}.gif`}
            className="btn-outline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Timelapse (GIF)
          </a>
          <a
            href={`/data/media/${properties.id}.mp4`}
            className="btn-outline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Timelapse (MP4)
          </a>
          <Link href="/decision/comparar" className="btn-outline">
            Comparar con otros polígonos
          </Link>
        </section>
      }
    />
  );

  return (
    <>
      <Disclaimer />
      <article className="container-obs py-6">
        <nav
          aria-label="Migas"
          className="mb-3 text-sm text-secondary dark:text-dk-muted"
        >
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            {properties.nombre}
          </span>
        </nav>

        <PoligonoStatStrip
          nombre={properties.nombre}
          poligonoId={properties.id}
          categoria={properties.categoria}
          habitabilidad={
            habitabilidadRow
              ? {
                  score: habitabilidadRow.score_habitabilidad,
                  categoria: habitabilidadRow.categoria,
                }
              : null
          }
          dengue={
            dengueRow ? { categoria: dengueRow.categoria } : null
          }
          pctConstruido={pctConstruido}
          verdeM2PerCapita={
            greenEquityRow?.m2_per_capita ??
            canopyRow?.m2_per_capita ??
            null
          }
        />

        {/* PoligonoTabs usa useSearchParams() internamente — Next 14 requiere
            wrap en Suspense para que static prerendering no falle. */}
        <Suspense fallback={<div className="mt-6 h-12 animate-pulse rounded-md bg-neutral-100 dark:bg-dk-elevated" aria-hidden />}>
          <PoligonoTabs
            panels={{
              diagnostico: panelDiagnostico,
              pronostico: panelPronostico,
              calidad: panelCalidad,
              historia: panelHistoria,
              datos: panelDatos,
            }}
          />
        </Suspense>
      </article>
    </>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
}) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-primary dark:text-dk-primary">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function VulnBlock({
  label,
  value,
  descripcion,
}: {
  label: string;
  value: number;
  descripcion?: string;
}) {
  const tooltip = descripcion ?? label;
  return (
    <div title={tooltip} aria-label={`${label}: ${value.toFixed(2)}. ${tooltip}`}>
      <p className="text-xs uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-primary dark:text-dk-primary">
        {value.toFixed(2)}
      </p>
      <div className="mt-1 h-1.5 w-full rounded-full bg-primary-50 dark:bg-dk-elevated">
        <div
          className="h-full rounded-full bg-accent dark:bg-dk-accent"
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </div>
    </div>
  );
}
