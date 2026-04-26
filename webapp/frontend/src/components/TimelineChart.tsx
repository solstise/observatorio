"use client";

// Gráfico de la serie de edificios detectados por año con banda de
// confianza ±15%. Mostramos lo que realmente medimos (conteo de edificios)
// en lugar de m²: las columnas superficie_*_km2 son derivadas y la banda
// venía en otra escala, lo cual hacía un chart ilegible.
//
// Dark mode: alternamos los colores de stroke/grid/tick usando useTheme().
// Recharts no permite usar variables CSS directamente en sus props, así que
// resolvemos los hex al momento del render.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EducationalTooltip } from "@/components/charts/EducationalTooltip";
import { useTheme } from "@/hooks/useTheme";
import type { SerieTemporalRow } from "@/lib/types";

interface TimelineChartProps {
  rows: SerieTemporalRow[];
  height?: number;
}

// Paleta efectiva por tema. Centralizamos acá para no rotar entre seis
// strings en el JSX según light/dark.
function palette(isDark: boolean) {
  return {
    primary: isDark ? "#7faed8" : "#1a3a5c",
    secondary: isDark ? "#94a0b8" : "#5a7a9c",
    grid: isDark ? "#2a3247" : "#e5e7eb",
    muted: isDark ? "#94a0b8" : "#6b7280",
    surface: isDark ? "#161d2f" : "#ffffff",
    border: isDark ? "#2a3247" : "#e5e7eb",
  };
}

export function TimelineChart({ rows, height = 320 }: TimelineChartProps) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const C = palette(isDark);

  if (!rows.length) {
    return (
      <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
        Sin datos de serie temporal.
      </p>
    );
  }

  // Ordenamos por año. La banda va como tupla [min, max] en la MISMA
  // unidad que la línea — ambas en conteo de edificios.
  const data = [...rows]
    .sort((a, b) => a.anio - b.anio)
    .map((r) => ({
      anio: r.anio,
      edificios: r.edificios_total,
      banda: [r.confianza_inferior, r.confianza_superior] as [number, number],
    }));

  const formatNumero = (n: number) =>
    n.toLocaleString("es-AR", { maximumFractionDigits: 0 });

  return (
    <div
      role="img"
      aria-label="Serie temporal de edificios detectados por año con banda de confianza ±15%"
      style={{ width: "100%", height }}
    >
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 10, right: 16, bottom: 0, left: 16 }}
        >
          <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
          <XAxis
            dataKey="anio"
            stroke={C.muted}
            tick={{ fill: C.muted }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
          />
          <YAxis
            stroke={C.muted}
            tick={{ fill: C.muted }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            tickFormatter={formatNumero}
            label={{
              value: "viviendas detectadas",
              angle: -90,
              position: "insideLeft",
              offset: 0,
              style: { fill: C.muted, fontSize: 12, textAnchor: "middle" },
            }}
            domain={["dataMin - 200", "dataMax + 200"]}
          />
          <Tooltip
            content={
              <EducationalTooltip
                labelFormatter={(label) => `Año ${label}`}
                formatter={(value, name) => {
                  if (Array.isArray(value)) {
                    const [lo, hi] = value as [number, number];
                    return [
                      `${formatNumero(lo)} – ${formatNumero(hi)}`,
                      name,
                    ];
                  }
                  return [
                    `${formatNumero(Number(value))} viviendas`,
                    name,
                  ];
                }}
                interpretacion={
                  "La banda ±15% representa el margen de incertidumbre típico " +
                  "de Open Buildings (Google) sobre Posadas; los conteos son " +
                  "centroides detectados desde Sentinel-2/Maxar."
                }
              />
            }
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: C.muted }}
          />
          <Area
            type="monotone"
            dataKey="banda"
            stroke="none"
            fill={C.secondary}
            fillOpacity={isDark ? 0.32 : 0.22}
            name="Banda ±15%"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="edificios"
            stroke={C.primary}
            strokeWidth={2.4}
            dot={{ r: 3, fill: C.primary }}
            activeDot={{ r: 5 }}
            name="Viviendas estimadas"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
