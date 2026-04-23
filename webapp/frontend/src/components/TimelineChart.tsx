"use client";

// Grafico de linea con banda de confianza de la superficie construida.
// Usa Recharts. Se accede desde detalle del poligono.

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

  // Ordenar por anio y pre-computar banda como array [low, high].
  const data = [...rows]
    .sort((a, b) => a.anio - b.anio)
    .map((r) => ({
      anio: r.anio,
      construida: r.superficie_construida_km2,
      vegetacion: r.superficie_vegetacion_km2,
      banda: [r.confianza_inferior, r.confianza_superior] as [number, number],
    }));

  return (
    <div
      role="img"
      aria-label="Serie temporal de superficie construida y vegetacion, con banda de confianza"
      style={{ width: "100%", height }}
    >
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
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
            label={{
              value: "km2",
              angle: -90,
              position: "insideLeft",
              style: { fill: COLORS.muted, fontSize: 12 },
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#ffffff",
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              fontSize: 13,
            }}
            labelStyle={{ color: COLORS.primary, fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="banda"
            stroke="none"
            fill={COLORS.secondary}
            fillOpacity={0.18}
            name="Banda de confianza"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="construida"
            stroke={COLORS.primary}
            strokeWidth={2.2}
            dot={{ r: 2.5, fill: COLORS.primary }}
            name="Superficie construida (km2)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="vegetacion"
            stroke={COLORS.accent}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            name="Vegetacion (km2)"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
