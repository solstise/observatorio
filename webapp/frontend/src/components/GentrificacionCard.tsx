// Card de gentrificación — capa 3.
//
// Identifica barrios "en transformación" (top score_gentrificacion) y
// muestra una alerta editorial sobre el riesgo de desplazamiento. Es una
// SEÑAL, no una sentencia — la métrica detecta cambio rápido, no causa
// desplazamiento por sí sola.

import Link from "next/link";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import type { GentrificacionRow, PoligonoFeature } from "@/lib/types";

const CATEGORIA_COLOR: Record<GentrificacionRow["categoria"], string> = {
  estable: "#5a7a9c",
  crecimiento_moderado: "#facc15",
  en_transformacion: "#c97d3c",
};

const CATEGORIA_LABEL: Record<GentrificacionRow["categoria"], string> = {
  estable: "Estable",
  crecimiento_moderado: "Crecimiento moderado",
  en_transformacion: "En transformación",
};

interface Props {
  rows: GentrificacionRow[];
  features: PoligonoFeature[];
}

function formatPct(n: number): string {
  const signo = n > 0 ? "+" : "";
  return `${signo}${n.toFixed(1)}%`;
}

export function GentrificacionCard({ rows, features }: Props) {
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre] as const),
  );

  const valid = rows.filter((r) => Number.isFinite(r.score_gentrificacion));
  const enTransformacion = valid.filter(
    (r) => r.categoria === "en_transformacion",
  ).length;
  const top5 = [...valid]
    .sort((a, b) => b.score_gentrificacion - a.score_gentrificacion)
    .slice(0, 5);

  return (
    <article className="card flex h-full flex-col">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          <TerminoGlosario id="gentrificacion">Gentrificación</TerminoGlosario>
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Velocidad del cambio edilicio y constructivo (2018–2026). Score
          alto = transformación rápida.
        </p>
      </header>

      <div className="mb-3 rounded-md border border-accent-200 bg-accent-50 p-3 text-xs leading-relaxed text-neutral-text dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100">
        <strong className="text-accent dark:text-dk-accent">Ojo:</strong>{" "}
        cuando un barrio crece rápido, los precios pueden subir y la población
        original puede ser desplazada. Esta métrica es una <em>señal</em>{" "}
        para mirar más de cerca, no una sentencia.
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-accent dark:text-dk-accent">
          {enTransformacion}
        </span>
        <span className="text-xs text-neutral-text dark:text-dk-text">
          barrios <strong>en transformación</strong> activa
        </span>
      </div>

      <section aria-label="Top 5 barrios en transformación" className="flex-1">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Top 5 cambio más acelerado
        </h4>
        <ol className="space-y-1.5">
          {top5.map((r, i) => {
            const nombre = nombreById.get(r.poligono_id) ?? r.poligono_id;
            const color = CATEGORIA_COLOR[r.categoria];
            return (
              <li
                key={r.poligono_id}
                className="rounded border border-neutral-border bg-neutral-50 px-2 py-1.5 text-xs dark:border-dk-border dark:bg-dk-elevated"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white"
                  >
                    {i + 1}
                  </span>
                  <Link
                    href={`/poligono/${r.poligono_id}`}
                    className="flex-1 truncate font-medium text-primary hover:underline dark:text-dk-primary"
                  >
                    {nombre}
                  </Link>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {CATEGORIA_LABEL[r.categoria]}
                  </span>
                  <span className="w-8 text-right font-bold tabular-nums text-primary dark:text-dk-primary">
                    {r.score_gentrificacion.toFixed(0)}
                  </span>
                </div>
                <p className="mt-1 ml-7 text-[10px] text-neutral-muted dark:text-dk-muted">
                  Edificios {formatPct(r.cambio_edificios_pct)} · Construido{" "}
                  {formatPct(r.cambio_construido_pct)}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="mt-3 pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Fuentes: Open Buildings + GHSL (edificios) · Dynamic World
        (superficie construida).
      </footer>
    </article>
  );
}

export default GentrificacionCard;
