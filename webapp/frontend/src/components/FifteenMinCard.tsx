// Card de "Ciudad de los 15 minutos" — capa 3.
//
// Aproxima el indicador de Carlos Moreno para Posadas mediante un score
// 0-100 derivado de las distancias a CAPS, escuela, hospital y transporte.
// Muestra dos lecturas clave:
//   (1) % de barrios con score_15min ≥ 75 ("acceso completo")
//   (2) Top 5 con peor acceso, listando los servicios faltantes como chips.

import Link from "next/link";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import type {
  PoligonoFeature,
  QuinceMinutosRow,
} from "@/lib/types";

interface Props {
  rows: QuinceMinutosRow[];
  features: PoligonoFeature[];
}

const SERVICIO_LABEL: Record<string, string> = {
  caps: "CAPS",
  CAPS: "CAPS",
  escuela: "Escuela",
  hospital: "Hospital",
  transporte: "Transporte",
};

function parseFaltas(raw: string | null): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s || s === "ninguno") return [];
  return s
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function FifteenMinCard({ rows, features }: Props) {
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre] as const),
  );

  const valid = rows.filter(
    (r): r is QuinceMinutosRow & { score_15min: number } =>
      r.score_15min !== null && Number.isFinite(r.score_15min),
  );

  const total = valid.length;
  const conAcceso = valid.filter((r) => r.score_15min >= 75).length;
  const pctAcceso = total > 0 ? (conAcceso / total) * 100 : 0;

  const peores = [...valid]
    .sort((a, b) => a.score_15min - b.score_15min)
    .slice(0, 5);

  return (
    <article className="card flex h-full flex-col">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          <TerminoGlosario id="ciudad-15-min">
            Ciudad de los 15 minutos
          </TerminoGlosario>
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Acceso caminable a salud, educación y transporte en un radio de
          15 min.
        </p>
      </header>

      <div className="mb-4 rounded-md border border-accent-200 bg-accent-50 p-3 dark:border-amber-700/60 dark:bg-amber-900/30">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums text-accent dark:text-dk-accent">
            {pctAcceso.toFixed(0)}%
          </span>
          <span className="text-xs text-neutral-text dark:text-amber-100">
            de los barrios con <strong>acceso completo</strong> (score ≥ 75)
          </span>
        </div>
        <p className="mt-1 text-[11px] text-neutral-muted dark:text-amber-100/80">
          {conAcceso} de {total} polígonos monitoreados
        </p>
      </div>

      <section aria-label="Top 5 peor acceso" className="flex-1">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Top 5 peor acceso
        </h4>
        <ol className="space-y-2">
          {peores.map((r) => {
            const nombre = nombreById.get(r.poligono_id) ?? r.poligono_id;
            const faltas = parseFaltas(r.servicios_falta);
            return (
              <li
                key={r.poligono_id}
                className="rounded border border-neutral-border bg-neutral-50 px-2 py-2 text-xs dark:border-dk-border dark:bg-dk-elevated"
              >
                <div className="flex items-center gap-2">
                  <Link
                    href={`/poligono/${r.poligono_id}`}
                    className="flex-1 truncate font-medium text-primary hover:underline dark:text-dk-primary"
                  >
                    {nombre}
                  </Link>
                  <span className="font-bold tabular-nums text-primary dark:text-dk-primary">
                    {r.score_15min.toFixed(0)}
                  </span>
                  <span className="text-[10px] text-neutral-muted dark:text-dk-muted">
                    /100
                  </span>
                </div>
                {faltas.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {faltas.map((f) => (
                      <span
                        key={f}
                        className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-900/50 dark:text-rose-200"
                      >
                        falta {SERVICIO_LABEL[f] ?? f}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="mt-3 pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Concepto original de Carlos Moreno (Sorbonne, 2016). Adoptado por
        París, Melbourne y Bogotá.
      </footer>
    </article>
  );
}

export default FifteenMinCard;
