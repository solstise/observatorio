// Página /datos/glosario — destino dedicado al glosario completo.
//
// El glosario también vive como sección dentro de /datos/metodologia#glosario
// (los tooltips <TerminoGlosario> linkean a ese ancla). Esta página es la
// versión "directa" para quien busca solo definiciones, sin tener que
// scrollear toda la metodología.
//
// Server Component. El componente <GlosarioCompleto> es client (tiene un
// buscador con useState) — Next.js lo monta en una isla cliente sin
// problema, ya que la página padre no usa hooks.

import type { Metadata } from "next";
import Link from "next/link";

import { GlosarioCompleto } from "@/components/GlosarioCompleto";
import { GLOSARIO } from "@/lib/glosario";

export const metadata: Metadata = {
  title: "Glosario de términos",
  description:
    "Definiciones de los conceptos técnicos del Observatorio Urbano Posadas: UHI, LST, NDBI, vulnerabilidad, anomalía SAR, ciudad de 15 minutos, Gini espacial y más.",
  alternates: { canonical: "/datos/glosario" },
};

const TOTAL = GLOSARIO.length;

export default function GlosarioPage() {
  return (
    <article className="container-obs py-10">
      <nav
        aria-label="Migas"
        className="mb-4 text-sm text-secondary dark:text-dk-muted"
      >
        <Link href="/datos" className="hover:underline">
          Datos
        </Link>{" "}
        <span aria-hidden>/</span>{" "}
        <span className="text-neutral-muted dark:text-dk-muted">Glosario</span>
      </nav>

      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
          Datos · glosario
        </p>
        <h1
          className="mt-2 font-bold text-primary dark:text-dk-primary"
          style={{ fontSize: "var(--fs-h1)" }}
        >
          Glosario de términos
        </h1>
        <p className="mt-3 lead text-neutral-text dark:text-dk-text">
          {TOTAL} definiciones de los conceptos técnicos del observatorio.
          Buscá por nombre, alias o categoría. Los enlaces{" "}
          <code className="rounded bg-primary-50 px-1 py-0.5 text-[0.85em] text-primary dark:bg-dk-elevated dark:text-dk-primary">
            #glosario-uhi
          </code>{" "}
          de los tooltips de otras páginas llevan a esta misma lista
          (también disponible inline en{" "}
          <Link
            href="/datos/metodologia#glosario"
            className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
          >
            metodología
          </Link>
          ).
        </p>
      </header>

      <section className="mt-8" aria-labelledby="glosario-listado">
        <h2 id="glosario-listado" className="sr-only">
          Listado completo
        </h2>
        <GlosarioCompleto />
      </section>
    </article>
  );
}
