// Página /datos/historia — slider temporal 1999-2026 con imágenes Landsat+CBERS.
// Vivía en /historia como hub top-level pero se reubicó bajo /datos porque
// las imágenes a 30 m son más una herramienta documental que decisional —
// para cambios accionables a escala de barrio, los indicadores derivados
// (built %, edif 2018→2026, gentrificación) en /indicadores son la vista
// canónica. Mantengo la timeline acá para prensa, IDE Misiones y consulta
// general. Server Component que pre-carga la serie y delega el render
// interactivo a CBERSHistoricoTimeline (client).

import dynamic from "next/dynamic";
import Link from "next/link";
import type { Metadata } from "next";

import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { TerminoGlosario } from "@/components/TerminoGlosario";
import { getCbersHistorico } from "@/lib/data.server";
import { getDatasetFreshness } from "@/lib/data-freshness";

// Cargamos el componente dinámicamente para no inflar el bundle inicial.
const CBERSHistoricoTimeline = dynamic(() =>
  import("@/components/CBERSHistoricoTimeline").then((m) => ({
    default: m.CBERSHistoricoTimeline,
  })),
);

export const metadata: Metadata = {
  title: "Historia satelital de Posadas (1999-2026)",
  description:
    "Recorrido visual de Posadas (Misiones, AR) a lo largo de 27 años con Landsat-5/7/8 (1999-2014) y CBERS-4 (2015+). Imágenes anuales con badges de sensor y calidad.",
  alternates: { canonical: "/datos/historia" },
  openGraph: {
    title: "Historia satelital de Posadas",
    description:
      "27 años de evolución urbana vista desde el espacio (1999-2026, Landsat + CBERS).",
    type: "article",
    url: "/datos/historia",
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
          <Link href="/datos" className="hover:underline">
            Datos
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            Línea de tiempo 1999-2026
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Historia · Landsat + CBERS · 1999–2026
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
            Recorré la evolución urbana de Posadas con dos generaciones de
            satélites combinadas para cubrir 27 años sin gaps: <strong>Landsat-5/7/8</strong>{" "}
            (USGS/NASA, 30 m) para 1999-2014 y <strong>CBERS-4</strong> del{" "}
            <TerminoGlosario id="inpe">INPE</TerminoGlosario> Brasil (10 m)
            desde 2015. La serie original CBERS-1/2/2B existe pero solo se
            distribuye con registro manual en INPE CDSR, por lo que Landsat
            llena ese tramo con calidad equivalente o mejor (cobertura SWIR
            completa, 0 % de nubes en todas las escenas elegidas).
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
              Landsat-5/7/8 (1999-2014)
            </h3>
            <p className="mt-2 text-xs text-neutral-text dark:text-dk-text">
              <strong>Landsat-5 TM</strong> (1984-2013, 30 m) cubre la mayor
              parte del período por su cadencia y limpieza. <strong>Landsat-7
              ETM+</strong> (1999+) aporta panchromatic 15 m antes del fallo
              SLC (may-2003) y se usa también para 2012. <strong>Landsat-8
              OLI</strong> (2013+) cubre 2013-2014. Bandas SWIR completas a
              30 m permiten NDBI, NDWI y ACRI desde 1999. Fuente: Microsoft
              Planetary Computer STAC sobre USGS Collection 2 Level-2. La
              serie original CBERS-1/2/2B requiere registro manual en INPE
              CDSR y no fue incluida en este pipeline.
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
              href="/indicadores/calor"
              className="text-primary underline dark:text-dk-primary"
            >
              calor urbano
            </Link>{" "}
            (LST mensual desde 2018) y la{" "}
            <Link
              href="/datos/validacion"
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
