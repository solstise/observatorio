// Página /eventos — timeline de eventos extremos detectados por composite
// multi-sensor. La primera implementación cubre INUNDACIONES (T1):
// Sentinel-1 SAR detecta agua nueva, S2/CBERS WPM la confirman ópticamente
// y el detector requiere consenso entre al menos dos sensores.
//
// Server Component que pre-carga eventos + polígonos para resolver IDs.
// El render interactivo (chips clicables, ordenamiento, expansión) lo
// maneja EventosInundacion.

import dynamic from "next/dynamic";
import Link from "next/link";
import type { Metadata } from "next";

import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { TerminoGlosario } from "@/components/TerminoGlosario";
import {
  getEventosInundacion,
  getPoligonosBarrios,
} from "@/lib/data.server";
import { getDatasetFreshness } from "@/lib/data-freshness";

const EventosInundacion = dynamic(() =>
  import("@/components/EventosInundacion").then((m) => ({
    default: m.EventosInundacion,
  })),
);

export const metadata: Metadata = {
  title: "Eventos extremos — inundaciones",
  description:
    "Eventos de inundación detectados en Posadas mediante composite multi-sensor (Sentinel-1 SAR + S2 + CBERS-4A WPM). Cada evento validado por al menos dos sensores independientes.",
  alternates: { canonical: "/eventos" },
  openGraph: {
    title: "Eventos extremos — inundaciones",
    description:
      "Timeline de inundaciones detectadas y validadas en Posadas, con áreas afectadas y polígonos por evento.",
    type: "article",
    url: "/eventos",
  },
};

export default async function EventosPage() {
  const [rows, collection, freshness] = await Promise.all([
    getEventosInundacion(),
    getPoligonosBarrios(),
    getDatasetFreshness("cbers_inundacion"),
  ]);

  return (
    <>
      <Disclaimer />
      <main className="container-obs py-8">
        <nav
          aria-label="Migas"
          className="mb-4 text-sm text-secondary dark:text-dk-muted"
        >
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            Eventos extremos
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Eventos extremos · Inundaciones · Multi-sensor
          </p>
          <h1
            className="mt-2 font-bold"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Eventos de inundación detectados
          </h1>
          <div className="mt-3">
            <DataFreshness
              dataset="cbers_inundacion"
              lastUpdated={freshness.lastUpdated}
              frequency={freshness.frequency}
            />
          </div>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Eventos identificados por un composite combinando radar (
            <TerminoGlosario id="sentinel-1">Sentinel-1</TerminoGlosario>
            , que ve a través de las nubes) y óptico (
            <TerminoGlosario id="sentinel-2">Sentinel-2</TerminoGlosario>{" "}
            +{" "}
            <TerminoGlosario id="cbers">CBERS-4A WPM</TerminoGlosario>).
            Cada evento es validado por al menos dos sensores
            independientes antes de publicarse.
          </p>
        </header>

        <section
          aria-labelledby="timeline"
          className="rounded-lg border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface sm:p-6"
        >
          <h2 id="timeline" className="sr-only">
            Línea de tiempo de eventos
          </h2>
          <EventosInundacion rows={rows} poligonos={collection} compact />
        </section>

        <section
          aria-labelledby="metodologia"
          className="mt-10 grid gap-4 md:grid-cols-2"
        >
          <h2 id="metodologia" className="sr-only">
            Cómo se detectan los eventos
          </h2>
          <div className="card">
            <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
              Por qué multi-sensor
            </h3>
            <p className="mt-2 text-sm text-neutral-text dark:text-dk-text">
              Las inundaciones suelen coincidir con cielos cubiertos,
              cuando los satélites ópticos no pueden ver el suelo.
              Sentinel-1 (radar) atraviesa nubes y detecta el cambio en
              la retrodispersión que produce el agua nueva. Una vez que
              el cielo aclara, el óptico confirma la mancha y descarta
              falsos positivos por humedad de suelo.
            </p>
            <p className="mt-2 text-xs italic text-neutral-muted dark:text-dk-muted">
              Estrategia clásica de hidrología satelital — consenso
              radar/óptico para reducir falsas alarmas.
            </p>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
              Niveles de confianza
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-text dark:text-dk-text">
              <li>
                <strong className="text-emerald-700 dark:text-emerald-400">
                  Alta
                </strong>
                : tres sensores coinciden y la mancha persiste &gt; 24 h.
              </li>
              <li>
                <strong className="text-amber-700 dark:text-amber-300">
                  Media
                </strong>
                : dos sensores coinciden o la mancha es transitoria.
              </li>
              <li>
                <strong className="text-rose-700 dark:text-rose-400">
                  Baja
                </strong>
                : un solo sensor detecta y los otros no la corroboran;
                publicado para trazabilidad pero requiere chequeo manual.
              </li>
            </ul>
          </div>
        </section>

        <section className="mt-10 text-sm text-neutral-text dark:text-dk-text">
          <p>
            La detección de inundaciones complementa los datos de lluvia
            por <TerminoGlosario id="chirps">CHIRPS</TerminoGlosario> que
            aparecen en cada ficha de barrio: lluvia es la causa, este
            timeline son los efectos territoriales medidos. Para riesgo
            de inundación a futuro y vulnerabilidad estructural, ver el{" "}
            <Link
              href="/prioridades"
              className="text-primary underline dark:text-dk-primary"
            >
              ranking de prioridades
            </Link>{" "}
            y la{" "}
            <Link
              href="/metodologia"
              className="text-primary underline dark:text-dk-primary"
            >
              metodología
            </Link>
            .
          </p>
        </section>
      </main>
    </>
  );
}
