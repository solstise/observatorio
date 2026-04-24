"use client";

// Grafico de precipitacion anual por estacion (CHIRPS). Se eligio
// barras apiladas en lugar de dos lineas porque las dos series son
// componentes que suman al total anual: apilarlas hace explicita la
// lectura "cuanto del total cae en cada semestre" y evita el problema
// tipico de dos lineas cruzandose en años secos/humedos.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChirpsRow } from "@/lib/types";

interface ClimaChartProps {
  rows: ChirpsRow[];
  height?: number;
}

const COLOR_VERANO = "#5a7a9c"; // secondary azul (semestre humedo oct-mar)
const COLOR_INVIERNO = "#c97d3c"; // accent naranja (semestre seco abr-sep)
const COLOR_GRID = "#e5e7eb";
const COLOR_MUTED = "#6b7280";

// Payload del tooltip de recharts para nuestras series.
interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const verano = payload.find((p) => p.name === "Verano (oct-mar)");
  const invierno = payload.find((p) => p.name === "Invierno (abr-sep)");
  const verNum = typeof verano?.value === "number" ? verano.value : 0;
  const invNum = typeof invierno?.value === "number" ? invierno.value : 0;
  const total = verNum + invNum;
  return (
    <div className="rounded border border-neutral-border bg-white p-2 text-xs shadow-sm">
      <p className="font-semibold text-primary">Año {label}</p>
      <p style={{ color: COLOR_VERANO }}>
        Verano (oct-mar): {verNum.toFixed(0)} mm
      </p>
      <p style={{ color: COLOR_INVIERNO }}>
        Invierno (abr-sep): {invNum.toFixed(0)} mm
      </p>
      <p className="mt-1 font-semibold text-primary">
        Total anual: {total.toFixed(0)} mm
      </p>
    </div>
  );
}

export function ClimaChart({ rows, height = 260 }: ClimaChartProps) {
  if (!rows.length) {
    return (
      <div className="flex min-h-[160px] items-center justify-center">
        <p className="text-sm italic text-neutral-muted">
          CHIRPS sin datos de precipitacion para este poligono.
        </p>
      </div>
    );
  }

  // Ordenamos ascendente por anio y proyectamos solo lo que necesita
  // el grafico. Papaparse con dynamicTyping deja los anios como number.
  const data = [...rows]
    .sort((a, b) => a.anio - b.anio)
    .map((r) => ({
      anio: r.anio,
      verano: r.precip_mm_verano,
      invierno: r.precip_mm_invierno,
    }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-primary">
          Precipitacion anual por estacion
        </h3>
        <p className="text-xs text-neutral-muted">
          Fuente: CHIRPS (Climate Hazards InfraRed Precipitation). Verano
          oct-mar, invierno abr-sep. Milimetros acumulados.
        </p>
      </div>
      <div
        role="img"
        aria-label="Grafico de barras apiladas con precipitacion anual dividida en semestres verano e invierno."
        style={{ width: "100%", height }}
      >
        <ResponsiveContainer>
          <BarChart
            data={data}
            margin={{ top: 10, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke={COLOR_GRID} strokeDasharray="3 3" />
            <XAxis
              dataKey="anio"
              stroke={COLOR_MUTED}
              tickLine={false}
              axisLine={{ stroke: COLOR_GRID }}
            />
            <YAxis
              stroke={COLOR_MUTED}
              tickLine={false}
              axisLine={{ stroke: COLOR_GRID }}
              label={{
                value: "mm",
                angle: -90,
                position: "insideLeft",
                style: { fill: COLOR_MUTED, fontSize: 12 },
              }}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f0f4f9" }} />
            <Legend wrapperStyle={{ fontSize: 12, paddingBottom: 8 }} verticalAlign="top" />
            <Bar
              dataKey="verano"
              stackId="precip"
              fill={COLOR_VERANO}
              name="Verano (oct-mar)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="invierno"
              stackId="precip"
              fill={COLOR_INVIERNO}
              name="Invierno (abr-sep)"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
