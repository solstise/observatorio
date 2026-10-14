// Card de riesgo de dengue — Capa 2.
//
// Modelo heurístico inspirado en literatura UNL/INTA Misiones: combina
// (a) precipitación de verano y lluvia próxima 14 d (criaderos),
// (b) temperatura nocturna mínima (acelera ciclo del Aedes),
// (c) densidad poblacional + vulnerabilidad (exposición humana),
// (d) déficit de canopy (sombra y permeabilidad).
//
// Muestra el Top 5 con mayor score, badge de categoría y un footer con
// glosario. Pensado para vivir en la grid 2x2 de /riesgos.
//
// Server Component puro.

import Link from "next/link";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import { RiesgoBadge } from "@/components/RiesgoBadge";
import type { DengueRow, PoligonoFeature } from "@/lib/types";

interface Props {
  rows: DengueRow[];
  features: PoligonoFeature[];
}

function nombreById(features: PoligonoFeature[]): Map<string, string> {
  return new Map(features.map((f) => [f.properties.id, f.properties.nombre]));
}

function formatoNum(n: number | null | undefined, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

export function DengueRiskCard({ rows, features }: Props) {
  const nombres = nombreById(features);
  // Orden descendente por score, ignorando filas sin score.
  const top = [...rows]
    .filter((r) => typeof r.score_dengue === "number" && !Number.isNaN(r.score_dengue))
    .sort((a, b) => b.score_dengue - a.score_dengue)
    .slice(0, 5);

  return (
    <section
      aria-labelledby="dengue-card-title"
      className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary dark:text-dk-muted">
            <span aria-hidden>🦟</span> Riesgo Dengue
          </p>
          <h2
            id="dengue-card-title"
            className="mt-1 text-lg font-bold text-primary dark:text-dk-primary"
          >
            Barrios con mayor riesgo
          </h2>
        </div>
      </header>

      <p className="mb-3 text-xs leading-relaxed text-neutral-text dark:text-dk-text">
        Modelo heurístico que combina{" "}
        <strong>precipitación de verano</strong> + <strong>temperatura nocturna</strong>{" "}
        (acelera el ciclo del{" "}
        <TerminoGlosario id="aedes-aegypti">Aedes aegypti</TerminoGlosario>) +{" "}
        <strong>densidad</strong> y{" "}
        <strong>vulnerabilidad</strong> + déficit de{" "}
        <TerminoGlosario id="canopy">canopy</TerminoGlosario> + lluvia
        proyectada próximos 14 días.
      </p>

      {top.length === 0 ? (
        <p
          role="status"
          className="rounded border border-neutral-border bg-neutral-50 p-3 text-xs italic text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted"
        >
          Sin datos de dengue disponibles todavía.
        </p>
      ) : (
        <ol
          className="space-y-2"
          aria-label="Top 5 barrios con mayor riesgo de dengue"
        >
          {top.map((r, idx) => {
            const nombre = nombres.get(r.poligono_id) ?? r.poligono_id;
            return (
              <li
                key={r.poligono_id}
                className="flex items-center gap-3 rounded border border-neutral-border bg-neutral-50 p-2 dark:border-dk-border dark:bg-dk-elevated"
              >
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white dark:bg-dk-primary dark:text-dk-bg"
                  aria-hidden="true"
                >
                  {idx + 1}
                </span>
                <div className="flex flex-1 flex-col min-w-0">
                  <Link
                    href={`/poligono/${r.poligono_id}`}
                    className="truncate text-sm font-medium text-primary hover:underline dark:text-dk-primary"
                  >
                    {nombre}
                  </Link>
                  <span className="text-[10px] text-neutral-muted dark:text-dk-muted">
                    Lluvia 14d: {formatoNum(r.lluvia_14d_proj_mm, 0)} mm · Tmin
                    media: {formatoNum(r.tmin_avg_14d_proj_c, 1)} °C
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-bold tabular-nums text-primary dark:text-dk-primary">
                    {formatoNum(r.score_dengue, 1)}
                  </span>
                  <RiesgoBadge categoria={r.categoria} />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <footer className="mt-3 border-t border-neutral-border pt-2 text-[11px] text-neutral-muted dark:border-dk-border dark:text-dk-muted">
        <em>
          Modelo heurístico inspirado en literatura UNL/INTA Misiones. Sin
          datos epidemiológicos puntuales aún — útil como proxy de riesgo
          ambiental, no de incidencia confirmada.
        </em>
      </footer>
    </section>
  );
}

export default DengueRiskCard;
