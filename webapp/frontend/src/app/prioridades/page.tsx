// Página /prioridades — ranking político de inversión por polígono.
//
// Server Component que carga los CSVs `social/ranking.csv` y
// `social/distancias.csv` (script 54 + 53) y muestra una tabla ordenada
// con todos los polígonos. Los Top 10 se destacan visualmente.
//
// Datos: scripts/54_ranking_politico.py — combina vulnerabilidad (0-100,
// script 35), UHI estacional verano (script 49) y distancias mínimas a
// CAPS, escuela, hospital y transporte (script 53). Pesos por defecto:
// 0.4 vulnerabilidad, 0.3 UHI, 0.3 carencia de acceso a servicios.
//
// Importante: este ranking es un INSUMO TÉCNICO PARA POLÍTICA PÚBLICA a
// nivel barrio. NO debe usarse para decisiones individuales. Ver
// /metodologia y docs/metodologia_servicios.md.

import Link from "next/link";
import type { Metadata } from "next";

import { Disclaimer } from "@/components/Disclaimer";
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
  title: "Prioridades de inversión",
  description:
    "Ranking político de prioridad de inversión por polígono en Posadas, calculado a partir de vulnerabilidad territorial, isla de calor de verano y carencia de acceso a servicios públicos.",
};

interface FilaRanking extends RankingPoliticoRow {
  nombre: string;
  dist_promedio_m: number | null;
}

function buildFilas(
  ranking: RankingPoliticoRow[],
  distancias: SocialDistanciasRow[],
  features: PoligonoFeature[],
): FilaRanking[] {
  const featureById = new Map(features.map((f) => [f.properties.id, f]));
  const distById = new Map(distancias.map((d) => [d.poligono_id, d]));
  return ranking.map((r) => {
    const feature = featureById.get(r.poligono_id);
    const dist = distById.get(r.poligono_id);
    let promedio: number | null = null;
    if (dist) {
      const xs = [
        dist.dist_caps_m,
        dist.dist_escuela_m,
        dist.dist_hospital_m,
        dist.dist_transporte_m,
      ].filter(
        (v): v is number => v !== null && v !== undefined && !Number.isNaN(v),
      );
      if (xs.length > 0) {
        promedio = xs.reduce((a, b) => a + b, 0) / xs.length;
      }
    }
    return {
      ...r,
      nombre: feature?.properties.nombre ?? r.poligono_id,
      dist_promedio_m: promedio,
    };
  });
}

function formatoDistancia(distM: number | null): string {
  if (distM === null || distM === undefined || Number.isNaN(distM)) {
    return "s/d";
  }
  if (distM < 1000) {
    return `${Math.round(distM)} m`;
  }
  return `${(distM / 1000).toFixed(2)} km`;
}

