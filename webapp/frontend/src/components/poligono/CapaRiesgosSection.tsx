// Sección "Riesgos próximos 14 días" para la ficha del polígono.
// 4 sub-cards (Capa 2): dengue, calor & salud (con mini-calendario
// de 14 días), anegamiento y saturación urbana/infraestructura.

import type {
  AnegamientoRow,
  CalorSaludDiarioRow,
  CalorSaludRow,
  CategoriaRiesgo,
  DengueRow,
  NivelCalorDiario,
  SaturacionRow,
} from "@/lib/types";
import { formatNumber } from "@/lib/format";

interface CapaRiesgosSectionProps {
  dengue: DengueRow | null;
  calorSalud: CalorSaludRow | null;
  calorSaludDiario: CalorSaludDiarioRow[];
  anegamiento: AnegamientoRow | null;
  saturacion: SaturacionRow | null;
}

const COLOR_RIESGO: Record<CategoriaRiesgo, string> = {
  bajo: "#16a34a",
  medio: "#facc15",
  alto: "#ea580c",
  muy_alto: "#dc2626",
};

const LABEL_RIESGO: Record<CategoriaRiesgo, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
  muy_alto: "Muy alto",
};

const COLOR_NIVEL_CALOR: Record<NivelCalorDiario, string> = {
  normal: "#16a34a",
  moderado: "#facc15",
  alto: "#ea580c",
  extremo: "#dc2626",
};

const LABEL_NIVEL_CALOR: Record<NivelCalorDiario, string> = {
  normal: "Normal",
  moderado: "Moderado",
  alto: "Alto",
  extremo: "Extremo",
};

export function CapaRiesgosSection({
  dengue,
  calorSalud,
  calorSaludDiario,
  anegamiento,
  saturacion,
}: CapaRiesgosSectionProps) {
  return (
    <section aria-labelledby="capa-riesgos" className="mt-10">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2
          id="capa-riesgos"
          className="text-xl font-semibold text-primary dark:text-dk-primary"
        >
          Riesgos próximos 14 días
        </h2>
        <span className="rounded-sm bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary dark:bg-dk-elevated dark:text-dk-muted">
          Capa 2
        </span>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
        Pronóstico de salud pública del barrio: virus por mosquito, olas de
        calor, anegamiento por lluvia intensa y saturación de infraestructura
        ante crecimiento poblacional.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <DengueCard row={dengue} />
        <CalorSaludCard row={calorSalud} diario={calorSaludDiario} />
        <AnegamientoCard row={anegamiento} />
        <SaturacionCard row={saturacion} />
      </div>
    </section>
  );
}

