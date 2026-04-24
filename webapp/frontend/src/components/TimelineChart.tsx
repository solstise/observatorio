"use client";

// Gráfico de la serie de edificios detectados por año con banda de
// confianza ±15%. Mostramos lo que realmente medimos (conteo de edificios)
// en lugar de m²: las columnas superficie_*_km2 son derivadas y la banda
// venía en otra escala, lo cual hacía un chart ilegible.

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

import { COLORS } from "@/lib/colors";
import type { SerieTemporalRow } from "@/lib/types";

interface TimelineChartProps {
  rows: SerieTemporalRow[];
  height?: number;
}

export function TimelineChart({ rows, height = 320 }: TimelineChartProps) {
  if (!rows.length) {
    return (
      <p className="text-sm italic text-neutral-muted">
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
          <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />
          <XAxis
            dataKey="anio"
            stroke={COLORS.muted}
            tickLine={false}
            axisLine={{ stroke: COLORS.border }}
          />
          <YAxis
            stroke={COLORS.muted}
            tickLine={false}
            axisLine={{ stroke: COLORS.border }}
            tickFormatter={formatNumero}
            label={{
              value: "viviendas detectadas",
              angle: -90,
              position: "insideLeft",
              offset: 0,
              style: { fill: COLORS.muted, fontSize: 12, textAnchor: "middle" },
            }}
            domain={["dataMin - 200", "dataMax + 200"]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              fontSize: 13,
            }}
            labelStyle={{ color: COLORS.primary, fontWeight: 600 }}
            formatter={(value: unknown, name: string) => {
              if (Array.isArray(value)) {
                const [lo, hi] = value as [number, number];
                return [`${formatNumero(lo)} – ${formatNumero(hi)}`, name];
              }
              return [formatNumero(Number(value)), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="banda"
            stroke="none"
            fill={COLORS.secondary}
            fillOpacity={0.22}
            name="Banda ±15%"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="edificios"
            stroke={COLORS.primary}
            strokeWidth={2.4}
            dot={{ r: 3, fill: COLORS.primary }}
            activeDot={{ r: 5 }}
            name="Viviendas estimadas"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
