// Pagina de detalle de un poligono.
// Renderiza server-side para buen SEO. Si el id no existe, muestra 404.

import Link from "next/link";
import { notFound } from "next/navigation";

import { AireGauge } from "@/components/AireGauge";
import { AreaProtegidaNotice } from "@/components/AreaProtegidaNotice";
import { ClimaChart } from "@/components/ClimaChart";
import { Disclaimer } from "@/components/Disclaimer";
import { DynamicWorldGauge } from "@/components/DynamicWorldGauge";
import { FirmsBadge } from "@/components/FirmsBadge";
import { HistoriaLargaChart } from "@/components/HistoriaLargaChart";
import { IslaCalorBadge } from "@/components/IslaCalorBadge";
import { SarDeltaBadge } from "@/components/SarDeltaBadge";
import { ServiceTable } from "@/components/ServiceTable";
import { TimelineChart } from "@/components/TimelineChart";
import {
  getChirps,
  getDynamicWorld,
  getFirms,
  getGhsl,
  getLst,
  getMapBiomas,
  getNo2,
  getPoligonoDetalle,
  getPoligonos,
  getSentinel1,
  getViirs,
  getWdpa,
} from "@/lib/data.server";

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
  return {
    title: detalle.properties.nombre,
    description: `Ficha del poligono ${detalle.properties.nombre} - Observatorio Urbano Posadas.`,
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
  ]);

  const poblacionUltima = [...poblacion].sort((a, b) => b.anio - a.anio)[0];
  const primerAnio = [...serie_temporal].sort((a, b) => a.anio - b.anio)[0];
  const ultimoAnio = [...serie_temporal].sort((a, b) => b.anio - a.anio)[0];

  return (
    <>
      <Disclaimer />
      <article className="container-obs py-8">
        <nav aria-label="Migas" className="mb-4 text-sm text-secondary">
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted">{properties.nombre}</span>
        </nav>

        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary">
            {properties.categoria.replace("_", " ")}
          </p>
          <h1 className="mt-1 text-3xl md:text-4xl font-bold">
            {properties.nombre}
          </h1>
          <p className="mt-2 text-sm text-neutral-muted">
            ID: <code className="rounded bg-primary-50 px-1">{properties.id}</code>
          </p>
        </header>

        <section
          aria-labelledby="resumen"
          className="grid gap-3 md:grid-cols-4"
        >
          <h2 id="resumen" className="sr-only">
            Resumen de metricas
          </h2>
          <MetricCard
            label="Score expansion"
            value={properties.score_expansion.toFixed(2)}
            hint="0 a 1, mayor = mas expansion"
          />
          <MetricCard
            label="Superficie analizada"
            value={`${properties.superficie_km2.toFixed(1)} km2`}
          />
          <MetricCard
            label="Poblacion estimada"
            value={
              poblacionUltima
                ? poblacionUltima.poblacion_estimada.toLocaleString("es-AR")
                : "s/d"
            }
            hint={poblacionUltima ? `WorldPop ${poblacionUltima.anio}` : undefined}
          />
          <MetricCard
            label="Vulnerabilidad"
            value={
              vulnerabilidad
                ? vulnerabilidad.indice_vulnerabilidad.toFixed(2)
                : "s/d"
            }
            hint="indice 0 a 1"
          />
        </section>

        <section aria-labelledby="serie" className="mt-10">
          <h2
            id="serie"
            className="mb-4 text-xl font-semibold text-primary"
          >
            Serie temporal de superficie
          </h2>
          <div className="card">
            <TimelineChart rows={serie_temporal} />
            {primerAnio && ultimoAnio && (
              <p className="mt-3 text-sm text-neutral-muted">
                Entre {primerAnio.anio} y {ultimoAnio.anio} la superficie
                construida paso de {primerAnio.superficie_construida_km2.toFixed(2)} a{" "}
                {ultimoAnio.superficie_construida_km2.toFixed(2)} km2.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby="servicios" className="mt-10">
          <h2
            id="servicios"
            className="mb-4 text-xl font-semibold text-primary"
          >
            Cobertura de servicios publicos
          </h2>
          <div className="card overflow-x-auto">
            <ServiceTable rows={servicios} />
          </div>
        </section>

        {vulnerabilidad && (
          <section aria-labelledby="vulnerabilidad" className="mt-10">
            <h2
              id="vulnerabilidad"
              className="mb-4 text-xl font-semibold text-primary"
            >
              Vulnerabilidad territorial
            </h2>
            <div className="card grid gap-3 md:grid-cols-5">
              <VulnBlock
                label="Indice general"
                value={vulnerabilidad.indice_vulnerabilidad}
              />
              <VulnBlock
                label="Carencia servicios"
                value={vulnerabilidad.carencia_servicios}
              />
              <VulnBlock
                label="Riesgo inundacion"
                value={vulnerabilidad.riesgo_inundacion}
              />
              <VulnBlock
                label="Accesibilidad salud"
                value={vulnerabilidad.accesibilidad_salud}
              />
              <VulnBlock
                label="Accesibilidad educacion"
                value={vulnerabilidad.accesibilidad_educacion}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-muted">
              Banda de confianza: {vulnerabilidad.confianza_inferior.toFixed(2)} a{" "}
              {vulnerabilidad.confianza_superior.toFixed(2)}.
            </p>
          </section>
        )}

        <section aria-labelledby="historia-larga" className="mt-10">
          <h2
            id="historia-larga"
            className="mb-4 text-xl font-semibold text-primary"
          >
            Historia larga
          </h2>
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
          <h2
            id="indicadores-compl"
            className="mb-4 text-xl font-semibold text-primary"
          >
            Indicadores complementarios
          </h2>
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
          <h2
            id="ambiental"
            className="mb-4 text-xl font-semibold text-primary"
          >
            Capa ambiental
          </h2>
          <AreaProtegidaNotice rows={wdpa} variant="banner" />
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="card">
              <IslaCalorBadge rows={lst} />
            </div>
            <div className="card">
              <AireGauge rows={no2} />
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

        <section className="mt-10 flex flex-wrap gap-3">
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
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-primary">
            Comparación alta resolución (antes / después)
          </h3>
          <img
            src={`/data/media/${properties.id}_comparacion_hd.png`}
            alt={`Comparación HD de ${properties.nombre}`}
            className="w-full rounded-lg border border-neutral-200 shadow-sm"
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
  hint?: string;
}) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wider text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
      {hint && <p className="mt-1 text-xs text-neutral-muted">{hint}</p>}
    </div>
  );
}

function VulnBlock({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-secondary">{label}</p>
      <p className="mt-1 text-xl font-bold text-primary">{value.toFixed(2)}</p>
      <div className="mt-1 h-1.5 w-full rounded-full bg-primary-50">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
      </div>
    </div>
  );
}
