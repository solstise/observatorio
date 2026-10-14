// <PoligonoStatStrip> — strip condensado arriba de los tabs en la ficha.
//
// Server component puro. Concentra de un vistazo: categoría, nombre, ID,
// botones de acción (PDF, share) y 4 KPIs principales del barrio.
//
// Diseño: una franja con dos filas en mobile / una en desktop. La idea
// es que el lector vea "este barrio" + sus 4 indicadores top sin importar
// en qué tab esté.

import Link from "next/link";
import type { CategoriaHabitabilidad, CategoriaRiesgo } from "@/lib/types";

interface PoligonoStatStripProps {
  nombre: string;
  poligonoId: string;
  categoria: string; // ej "emergente", "consolidado" — viene crudo

  // KPI 1: Habitabilidad (score 0-100 + categoría textual)
  habitabilidad?: {
    score: number;
    categoria: CategoriaHabitabilidad;
  } | null;
  // KPI 2: Riesgo dengue (categoría textual)
  dengue?: {
    categoria: CategoriaRiesgo;
  } | null;
  // KPI 3: % construido (Dynamic World 2026 o similar)
  pctConstruido?: number | null;
  // KPI 4: Verde m²/hab
  verdeM2PerCapita?: number | null;
}

const LABEL_HABIT: Record<CategoriaHabitabilidad, string> = {
  bajo: "Bajo",
  medio: "Medio",
  bueno: "Bueno",
  excelente: "Excelente",
};

const COLOR_HABIT: Record<CategoriaHabitabilidad, string> = {
  bajo: "text-rose-700 dark:text-rose-300",
  medio: "text-amber-700 dark:text-amber-300",
  bueno: "text-emerald-700 dark:text-emerald-300",
  excelente: "text-emerald-700 dark:text-emerald-300",
};

const LABEL_RIESGO: Record<CategoriaRiesgo, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
  muy_alto: "Muy alto",
};

const COLOR_RIESGO: Record<CategoriaRiesgo, string> = {
  bajo: "text-emerald-700 dark:text-emerald-300",
  medio: "text-amber-700 dark:text-amber-300",
  alto: "text-orange-700 dark:text-orange-300",
  muy_alto: "text-rose-700 dark:text-rose-300",
};

export function PoligonoStatStrip({
  nombre,
  poligonoId,
  categoria,
  habitabilidad,
  dengue,
  pctConstruido,
  verdeM2PerCapita,
}: PoligonoStatStripProps) {
  return (
    <div className="mb-2 rounded-lg border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            {categoria.replace("_", " ")}
          </p>
          <h1
            className="mt-0.5 truncate font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h2)" }}
          >
            {nombre}
          </h1>
          <p className="mt-0.5 text-xs text-neutral-muted dark:text-dk-muted">
            ID:{" "}
            <code className="rounded bg-primary-50 px-1 dark:bg-dk-elevated dark:text-dk-text">
              {poligonoId}
            </code>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a
            href={`/data/media/${poligonoId}.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary/40 dark:bg-dk-elevated dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
            aria-label="Descargar reporte PDF"
          >
            <span aria-hidden>PDF</span>
          </a>
          <Link
            href={`/decision/comparar?ids=${encodeURIComponent(poligonoId)},posadas_completa`}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary/40 dark:bg-dk-elevated dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
            aria-label="Comparar este barrio con el total de Posadas"
          >
            <span aria-hidden>⊕</span> Comparar
          </Link>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiBlock
          label="Habitabilidad"
          value={
            habitabilidad ? `${Math.round(habitabilidad.score)}/100` : "s/d"
          }
          sub={
            habitabilidad
              ? LABEL_HABIT[habitabilidad.categoria]
              : "Sin medición"
          }
          colorClass={habitabilidad ? COLOR_HABIT[habitabilidad.categoria] : ""}
        />
        <KpiBlock
          label="Riesgo dengue"
          value={dengue ? LABEL_RIESGO[dengue.categoria] : "s/d"}
          sub="14 días"
          colorClass={dengue ? COLOR_RIESGO[dengue.categoria] : ""}
        />
        <KpiBlock
          label="Construido"
          value={
            pctConstruido != null
              ? `${pctConstruido.toFixed(0)}%`
              : "s/d"
          }
          sub="Cobertura del barrio"
        />
        <KpiBlock
          label="Verde por hab."
          value={
            verdeM2PerCapita != null
              ? `${Math.round(verdeM2PerCapita)} m²`
              : "s/d"
          }
          sub="m² verde / habitante"
        />
      </div>
    </div>
  );
}

function KpiBlock({
  label,
  value,
  sub,
  colorClass,
}: {
  label: string;
  value: string;
  sub: string;
  colorClass?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-border/60 bg-primary-50/40 px-3 py-2 dark:border-dk-border/60 dark:bg-dk-elevated/50">
      <p className="text-[10px] uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </p>
      <p
        className={[
          "mt-0.5 text-lg font-bold tabular-nums",
          colorClass || "text-primary dark:text-dk-primary",
        ].join(" ")}
      >
        {value}
      </p>
      <p className="text-[10px] text-neutral-muted dark:text-dk-muted">{sub}</p>
    </div>
  );
}
