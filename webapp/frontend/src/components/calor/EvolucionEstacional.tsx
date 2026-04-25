"use client";

// Grafico de evolucion estacional de LST / UHI para un polígono seleccionado
// o el promedio urbano. Tres líneas: polígono, promedio ciudad, baseline rural.

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
      <p className="text-sm italic text-neutral-muted">
        Aún no hay datos suficientes para graficar la evolución estacional.
      </p>
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 10 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            stroke="#6b7280"
            tickLine={false}
            axisLine={{ stroke: "#e5e7eb" }}
            interval="preserveStartEnd"
            angle={-18}
            height={50}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            stroke="#6b7280"
            tickLine={false}
            axisLine={{ stroke: "#e5e7eb" }}
            unit="°C"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(v: unknown) =>
              v === null || !Number.isFinite(Number(v))
                ? ["sin dato", ""]
                : [`${Number(v).toFixed(1)} °C`, ""]
            }
            contentStyle={{
              border: "1px solid #e5e7eb",
              borderRadius: 4,
              fontSize: 13,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {poligonoId ? (
            <Line
              type="monotone"
              dataKey="polígono"
              stroke="#1a3a5c"
              strokeWidth={2.4}
              dot={{ r: 3, fill: "#1a3a5c" }}
              name="Polígono"
              connectNulls
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="ciudad"
            stroke="#c97d3c"
            strokeWidth={2}
            dot={false}
            strokeDasharray="4 3"
            name="Promedio ciudad"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="rural"
            stroke="#5a7a9c"
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
