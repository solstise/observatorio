// Badge del ranking político de prioridad (capa social, fase 3).
//
// Qué hace: muestra la posición del polígono dentro del ranking de
// prioridad de inversión política. Incluye un tooltip con el desglose
// de los tres componentes (vulnerabilidad, UHI verano y carencia de
// acceso a servicios).
//
// Datos: scripts/54_ranking_politico.py — combina vulnerabilidad
// (script 35), UHI estacional verano (script 49) y distancias del
// script 53.
//
// Este indicador es para PRIORIZAR INVERSIÓN A NIVEL BARRIO, no para
// decisiones individuales. Ver docs/metodologia_servicios.md.

import type { RankingPoliticoRow } from "@/lib/types";

interface RankingPoliticoBadgeProps {
  row: RankingPoliticoRow | null;
  totalPoligonos?: number;
}

// Etiqueta cualitativa según percentil (no según valor absoluto del índice,
// para mantener interpretación estable cuando se agreguen / quiten polígonos).
function clasificarPrioridad(
  ranking: number,
  total: number,
): {
  label: string;
  badgeCls: string;
  textCls: string;
} {
  const pct = ranking / total;
  if (pct <= 0.25) {
    return {
      label: "alta prioridad de inversión",
      badgeCls:
        "bg-rose-100 border-rose-300 text-rose-800 dark:bg-rose-900/40 dark:border-rose-700 dark:text-rose-200",
      textCls: "text-rose-700 dark:text-rose-300",
    };
  }
  if (pct <= 0.5) {
    return {
      label: "prioridad media-alta",
      badgeCls:
        "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-900/40 dark:border-amber-700 dark:text-amber-200",
      textCls: "text-amber-700 dark:text-amber-300",
    };
  }
  if (pct <= 0.75) {
    return {
      label: "prioridad media-baja",
      badgeCls:
        "bg-sky-100 border-sky-300 text-sky-800 dark:bg-sky-900/40 dark:border-sky-700 dark:text-sky-200",
      textCls: "text-sky-700 dark:text-sky-300",
    };
  }
  return {
    label: "situación más equilibrada",
    badgeCls:
      "bg-emerald-100 border-emerald-300 text-emerald-800 dark:bg-emerald-900/40 dark:border-emerald-700 dark:text-emerald-200",
    textCls: "text-emerald-700 dark:text-emerald-300",
  };
}

function ordinal(n: number): string {
  return `${n}°`;
}

export function RankingPoliticoBadge({
  row,
  totalPoligonos,
}: RankingPoliticoBadgeProps) {
  if (!row) {
    return (
      <div
        className="rounded-md border border-neutral-border bg-white p-4 dark:border-dk-border dark:bg-dk-surface"
        role="status"
      >
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Ranking de prioridad
        </h3>
        <p className="mt-2 text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos de ranking para este polígono todavía.
        </p>
      </div>
    );
  }

  const total = totalPoligonos ?? row.ranking;
  const { label, badgeCls, textCls } = clasificarPrioridad(row.ranking, total);

  // Componentes en porcentaje legible.
  const vuln = (row.vulnerabilidad_norm * 100).toFixed(0);
  const uhi = (row.uhi_verano_norm * 100).toFixed(0);
  const carencia = (row.acceso_servicios_norm * 100).toFixed(0);
  const indicePct = (row.indice_prioridad * 100).toFixed(0);

  const tooltip = [
    `Índice de prioridad: ${indicePct}/100`,
    `Vulnerabilidad (peso 40%): ${vuln}/100`,
    `UHI verano (peso 30%): ${uhi}/100`,
    `Carencia de acceso a servicios (peso 30%): ${carencia}/100`,
    "Indicador técnico para priorizar inversión a nivel barrio.",
    "NO usar para decisiones individuales.",
  ].join(" | ");

  return (
    <div
      className="rounded-md border border-neutral-border bg-white p-4 dark:border-dk-border dark:bg-dk-surface"
      title={tooltip}
      aria-label={tooltip}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Ranking de prioridad
        </h3>
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${badgeCls}`}
        >
          {label}
        </span>
      </header>

      <div className="flex items-baseline gap-3">
        <span
          className={`text-3xl font-bold tabular-nums ${textCls}`}
          aria-label={`Posición ${ordinal(row.ranking)} de ${total}`}
        >
          {ordinal(row.ranking)}
        </span>
        <span className="text-sm text-neutral-muted dark:text-dk-muted">
          de {total} polígonos analizados
        </span>
      </div>

      <p className="mt-2 text-xs text-neutral-text dark:text-dk-text">
        Mayor posición = mayor prioridad. Combina vulnerabilidad, isla de
        calor de verano y carencia de acceso a servicios públicos.
      </p>

      <dl className="mt-3 grid gap-2 grid-cols-3 text-[11px]">
        <Componente
          label="Vulnerabilidad"
          peso="40%"
          valor={vuln}
        />
        <Componente label="UHI verano" peso="30%" valor={uhi} />
        <Componente
          label="Carencia servicios"
          peso="30%"
          valor={carencia}
        />
      </dl>

      <p className="mt-3 border-t border-neutral-border pt-2 text-[11px] text-neutral-muted dark:border-dk-border dark:text-dk-muted">
        Índice agregado:{" "}
        <strong className="text-primary dark:text-dk-primary">
          {indicePct}/100
        </strong>
        .{" "}
        <em>
          Insumo técnico para priorizar inversión a nivel barrio. No
          condiciona viviendas individuales.
        </em>
      </p>
    </div>
  );
}

function Componente({
  label,
  peso,
  valor,
}: {
  label: string;
  peso: string;
  valor: string;
}) {
  return (
    <div className="rounded border border-neutral-border bg-neutral-50 p-2 dark:border-dk-border dark:bg-dk-elevated">
      <dt className="uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </dt>
      <dd className="mt-0.5 flex items-baseline gap-1">
        <span className="text-base font-bold text-primary dark:text-dk-primary">
          {valor}
        </span>
        <span className="text-[10px] text-neutral-muted dark:text-dk-muted">
          /100 · peso {peso}
        </span>
      </dd>
    </div>
  );
}
