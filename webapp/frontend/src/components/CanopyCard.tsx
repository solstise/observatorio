// Card de cobertura vegetal y verde per cápita (Capa 1).
//
// Datos: scripts/capas_avanzadas/compute_capas.cjs → tipologia/canopy.csv.
// `verde_pct` se computa como (1 - dw_built_pct_ge_50) del último mes de
// Dynamic World disponible. `m2_per_capita` cruza el verde absoluto con
// la población estimada del barrio.
//
// Umbral OMS: 9 m²/habitante de espacio verde urbano accesible. Es un
// estándar de referencia de la OMS para salud pública (Sources: WHO
// Regional Office for Europe, "Urban Green Spaces and Health", 2016).
//
// Sin JS: la tarjeta funciona como render estático puro — los tooltips
// son `title` nativos, los colores semánticos están bakeados en el HTML.

import type { CanopyRow, PoligonoFeature } from "@/lib/types";

interface CanopyCardProps {
  rows: CanopyRow[];
  features: PoligonoFeature[];
}

const UMBRAL_OMS = 9; // m² por habitante.

// Mapeo categoría → color sólido + clase tailwind para fondo suave.
// Las categorías vienen pre-computadas por el script (rojo/naranja/amarillo/verde),
// así que respetamos el override puntual (rojo) por ser CATEGORICAL.
const CATEGORIA_COLOR: Record<
  string,
  { dot: string; bg: string; label: string }
> = {
  rojo: {
    dot: "#dc2626",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    label: "Crítico",
  },
  naranja: {
    dot: "#ea580c",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    label: "Bajo",
  },
  amarillo: {
    dot: "#facc15",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    label: "Moderado",
  },
  verde: {
    dot: "#16a34a",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    label: "Adecuado",
  },
  sin_dato: {
    dot: "#9ca3af",
    bg: "bg-neutral-50 dark:bg-dk-elevated",
    label: "Sin dato",
  },
};

function fmt(n: number | null, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

export function CanopyCard({ rows, features }: CanopyCardProps) {
  const nombreById = new Map(features.map((f) => [f.properties.id, f.properties.nombre]));

  const conDato = rows.filter(
    (r) => r.verde_pct !== null && Number.isFinite(r.verde_pct as number),
  );
  const conPerCap = rows.filter(
    (r) =>
      r.m2_per_capita !== null && Number.isFinite(r.m2_per_capita as number),
  );

  const avgVerdePct = conDato.length
    ? conDato.reduce((s, r) => s + (r.verde_pct as number), 0) / conDato.length
    : null;
  const avgPerCap = conPerCap.length
    ? conPerCap.reduce((s, r) => s + (r.m2_per_capita as number), 0) /
      conPerCap.length
    : null;

  const bajoUmbral = conPerCap.filter(
    (r) => (r.m2_per_capita as number) < UMBRAL_OMS,
  ).length;

  const top5Bajos = [...conPerCap]
    .sort(
      (a, b) => (a.m2_per_capita as number) - (b.m2_per_capita as number),
    )
    .slice(0, 5);

  return (
    <section
      aria-labelledby="capa1-canopy-titulo"
      className="card flex flex-col dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2
            id="capa1-canopy-titulo"
            className="text-sm font-semibold text-primary dark:text-dk-primary"
          >
            Verde urbano (canopy)
          </h2>
          <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
            % de superficie no construida y m² verdes por habitante.
          </p>
        </div>
        <span
          title="OMS recomienda al menos 9 m² de espacio verde urbano accesible por habitante (WHO Regional Office for Europe, Urban Green Spaces and Health, 2016)."
          className="inline-flex shrink-0 cursor-help items-center rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary dark:bg-dk-elevated dark:text-dk-primary"
          aria-label="Información sobre el umbral OMS de 9 m² por habitante"
        >
          OMS 9 m²/hab
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-neutral-border bg-neutral-50 p-3 dark:border-dk-border dark:bg-dk-elevated">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
            Verde promedio
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-primary dark:text-dk-primary">
            {fmt(avgVerdePct, 1)}
            <span className="ml-0.5 text-base font-medium text-neutral-muted dark:text-dk-muted">
              %
            </span>
          </p>
          <p className="text-[11px] text-neutral-muted dark:text-dk-muted">
            ciudad ({conDato.length} barrios)
          </p>
        </div>
        <div className="rounded-md border border-neutral-border bg-neutral-50 p-3 dark:border-dk-border dark:bg-dk-elevated">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
            m² verde / cap.
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-primary dark:text-dk-primary">
            {fmt(avgPerCap, 1)}
          </p>
          <p className="text-[11px] text-neutral-muted dark:text-dk-muted">
            promedio
          </p>
        </div>
      </div>

      <div
        className={[
          "mt-3 rounded-md border px-3 py-2 text-xs",
          bajoUmbral > 0
            ? "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-100"
            : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-100",
        ].join(" ")}
      >
        <strong className="tabular-nums">{bajoUmbral}</strong> de{" "}
        {conPerCap.length} barrios{" "}
        {bajoUmbral === 1 ? "está" : "están"} por debajo del umbral OMS
        (9 m²/hab).
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Top 5 con menos verde per cápita
        </h3>
        {top5Bajos.length === 0 ? (
          <p className="text-xs italic text-neutral-muted dark:text-dk-muted">
            Sin datos suficientes todavía.
          </p>
        ) : (
          <ol className="space-y-1.5" aria-label="Ranking de menor verde per cápita">
            {top5Bajos.map((r, i) => {
              const cat =
                CATEGORIA_COLOR[r.categoria] ?? CATEGORIA_COLOR.sin_dato;
              return (
                <li
                  key={r.poligono_id}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${cat.bg}`}
                >
                  <span className="w-4 text-[10px] font-mono tabular-nums text-neutral-muted dark:text-dk-muted">
                    {i + 1}
                  </span>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: cat.dot }}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate font-medium text-primary dark:text-dk-primary">
                    {nombreById.get(r.poligono_id) ?? r.poligono_id}
                  </span>
                  <span className="shrink-0 tabular-nums text-neutral-text dark:text-dk-text">
                    {fmt(r.m2_per_capita, 1)} m²/hab
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="mt-auto pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Fuente: Dynamic World V1 (Sentinel-2) + WorldPop. Script:{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-dk-elevated">
          compute_capas.cjs
        </code>
        .
      </footer>
    </section>
  );
}
