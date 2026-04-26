"use client";

// Medidor tipo donut que muestra el indicador Dynamic World del
// poligono para la fecha mas reciente disponible. El valor expresa
// el porcentaje del area donde el modelo asigna probabilidad >= 0.5
// de clase "built" (construido) en Sentinel-2 via deep learning.
//
// dw_built_pct_ge_50 viene en fraccion 0-1 en los CSV reales, pero
// para robustez aceptamos tanto 0-1 como 0-100 (si ya viene escalado).
//
// Dark mode: el "construido" se pinta en azul claro y el "resto" en un
// gris oscuro azulado para diferenciar del fondo de la card. El número
// central usa text-primary que el sistema CSS ya invierte.

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { useTheme } from "@/hooks/useTheme";
import type { DynamicWorldRow } from "@/lib/types";

interface DynamicWorldGaugeProps {
  rows: DynamicWorldRow[];
  height?: number;
}

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
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const colorBuilt = isDark ? "#7faed8" : "#1a3a5c";
  const colorRest = isDark ? "#2a3247" : "#e5e7eb";

  if (!rows.length) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center">
        <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos de cobertura del suelo para este polígono.
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
      <div>
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Cuánto del barrio es construcción
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Identifica qué proporción del polígono es superficie construida
          (techos, calles, infraestructura) frente a verde, suelo y agua.
        </p>
      </div>
      <div
        role="img"
        aria-label={`Cobertura construida: ${pct.toFixed(1)} por ciento del polígono.`}
        className="relative w-full"
        style={{ height }}
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
              <Cell fill={colorBuilt} />
              <Cell fill={colorRest} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-primary dark:text-dk-primary">
            {pct.toFixed(0)}%
          </span>
          <span className="text-[10px] uppercase tracking-wider text-secondary dark:text-dk-muted">
            construido
          </span>
        </div>
      </div>
      <p className="text-xs text-neutral-muted dark:text-dk-muted">
        {pct.toFixed(1)}% del polígono clasificado como construcción
        ({ultima.fecha}).{" "}
        <em>Datos: Dynamic World V1, IA de Google sobre Sentinel-2.</em>
      </p>
    </div>
  );
}
