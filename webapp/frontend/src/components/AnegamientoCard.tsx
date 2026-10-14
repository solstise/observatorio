// Card de riesgo de anegamiento — Capa 2.
//
// Modelo simple: pct_impermeable (suelo construido / pavimentado) +
// lluvia proyectada próximas 48 h + riesgo histórico de inundación.
// Útil para anticipar barrios donde la combinación impermeabilidad +
// chaparrón fuerte puede saturar el drenaje pluvial.
//
// Datos: scripts/capas_avanzadas (dynamic_world + forecast 48h + vulnerabilidad).

import Link from "next/link";

import { RiesgoBadge } from "@/components/RiesgoBadge";
import type { AnegamientoRow, PoligonoFeature } from "@/lib/types";

interface Props {
  rows: AnegamientoRow[];
  features: PoligonoFeature[];
}

function nombreById(features: PoligonoFeature[]): Map<string, string> {
  return new Map(features.map((f) => [f.properties.id, f.properties.nombre]));
}

function formatoNum(n: number | null | undefined, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

export function AnegamientoCard({ rows, features }: Props) {
  const nombres = nombreById(features);
  const top = [...rows]
    .filter((r) => typeof r.score_anegamiento === "number" && !Number.isNaN(r.score_anegamiento))
    .sort((a, b) => b.score_anegamiento - a.score_anegamiento)
    .slice(0, 5);

  const lluviaCiudad = rows.reduce<number | null>((acc, r) => {
    if (r.lluvia_48h_proj_mm === null || r.lluvia_48h_proj_mm === undefined) {
      return acc;
    }
    if (acc === null || r.lluvia_48h_proj_mm > acc) return r.lluvia_48h_proj_mm;
    return acc;
  }, null);

  return (
    <section
      aria-labelledby="anegamiento-card-title"
      className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary dark:text-dk-muted">
            <span aria-hidden>💧</span> Anegamiento 48h
          </p>
          <h2
            id="anegamiento-card-title"
            className="mt-1 text-lg font-bold text-primary dark:text-dk-primary"
          >
            Barrios más expuestos
          </h2>
        </div>
        <div
          className="shrink-0 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-right dark:border-sky-700/60 dark:bg-sky-900/30"
          aria-label={`Lluvia máxima 48 horas proyectada: ${formatoNum(lluviaCiudad, 0)} milímetros`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-200">
            Lluvia 48h máx.
          </p>
          <p className="text-xl font-bold tabular-nums text-sky-900 dark:text-sky-50">
            {formatoNum(lluviaCiudad, 0)} mm
          </p>
        </div>
      </header>

      <p className="mb-3 text-xs leading-relaxed text-neutral-text dark:text-dk-text">
        Riesgo de saturación de drenaje urbano: <strong>impermeabilidad</strong>{" "}
        del suelo + <strong>lluvia proyectada 48 h</strong> + riesgo base de
        inundación según historial del barrio.
      </p>

      {top.length === 0 ? (
        <p
          role="status"
          className="rounded border border-neutral-border bg-neutral-50 p-3 text-xs italic text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted"
        >
          Sin datos de anegamiento disponibles todavía.
        </p>
      ) : (
        <ol
          className="space-y-2"
          aria-label="Top 5 barrios con mayor riesgo de anegamiento"
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
                    Impermeable:{" "}
                    <strong>{formatoNum(r.pct_impermeable, 0)}%</strong> · Lluvia
                    48h: <strong>{formatoNum(r.lluvia_48h_proj_mm, 0)} mm</strong>
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-bold tabular-nums text-primary dark:text-dk-primary">
                    {formatoNum(r.score_anegamiento, 1)}
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
          Modelo simple: impermeabilidad (Dynamic World) + lluvia 48 h
          (Open-Meteo) + riesgo histórico de inundación (vulnerabilidad).
        </em>
      </footer>
    </section>
  );
}

export default AnegamientoCard;
