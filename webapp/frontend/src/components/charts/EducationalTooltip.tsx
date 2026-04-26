"use client";

// Tooltip reusable para gráficos recharts. Muestra:
//   1. La etiqueta del eje (típicamente el año o la fecha).
//   2. Cada serie con su color y valor (formateado por la prop `formatter`).
//   3. Un texto interpretativo opcional explicando el rango "normal" o el
//      contexto necesario para leer el dato (ej. promedio histórico de Posadas).
//
// Recharts pasa props `active`, `payload` y `label` cuando un punto del
// gráfico está hover. Tipamos esos campos de forma laxa porque la firma
// oficial es genérica y cambia según el tipo de chart.
//
// Dark mode: los colores de cada serie ya vienen del payload (el chart
// los pasó como `color` o `stroke`). El contenedor sí adapta fondo/borde
// porque el tooltip flota sobre la página.

import type { ReactNode } from "react";

// Forma laxa de cada item del payload — recharts no exporta un tipo estable.
export interface TooltipPayloadItem {
  name?: string | number;
  value?: number | string | Array<number | string>;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: string | number;
  unit?: string;
}

export interface EducationalTooltipProps {
  /** Provistos por recharts cuando el tooltip está activo. */
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  /**
   * Texto interpretativo que aparece debajo de los datos.
   * Recibe la etiqueta y el payload por si el texto depende del contexto.
   * Si es string, se muestra tal cual.
   */
  interpretacion?:
    | string
    | ((label: string | number | undefined, payload: TooltipPayloadItem[]) => ReactNode);
  /**
   * Formateador para cada valor. Permite controlar unidades, decimales,
   * etc. Devolver `[texto, etiqueta?]`. Si no se pasa, se hace
   * `Number(value).toLocaleString("es-AR")`.
   */
  formatter?: (
    value: number | string | Array<number | string>,
    name: string | number | undefined,
    item: TooltipPayloadItem,
  ) => [ReactNode, ReactNode?];
  /**
   * Permite filtrar items del payload (ej. ocultar series internas con
   * dataKey "_aux"). Si devuelve `false`, el item no se muestra.
   */
  filter?: (item: TooltipPayloadItem) => boolean;
  /** Etiqueta personalizada para el "label" superior. */
  labelFormatter?: (label: string | number | undefined) => ReactNode;
}

function defaultFormatter(value: number | string | Array<number | string>) {
  if (Array.isArray(value)) {
    const [a, b] = value as [number | string, number | string];
    return `${formatNum(a)} – ${formatNum(b)}`;
  }
  return formatNum(value);
}

function formatNum(v: number | string): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  }
  return String(v);
}

export function EducationalTooltip({
  active,
  payload,
  label,
  interpretacion,
  formatter,
  filter,
  labelFormatter,
}: EducationalTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const visible = filter ? payload.filter(filter) : payload;
  if (!visible.length) return null;

  const interpText =
    typeof interpretacion === "function"
      ? interpretacion(label, visible)
      : interpretacion;

  return (
    <div
      className="max-w-xs rounded-md border border-neutral-border bg-white px-3 py-2 text-xs shadow-md dark:border-dk-border dark:bg-dk-surface"
      role="tooltip"
    >
      {label !== undefined && label !== "" && (
        <p className="mb-1 font-semibold text-primary dark:text-dk-primary">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {visible.map((item, idx) => {
          const color = item.color ?? item.stroke ?? item.fill ?? undefined;
          const rawValue =
            item.value === undefined || item.value === null ? "" : item.value;
          const formatted = formatter
            ? formatter(rawValue, item.name, item)
            : ([defaultFormatter(rawValue), item.name] as [
                ReactNode,
                ReactNode,
              ]);
          const [valueNode, nameNode] = Array.isArray(formatted)
            ? formatted
            : [formatted, item.name];
          return (
            <li
              key={`${item.dataKey ?? idx}-${idx}`}
              className="flex items-baseline gap-2 text-neutral-text dark:text-dk-text"
            >
              {color && (
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
              )}
              <span className="text-neutral-muted dark:text-dk-muted">
                {nameNode ?? item.name ?? ""}
              </span>
              <span className="ml-auto font-medium text-primary tabular-nums dark:text-dk-primary">
                {valueNode}
              </span>
            </li>
          );
        })}
      </ul>
      {interpText && (
        <p className="mt-2 border-t border-neutral-border pt-1.5 text-[11px] italic leading-snug text-neutral-muted dark:border-dk-border dark:text-dk-muted">
          {interpText}
        </p>
      )}
    </div>
  );
}
