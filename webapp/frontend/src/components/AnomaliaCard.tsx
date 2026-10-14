// Card de anomalías estructurales (Capa 1).
//
// Datos: scripts/capas_avanzadas/compute_capas.cjs → tipologia/anomalias.csv.
// `z_score` compara la retrodispersión Sentinel-1 VV del mes más reciente
// contra la baseline histórica (media de los últimos 12 meses, sin contar
// el actual). |z| > 2 marca un cambio fuera del ruido normal del barrio:
//
//   z > +2: crecimiento_fuerte    — nueva edificación, urbanización
//   z > +1: crecimiento_moderado  — obras puntuales, ampliaciones
//   |z| <=1: estable              — sin cambios significativos
//   z < -1: pérdida_moderada      — demoliciones, despeje
//   z < -2: pérdida_fuerte        — alerta: pérdida masiva (inundación, desmonte)
//
// El SAR S1 atraviesa nubes y es robusto día/noche, por eso es la fuente
// preferida para detección continua de cambios estructurales mes a mes.

import type { AnomaliaRow, CategoriaAnomalia, PoligonoFeature } from "@/lib/types";

interface AnomaliaCardProps {
  rows: AnomaliaRow[];
  features: PoligonoFeature[];
}

// Diseño semántico: crecimiento usa primary (azul) o accent (durazno)
// según intensidad; pérdida usa rose para hacer evidente el riesgo.
const CATEGORIA_DISPLAY: Record<
  CategoriaAnomalia,
  { label: string; icon: string; bg: string; text: string }
> = {
  crecimiento_fuerte: {
    label: "Crecimiento fuerte",
    icon: "↑↑",
    bg: "bg-accent-50 border-accent-300 dark:border-amber-700/60 dark:bg-amber-950/40",
    text: "text-accent-700 dark:text-amber-200",
  },
  crecimiento_moderado: {
    label: "Crecimiento moderado",
    icon: "↑",
    bg: "bg-primary-50 border-primary-200 dark:border-dk-border dark:bg-dk-elevated",
    text: "text-primary dark:text-dk-primary",
  },
  estable: {
    label: "Estable",
    icon: "=",
    bg: "bg-neutral-50 border-neutral-border",
    text: "text-secondary dark:text-dk-muted",
  },
  "pérdida_moderada": {
    label: "Pérdida moderada",
    icon: "↓",
    bg: "bg-rose-50 border-rose-200 dark:border-rose-800/60 dark:bg-rose-950/30",
    text: "text-rose-800 dark:text-rose-200",
  },
  "pérdida_fuerte": {
    label: "Pérdida fuerte",
    icon: "↓↓",
    bg: "bg-rose-100 border-rose-300 dark:border-rose-700/60 dark:bg-rose-950/60",
    text: "text-rose-900 dark:text-rose-100",
  },
  sin_dato: {
    label: "Sin dato",
    icon: "—",
    bg: "bg-neutral-50 border-neutral-border",
    text: "text-neutral-muted dark:text-dk-muted",
  },
};

export function AnomaliaCard({ rows, features }: AnomaliaCardProps) {
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre]),
  );

  const conDato = rows.filter(
    (r) => r.z_score !== null && Number.isFinite(r.z_score),
  );

  // Alertas activas = |z| > 2. Ordenadas por |z| descendente para mostrar
  // primero las anomalías más fuertes.
  const alertas = conDato
    .filter((r) => Math.abs(r.z_score as number) > 2)
    .sort((a, b) => Math.abs(b.z_score as number) - Math.abs(a.z_score as number));

  // Fecha más reciente del conjunto (todas deberían compartir el último mes).
  const fechaMasReciente = conDato
    .map((r) => r.fecha_ultima)
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .sort()
    .pop();

  return (
    <section
      aria-labelledby="capa1-anomalias-titulo"
      className="card flex flex-col dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2
            id="capa1-anomalias-titulo"
            className="text-sm font-semibold text-primary dark:text-dk-primary"
          >
            Anomalías estructurales
          </h2>
          <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
            Cambios fuera del rango normal detectados por Sentinel-1 SAR.
          </p>
        </div>
        <span
          className="inline-flex shrink-0 items-center rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary dark:bg-dk-elevated dark:text-dk-primary"
          title="z-score > 2 en valor absoluto = cambio fuera de las 2 desviaciones estándar respecto a la baseline histórica de 12 meses del propio barrio."
        >
          |z| &gt; 2
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-neutral-border bg-neutral-50 px-2 py-2 dark:border-dk-border dark:bg-dk-elevated">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
            Analizados
          </p>
          <p className="mt-0.5 text-xl font-bold tabular-nums text-primary dark:text-dk-primary">
            {conDato.length}
          </p>
        </div>
        <div
          className={[
            "rounded-md border px-2 py-2",
            alertas.length > 0
              ? "border-rose-200 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-950/40"
              : "border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/40",
          ].join(" ")}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
            Alertas
          </p>
          <p
            className={[
              "mt-0.5 text-xl font-bold tabular-nums",
              alertas.length > 0
                ? "text-rose-700 dark:text-rose-200"
                : "text-emerald-700 dark:text-emerald-200",
            ].join(" ")}
          >
            {alertas.length}
          </p>
        </div>
        <div className="rounded-md border border-neutral-border bg-neutral-50 px-2 py-2 dark:border-dk-border dark:bg-dk-elevated">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
            Mes
          </p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-primary dark:text-dk-primary">
            {fechaMasReciente ?? "s/d"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex-1">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Alertas activas
        </h3>
        {alertas.length === 0 ? (
          <div
            role="status"
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-100"
          >
            <p className="font-semibold">Sin anomalías detectadas</p>
            <p className="mt-0.5 leading-relaxed">
              Ningún barrio presenta cambios estructurales fuera del rango
              habitual en el último mes.
            </p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Lista de alertas activas">
            {alertas.slice(0, 8).map((r) => {
              const cat =
                CATEGORIA_DISPLAY[r.categoria] ?? CATEGORIA_DISPLAY.sin_dato;
              const z = r.z_score as number;
              return (
                <li
                  key={r.poligono_id}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2 text-xs ${cat.bg}`}
                >
                  <span
                    className={`shrink-0 font-bold tabular-nums text-base ${cat.text}`}
                    aria-hidden="true"
                  >
                    {cat.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-semibold text-primary dark:text-dk-primary">
                      {nombreById.get(r.poligono_id) ?? r.poligono_id}
                    </p>
                    <p className={`text-[10px] ${cat.text}`}>{cat.label}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded bg-white/80 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums dark:bg-dk-bg/60 ${cat.text}`}
                    title={`z-score = ${z.toFixed(2)} desviaciones estándar respecto a la baseline`}
                  >
                    z={z > 0 ? "+" : ""}
                    {z.toFixed(1)}
                  </span>
                </li>
              );
            })}
            {alertas.length > 8 && (
              <li className="px-3 text-[11px] italic text-neutral-muted dark:text-dk-muted">
                + {alertas.length - 8} alertas adicionales en la tabla
                completa.
              </li>
            )}
          </ul>
        )}
      </div>

      <footer className="mt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Fuente: ESA Sentinel-1 SAR VV (banda C). Script:{" "}
        <code className="rounded bg-neutral-100 px-1 py-0.5 dark:bg-dk-elevated">
          compute_capas.cjs
        </code>{" "}
        — z-score vs baseline de 12 meses.
      </footer>
    </section>
  );
}
