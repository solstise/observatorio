// Sección "Tipología urbana" para la ficha del polígono.
// Renderiza 4 sub-cards (Capa 1): cobertura verde, mix de techos,
// densidad volumétrica y anomalía SAR. Todos los datos vienen del
// padre (Server Component) ya filtrados por polígono.

import type {
  AnomaliaRow,
  CanopyRow,
  CategoriaAnomalia,
  CategoriaCanopy,
  DensidadVolumetricaRow,
  TechosRow,
} from "@/lib/types";
import { formatNumber } from "@/lib/format";

interface CapaTipologiaSectionProps {
  canopy: CanopyRow | null;
  techos: TechosRow | null;
  densidad: DensidadVolumetricaRow | null;
  anomalia: AnomaliaRow | null;
}

const COLOR_CANOPY: Record<CategoriaCanopy, string> = {
  rojo: "#dc2626",
  naranja: "#ea580c",
  amarillo: "#facc15",
  verde: "#16a34a",
  sin_dato: "#9ca3af",
};

const LABEL_CANOPY: Record<CategoriaCanopy, string> = {
  rojo: "Crítico",
  naranja: "Deficitario",
  amarillo: "Aceptable",
  verde: "Óptimo",
  sin_dato: "Sin dato",
};

const COLOR_ANOMALIA: Record<CategoriaAnomalia, string> = {
  estable: "#9ca3af",
  crecimiento_moderado: "#facc15",
  crecimiento_fuerte: "#16a34a",
  "pérdida_moderada": "#ea580c",
  "pérdida_fuerte": "#dc2626",
  sin_dato: "#9ca3af",
};

const LABEL_ANOMALIA: Record<CategoriaAnomalia, string> = {
  estable: "Estable",
  crecimiento_moderado: "Crecimiento moderado",
  crecimiento_fuerte: "Crecimiento fuerte",
  "pérdida_moderada": "Pérdida moderada",
  "pérdida_fuerte": "Pérdida fuerte",
  sin_dato: "Sin dato",
};

// Mezcla losa/teja/chapa_nueva/chapa_vieja/asbesto → barra apilada horizontal.
const TECHO_PALETTE: { key: keyof TechosRow; label: string; color: string }[] = [
  { key: "pct_losa", label: "Losa", color: "#1a3a5c" },
  { key: "pct_teja", label: "Teja", color: "#c97d3c" },
  { key: "pct_chapa_nueva", label: "Chapa nueva", color: "#5a7a9c" },
  { key: "pct_chapa_vieja", label: "Chapa vieja", color: "#8b5e3c" },
  { key: "pct_asbesto", label: "Asbesto", color: "#7c2d12" },
];

export function CapaTipologiaSection({
  canopy,
  techos,
  densidad,
  anomalia,
}: CapaTipologiaSectionProps) {
  return (
    <section aria-labelledby="capa-tipologia" className="mt-10">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2
          id="capa-tipologia"
          className="text-xl font-semibold text-primary dark:text-dk-primary"
        >
          Tipología urbana
        </h2>
        <span className="rounded-sm bg-primary-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-secondary dark:bg-dk-elevated dark:text-dk-muted">
          Capa 1
        </span>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
        Qué tan verde, qué materiales predominan en techos, qué tan en altura
        está construido y si la huella urbana cambió fuerte en el último radar.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <CoberturaVerdeCard row={canopy} />
        <TechosCard row={techos} />
        <DensidadVolumetricaCard row={densidad} />
        <AnomaliaSarCard row={anomalia} />
      </div>
    </section>
  );
}

function CoberturaVerdeCard({ row }: { row: CanopyRow | null }) {
  if (!row) {
    return <EmptyCard title="Cobertura verde" />;
  }
  const cat = row.categoria;
  const color = COLOR_CANOPY[cat];
  return (
    <article
      className="card"
      aria-label={`Cobertura verde: ${LABEL_CANOPY[cat]}`}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Cobertura verde
        </h3>
        <span
          className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-white/80"
          />
          {LABEL_CANOPY[cat]}
        </span>
      </header>
      <p className="mt-2 text-3xl font-bold text-primary dark:text-dk-primary">
        {formatNumber(row.verde_pct, "s/d", { decimals: 1, suffix: " %" })}
      </p>
      <p className="text-xs text-neutral-muted dark:text-dk-muted">
        de la superficie es no construida (proxy Dynamic World)
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-secondary dark:text-dk-muted">m²/hab</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.m2_per_capita, "s/d", { decimals: 1 })}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Total m²</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.verde_m2_total, "s/d")}
          </dd>
        </div>
      </dl>
      {row.fecha_referencia && (
        <p className="mt-2 text-[11px] italic text-neutral-muted dark:text-dk-muted">
          Referencia: {row.fecha_referencia}
        </p>
      )}
    </article>
  );
}

