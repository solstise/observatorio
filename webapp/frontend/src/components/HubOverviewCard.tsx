// <HubOverviewCard> — tarjeta visual para las páginas hub (índice).
//
// Cada hub (`/indicadores`, `/pronostico`, `/decision`, `/datos`) muestra
// un grid de estas cards, una por sub-tema. Cada card lleva al sub-tema
// con un KPI ya consumible para que el usuario que sólo quiere "el dato
// rápido" no tenga que entrar a la sub-página.
//
// Diseño:
//   - Header con ícono + título + (opcional) chip de categoría
//   - Body con 1-2 líneas de descripción
//   - KPI grande tipográfico (40-48px)
//   - Footer con sub-texto + CTA "Ver más →"
//   - Hover: borde resaltado + leve scale, dejando claro que es clicable
//
// No usa estado; es 100% server-renderable. Hover/focus solo con CSS.

import Link from "next/link";
import type { ReactNode } from "react";

interface HubOverviewCardProps {
  /** URL de la sub-página */
  href: string;
  /** Título corto y específico (ej: "Tipología urbana") */
  title: string;
  /** Descripción 1-2 oraciones de qué encontrás dentro */
  description: string;
  /** KPI principal (valor + unidad). Idealmente el dato más importante
      del sub-tema para que sea consumible sin entrar. */
  kpi?: {
    value: string;
    unit?: string;
    label: string; // sub-texto explicando qué métrica es
  };
  /** Ícono SVG inline opcional (24x24 viewBox preferido) */
  icon?: ReactNode;
  /** Chip de categoría opcional: muestra arriba a la derecha. Por
      ejemplo "Capa 1" o "Próximos 14 días". */
  chip?: string;
  /** Tono del card: define el color del ícono + chip. Default = primary. */
  tone?: "primary" | "accent" | "danger" | "success" | "muted";
}

const TONE_CLASSES: Record<NonNullable<HubOverviewCardProps["tone"]>, { icon: string; chip: string; border: string }> = {
  primary: {
    icon: "text-primary dark:text-dk-primary",
    chip: "bg-primary-50 text-primary dark:bg-dk-elevated dark:text-dk-primary",
    border: "hover:border-primary-300 dark:hover:border-dk-primary/70",
  },
  accent: {
    icon: "text-accent dark:text-dk-accent",
    chip: "bg-accent-50 text-accent dark:bg-amber-900/30 dark:text-dk-accent",
    border: "hover:border-accent-200 dark:hover:border-dk-accent/70",
  },
  danger: {
    icon: "text-rose-700 dark:text-rose-300",
    chip: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
    border: "hover:border-rose-300 dark:hover:border-rose-700/70",
  },
  success: {
    icon: "text-emerald-700 dark:text-emerald-300",
    chip: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    border: "hover:border-emerald-300 dark:hover:border-emerald-700/70",
  },
  muted: {
    icon: "text-secondary dark:text-dk-muted",
    chip: "bg-neutral-100 text-secondary dark:bg-dk-elevated dark:text-dk-muted",
    border: "hover:border-neutral-300 dark:hover:border-dk-border/80",
  },
};

export function HubOverviewCard({
  href,
  title,
  description,
  kpi,
  icon,
  chip,
  tone = "primary",
}: HubOverviewCardProps) {
  const cls = TONE_CLASSES[tone];
  return (
    <Link
      href={href}
      className={[
        "group relative flex flex-col gap-3 rounded-lg border border-neutral-border bg-white p-4 shadow-sm transition-all dark:border-dk-border dark:bg-dk-surface",
        "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-dk-primary dark:focus-visible:ring-offset-dk-bg",
        cls.border,
      ].join(" ")}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon && (
            <span aria-hidden className={`shrink-0 ${cls.icon}`}>
              {icon}
            </span>
          )}
          <h3 className="text-base font-semibold text-primary dark:text-dk-primary">
            {title}
          </h3>
        </div>
        {chip && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls.chip}`}
          >
            {chip}
          </span>
        )}
      </header>

      <p className="text-xs leading-relaxed text-neutral-text dark:text-dk-text">
        {description}
      </p>

      {kpi && (
        <div className="mt-auto rounded-md border border-neutral-border/60 bg-primary-50/40 px-3 py-2 dark:border-dk-border/60 dark:bg-dk-elevated/50">
          <p className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tabular-nums text-primary dark:text-dk-primary">
              {kpi.value}
            </span>
            {kpi.unit && (
              <span className="text-sm font-medium text-secondary dark:text-dk-muted">
                {kpi.unit}
              </span>
            )}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-secondary dark:text-dk-muted">
            {kpi.label}
          </p>
        </div>
      )}

      <footer className="flex items-center justify-end gap-1 text-xs font-semibold text-primary group-hover:gap-2 dark:text-dk-primary">
        <span className="transition-all">Ver más</span>
        <span aria-hidden className="transition-all">→</span>
      </footer>
    </Link>
  );
}
