// Card de resiliencia urbana — capa 3.
//
// Combina permeabilidad, canopy, drenaje y enfriamiento en un score 0-100
// por barrio. Resalta los 5 más resilientes y los 5 menos, y muestra el
// desglose promedio de componentes.

import Link from "next/link";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import type { PoligonoFeature, ResilienciaRow } from "@/lib/types";

const CATEGORIA_COLOR: Record<ResilienciaRow["categoria"], string> = {
  baja: "#dc2626",
  media: "#facc15",
  alta: "#16a34a",
};

const CATEGORIA_LABEL: Record<ResilienciaRow["categoria"], string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
};

interface Props {
  rows: ResilienciaRow[];
  features: PoligonoFeature[];
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function ListaBarrios({
  items,
  nombreById,
  highlight,
}: {
  items: ResilienciaRow[];
  nombreById: Map<string, string>;
  highlight: "top" | "bottom";
}) {
  return (
    <ol className="space-y-1">
      {items.map((r, i) => {
        const nombre = nombreById.get(r.poligono_id) ?? r.poligono_id;
        const color = CATEGORIA_COLOR[r.categoria];
        return (
          <li
            key={r.poligono_id}
            className="flex items-center gap-2 rounded border border-neutral-border bg-neutral-50 px-2 py-1 text-xs dark:border-dk-border dark:bg-dk-elevated"
          >
            <span
              aria-hidden="true"
              className={[
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
                highlight === "top" ? "bg-emerald-600" : "bg-rose-600",
              ].join(" ")}
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
              aria-label={`Resiliencia ${CATEGORIA_LABEL[r.categoria]}`}
            >
              {CATEGORIA_LABEL[r.categoria]}
            </span>
            <span className="w-8 text-right font-bold tabular-nums text-primary dark:text-dk-primary">
              {r.score_resiliencia.toFixed(0)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ResilienciaCard({ rows, features }: Props) {
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre] as const),
  );

  const valid = rows.filter((r) => Number.isFinite(r.score_resiliencia));

  const componentes = {
    permeabilidad: mean(valid.map((r) => r.componente_permeabilidad)),
    canopy: mean(valid.map((r) => r.componente_canopy)),
    drenaje: mean(valid.map((r) => r.componente_drenaje)),
    enfriamiento: mean(valid.map((r) => r.componente_calor)),
  };

  const ordenados = [...valid].sort(
    (a, b) => b.score_resiliencia - a.score_resiliencia,
  );
  const top5 = ordenados.slice(0, 5);
  const bottom5 = ordenados.slice(-5).reverse();

  return (
    <article className="card flex h-full flex-col">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          <TerminoGlosario id="resiliencia-urbana">
            Resiliencia urbana
          </TerminoGlosario>
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Capacidad del barrio para resistir <strong>olas de calor</strong> y{" "}
          <strong>lluvias intensas</strong> sin colapsar.
        </p>
      </header>

      <section
        aria-label="Componentes promedio"
        className="mb-4 space-y-1.5"
      >
        {(
          [
            ["Permeabilidad", componentes.permeabilidad],
            ["Canopy vegetal", componentes.canopy],
            ["Drenaje", componentes.drenaje],
            ["Enfriamiento", componentes.enfriamiento],
          ] as const
        ).map(([label, v]) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 text-neutral-text dark:text-dk-text">
              {label}
            </span>
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-primary-50 dark:bg-dk-elevated"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-emerald-600 dark:bg-emerald-500"
                style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
              />
            </div>
            <span className="w-9 text-right font-semibold tabular-nums text-primary dark:text-dk-primary">
              {v.toFixed(0)}
            </span>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <section aria-label="Top 5 más resilientes">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Más resilientes
          </h4>
          <ListaBarrios items={top5} nombreById={nombreById} highlight="top" />
        </section>
        <section aria-label="Bottom 5 menos resilientes">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-300">
            Menos resilientes
          </h4>
          <ListaBarrios
            items={bottom5}
            nombreById={nombreById}
            highlight="bottom"
          />
        </section>
      </div>

      <footer className="mt-auto pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Marco IPCC AR6 WGII + UN-Habitat <em>Resilient Cities</em>.
      </footer>
    </article>
  );
}

export default ResilienciaCard;
