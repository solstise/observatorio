// Sección "Calidad de vida" para la ficha del polígono.
// 4 sub-cards (Capa 3): habitabilidad global, 15-minute city,
// resiliencia climática y dinámica de gentrificación.

import type {
  CategoriaGentrificacion,
  CategoriaHabitabilidad,
  CategoriaResiliencia,
  GentrificacionRow,
  HabitabilidadRow,
  QuinceMinutosRow,
  ResilienciaRow,
} from "@/lib/types";
import { formatNumber } from "@/lib/format";

interface CapaCalidadVidaSectionProps {
  habitabilidad: HabitabilidadRow | null;
  quince: QuinceMinutosRow | null;
  resiliencia: ResilienciaRow | null;
  gentrificacion: GentrificacionRow | null;
}

const COLOR_HABITAB: Record<CategoriaHabitabilidad, string> = {
  bajo: "#dc2626",
  medio: "#facc15",
  bueno: "#5a7a9c",
  excelente: "#16a34a",
};

const LABEL_HABITAB: Record<CategoriaHabitabilidad, string> = {
  bajo: "Bajo",
  medio: "Medio",
  bueno: "Bueno",
  excelente: "Excelente",
};

const COLOR_RESIL: Record<CategoriaResiliencia, string> = {
  baja: "#dc2626",
  media: "#facc15",
  alta: "#16a34a",
};

const LABEL_RESIL: Record<CategoriaResiliencia, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
};

const COLOR_GENTRI: Record<CategoriaGentrificacion, string> = {
  estable: "#16a34a",
  crecimiento_moderado: "#facc15",
  en_transformacion: "#ea580c",
};

const LABEL_GENTRI: Record<CategoriaGentrificacion, string> = {
  estable: "Estable",
  crecimiento_moderado: "Crecimiento moderado",
  en_transformacion: "En transformación",
};

export function CapaCalidadVidaSection({
  habitabilidad,
  quince,
  resiliencia,
  gentrificacion,
}: CapaCalidadVidaSectionProps) {
  return (
    <section aria-labelledby="capa-calidad" className="mt-10">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2
          id="capa-calidad"
          className="text-xl font-semibold text-primary dark:text-dk-primary"
        >
          Calidad de vida
        </h2>
        <span className="rounded-sm bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary dark:bg-dk-elevated dark:text-dk-muted">
          Capa 3
        </span>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
        Cuatro lecturas integradas: habitabilidad agregada, accesibilidad
        peatonal (15 minutos), resiliencia climática y presión de
        gentrificación.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <HabitabilidadCard row={habitabilidad} />
        <QuinceMinCard row={quince} />
        <ResilienciaCard row={resiliencia} />
        <GentrificacionCard row={gentrificacion} />
      </div>
    </section>
  );
}

function Bar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-secondary dark:text-dk-muted">{label}</span>
        <span className="font-semibold text-primary dark:text-dk-primary">
          {pct.toFixed(0)}
        </span>
      </div>
      <div
        className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-primary-50 dark:bg-dk-elevated"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={label}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function HabitabilidadCard({ row }: { row: HabitabilidadRow | null }) {
  if (!row) return <EmptyCard title="Habitabilidad" />;
  const color = COLOR_HABITAB[row.categoria];
  const label = LABEL_HABITAB[row.categoria];
  return (
    <article className="card" aria-label="Habitabilidad">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Habitabilidad
        </h3>
        <span
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white/80" />
          {label}
        </span>
      </header>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl font-bold" style={{ color }}>
          {row.score_habitabilidad.toFixed(0)}
        </span>
        <span className="text-sm text-neutral-muted dark:text-dk-muted">
          / 100
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <Bar label="Calor" value={row.componente_calor} color={color} />
        <Bar label="Verde" value={row.componente_verde} color={color} />
        <Bar label="Aire" value={row.componente_aire} color={color} />
        <Bar label="Acceso" value={row.componente_acceso} color={color} />
      </div>
    </article>
  );
}

const SERVICIOS_LABEL: Record<string, string> = {
  CAPS: "CAPS",
  caps: "CAPS",
  escuela: "Escuela",
  hospital: "Hospital",
  transporte: "Transporte",
};

