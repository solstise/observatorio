// Hub /decision — landing del eje "decisión política".
//
// Server Component. Agrupa los dos insumos técnicos para política pública:
//   1. Prioridades de inversión (ranking 62 barrios).
//   2. Comparador 2 barrios lado a lado.
//
// Además renderiza una tabla compacta con el top 5 de urgencias para que
// un funcionario que aterriza acá ya vea "qué barrios prender" sin tener
// que entrar al ranking completo.
//
// Los CSVs se leen desde data.server (ranking.csv + distancias.csv) en
// SSR; si todavía no están en disco, degradamos con [] y mostramos un
// placeholder informativo en lugar de crashear.

import Link from "next/link";
import type { Metadata } from "next";

import { HubOverviewCard } from "@/components/HubOverviewCard";
import {
  getDistanciasSociales,
  getPoligonosBarrios,
  getRankingPolitico,
} from "@/lib/data.server";
import type {
  PoligonoFeature,
  RankingPoliticoRow,
  SocialDistanciasRow,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Decisión · dónde y cómo intervenir",
  description:
    "Insumos técnicos para política pública: ranking de prioridad de inversión por barrio, comparador lado a lado, y atajos al top de cada dimensión del Observatorio Urbano Posadas.",
  alternates: { canonical: "/decision" },
};

interface FilaTopUrgencia {
  poligono_id: string;
  nombre: string;
  ranking: number;
  vulnerabilidad: number | null;
  uhi_verano: number | null;
  dist_promedio_m: number | null;
  indice_prioridad: number;
}

