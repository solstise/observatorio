// Pagina de detalle de un poligono.
// Renderiza server-side para buen SEO. Si el id no existe, muestra 404.

import Link from "next/link";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AccesoServiciosCard } from "@/components/AccesoServiciosCard";
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
import {
  getChirps,
  getCoberturaAwfi,
  getDistanciasSociales,
  getDynamicWorld,
  getFirms,
  getGhsl,
  getLst,
  getLstCbers,
  getMapBiomas,
  getNo2,
  getPoblacion,
  getPoligonoDetalle,
  getPoligonos,
  getPoligonosBarrios,
  getRankingPolitico,
  getSentinel1,
  getSerieTemporal,
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
  // por barrio. Mostrar UHI/clima del polígono "ciudad completa" rompe la
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
    // Freshness por sección. Pedimos todos los datasets que aparecen en
    // la ficha y luego los enchufamos al chip de cada sección. Una sola
    // ronda I/O en paralelo — no impacta TTFB.
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

  const poblacionUltima = [...poblacion].sort((a, b) => b.anio - a.anio)[0];
  const primerAnio = [...serie_temporal].sort((a, b) => a.anio - b.anio)[0];
  const ultimoAnio = [...serie_temporal].sort((a, b) => b.anio - a.anio)[0];

  return (
    <>
      <Disclaimer />
      <article className="container-obs py-8">
        <nav
          aria-label="Migas"
          className="mb-4 text-sm text-secondary dark:text-dk-muted"
        >
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            {properties.nombre}
          </span>
        </nav>

        <header className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
                {properties.categoria.replace("_", " ")}
              </p>
              <h1
                className="mt-1 font-bold"
                style={{ fontSize: "var(--fs-h1)" }}
              >
                {properties.nombre}
              </h1>
              <p className="mt-2 text-sm text-neutral-muted dark:text-dk-muted">
                ID:{" "}
                <code className="rounded bg-primary-50 px-1 dark:bg-dk-elevated dark:text-dk-text">
                  {properties.id}
                </code>
              </p>
            </div>
            {/* Acceso rápido para comparar este barrio contra el total de la
                ciudad. Usa query string `ids` (ver app/comparar/page.tsx).
                Estilo sutil para no competir con la jerarquía del título. */}
            <Link
              href={`/comparar?ids=${encodeURIComponent(properties.id)},posadas_completa`}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary/40 dark:bg-dk-elevated dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
              aria-label="Comparar este polígono con el total de Posadas"
            >
              <span aria-hidden>{"⊕"}</span>
              Comparar con Posadas total
            </Link>
          </div>
        </header>

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
              // El score 0 en el geojson para polígonos sin análisis (capas
              // de referencia como `posadas_completa`) no es un valor real,
              // por eso lo tratamos como s/d. Para barrios reales el score
              // siempre es > 0.
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

        <section aria-labelledby="serie" className="mt-10">
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

        {/* Imagen alta resolución: toggle Sentinel-2 (10 m, mensual, color)
            ↔ CBERS-4A WPM (8 m, color, pansharpen, trimestral) ↔ CBERS-4
            PAN5 (5 m, blanco/negro, trimestral). Es el "ground truth"
            visual del crecimiento que muestra el TimelineChart de arriba
            — por eso lo posicionamos justo después. La pipeline Python
            (S-A + T1) genera los PNG de CBERS; si aún no corrió alguna
            de las variantes, el componente degrada y sugiere otra capa. */}
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
            blanco/negro, trimestral). Usá S2 para series temporales,
            WPM para color a buen detalle, PAN5 para zoom alto sobre
            cuadras.
          </p>
          <HiResComparacion
            poligonoId={properties.id}
            nombre={properties.nombre}
          />
        </section>

        {/* Cobertura satelital mensual S2 + AWFI. Le explica al lector
            por qué algunos meses tienen menos datos que otros — la
            transparencia es parte del producto. T1 publica el CSV en
            /data/cbers_awfi/cobertura.csv; mientras tanto degrada solo. */}
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
            Porcentaje del polígono cubierto por agua de red, cloacas, gas, luz,
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
            Distancia mínima desde este polígono al servicio más cercano de
            cuatro categorías clave (CAPS, escuela, hospital, transporte) y
            posición en el ranking de prioridad de inversión política.{" "}
            <Link
              href="/prioridades"
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
              />
              <VulnBlock
                label="Carencia servicios"
                value={vulnerabilidad.carencia_servicios}
              />
              <VulnBlock
                label="Riesgo inundación"
                value={vulnerabilidad.riesgo_inundacion}
              />
              <VulnBlock
                label="Accesibilidad salud"
                value={vulnerabilidad.accesibilidad_salud}
              />
              <VulnBlock
                label="Accesibilidad educación"
                value={vulnerabilidad.accesibilidad_educacion}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
              Banda de confianza: {vulnerabilidad.confianza_inferior.toFixed(2)} a{" "}
              {vulnerabilidad.confianza_superior.toFixed(2)}.
            </p>
          </section>
        )}

        <section aria-labelledby="historia-larga" className="mt-10">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2
              id="historia-larga"
              className="text-xl font-semibold text-primary dark:text-dk-primary"
            >
              Historia larga (1975–2030)
            </h2>
            {/* Tres datasets distintos alimentan este chart — mostramos
                el más infrecuente (anual) que es el "cuello de botella"
                de frescura del bloque. */}
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
            Mide qué proporción del polígono es construcción y detecta cambios
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

        <section aria-labelledby="ambiental" className="mt-10">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h2
              id="ambiental"
              className="text-xl font-semibold text-primary dark:text-dk-primary"
            >
              Salud ambiental del barrio
            </h2>
            {/* La sección agrupa cuatro datasets independientes. Solo
                mostramos los dos con frecuencia más exigente (calor mensual
                y firms diario) para no saturar el header — los otros viven
                en sus respectivas tarjetas y en /metodologia#frescura. */}
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
              {/* Reemplazo del AireGauge legacy: ahora multi-gas + toggle
                  histórico (TROPOMI real) vs forecast (CAMS modelado). El
                  componente trae sus propios datos client-side via
                  getAireMultigas() y getAqiDiario(); el `no2` server-side
                  destructurado más arriba se mantiene en el Promise.all
                  para que sigan calientes los CSV sin agregar requests
                  duplicados al cliente. */}
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

        <section className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <a
            href={`/data/media/${properties.id}.pdf`}
            className="btn-primary"
            target="_blank"
            rel="noopener noreferrer"
          >
            Descargar reporte PDF
          </a>
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
          <Link href="/comparar" className="btn-outline">
            Comparar con otros polígonos
          </Link>
        </section>

        <section className="mt-8">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-primary dark:text-dk-primary">
            Comparación alta resolución (antes / después)
          </h3>
          {/* MapaDescriptionImage agrega alt + tooltip auto-generado por
              scripts/_descripcion_mapas.py si está disponible. Si el JSON
              no existe (script aún no corrió), cae al fallback estático. */}
          <MapaDescriptionImage
            src={`/data/media/${properties.id}_comparacion_hd.png`}
            filename={`${properties.id}_comparacion.png`}
            fallbackAlt={`Comparación HD de ${properties.nombre}`}
            className="w-full rounded-lg border border-neutral-border shadow-sm dark:border-dk-border"
            loading="lazy"
          />
        </section>

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

function VulnBlock({ label, value }: { label: string; value: number }) {
  return (
    <div>
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