function ScoreGauge({
  score,
  categoria,
  unit,
}: {
  score: number | null | undefined;
  categoria: CategoriaRiesgo | null;
  unit?: string;
}) {
  const value = typeof score === "number" && Number.isFinite(score) ? score : 0;
  const color = categoria ? COLOR_RIESGO[categoria] : "#9ca3af";
  return (
    <div className="mt-2">
      <div className="flex items-baseline gap-1">
        <span
          className="text-3xl font-bold"
          style={{ color }}
        >
          {value.toFixed(0)}
        </span>
        <span className="text-sm text-neutral-muted dark:text-dk-muted">
          {unit ?? "/ 100"}
        </span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-primary-50 dark:bg-dk-elevated"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(100, Math.max(0, value))}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

function RiesgoBadge({ categoria }: { categoria: CategoriaRiesgo }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold text-white"
      style={{ backgroundColor: COLOR_RIESGO[categoria] }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white/80" />
      {LABEL_RIESGO[categoria]}
    </span>
  );
}

function DengueCard({ row }: { row: DengueRow | null }) {
  if (!row) return <EmptyCard title="Riesgo de dengue" />;
  const factores: { label: string; value: string }[] = [
    {
      label: "Lluvia 14 d proj",
      value: formatNumber(row.lluvia_14d_proj_mm, "s/d", {
        decimals: 0,
        suffix: " mm",
      }),
    },
    {
      label: "Tmín 14 d proj",
      value: formatNumber(row.tmin_avg_14d_proj_c, "s/d", {
        decimals: 1,
        suffix: "°C",
      }),
    },
    {
      label: "Densidad hab.",
      value: formatNumber(row.densidad_hab_km2, "s/d", { suffix: " /km²" }),
    },
    {
      label: "Verde (canopy)",
      value: formatNumber(row.canopy_pct, "s/d", {
        decimals: 0,
        suffix: " %",
      }),
    },
  ];
  return (
    <article className="card" aria-label="Riesgo de dengue">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Dengue
        </h3>
        <RiesgoBadge categoria={row.categoria} />
      </header>
      <ScoreGauge score={row.score_dengue} categoria={row.categoria} />
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        {factores.map((f) => (
          <li key={f.label} className="flex flex-col">
            <span className="text-secondary dark:text-dk-muted">{f.label}</span>
            <span className="font-semibold text-primary dark:text-dk-primary">
              {f.value}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function CalorSaludCard({
  row,
  diario,
}: {
  row: CalorSaludRow | null;
  diario: CalorSaludDiarioRow[];
}) {
  if (!row) return <EmptyCard title="Calor y salud" />;
  // Tomamos los primeros 14 días (data.server ya ordena por fecha asc).
  const dias = diario.slice(0, 14);
  return (
    <article className="card" aria-label="Calor y salud">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Calor y salud
        </h3>
        <RiesgoBadge categoria={row.categoria} />
      </header>
      <ScoreGauge score={row.score_calor} categoria={row.categoria} />
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-secondary dark:text-dk-muted">Días alto</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {row.dias_riesgo_alto}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Días extremo</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {row.dias_riesgo_extremo}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Tmáx proy.</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.tmax_max_proj_c, "s/d", {
              decimals: 1,
              suffix: "°C",
            })}
          </dd>
        </div>
      </dl>
      {dias.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[11px] uppercase tracking-wider text-secondary dark:text-dk-muted">
            Próximos {dias.length} días
          </p>
          <div className="flex flex-wrap gap-1">
            {dias.map((d) => (
              <div
                key={d.fecha}
                className="flex h-10 w-10 flex-col items-center justify-center rounded text-[10px] font-medium text-white"
                style={{ backgroundColor: COLOR_NIVEL_CALOR[d.nivel_calor] }}
                title={`${d.fecha}: ${LABEL_NIVEL_CALOR[d.nivel_calor]}, Tmáx ${d.tmax_p50.toFixed(0)}°C`}
                aria-label={`${d.fecha}, nivel ${LABEL_NIVEL_CALOR[d.nivel_calor]}, máxima ${d.tmax_p50.toFixed(0)} grados`}
              >
                <span>{d.fecha.slice(8, 10)}</span>
                <span className="text-[9px] opacity-90">
                  {d.tmax_p50.toFixed(0)}°
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
            {(Object.keys(LABEL_NIVEL_CALOR) as NivelCalorDiario[]).map((k) => (
              <span key={k} className="flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-sm"
                  style={{ backgroundColor: COLOR_NIVEL_CALOR[k] }}
                />
                <span className="text-neutral-muted dark:text-dk-muted">
                  {LABEL_NIVEL_CALOR[k]}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function AnegamientoCard({ row }: { row: AnegamientoRow | null }) {
  if (!row) return <EmptyCard title="Anegamiento" />;
  return (
    <article className="card" aria-label="Riesgo de anegamiento">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Anegamiento
        </h3>
        <RiesgoBadge categoria={row.categoria} />
      </header>
      <ScoreGauge score={row.score_anegamiento} categoria={row.categoria} />
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-secondary dark:text-dk-muted">% impermeable</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.pct_impermeable, "s/d", {
              decimals: 0,
              suffix: " %",
            })}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Lluvia 48 h</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.lluvia_48h_proj_mm, "s/d", {
              decimals: 0,
              suffix: " mm",
            })}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-secondary dark:text-dk-muted">
            Riesgo base inundación
          </dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.riesgo_inundacion_base, "s/d", { decimals: 2 })}{" "}
            <span className="text-[10px] font-normal text-neutral-muted dark:text-dk-muted">
              (índice 0–1)
            </span>
          </dd>
        </div>
      </dl>
    </article>
  );
}

function SaturacionCard({ row }: { row: SaturacionRow | null }) {
  if (!row) return <EmptyCard title="Saturación urbana" />;
  const anioSat = row.anio_saturacion;
  return (
    <article className="card" aria-label="Saturación urbana">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Saturación urbana
        </h3>
      </header>
      <p className="mt-2 text-3xl font-bold text-primary dark:text-dk-primary">
        {anioSat !== null && anioSat !== undefined ? anioSat : "—"}
      </p>
      <p className="text-xs text-neutral-muted dark:text-dk-muted">
        {anioSat !== null && anioSat !== undefined
          ? "año proyectado de saturación urbana"
          : "todavía no proyectado · crecimiento bajo o consolidado"}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-secondary dark:text-dk-muted">% ocupado 2026</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.pct_ocupado_2026, "s/d", {
              decimals: 0,
              suffix: " %",
            })}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">
            Crec. anual edif.
          </dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.crecimiento_anual_edif, "s/d", {
              decimals: 0,
            })}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Pob. 2030 proj</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.pop_2030_proj, "s/d")}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Tasa anual</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.tasa_crecimiento_anual, "s/d", {
              decimals: 1,
              suffix: " %",
            })}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Aulas 2030</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.aulas_necesarias_2030, "s/d")}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Camas 2030</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.camas_necesarias_2030, "s/d")}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function EmptyCard({ title }: { title: string }) {
  return (
    <article className="card opacity-70" aria-label={`${title} sin datos`}>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
        {title}
      </h3>
      <p className="mt-3 text-sm italic text-neutral-muted dark:text-dk-muted">
        Sin datos disponibles para este barrio.
      </p>
    </article>
  );
}
