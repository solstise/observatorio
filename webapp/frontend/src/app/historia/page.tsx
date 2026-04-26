// Página /historia — slider temporal 1999-2026 con imágenes pansharpen
// históricas de Posadas usando lo mejor disponible cada año (CBERS-1/2/2B/4/4A
// y, donde corresponda, HRC). Server Component que pre-carga la serie y
// delega el render interactivo a CBERSHistoricoTimeline (client).

import dynamic from "next/dynamic";
import Link from "next/link";
import type { Metadata } from "next";

import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { TerminoGlosario } from "@/components/TerminoGlosario";
import { getCbersHistorico } from "@/lib/data.server";
import { getDatasetFreshness } from "@/lib/data-freshness";

// Cargamos el componente dinámicamente para no inflar el bundle inicial:
// el slider+img live solo en /historia, ninguna otra página lo usa.
const CBERSHistoricoTimeline = dynamic(() =>
  import("@/components/CBERSHistoricoTimeline").then((m) => ({
    default: m.CBERSHistoricoTimeline,
  })),
);

export const metadata: Metadata = {
  title: "Historia satelital de Posadas (1999-2026)",
  description:
    "Recorrido visual de Posadas (Misiones, AR) a lo largo de 27 años usando los satélites CBERS del INPE. Imágenes pansharpen anuales con badges de calidad por sensor.",
  alternates: { canonical: "/historia" },
  openGraph: {
    title: "Historia satelital de Posadas",
    description:
      "27 años de evolución urbana vista desde el espacio (1999-2026, CBERS INPE).",
    type: "article",
    url: "/historia",
  },
};

export default async function HistoriaPage() {
  // Cargamos la serie + freshness en paralelo. Si T1 todavía no publicó
  // el CSV, getCbersHistorico devuelve [] y el componente cliente
  // muestra el placeholder "Datos en preparación".
  const [serie, freshness] = await Promise.all([
    getCbersHistorico(),
    getDatasetFreshness("cbers_historico"),
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
            Historia satelital
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Historia · CBERS · 1999–2026
          </p>
          <h1
            className="mt-2 font-bold"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Posadas a lo largo de 27 años
          </h1>
          <div className="mt-3">
            <DataFreshness
              dataset="cbers_historico"
              lastUpdated={freshness.lastUpdated}
              frequency={freshness.frequency}
            />
          </div>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Recorré la evolución urbana de Posadas usando un único proveedor
            satelital (<TerminoGlosario id="inpe">INPE</TerminoGlosario>{" "}
            Brasil) a lo largo de toda la serie. El programa{" "}
            <TerminoGlosario id="cbers">CBERS</TerminoGlosario> mantiene
            datos abiertos desde 1999 — más de dos décadas de observación
            consistente, gratis.
          </p>
        </header>

        <section
          aria-labelledby="timeline"
          className="rounded-lg border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface sm:p-6"
        >
          <h2 id="timeline" className="sr-only">
            Línea de tiempo de imágenes históricas
          </h2>
          <CBERSHistoricoTimeline serie={serie} />
        </section>

        <section
          aria-labelledby="leyenda"
          className="mt-10 grid gap-4 md:grid-cols-3"
        >
          <h2 id="leyenda" className="sr-only">
            Leyenda y contexto técnico
          </h2>
          <div className="card">
            <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
              CBERS-1, 2 y 2B (1999-2010)
            </h3>
            <p className="mt-2 text-xs text-neutral-text dark:text-dk-text">
              Primera generación del programa: cámaras CCD (20 m) e IRMSS
              (80 m). El CBERS-2B incluyó la{" "}
              <TerminoGlosario id="hrc">HRC</TerminoGlosario> a 2,7 m,
              vigente solo entre 2007 y 2010. La calibración radiométrica
              de esta etapa es menos estable que la flota actual y se
              etiqueta como{" "}
              <em className="text-amber-700 dark:text-amber-300">
                preliminar
              </em>
              .
            </p>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
              CBERS-4 (2014+)
            </h3>
            <p className="mt-2 text-xs text-neutral-text dark:text-dk-text">
              Lanzado en diciembre de 2014, opera todavía. Aporta{" "}
              <TerminoGlosario id="pan5">PAN5</TerminoGlosario> (5 m B&N),
              la cámara MUX/PanMUX (10 m / 20 m color) y el sensor{" "}
              <TerminoGlosario id="irs-cbers">IRS</TerminoGlosario> (40 m
              térmico + 80 m SWIR) para LST y validación de incendios.
            </p>
          </div>
          <div className="card">
            <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
              CBERS-4A (2019+)
            </h3>
            <p className="mt-2 text-xs text-neutral-text dark:text-dk-text">
              Activo desde diciembre de 2019. Suma la{" "}
              <TerminoGlosario id="pansharpen">WPM</TerminoGlosario> (pan
              8 m + multispectral 16 m, fusionables a 8 m color) y la{" "}
              <TerminoGlosario id="awfi">AWFI</TerminoGlosario> de campo
              amplio (64 m, swath 866 km, revisita 5 días) para cobertura
              continental complementaria a Sentinel-2.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="cita"
          className="mt-12 rounded-md border border-neutral-border bg-neutral-50 p-5 text-sm text-neutral-text dark:border-dk-border dark:bg-dk-elevated/40 dark:text-dk-text"
        >
          <h2
            id="cita"
            className="text-sm font-semibold text-primary dark:text-dk-primary"
          >
            Cita y reproducibilidad
          </h2>
          <p className="mt-2">
            Datos: Instituto Nacional de Pesquisas Espaciais (INPE), Brasil.
            Programa{" "}
            <a
              href="http://www.cbers.inpe.br/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline dark:text-dk-primary"
            >
              cbers.inpe.br
            </a>
            . Catálogo abierto bajo registro libre. Las imágenes
            pansharpen mostradas se generan con scripts del observatorio
            (composite anual + IHS/Brovey por banda) y se publican en{" "}
            <code>/data/media/cbers_historico/</code>.
          </p>
          <p className="mt-2 text-xs italic text-neutral-muted dark:text-dk-muted">
            Para análisis cuantitativo de los cambios visibles en este
            timeline, complementá con la página de{" "}
            <Link
              href="/calor"
              className="text-primary underline dark:text-dk-primary"
            >
              calor urbano
            </Link>{" "}
            (LST mensual desde 2018) y la{" "}
            <Link
              href="/validacion"
              className="text-primary underline dark:text-dk-primary"
            >
              validación cruzada de índices
            </Link>{" "}
            (NDBI/NDVI S2 vs CBERS).
          </p>
        </section>
      </main>
    </>
  );
}