function formatoNum(n: number | null, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

export default async function PrioridadesPage() {
  const [ranking, distancias, collection] = await Promise.all([
    getRankingPolitico(),
    getDistanciasSociales(),
    getPoligonosBarrios(),
  ]);

  const filas = buildFilas(ranking, distancias, collection.features);
  const total = filas.length;

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
            Prioridades
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Capa social — fase 3
          </p>
          <h1
            className="mt-2 font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Prioridades de inversión política
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Ranking de los {total} polígonos monitoreados por su prioridad de
            inversión, combinando tres dimensiones: <strong>vulnerabilidad</strong>{" "}
            territorial (40%), <strong>isla de calor</strong> de verano (30%) y{" "}
            <strong>carencia de acceso</strong> a servicios públicos (30%).
            Mayor posición = mayor prioridad.
          </p>
          <div className="mt-4 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-neutral-text dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100">
            <strong>Importante:</strong> este ranking es un{" "}
            <em>insumo técnico para priorizar inversión a nivel barrio</em>.{" "}
            <strong>NO</strong> sirve para decidir sobre viviendas individuales,
            asignar subsidios personales ni alertas a personas específicas.{" "}
            <Link
              href="/metodologia"
              className="font-medium text-primary underline-offset-2 hover:underline dark:text-amber-50 dark:underline"
            >
              Ver metodología
            </Link>
            .
          </div>
        </header>

        {filas.length === 0 ? (
          <div
            role="status"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
          >
            El ranking está en preparación. Asegurate de haber corrido los
            scripts <code>53_servicios_distancias.py</code> y{" "}
            <code>54_ranking_politico.py</code>.
          </div>
        ) : (
          <section
            aria-labelledby="tabla-prioridades"
            className="rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface"
          >
            <h2 id="tabla-prioridades" className="sr-only">
              Tabla de prioridades
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Ranking de polígonos ordenados por prioridad de inversión
                  política. Los primeros diez se destacan en color durazno.
                </caption>
                <thead className="border-b border-neutral-border bg-neutral-50 text-left text-xs uppercase tracking-wider text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      #
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Polígono
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Vulnerabilidad
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      UHI verano (°C)
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Dist. promedio
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Índice prioridad
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => {
                    const top10 = f.ranking <= 10;
                    return (
                      <tr
                        key={f.poligono_id}
                        className={[
                          "border-b border-neutral-border/60 last:border-0 dark:border-dk-border/60",
                          top10
                            ? "bg-accent-50/60 dark:bg-amber-900/20"
                            : "hover:bg-neutral-50 dark:hover:bg-dk-elevated/60",
                        ].join(" ")}
                      >
                        <td className="px-3 py-2 font-mono text-xs tabular-nums text-secondary dark:text-dk-muted">
                          <span
                            className={[
                              "inline-flex h-6 min-w-[1.75rem] items-center justify-center rounded-full px-1 text-[11px] font-bold",
                              top10
                                ? "bg-accent text-white"
                                : "bg-neutral-200 text-primary dark:bg-dk-elevated dark:text-dk-text",
                            ].join(" ")}
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
                          <p className="font-mono text-[10px] font-normal text-neutral-muted dark:text-dk-muted">
                            {f.poligono_id}
                          </p>
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
                            ? `${f.uhi_verano > 0 ? "+" : ""}${f.uhi_verano.toFixed(1)}`
                            : "s/d"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                          {formatoDistancia(f.dist_promedio_m)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <BarraPrioridad valor={f.indice_prioridad} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se calcula
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Vulnerabilidad (40%)</strong>: índice 0-100 que combina
              crecimiento de viviendas, densidad, distancia a CAPS y escuela,
              cobertura de pavimento y riesgo de inundación. Versión{" "}
              <code>v0-borrador</code>.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Script: <code>35_indice_vulnerabilidad.py</code>.
              </span>
            </li>
            <li>
              <strong>UHI verano (30%)</strong>: delta de temperatura de
              superficie del verano más reciente, comparado con el campo
              cercano. Mide cuánto más caliente está el barrio cuando el calor
              importa más para salud.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Script: <code>49_calor_pipeline.py</code>, fuente Landsat 8/9.
              </span>
            </li>
            <li>
              <strong>Carencia de acceso a servicios (30%)</strong>: promedio
              normalizado de las distancias mínimas a CAPS, escuela, hospital
              y transporte público. Mayor distancia = mayor carencia.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Script: <code>53_servicios_distancias.py</code>, fuentes:
                Ministerio de Salud Misiones (CAPS, hospitales) + OSM
                (escuelas, transporte).
              </span>
            </li>
            <li>
              <strong>Para qué NO sirve</strong>: no es una herramienta para
              decidir sobre viviendas o personas individuales, ni para
              alertas a un domicilio en particular. Es información agregada
              por barrio, para política pública y planificación
              presupuestaria.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}

// Barra horizontal compacta. Color graduado por nivel de prioridad: en los
// extremos altos usa el accent (durazno) consistente con el resto del sitio,
// en bajos usa el primary (azul).
function BarraPrioridad({ valor }: { valor: number }) {
  const pct = Math.max(0, Math.min(100, valor * 100));
  const color =
    pct >= 65
      ? "#c97d3c"
      : pct >= 50
        ? "#d99566"
        : pct >= 35
          ? "#5a7a9c"
          : "#1a3a5c";
  return (
    <div
      className="ml-auto flex items-center gap-2"
      aria-label={`Índice de prioridad ${pct.toFixed(0)} sobre 100`}
    >
      <div
        className="h-2 w-24 rounded-full bg-primary-50 dark:bg-dk-elevated"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-10 text-right text-sm font-semibold tabular-nums text-primary dark:text-dk-primary">
        {pct.toFixed(0)}
      </span>
    </div>
  );
}