function QuinceMinCard({ row }: { row: QuinceMinutosRow | null }) {
  if (!row) return <EmptyCard title="Ciudad de 15 minutos" />;
  const score = row.score_15min;
  const faltaRaw = (row.servicios_falta ?? "").trim();
  const faltan =
    !faltaRaw || faltaRaw.toLowerCase() === "ninguno"
      ? []
      : faltaRaw.split("|").map((s) => s.trim()).filter(Boolean);
  return (
    <article className="card" aria-label="Ciudad de 15 minutos">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Ciudad de 15 minutos
        </h3>
      </header>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl font-bold text-primary dark:text-dk-primary">
          {score != null ? score.toFixed(0) : "s/d"}
        </span>
        <span className="text-sm text-neutral-muted dark:text-dk-muted">
          / 100
        </span>
      </div>
      <p className="text-xs text-neutral-muted dark:text-dk-muted">
        accesibilidad ponderada a 4 servicios esenciales
      </p>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <Bar
          label="CAPS"
          value={(row.acceso_caps ?? 0)}
          color="#5a7a9c"
        />
        <Bar
          label="Escuela"
          value={(row.acceso_escuela ?? 0)}
          color="#5a7a9c"
        />
        <Bar
          label="Hospital"
          value={(row.acceso_hospital ?? 0)}
          color="#5a7a9c"
        />
        <Bar
          label="Transporte"
          value={(row.acceso_transporte ?? 0)}
          color="#5a7a9c"
        />
      </div>
      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-wider text-secondary dark:text-dk-muted">
          Servicios faltantes
        </p>
        {faltan.length === 0 ? (
          <p className="mt-1 text-xs italic text-neutral-muted dark:text-dk-muted">
            Ninguno — todos los servicios están dentro del rango.
          </p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {faltan.map((s) => (
              <li
                key={s}
                className="rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-800 dark:border-orange-700/60 dark:bg-orange-900/40 dark:text-orange-200"
              >
                {SERVICIOS_LABEL[s] ?? s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function ResilienciaCard({ row }: { row: ResilienciaRow | null }) {
  if (!row) return <EmptyCard title="Resiliencia climática" />;
  const color = COLOR_RESIL[row.categoria];
  const label = LABEL_RESIL[row.categoria];
  return (
    <article className="card" aria-label="Resiliencia climática">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Resiliencia climática
        </h3>
        <span
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white/80" />
          {label}
        </span>
      </header>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-4xl font-bold" style={{ color }}>
          {row.score_resiliencia.toFixed(0)}
        </span>
        <span className="text-sm text-neutral-muted dark:text-dk-muted">
          / 100
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <Bar
          label="Permeabilidad"
          value={row.componente_permeabilidad}
          color={color}
        />
        <Bar label="Canopy" value={row.componente_canopy} color={color} />
        <Bar label="Drenaje" value={row.componente_drenaje} color={color} />
        <Bar label="Calor" value={row.componente_calor} color={color} />
      </div>
    </article>
  );
}

function GentrificacionCard({
  row,
}: {
  row: GentrificacionRow | null;
}) {
  if (!row) return <EmptyCard title="Gentrificación" />;
  const color = COLOR_GENTRI[row.categoria];
  const label = LABEL_GENTRI[row.categoria];
  const edifArrow = row.cambio_edificios_pct >= 0 ? "↑" : "↓";
  const constArrow = row.cambio_construido_pct >= 0 ? "↑" : "↓";
  return (
    <article className="card" aria-label="Gentrificación">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Gentrificación
        </h3>
        <span
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-white/80" />
          {label}
        </span>
      </header>
      <p className="mt-2 text-3xl font-bold text-primary dark:text-dk-primary">
        {row.score_gentrificacion.toFixed(0)}
        <span className="ml-1 text-sm font-normal text-neutral-muted dark:text-dk-muted">
          / 100
        </span>
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-secondary dark:text-dk-muted">
            Δ edificios
          </dt>
          <dd
            className="font-semibold"
            style={{
              color: row.cambio_edificios_pct >= 0 ? color : "#5a7a9c",
            }}
          >
            <span aria-hidden>{edifArrow}</span>{" "}
            {row.cambio_edificios_pct.toFixed(1)} %
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">
            Δ construido
          </dt>
          <dd
            className="font-semibold"
            style={{
              color: row.cambio_construido_pct >= 0 ? color : "#5a7a9c",
            }}
          >
            <span aria-hidden>{constArrow}</span>{" "}
            {formatNumber(row.cambio_construido_pct, "s/d", {
              decimals: 1,
              suffix: " %",
            })}
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
