// Card de saturación urbana y demanda 2030 — Capa 2.
//
// Dos vistas en un solo card:
//   1) "Barrios próximos a saturarse" — orden ascendente por
//      `anio_saturacion` (no-null). Más cerca del presente = más urgente.
//   2) "Demanda 2030" — suma sobre toda la ciudad de aulas y camas que
//      faltan según ratios INDEC (aulas/100 hab) y MSal (camas/1000 hab),
//      sobre la proyección de población 2030.
//
// Supuestos del modelo (ver scripts/capas_avanzadas/saturacion.cjs):
//   - Huella media por vivienda: ~90 m²
//   - Coeficiente construible máximo: 70% de la superficie del polígono
//   - Ratio aulas por habitante: INDEC ~22 alumnos por aula, ~0.18 niños/hab
//   - Ratio camas: 4.5 camas / 1000 hab (objetivo MSal 2030)
//
// Server Component.

import Link from "next/link";

import type { PoligonoFeature, SaturacionRow } from "@/lib/types";

interface Props {
  rows: SaturacionRow[];
  features: PoligonoFeature[];
}

function nombreById(features: PoligonoFeature[]): Map<string, string> {
  return new Map(features.map((f) => [f.properties.id, f.properties.nombre]));
}

function formatoEntero(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return Math.round(n).toLocaleString("es-AR");
}

function formatoNum(n: number | null | undefined, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

export function SaturacionCard({ rows, features }: Props) {
  const nombres = nombreById(features);
  const anioActual = new Date().getFullYear();
  // Barrios con saturación proyectada (anio no null) ordenados por
  // proximidad. Si anio_saturacion <= anioActual ya están saturados —
  // los mostramos primero igualmente (más urgente todavía).
  const proximos = [...rows]
    .filter((r) => r.anio_saturacion !== null && r.anio_saturacion !== undefined)
    .sort(
      (a, b) =>
        (a.anio_saturacion as number) - (b.anio_saturacion as number),
    )
    .slice(0, 5);

  // Totales ciudad para la vista de demanda 2030.
  const totales = rows.reduce(
    (acc, r) => {
      acc.aulas += Number.isFinite(r.aulas_necesarias_2030)
        ? r.aulas_necesarias_2030
        : 0;
      acc.camas += Number.isFinite(r.camas_necesarias_2030)
        ? r.camas_necesarias_2030
        : 0;
      acc.pop2026 += Number.isFinite(r.pop_2026) ? r.pop_2026 : 0;
      acc.pop2030 += Number.isFinite(r.pop_2030_proj) ? r.pop_2030_proj : 0;
      return acc;
    },
    { aulas: 0, camas: 0, pop2026: 0, pop2030: 0 },
  );

  const crecimientoPct =
    totales.pop2026 > 0
      ? ((totales.pop2030 - totales.pop2026) / totales.pop2026) * 100
      : null;

  return (
    <section
      aria-labelledby="saturacion-card-title"
      className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary dark:text-dk-muted">
          <span aria-hidden>🏗</span> Saturación urbana
        </p>
        <h2
          id="saturacion-card-title"
          className="mt-1 text-lg font-bold text-primary dark:text-dk-primary"
        >
          Capacidad y demanda 2030
        </h2>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div
          className="rounded-md border border-accent-200 bg-accent-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/30"
          title="Aulas adicionales necesarias en 2030 según proyección de población y ratios educativos INDEC."
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent dark:text-amber-200">
            Aulas faltantes 2030
          </p>
          <p className="text-xl font-bold tabular-nums text-primary dark:text-dk-primary">
            {formatoEntero(totales.aulas)}
          </p>
          <p className="mt-0.5 text-[10px] text-neutral-muted dark:text-dk-muted">
            ratio INDEC ~22 alumnos/aula
          </p>
        </div>
        <div
          className="rounded-md border border-accent-200 bg-accent-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/30"
          title="Camas hospitalarias adicionales 2030 según objetivo del Ministerio de Salud Nacional (4.5 camas / 1000 hab)."
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-accent dark:text-amber-200">
            Camas faltantes 2030
          </p>
          <p className="text-xl font-bold tabular-nums text-primary dark:text-dk-primary">
            {formatoEntero(totales.camas)}
          </p>
          <p className="mt-0.5 text-[10px] text-neutral-muted dark:text-dk-muted">
            objetivo 4.5 camas / 1000 hab
          </p>
        </div>
      </div>

      {totales.pop2026 > 0 && (
        <p className="mb-3 text-[11px] text-neutral-muted dark:text-dk-muted">
          Población 2026: <strong>{formatoEntero(totales.pop2026)}</strong> →{" "}
          2030: <strong>{formatoEntero(totales.pop2030)}</strong>{" "}
          {crecimientoPct !== null && (
            <>
              (
              <span
                className={
                  crecimientoPct >= 0
                    ? "text-accent"
                    : "text-secondary dark:text-dk-muted"
                }
              >
                {crecimientoPct >= 0 ? "+" : ""}
                {formatoNum(crecimientoPct, 1)}%
              </span>
              )
            </>
          )}
        </p>
      )}

      <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
        Próximos a saturarse
      </h3>

      {proximos.length === 0 ? (
        <p
          role="status"
          className="rounded border border-neutral-border bg-neutral-50 p-3 text-xs italic text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted"
        >
          Sin barrios con saturación proyectada en el horizonte del modelo.
        </p>
      ) : (
        <ol
          className="space-y-2"
          aria-label="Top 5 barrios próximos a saturarse"
        >
          {proximos.map((r, idx) => {
            const nombre = nombres.get(r.poligono_id) ?? r.poligono_id;
            const anios = (r.anio_saturacion as number) - anioActual;
            const yaSaturado = anios <= 0;
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
                    Ocupado:{" "}
                    <strong>{formatoNum(r.pct_ocupado_2026, 0)}%</strong> ·
                    Crecimiento {formatoNum(r.tasa_crecimiento_anual, 1)}%/año
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      yaSaturado
                        ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200"
                        : anios <= 5
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
                    ].join(" ")}
                  >
                    {yaSaturado
                      ? "Saturado"
                      : `${r.anio_saturacion}`}
                  </span>
                  {!yaSaturado && (
                    <span className="mt-0.5 text-[10px] tabular-nums text-neutral-muted dark:text-dk-muted">
                      en {anios} año{anios === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <footer className="mt-3 border-t border-neutral-border pt-2 text-[11px] text-neutral-muted dark:border-dk-border dark:text-dk-muted">
        <em>
          Supuestos: huella media de vivienda 90 m², coeficiente construible
          70 %; ratios educativos INDEC (~22 alumnos/aula × ~0.18 niños/hab)
          y objetivo MSal 4.5 camas/1000 hab. La proyección de población usa
          tasa propia del barrio.
        </em>
      </footer>
    </section>
  );
}

export default SaturacionCard;
