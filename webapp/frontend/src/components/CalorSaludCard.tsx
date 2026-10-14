// Card de riesgo calor-salud — Capa 2.
//
// Para los próximos `horizonte_dias` (típicamente 14), cuenta cuántos
// días tienen tmax ≥ 32 °C ("alto") y ≥ 35 °C ("extremo") según el
// ensemble Open-Meteo de 6 modelos. Muestra el Top 5 de barrios más
// expuestos y un mini-display con la tmax máxima proyectada de la ciudad.
//
// Datos: scripts/capas_avanzadas (forecast_diario × poligono + UHI verano).

import Link from "next/link";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import { RiesgoBadge } from "@/components/RiesgoBadge";
import type { CalorSaludRow, PoligonoFeature } from "@/lib/types";

interface Props {
  rows: CalorSaludRow[];
  features: PoligonoFeature[];
}

function nombreById(features: PoligonoFeature[]): Map<string, string> {
  return new Map(features.map((f) => [f.properties.id, f.properties.nombre]));
}

function formatoNum(n: number | null | undefined, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

export function CalorSaludCard({ rows, features }: Props) {
  const nombres = nombreById(features);
  // Ordenar por riesgo extremo primero, luego por alto, luego por score.
  const top = [...rows]
    .filter((r) => typeof r.score_calor === "number" && !Number.isNaN(r.score_calor))
    .sort((a, b) => {
      if (b.dias_riesgo_extremo !== a.dias_riesgo_extremo) {
        return b.dias_riesgo_extremo - a.dias_riesgo_extremo;
      }
      if (b.dias_riesgo_alto !== a.dias_riesgo_alto) {
        return b.dias_riesgo_alto - a.dias_riesgo_alto;
      }
      return b.score_calor - a.score_calor;
    })
    .slice(0, 5);

  const horizonte = top[0]?.horizonte_dias ?? 14;
  const tmaxCiudad = rows.reduce<number | null>((acc, r) => {
    if (r.tmax_max_proj_c === null || r.tmax_max_proj_c === undefined) {
      return acc;
    }
    if (acc === null || r.tmax_max_proj_c > acc) return r.tmax_max_proj_c;
    return acc;
  }, null);

  return (
    <section
      aria-labelledby="calor-card-title"
      className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary dark:text-dk-muted">
            <span aria-hidden>🌡</span> Calor extremo
          </p>
          <h2
            id="calor-card-title"
            className="mt-1 text-lg font-bold text-primary dark:text-dk-primary"
          >
            Riesgo para la salud
          </h2>
        </div>
        <div
          className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-right dark:border-amber-700/60 dark:bg-amber-900/30"
          aria-label={`Temperatura máxima proyectada de la ciudad: ${formatoNum(tmaxCiudad, 1)} grados`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-200">
            Tmax máx. proyectada
          </p>
          <p className="text-xl font-bold tabular-nums text-amber-900 dark:text-amber-50">
            {formatoNum(tmaxCiudad, 1)} °C
          </p>
        </div>
      </header>

      <p className="mb-3 text-xs leading-relaxed text-neutral-text dark:text-dk-text">
        Próximos <strong>{horizonte} días</strong>, ensemble de 6 modelos
        meteorológicos (<TerminoGlosario id="open-meteo">Open-Meteo</TerminoGlosario>).
        Riesgo <em>alto</em> = tmax ≥ 32 °C; <em>extremo</em> = tmax ≥ 35 °C.
        El score suma{" "}
        <TerminoGlosario id="uhi">isla de calor</TerminoGlosario> de verano por
        barrio.
      </p>

      {top.length === 0 ? (
        <p
          role="status"
          className="rounded border border-neutral-border bg-neutral-50 p-3 text-xs italic text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted"
        >
          Sin datos de calor-salud disponibles todavía.
        </p>
      ) : (
        <ol
          className="space-y-2"
          aria-label="Top 5 barrios con más días de calor riesgoso"
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
                    <strong className="text-orange-700 dark:text-orange-300">
                      {r.dias_riesgo_extremo}
                    </strong>{" "}
                    días ≥35°C ·{" "}
                    <strong className="text-amber-700 dark:text-amber-300">
                      {r.dias_riesgo_alto}
                    </strong>{" "}
                    días ≥32°C
                    {r.uhi_verano !== null && r.uhi_verano !== undefined && (
                      <> · UHI +{formatoNum(r.uhi_verano, 1)}°C</>
                    )}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-bold tabular-nums text-primary dark:text-dk-primary">
                    {formatoNum(r.score_calor, 1)}
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
          Pronóstico Open-Meteo (ECMWF + GFS + ICON + JMA + GEM + BoM). El UHI
          es un offset estimado por barrio según calor de verano histórico
          (Landsat).
        </em>
      </footer>
    </section>
  );
}

export default CalorSaludCard;
