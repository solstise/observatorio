// Pagina de detalle de un poligono.
// Renderiza server-side para buen SEO. Si el id no existe, muestra 404.

import Link from "next/link";
import { notFound } from "next/navigation";

import { Disclaimer } from "@/components/Disclaimer";
import { ServiceTable } from "@/components/ServiceTable";
import { TimelineChart } from "@/components/TimelineChart";
import {
  getPoligonoDetalle,
  getPoligonos,
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

        <section className="mt-10 flex flex-wrap gap-3">
          <a
            href={`/api/poligonos/${properties.id}/reporte.pdf`}
            className="btn-primary"
          >
            Descargar reporte PDF
          </a>
          <a
            href={`/api/poligonos/${properties.id}/timelapse.gif`}
            className="btn-outline"
          >
            Timelapse (GIF)
          </a>
          <Link href="/comparar" className="btn-outline">
            Comparar con otros poligonos
          </Link>
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
