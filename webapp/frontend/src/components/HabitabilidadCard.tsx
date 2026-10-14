// Card de habitabilidad urbana — capa 3.
//
// Sintetiza el score compuesto 0-100 por barrio (calor + verde + aire +
// acceso). Muestra Top 5 mejores, la media de la ciudad y un desglose
// promedio de componentes como mini-barras horizontales. La paleta de
// categorías sigue la convención editorial documentada en la página
// /calidad-vida.

import Link from "next/link";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import type {
  HabitabilidadRow,
  PoligonoFeature,
} from "@/lib/types";

const CATEGORIA_COLOR: Record<HabitabilidadRow["categoria"], string> = {
  bajo: "#dc2626",
  medio: "#facc15",
  bueno: "#5a7a9c",
  excelente: "#16a34a",
};

const CATEGORIA_LABEL: Record<HabitabilidadRow["categoria"], string> = {
  bajo: "Bajo",
  medio: "Medio",
  bueno: "Bueno",
  excelente: "Excelente",
};

interface Props {
  rows: HabitabilidadRow[];
  features: PoligonoFeature[];
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function HabitabilidadCard({ rows, features }: Props) {
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre] as const),
  );

  const valid = rows.filter((r) => Number.isFinite(r.score_habitabilidad));
  const mediaCiudad = mean(valid.map((r) => r.score_habitabilidad));
  const componentes = {
    calor: mean(valid.map((r) => r.componente_calor)),
    verde: mean(valid.map((r) => r.componente_verde)),
    aire: mean(valid.map((r) => r.componente_aire)),
    acceso: mean(valid.map((r) => r.componente_acceso)),
  };

  const top5 = [...valid]
    .sort((a, b) => b.score_habitabilidad - a.score_habitabilidad)
    .slice(0, 5);

  return (
    <article className="card flex h-full flex-col">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          <TerminoGlosario id="habitabilidad">Habitabilidad</TerminoGlosario>{" "}
          urbana
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Score compuesto 0-100 a partir de calor, verde, aire y acceso.
        </p>
      </header>

      <div className="mb-4 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-primary dark:text-dk-primary">
          {mediaCiudad.toFixed(1)}
        </span>
        <span className="text-xs text-neutral-muted dark:text-dk-muted">
          /100 — media de la ciudad ({valid.length} barrios)
        </span>
      </div>

      <section
        aria-label="Componentes promedio"
        className="mb-4 space-y-1.5"
      >
        {(
          [
            ["Frescor (calor)", componentes.calor],
            ["Verde", componentes.verde],
            ["Aire", componentes.aire],
            ["Acceso a servicios", componentes.acceso],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0 text-neutral-text dark:text-dk-text">
              {label}
            </span>
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-primary-50 dark:bg-dk-elevated"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-primary dark:bg-dk-primary"
                style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
              />
            </div>
            <span className="w-10 text-right font-semibold tabular-nums text-primary dark:text-dk-primary">
              {v.toFixed(0)}
            </span>
          </div>
        ))}
      </section>

      <section aria-label="Top 5 mejores barrios">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Top 5 mejor habitabilidad
        </h4>
        <ol className="space-y-1.5">
          {top5.map((r, i) => {
            const nombre = nombreById.get(r.poligono_id) ?? r.poligono_id;
            const color = CATEGORIA_COLOR[r.categoria];
            return (
              <li
                key={r.poligono_id}
                className="flex items-center gap-2 rounded border border-neutral-border bg-neutral-50 px-2 py-1.5 text-xs dark:border-dk-border dark:bg-dk-elevated"
              >
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
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: color }}
                >
                  {CATEGORIA_LABEL[r.categoria]}
                </span>
                <span className="w-9 text-right font-bold tabular-nums text-primary dark:text-dk-primary">
                  {r.score_habitabilidad.toFixed(0)}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="mt-auto pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Fuentes: Landsat (calor), Dynamic World (verde), TROPOMI (aire), OSM +
        Min. Salud Misiones (acceso).
      </footer>
    </article>
  );
}

export default HabitabilidadCard;
