"use client";

// Grafico de evolucion estacional de LST / UHI para un polígono seleccionado
// o el promedio urbano. Tres líneas: polígono, promedio ciudad, baseline rural.
//
// Dark mode: se mantiene la convención cromática de la página /calor (azul
// para baseline rural, naranja para promedio ciudad, primary para polígono)
// porque la lectura es semántica. Solo grid/muted/tick se ajustan al fondo.

import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EducationalTooltip } from "@/components/charts/EducationalTooltip";
import { useTheme } from "@/hooks/useTheme";
import type {
  CalorMensualRow,
  UhiEstacionalRow,
} from "@/lib/types";

interface Props {
  poligonoId: string | null;
  mensuales: CalorMensualRow[];
  estacionales: UhiEstacionalRow[];
  height?: number;
}

const ORDEN_ESTACIONES: Record<string, number> = {
  verano: 0,
  otono: 1,
  invierno: 2,
  primavera: 3,
};

export function EvolucionEstacional({
  poligonoId,
  mensuales,
  height = 320,
}: Props) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const colorGrid = isDark ? "#2a3247" : "#e5e7eb";
  const colorMuted = isDark ? "#94a0b8" : "#6b7280";
  const colorPoligono = isDark ? "#b3c7df" : "#1a3a5c";
  const colorCiudad = isDark ? "#e0945c" : "#c97d3c";
  const colorRural = isDark ? "#7faed8" : "#5a7a9c";

  const data = useMemo(() => {
    // Armamos puntos agrupados por (anio, estacion) — promedio LST.
    const filas = mensuales.filter(
      (r) => r.lst_mean !== null && Number.isFinite(r.lst_mean as number),
    );
    if (!filas.length) return [];

    // Agrupación helper.
    const agrupados = new Map<
      string,
      { anio: number; est: string; rural: number[]; ciudad: number[]; pol: number[] }
    >();
    const estDe = (mes: number): string => {
      if ([12, 1, 2].includes(mes)) return "verano";
      if ([3, 4, 5].includes(mes)) return "otono";
      if ([6, 7, 8].includes(mes)) return "invierno";
      return "primavera";
    };

    for (const r of filas) {
      const est = estDe(r.mes);
      const anio = est === "verano" && r.mes === 12 ? r.anio + 1 : r.anio;
      const k = `${anio}-${est}`;
      if (!agrupados.has(k)) {
        agrupados.set(k, { anio, est, rural: [], ciudad: [], pol: [] });
      }
      const bucket = agrupados.get(k)!;
      const val = r.lst_mean as number;
      if (r.tipo_poligono === "rural") bucket.rural.push(val);
      else {
        bucket.ciudad.push(val);
        if (poligonoId && r.poligono_id === poligonoId) bucket.pol.push(val);
      }
    }

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const arr = Array.from(agrupados.values())
      .map((b) => ({
        label: `${b.est[0].toUpperCase() + b.est.slice(1)} ${b.anio}`,
        orden: b.anio * 10 + (ORDEN_ESTACIONES[b.est] ?? 0),
        polígono: avg(b.pol),
        ciudad: avg(b.ciudad),
        rural: avg(b.rural),
      }))
      .sort((a, b) => a.orden - b.orden);
    return arr;
  }, [mensuales, poligonoId]);

  if (!data.length) {
    return (
      <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
        Aún no hay datos suficientes para graficar la evolución estacional.
      </p>
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 10 }}>
          <CartesianGrid stroke={colorGrid} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            stroke={colorMuted}
            tick={{ fill: colorMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: colorGrid }}
            interval="preserveStartEnd"
            angle={-18}
            height={50}
          />
          <YAxis
            stroke={colorMuted}
            tick={{ fill: colorMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: colorGrid }}
            unit="°C"
          />
          <Tooltip
            content={
              <EducationalTooltip
                formatter={(value, name) => {
                  if (
                    value === null ||
                    value === "" ||
                    (typeof value === "number" && !Number.isFinite(value))
                  ) {
                    return ["s/d", name];
                  }
                  const num = typeof value === "number" ? value : Number(value);
                  return [`${num.toFixed(1)} °C`, name];
                }}
                interpretacion={
                  "UHI = diferencia entre la temperatura del barrio y el campo " +
                  "rural cercano (mismo radar térmico Landsat 8/9). Valores por " +
                  "encima de la línea rural indican isla de calor; sobre 2 °C " +
                  "ya se considera UHI marcada (Voogt & Oke, 2003)."
                }
              />
            }
          />
          <Legend wrapperStyle={{ fontSize: 12, color: colorMuted }} />
          {poligonoId ? (
            <Line
              type="monotone"
              dataKey="polígono"
              stroke={colorPoligono}
              strokeWidth={2.4}
              dot={{ r: 3, fill: colorPoligono }}
              name="Polígono"
              connectNulls
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="ciudad"
            stroke={colorCiudad}
            strokeWidth={2}
            dot={false}
            strokeDasharray="4 3"
            name="Promedio ciudad"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="rural"
            stroke={colorRural}
            strokeWidth={2}
            dot={false}
            strokeDasharray="2 2"
            name="Baseline rural"
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