function TechosCard({ row }: { row: TechosRow | null }) {
  if (!row) {
    return <EmptyCard title="Tipología de techos" />;
  }
  const items = TECHO_PALETTE.map((p) => ({
    label: p.label,
    color: p.color,
    pct: Math.max(0, Number(row[p.key]) || 0),
  }));
  const total = items.reduce((a, b) => a + b.pct, 0) || 1;
  return (
    <article className="card" aria-label="Tipología de techos">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Tipología de techos
        </h3>
        <span
          className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
          title="Mezcla derivada por heurística sobre imágenes satelitales — no es relevamiento de campo"
        >
          Estimación heurística
        </span>
      </header>
      <div
        className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-primary-50 dark:bg-dk-elevated"
        role="img"
        aria-label="Distribución estimada de materiales de techo"
      >
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              width: `${(it.pct / total) * 100}%`,
              backgroundColor: it.color,
            }}
            title={`${it.label}: ${it.pct.toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2 w-2 flex-shrink-0 rounded-sm"
              style={{ backgroundColor: it.color }}
            />
            <span className="text-secondary dark:text-dk-muted">{it.label}</span>
            <span className="ml-auto font-semibold text-primary dark:text-dk-primary">
              {it.pct.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] italic text-neutral-muted dark:text-dk-muted">
        Método: {row.metodo} · Confianza: {row.confianza}
      </p>
    </article>
  );
}

function DensidadVolumetricaCard({
  row,
}: {
  row: DensidadVolumetricaRow | null;
}) {
  if (!row) {
    return <EmptyCard title="Densidad volumétrica" />;
  }
  return (
    <article className="card" aria-label="Densidad volumétrica">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
        Densidad volumétrica
      </h3>
      <p className="mt-2 text-3xl font-bold text-primary dark:text-dk-primary">
        {formatNumber(row.altura_estimada_m, "s/d", {
          decimals: 1,
          suffix: " m",
        })}
      </p>
      <p className="text-xs text-neutral-muted dark:text-dk-muted">
        altura promedio estimada por edificio
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-secondary dark:text-dk-muted">m³/km²</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.m3_por_km2, "s/d")}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Edificios</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.edificios_2026, "s/d")}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-secondary dark:text-dk-muted">Volumen total</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.m3_total, "s/d", { suffix: " m³" })}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function AnomaliaSarCard({ row }: { row: AnomaliaRow | null }) {
  if (!row || row.categoria === "estable" || row.categoria === "sin_dato") {
    return (
      <article
        className="card flex flex-col justify-between"
        aria-label="Anomalía SAR"
      >
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Anomalía SAR (Sentinel-1)
        </h3>
        <div className="mt-2 rounded-md border border-neutral-border bg-primary-50/40 p-3 dark:border-dk-border dark:bg-dk-elevated/40">
          <p className="text-sm text-neutral-muted dark:text-dk-muted">
            {row && row.categoria === "estable"
              ? "Sin cambios estructurales detectados en el último periodo."
              : "Sin dato de cambios estructurales para este barrio."}
          </p>
          {row?.z_score != null && (
            <p className="mt-1 text-[11px] italic text-neutral-muted dark:text-dk-muted">
              z-score actual: {row.z_score.toFixed(2)}
            </p>
          )}
        </div>
      </article>
    );
  }
  const color = COLOR_ANOMALIA[row.categoria];
  const label = LABEL_ANOMALIA[row.categoria];
  return (
    <article className="card" aria-label={`Anomalía SAR: ${label}`}>
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Anomalía SAR (Sentinel-1)
        </h3>
        <span
          className="rounded-sm px-2 py-0.5 text-xs font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {label}
        </span>
      </header>
      <p className="mt-2 text-3xl font-bold text-primary dark:text-dk-primary">
        {row.z_score != null ? row.z_score.toFixed(2) : "s/d"}
      </p>
      <p className="text-xs text-neutral-muted dark:text-dk-muted">
        z-score vs. baseline del polígono
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-secondary dark:text-dk-muted">Último valor</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.valor_ultimo_db, "s/d", {
              decimals: 1,
              suffix: " dB",
            })}
          </dd>
        </div>
        <div>
          <dt className="text-secondary dark:text-dk-muted">Baseline</dt>
          <dd className="font-semibold text-primary dark:text-dk-primary">
            {formatNumber(row.baseline_mean_db, "s/d", {
              decimals: 1,
              suffix: " dB",
            })}
          </dd>
        </div>
      </dl>
      {row.fecha_ultima && (
        <p className="mt-2 text-[11px] italic text-neutral-muted dark:text-dk-muted">
          Última observación: {row.fecha_ultima}
        </p>
      )}
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
