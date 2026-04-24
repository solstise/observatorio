"use client";

// Medidor tipo donut que muestra el indicador Dynamic World del
// poligono para la fecha mas reciente disponible. El valor expresa
// el porcentaje del area donde el modelo asigna probabilidad >= 0.5
// de clase "built" (construido) en Sentinel-2 via deep learning.
//
// dw_built_pct_ge_50 viene en fraccion 0-1 en los CSV reales, pero
// para robustez aceptamos tanto 0-1 como 0-100 (si ya viene escalado).

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import type { DynamicWorldRow } from "@/lib/types";

interface DynamicWorldGaugeProps {
  rows: DynamicWorldRow[];
  height?: number;
}

const COLOR_BUILT = "#1a3a5c";
const COLOR_REST = "#e5e7eb";

// Si el valor viene <= 1 lo tratamos como fraccion; si viene > 1 ya
// esta en porcentaje. Igual clampeamos a [0, 100].
function normalizarPct(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, pct));
}

// Compara dos fechas YYYY-MM lexicograficamente (string sort sirve).
function cmpFechaDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

export function DynamicWorldGauge({
  rows,
  height = 220,
}: DynamicWorldGaugeProps) {
  if (!rows.length) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center">
        <p className="text-sm italic text-neutral-muted">
          Dynamic World sin datos para este poligono.
        </p>
      </div>
    );
  }

  const ordenadas = [...rows].sort((a, b) => cmpFechaDesc(a.fecha, b.fecha));
  const ultima = ordenadas[0];
  const pct = normalizarPct(ultima.dw_built_pct_ge_50);
  const data = [
    { name: "Construido", value: pct },
    { name: "Resto", value: 100 - pct },
  ];

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-primary">
        Dynamic World &mdash; superficie construida
      </h3>
      <div
        role="img"
        aria-label={`Dynamic World: ${pct.toFixed(1)} por ciento del poligono con probabilidad mayor o igual a 0.5 de superficie construida`}
        className="relative"
        style={{ width: "100%", height }}
      >
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="65%"
              outerRadius="95%"
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              stroke="none"
            >
              <Cell fill={COLOR_BUILT} />
              <Cell fill={COLOR_REST} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-primary">
            {pct.toFixed(0)}%
          </span>
          <span className="text-[10px] uppercase tracking-wider text-secondary">
            prob. &ge; 0.5
          </span>
        </div>
      </div>
      <p className="text-xs text-neutral-muted">
        {pct.toFixed(1)}% de probabilidad &ge; 0.5 de superficie construida
        (Dynamic World, {ultima.fecha}).
      </p>
    </div>
  );
}