function calcDistPromedio(d: SocialDistanciasRow | undefined): number | null {
  if (!d) return null;
  const xs = [d.dist_caps_m, d.dist_escuela_m, d.dist_hospital_m, d.dist_transporte_m].filter(
    (v): v is number => v !== null && v !== undefined && !Number.isNaN(v),
  );
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function formatoDistancia(distM: number | null): string {
  if (distM === null || distM === undefined || Number.isNaN(distM)) return "s/d";
  if (distM < 1000) return `${Math.round(distM)} m`;
  return `${(distM / 1000).toFixed(2)} km`;
}

function formatoNum(n: number | null, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

function buildTopUrgencias(
  ranking: RankingPoliticoRow[],
  distancias: SocialDistanciasRow[],
  features: PoligonoFeature[],
  topN = 5,
): FilaTopUrgencia[] {
  const featureById = new Map(features.map((f) => [f.properties.id, f]));
  const distById = new Map(distancias.map((d) => [d.poligono_id, d]));
  return [...ranking]
    .sort((a, b) => a.ranking - b.ranking)
    .slice(0, topN)
    .map((r) => ({
      poligono_id: r.poligono_id,
      nombre: featureById.get(r.poligono_id)?.properties.nombre ?? r.poligono_id,
      ranking: r.ranking,
      vulnerabilidad: r.vulnerabilidad,
      uhi_verano: r.uhi_verano,
      dist_promedio_m: calcDistPromedio(distById.get(r.poligono_id)),
      indice_prioridad: r.indice_prioridad,
    }));
}

export default async function DecisionHubPage() {
  const [ranking, distancias, collection] = await Promise.all([
    getRankingPolitico(),
    getDistanciasSociales(),
    getPoligonosBarrios(),
  ]);

  const totalBarrios = collection.features.length;
  // El #1 del ranking = mayor urgencia. Mostramos su nombre como KPI de
  // la card de prioridades para que sea consumible sin entrar.
  const top1 = [...ranking].sort((a, b) => a.ranking - b.ranking)[0];
  const top1Nombre =
    top1
      ? collection.features.find((f) => f.properties.id === top1.poligono_id)
          ?.properties.nombre ?? top1.poligono_id
      : null;

  const topUrgencias = buildTopUrgencias(ranking, distancias, collection.features, 5);

  return (
    <main className="container-obs py-10">
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
          Decisión · dónde y cómo intervenir
        </p>
        <h1
          className="mt-2 font-bold text-primary dark:text-dk-primary"
          style={{ fontSize: "var(--fs-h1)" }}
        >
          Decisión · dónde y cómo intervenir
        </h1>
        <p className="mt-3 lead text-neutral-text dark:text-dk-text">
          Insumos técnicos para política pública: ranking de prioridad de
          inversión por barrio, comparador lado a lado, y atajos al top de
          cada dimensión.
        </p>
      </header>

      <section
        aria-labelledby="hub-decision-cards"
        className="mb-12"
      >
        <h2 id="hub-decision-cards" className="sr-only">
          Sub-secciones de Decisión
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <HubOverviewCard
            href="/decision/prioridades"
            title="Prioridades de inversión"
            description="Ranking político de los 62 polígonos por urgencia, combinando vulnerabilidad, UHI de verano y carencia de servicios."
            chip="Ranking 62 barrios"
            tone="accent"
            icon={<IconTarget />}
            kpi={
              top1 && top1Nombre
                ? {
                    value: top1Nombre,
                    label: "Barrio #1 prioridad",
                  }
                : {
                    value: "—",
                    label: "Ranking aún no calculado",
                  }
            }
          />
          <HubOverviewCard
            href="/decision/comparar"
            title="Comparador 2 barrios"
            description="Vista lado a lado de hasta 4 barrios: superficie, población, edificación, cobertura de servicios y calor."
            chip="Lado a lado"
            tone="primary"
            icon={<IconSplit />}
            kpi={{
              value: String(totalBarrios),
              label: "Barrios disponibles",
            }}
          />
        </div>
      </section>

      <section
        aria-labelledby="top-urgencias"
        className="rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface"
      >
        <header className="border-b border-neutral-border p-4 dark:border-dk-border">
          <h2
            id="top-urgencias"
            className="text-lg font-semibold text-primary dark:text-dk-primary"
          >
            Top 5 urgencias
          </h2>
          <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
            Los cinco barrios con mayor índice de prioridad. Para el ranking
            completo de los {totalBarrios} barrios, abrí{" "}
            <Link
              href="/decision/prioridades"
              className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
            >
              prioridades de inversión
            </Link>
            .
          </p>
        </header>

        {topUrgencias.length === 0 ? (
          <p
            role="status"
            className="p-4 text-sm italic text-neutral-muted dark:text-dk-muted"
          >
            Ranking todavía no disponible. Pasá por la página de prioridades
            cuando el pipeline termine de correr.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Top cinco barrios con mayor índice de prioridad de inversión.
              </caption>
              <thead className="border-b border-neutral-border bg-neutral-50 text-left text-xs uppercase tracking-wider text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    #
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Barrio
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Vulnerab.
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    UHI verano
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Dist. promedio
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Índice
                  </th>
                </tr>
              </thead>
              <tbody>
                {topUrgencias.map((f) => (
                  <tr
                    key={f.poligono_id}
                    className="border-b border-neutral-border/60 last:border-0 bg-accent-50/40 dark:border-dk-border/60 dark:bg-amber-900/15"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      <span
                        className="inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-white"
                        aria-label={`Posición ${f.ranking}`}
                      >
                        {f.ranking}
                      </span>
                    </td>
                    <th
                      scope="row"
                      className="px-3 py-2 text-left font-medium text-primary dark:text-dk-primary"
                    >
                      <Link
                        href={`/poligono/${f.poligono_id}`}
                        className="hover:underline"
                      >
                        {f.nombre}
                      </Link>
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                      {formatoNum(f.vulnerabilidad, 1)}
                      {f.vulnerabilidad !== null && (
                        <span className="ml-1 text-[10px] text-neutral-muted">
                          /100
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                      {f.uhi_verano !== null
                        ? `${f.uhi_verano > 0 ? "+" : ""}${f.uhi_verano.toFixed(1)} °C`
                        : "s/d"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                      {formatoDistancia(f.dist_promedio_m)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-semibold tabular-nums text-primary dark:text-dk-primary">
                        {(f.indice_prioridad * 100).toFixed(0)}
                      </span>
                      <span className="ml-1 text-[10px] text-neutral-muted">
                        /100
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="border-t border-neutral-border p-4 text-xs text-neutral-muted dark:border-dk-border dark:text-dk-muted">
          Mayor índice = mayor prioridad. El ranking combina vulnerabilidad
          (40%), UHI verano (30%) y carencia de servicios (30%). Es un insumo
          de política pública a nivel barrio, no aplica a decisiones
          individuales. Ver{" "}
          <Link
            href="/datos/metodologia"
            className="underline-offset-2 hover:underline dark:text-dk-primary"
          >
            metodología
          </Link>
          .
        </footer>
      </section>
    </main>
  );
}

// Icono "diana" para la card de prioridades — sugiere "dónde apuntar".
function IconTarget() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

// Icono "split" para la card de comparador — dos paneles lado a lado.
function IconSplit() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="8" height="16" rx="1.5" />
      <rect x="13" y="4" width="8" height="16" rx="1.5" />
    </svg>
  );
}
