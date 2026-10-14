// Card de tipología de techos (Capa 1).
//
// IMPORTANTE — esta capa es la única ESTIMACIÓN HEURÍSTICA del observatorio.
// El script `compute_capas.cjs` asigna mix de materiales por barrio según
// indicadores indirectos (antigüedad, categoría urbana, densidad), NO por
// un modelo de visión por computadora entrenado sobre imágenes aéreas.
// Por eso `confianza="baja"` en todas las filas y se muestra disclaimer.
//
// Asbesto: el uso de chapas de fibrocemento con amianto está prohibido en
// Argentina por la Resolución 845/2000 del Ministerio de Salud (vigente
// desde 2003). El % estimado funciona como alerta sanitaria para inspección
// in-situ, no como diagnóstico definitivo.

import type { PoligonoFeature, TechosRow } from "@/lib/types";

interface TechosCardProps {
  rows: TechosRow[];
  features: PoligonoFeature[];
}

interface Material {
  key: keyof Pick<
    TechosRow,
    "pct_losa" | "pct_teja" | "pct_chapa_nueva" | "pct_chapa_vieja" | "pct_asbesto"
  >;
  label: string;
  color: string;
}

// Orden = orden visual en la barra (de "mejor" a "peor"). Colores fríos
// para materiales nuevos/consolidados, cálidos saturados para los críticos
// (asbesto). Evitamos rojo puro porque la paleta institucional no lo usa
// en escalas continuas — acá es CATEGORICAL y es justificable.
const MATERIALES: Material[] = [
  { key: "pct_losa", label: "Losa", color: "#1a3a5c" },
  { key: "pct_teja", label: "Teja", color: "#5a7a9c" },
  { key: "pct_chapa_nueva", label: "Chapa nueva", color: "#8dabcf" },
  { key: "pct_chapa_vieja", label: "Chapa vieja", color: "#c97d3c" },
  { key: "pct_asbesto", label: "Asbesto (est.)", color: "#7c2d12" },
];

function avg(rows: TechosRow[], key: Material["key"]): number {
  if (!rows.length) return 0;
  const sum = rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  return sum / rows.length;
}

export function TechosCard({ rows, features }: TechosCardProps) {
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre]),
  );

  const mix = MATERIALES.map((m) => ({
    ...m,
    value: avg(rows, m.key),
  }));
  const total = mix.reduce((s, m) => s + m.value, 0) || 1;
  const mixNorm = mix.map((m) => ({ ...m, pct: (m.value / total) * 100 }));

  const top5Asbesto = [...rows]
    .filter((r) => Number.isFinite(r.pct_asbesto) && r.pct_asbesto > 0)
    .sort((a, b) => b.pct_asbesto - a.pct_asbesto)
    .slice(0, 5);

  return (
    <section
      aria-labelledby="capa1-techos-titulo"
      className="card flex flex-col dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2
            id="capa1-techos-titulo"
            className="text-sm font-semibold text-primary dark:text-dk-primary"
          >
            Tipología de techos
          </h2>
          <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
            Mix promedio de materiales y barrios con mayor estimación de
            asbesto.
          </p>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary dark:bg-dk-elevated dark:text-dk-primary"
          title="El % de asbesto se calibra con el índice ACRI (Asbestos Cement Roof Index) calculado sobre las bandas SWIR de Sentinel-2 — el cemento asbestoso tiene firma espectral distintiva en B11 (1610 nm). El resto del mix sigue siendo heurístico. Confianza: media."
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M9 12l2 2 4-4" fill="none" stroke="white" strokeWidth="2" />
          </svg>
          SWIR S-2
        </span>
      </header>

      <div
        className="flex h-6 w-full overflow-hidden rounded-md border border-neutral-border dark:border-dk-border"
        role="img"
        aria-label={`Mix promedio de materiales: ${mixNorm
          .map((m) => `${m.label} ${m.pct.toFixed(0)}%`)
          .join(", ")}`}
      >
        {mixNorm.map((m) => (
          <span
            key={m.key}
            title={`${m.label}: ${m.pct.toFixed(1)}%`}
            style={{ width: `${m.pct}%`, backgroundColor: m.color }}
            className="h-full"
            aria-hidden="true"
          />
        ))}
      </div>

      <ul
        className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3"
        aria-label="Leyenda de materiales"
      >
        {mixNorm.map((m) => (
          <li
            key={m.key}
            className="flex items-center gap-1.5 text-neutral-text dark:text-dk-text"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: m.color }}
              aria-hidden="true"
            />
            <span className="truncate">{m.label}</span>
            <span className="ml-auto tabular-nums text-neutral-muted dark:text-dk-muted">
              {m.pct.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-100">
        <p className="font-semibold">Alerta sanitaria — asbesto</p>
        <p className="mt-0.5 leading-relaxed">
          Prohibido en AR desde 2003 (Res. 845/2000 MSAL). El % por barrio
          se calibra con ACRI sobre Sentinel-2 SWIR; el ranking entre
          barrios es defendible, pero el valor absoluto requiere
          relevamiento de campo para confirmar.
        </p>
      </div>

      <div className="mt-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Top 5 — mayor estimación de asbesto
        </h3>
        {top5Asbesto.length === 0 ? (
          <p className="text-xs italic text-neutral-muted dark:text-dk-muted">
            Sin estimaciones de asbesto significativas.
          </p>
        ) : (
          <ol className="space-y-1.5" aria-label="Ranking estimación de asbesto">
            {top5Asbesto.map((r, i) => (
              <li
                key={r.poligono_id}
                className="flex items-center gap-2 rounded bg-rose-50/60 px-2 py-1.5 text-xs dark:bg-rose-950/20"
              >
                <span className="w-4 text-[10px] font-mono tabular-nums text-neutral-muted dark:text-dk-muted">
                  {i + 1}
                </span>
                <span className="flex-1 truncate font-medium text-primary dark:text-dk-primary">
                  {nombreById.get(r.poligono_id) ?? r.poligono_id}
                </span>
                <div
                  className="flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-rose-200/50 dark:bg-rose-900/40"
                  aria-hidden="true"
                >
                  <span
                    className="h-full bg-rose-700 dark:bg-rose-400"
                    style={{
                      width: `${Math.min(100, r.pct_asbesto)}%`,
                    }}
                  />
                </div>
                <span className="shrink-0 tabular-nums text-rose-800 dark:text-rose-200">
                  {r.pct_asbesto.toFixed(1)}%
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <footer className="mt-auto pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Método:{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-dk-elevated">
          ndai_swir_v1
        </code>{" "}
        — confianza: <strong>media</strong>. Calibrado con ACRI sobre
        Sentinel-2 L2A (B11/B12, escena 19-abr-2026). El resto del mix
        (losa, teja, chapa) sigue heurístico — pendiente clasificador CV
        sobre ortofotos para alcanzar confianza alta.
      </footer>
    </section>
  );
}
