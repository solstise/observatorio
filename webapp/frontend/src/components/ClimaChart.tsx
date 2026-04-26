"use client";

// Grafico de precipitacion anual por estacion (CHIRPS). Se eligio
// barras apiladas en lugar de dos lineas porque las dos series son
// componentes que suman al total anual: apilarlas hace explicita la
// lectura "cuanto del total cae en cada semestre" y evita el problema
// tipico de dos lineas cruzandose en años secos/humedos.
//
// Dark mode: la convención de "verano azul / invierno naranja" se
// mantiene porque es informativa (semestre húmedo / seco). Solo se
// ajustan grid y muted para legibilidad sobre fondo oscuro.

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

import { TerminoGlosario } from "@/components/TerminoGlosario";
import { useTheme } from "@/hooks/useTheme";
import type { ChirpsRow } from "@/lib/types";

interface ClimaChartProps {
  rows: ChirpsRow[];
  height?: number;
}

const COLOR_VERANO_LIGHT = "#5a7a9c"; // secondary azul
const COLOR_VERANO_DARK = "#7faed8"; // azul claro dk
const COLOR_INVIERNO_LIGHT = "#c97d3c"; // accent naranja
const COLOR_INVIERNO_DARK = "#e0945c"; // naranja cálido dk

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
  isDark?: boolean;
}

// Banda de referencia climática para Posadas (CHIRPS / WRF, ~1981-2020):
// el promedio anual ronda 1800-2300 mm. Lo usamos para clasificar el año
// como seco / normal / húmedo en el tooltip.
const PROMEDIO_POSADAS_MM_MIN = 1800;
const PROMEDIO_POSADAS_MM_MAX = 2300;

function clasificarLluvia(totalMm: number): string {
  if (totalMm < PROMEDIO_POSADAS_MM_MIN) {
    return `año seco (debajo del rango histórico ${PROMEDIO_POSADAS_MM_MIN}-${PROMEDIO_POSADAS_MM_MAX} mm)`;
  }
  if (totalMm > PROMEDIO_POSADAS_MM_MAX) {
    return `año húmedo (sobre el rango histórico ${PROMEDIO_POSADAS_MM_MIN}-${PROMEDIO_POSADAS_MM_MAX} mm)`;
  }
  return `dentro del rango normal de Posadas (${PROMEDIO_POSADAS_MM_MIN}-${PROMEDIO_POSADAS_MM_MAX} mm/año)`;
}

function ChartTooltip({ active, payload, label, isDark }: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const verano = payload.find((p) => p.name === "Verano (oct-mar)");
  const invierno = payload.find((p) => p.name === "Invierno (abr-sep)");
  const verNum = typeof verano?.value === "number" ? verano.value : 0;
  const invNum = typeof invierno?.value === "number" ? invierno.value : 0;
  const total = verNum + invNum;
  const colorVerano = isDark ? COLOR_VERANO_DARK : COLOR_VERANO_LIGHT;
  const colorInvierno = isDark ? COLOR_INVIERNO_DARK : COLOR_INVIERNO_LIGHT;
  const interpretacion = clasificarLluvia(total);
  return (
    <div
      className="max-w-xs rounded border border-neutral-border bg-white p-2 text-xs shadow-sm dark:border-dk-border dark:bg-dk-surface dark:text-dk-text"
      role="tooltip"
    >
      <p className="font-semibold text-primary dark:text-dk-primary">
        Año {label}
      </p>
      <p style={{ color: colorVerano }}>
        Verano (oct-mar): {verNum.toFixed(0)} mm
      </p>
      <p style={{ color: colorInvierno }}>
        Invierno (abr-sep): {invNum.toFixed(0)} mm
      </p>
      <p className="mt-1 font-semibold text-primary dark:text-dk-primary">
        Total anual: {total.toFixed(0)} mm
      </p>
      <p className="mt-1.5 border-t border-neutral-border pt-1 text-[11px] italic leading-snug text-neutral-muted dark:border-dk-border dark:text-dk-muted">
        {interpretacion}.
      </p>
    </div>
  );
}

export function ClimaChart({ rows, height = 260 }: ClimaChartProps) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

  const colorVerano = isDark ? COLOR_VERANO_DARK : COLOR_VERANO_LIGHT;
  const colorInvierno = isDark ? COLOR_INVIERNO_DARK : COLOR_INVIERNO_LIGHT;
  const colorGrid = isDark ? "#2a3247" : "#e5e7eb";
  const colorMuted = isDark ? "#94a0b8" : "#6b7280";
  const colorCursor = isDark ? "#1c2540" : "#f0f4f9";

  if (!rows.length) {
    return (
      <div className="flex min-h-[160px] items-center justify-center">
        <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
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
        <h3 className="text-base font-semibold text-primary dark:text-dk-primary">
          Cuánta lluvia recibió el barrio
        </h3>
        <p className="text-xs text-neutral-text dark:text-dk-text">
          Lluvia acumulada por año, separada en verano (oct–mar) e invierno
          (abr–sep). Clave para entender riesgo de inundaciones y patrones de
          sequía.
        </p>
        <p className="text-[11px] italic text-neutral-muted dark:text-dk-muted">
          Datos:{" "}
          <TerminoGlosario id="chirps">CHIRPS</TerminoGlosario>{" "}
          (Climate Hazards InfraRed Precipitation, USGS), en milímetros
          acumulados.
        </p>
      </div>
      <div
        role="img"
        aria-label="Gráfico de barras apiladas con precipitación anual dividida en semestres verano e invierno."
        className="w-full"
        style={{ height }}
      >
        <ResponsiveContainer>
          <BarChart
            data={data}
            margin={{ top: 10, right: 12, bottom: 0, left: -8 }}
          >
            <CartesianGrid stroke={colorGrid} strokeDasharray="3 3" />
            <XAxis
              dataKey="anio"
              stroke={colorMuted}
              tick={{ fill: colorMuted }}
              tickLine={false}
              axisLine={{ stroke: colorGrid }}
            />
            <YAxis
              stroke={colorMuted}
              tick={{ fill: colorMuted }}
              tickLine={false}
              axisLine={{ stroke: colorGrid }}
              label={{
                value: "mm",
                angle: -90,
                position: "insideLeft",
                style: { fill: colorMuted, fontSize: 12 },
              }}
            />
            <Tooltip
              content={<ChartTooltip isDark={isDark} />}
              cursor={{ fill: colorCursor }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingBottom: 8, color: colorMuted }}
              verticalAlign="top"
            />
            <Bar
              dataKey="verano"
              stackId="precip"
              fill={colorVerano}
              name="Verano (oct-mar)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="invierno"
              stackId="precip"
              fill={colorInvierno}
              name="Invierno (abr-sep)"
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
