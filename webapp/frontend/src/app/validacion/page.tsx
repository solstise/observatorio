// Página /validacion — validación cruzada de índices urbanos (NDBI/NDVI)
// entre Sentinel-2 y CBERS-4A. Cuando dos satélites distintos coinciden
// en la medición, la confianza del indicador es mayor; cuando difieren,
// hay que mirar con cuidado (nubes residuales, scaling distinto, sombras).
//
// La página es Server Component que pre-carga las filas + polígonos para
// resolver ID → nombre, y delega el render interactivo a NDBINDVICrossVal.

import dynamic from "next/dynamic";
import Link from "next/link";
import type { Metadata } from "next";

import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { TerminoGlosario } from "@/components/TerminoGlosario";
import {
  getNdbiNdviCrossval,
  getPoligonosBarrios,
} from "@/lib/data.server";
import { getDatasetFreshness } from "@/lib/data-freshness";

const NDBINDVICrossVal = dynamic(() =>
  import("@/components/NDBINDVICrossVal").then((m) => ({
    default: m.NDBINDVICrossVal,
  })),
);

export const metadata: Metadata = {
  title: "Validación cruzada de índices urbanos",
  description:
    "Comparación NDBI/NDVI Sentinel-2 vs CBERS-4A por barrio. Cuando dos satélites distintos coinciden, la confianza del indicador es mayor.",
  alternates: { canonical: "/validacion" },
  openGraph: {
    title: "Validación cruzada Sentinel-2 vs CBERS",
    description:
      "Tabla por barrio con NDBI/NDVI medidos por dos sensores independientes y diferencia relativa porcentual.",
    type: "article",
    url: "/validacion",
  },
};

export default async function ValidacionPage() {
  const [rows, collection, freshness] = await Promise.all([
    getNdbiNdviCrossval(),
    getPoligonosBarrios(),
    getDatasetFreshness("cbers_indices"),
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
            Validación cruzada
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Validación · Multi-sensor · S2 + CBERS
          </p>
          <h1
            className="mt-2 font-bold"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Validación cruzada de índices urbanos
          </h1>
          <div className="mt-3">
            <DataFreshness
              dataset="cbers_indices"
              lastUpdated={freshness.lastUpdated}
              frequency={freshness.frequency}
            />
          </div>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Cuando dos satélites distintos llegan al mismo número, la
            confianza del indicador sube. Comparamos los índices urbanos
            <TerminoGlosario id="ndbi">{" NDBI "}</TerminoGlosario>
            (construcción) y{" "}
            <TerminoGlosario id="ndvi">NDVI</TerminoGlosario>{" "}
            (vegetación) calculados por{" "}
            <TerminoGlosario id="sentinel-2">Sentinel-2</TerminoGlosario>{" "}
            (10 m, ESA) versus{" "}
            <TerminoGlosario id="cbers">CBERS-4A WPM</TerminoGlosario>{" "}
            (16 m, INPE).
          </p>
        </header>

        <section
          aria-labelledby="tabla"
          className="rounded-lg border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface sm:p-6"
        >
          <h2 id="tabla" className="sr-only">
            Tabla de validación cruzada por barrio
          </h2>
          <NDBINDVICrossVal rows={rows} poligonos={collection} />
        </section>

        <section
          aria-labelledby="explicacion"
          className="mt-10 grid gap-4 md:grid-cols-2"
        >
          <h2 id="explicacion" className="sr-only">
            Cómo leer la validación cruzada
          </h2>
          <div className="card">
            <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
              Por qué validar con dos satélites
            </h3>
            <p className="mt-2 text-sm text-neutral-text dark:text-dk-text">
              Cada satélite tiene errores propios (calibración, nubes,
              sombras, ángulo de pasada). Si Sentinel-2 dice que un barrio
              tiene NDBI = 0.32 y CBERS-4A dice 0.30, podemos confiar más
              que en cualquiera de los dos por separado. Si difieren un
              30 %, hay algo raro: una nube residual, un sombreado fuerte,
              o un scaling distinto en una de las pasadas.
            </p>
            <p className="mt-2 text-xs italic text-neutral-muted dark:text-dk-muted">
              Es el mismo razonamiento que en{" "}
              <TerminoGlosario id="composite-multifuente">
                composites multi-fuente
              </TerminoGlosario>
              : la redundancia inter-sensor es la mejor defensa contra
              errores sistemáticos puntuales.
            </p>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
              Cómo interpretar los colores
            </h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-text dark:text-dk-text">
              <li>
                <strong className="text-emerald-700 dark:text-emerald-400">
                  Verde
                </strong>{" "}
                (&lt;10 % de diferencia): los dos sensores ven lo mismo,
                confianza alta.
              </li>
              <li>
                <strong className="text-amber-700 dark:text-amber-300">
                  Amarillo
                </strong>{" "}
                (10–20 %): chequear si hay nubes parciales, sombras o
                discrepancias temporales (composites de meses distintos).
              </li>
              <li>
                <strong className="text-rose-700 dark:text-rose-400">
                  Rojo
                </strong>{" "}
                (≥20 %): discrepancia fuerte, el dato en sí amerita
                inspección visual antes de tomarlo como referencia.
              </li>
            </ul>
          </div>
        </section>

        <section className="mt-10 text-sm text-neutral-text dark:text-dk-text">
          <p>
            Para entender cómo se construye cada cifra desde el píxel hasta
            el dataset publicado, visitá la{" "}
            <Link
              href="/metodologia"
              className="text-primary underline dark:text-dk-primary"
            >
              metodología
            </Link>
            . Para ver cómo cambia la cobertura mes a mes (S2 + AWFI),{" "}
            entrá a la{" "}
            <Link
              href="/historia"
              className="text-primary underline dark:text-dk-primary"
            >
              historia satelital
            </Link>
            .
          </p>
        </section>
      </main>
    </>
  );
}
