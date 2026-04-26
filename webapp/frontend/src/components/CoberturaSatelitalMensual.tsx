"use client";

// <CoberturaSatelitalMensual> — gráfico de barras apiladas que muestra,
// para cada mes desde 2018, cuántas observaciones limpias entraron en el
// composite combinando Sentinel-2 (azul) y CBERS-4A AWFI (naranja). El
// total apilado es la "salud" de la cobertura ese mes.
//
// Sobre las barras pintamos una línea de `gap_dias_max` que destaca los
// meses con huecos prolongados (>10 días suele indicar nubosidad fuerte
// o una pasada perdida). Es la forma honesta de explicarle al lector
// por qué un mes puntual puede tener pocos datos sin culpar al pipeline.
//
// Props:
//   `rows` — opcional. Si no se pasa, el componente fetchea por su cuenta
//   `/data/cbers_awfi/cobertura.csv` (T1) y degrada a placeholder vacío
//   si T1 todavía no publicó el CSV. Pasarlo desde un Server Component
//   que ya lo cargó es válido y evita un fetch extra.
//
// Estados:
//   - loading: skeleton con la altura del chart.
//   - empty: card con texto "Datos en preparación, primer cron mensual los publicará".
//   - ok: chart Recharts.
//
// Dark mode: usa el mismo helper `palette()` que TimelineChart.

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
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
import { TerminoGlosario } from "@/components/TerminoGlosario";
import { useTheme } from "@/hooks/useTheme";
import { getCoberturaAwfi } from "@/lib/data.client";
import type { CoberturaAwfiRow } from "@/lib/types";

interface CoberturaSatelitalMensualProps {
  /** Filas pre-cargadas. Si se omite, fetcheamos del CSV. */
  rows?: CoberturaAwfiRow[];
  /** Altura del gráfico en píxeles. Default 280. */
  height?: number;
  /** Año desde el cual mostrar (default 2018, igual que la serie temporal). */
  desdeAnio?: number;
}

function palette(isDark: boolean) {
  return {
    s2: isDark ? "#7faed8" : "#1a3a5c",
    awfi: isDark ? "#e0945c" : "#c97d3c",
    gap: isDark ? "#f87171" : "#dc2626",
    grid: isDark ? "#2a3247" : "#e5e7eb",
    muted: isDark ? "#94a0b8" : "#6b7280",
  };
}

export function CoberturaSatelitalMensual({
  rows: propRows,
  height = 280,
  desdeAnio = 2018,
}: CoberturaSatelitalMensualProps) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const C = palette(isDark);

  const [rows, setRows] = useState<CoberturaAwfiRow[] | null>(
    propRows ?? null,
  );
  const [loading, setLoading] = useState(propRows === undefined);

  useEffect(() => {
    if (propRows !== undefined) {
      setRows(propRows);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getCoberturaAwfi()
      .then((r) => {
        if (!cancelled) {
          setRows(r);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [propRows]);

  // Filtramos por año y ordenamos cronológicamente. Las filas vienen con
  // `mes` como YYYY-MM, por lo que un sort lexicográfico funciona.
  const data = useMemo(() => {
    if (!rows) return [];
    return [...rows]
      .filter((r) => {
        const anio = parseInt(String(r.mes).slice(0, 4), 10);
        return Number.isFinite(anio) && anio >= desdeAnio;
      })
      .sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));
  }, [rows, desdeAnio]);

  // Tick formatter del eje X: "2024-01" → "ene 24". Solo los enero/julio
  // se imprimen para no saturar el eje en series largas.
  const formatXTick = (mes: string) => {
    if (typeof mes !== "string") return "";
    const [y, m] = mes.split("-");
    if (!m) return mes;
    const idx = parseInt(m, 10);
    if (idx !== 1 && idx !== 7) return "";
    const meses = [
      "ene", "feb", "mar", "abr", "may", "jun",
      "jul", "ago", "sep", "oct", "nov", "dic",
    ];
    return `${meses[idx - 1] ?? m} ${y.slice(2)}`;
  };

  if (loading) {
    return (
      <div
        aria-hidden
        className="h-[280px] w-full animate-pulse rounded-md bg-gradient-to-br from-primary-50 via-white to-primary-50 dark:from-dk-elevated dark:via-dk-surface dark:to-dk-elevated"
      />
    );
  }

  if (!data.length) {
    return (
      <div className="rounded-md border border-dashed border-neutral-border bg-neutral-50 p-6 text-center text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-elevated/40 dark:text-dk-muted">
        <p className="font-medium text-primary dark:text-dk-primary">
          Cobertura satelital mensual
        </p>
        <p className="mt-1">
          Datos en preparación, el primer cron mensual los publicará.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Cobertura satelital mensual
        </h3>
        <p className="text-xs text-neutral-muted dark:text-dk-muted">
          Cuántas observaciones limpias entraron en cada composite mensual
          combinando <TerminoGlosario id="sentinel-2">Sentinel-2</TerminoGlosario>{" "}
          y <TerminoGlosario id="awfi">CBERS-4A AWFI</TerminoGlosario>. La
          línea roja marca el gap más largo (en días) sin observación válida
          ese mes.
        </p>
      </div>
      <div
        role="img"
        aria-label="Cobertura satelital mensual: barras apiladas Sentinel-2 + AWFI con línea de gap máximo en días"
        style={{ width: "100%", height }}
      >
        <ResponsiveContainer>
          <ComposedChart
            data={data}
            margin={{ top: 16, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke={C.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="mes"
              stroke={C.muted}
              tick={{ fill: C.muted, fontSize: 11 }}
              tickFormatter={formatXTick}
              interval={0}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
            />
            <YAxis
              yAxisId="obs"
              stroke={C.muted}
              tick={{ fill: C.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
              label={{
                value: "obs/mes",
                angle: -90,
                position: "insideLeft",
                offset: 10,
                style: { fill: C.muted, fontSize: 11, textAnchor: "middle" },
              }}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="gap"
              orientation="right"
              stroke={C.gap}
              tick={{ fill: C.gap, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: C.grid }}
              label={{
                value: "gap (días)",
                angle: 90,
                position: "insideRight",
                offset: 10,
                style: { fill: C.gap, fontSize: 11, textAnchor: "middle" },
              }}
              allowDecimals={false}
            />
            <Tooltip
              content={
                <EducationalTooltip
                  labelFormatter={(label) => `Mes ${label}`}
                  formatter={(value, name) => [
                    typeof value === "number"
                      ? name === "Gap máximo (días)"
                        ? `${value} días`
                        : `${value} obs.`
                      : String(value),
                    name,
                  ]}
                  interpretacion="Cada barra es un mes; las barras apiladas suman observaciones limpias de S2 (azul) + AWFI (naranja). La línea roja marca el peor hueco (gap_dias_max) que tuvo la cobertura ese mes."
                />
              }
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: C.muted }}
            />
            <Bar
              yAxisId="obs"
              dataKey="n_obs_s2"
              stackId="obs"
              fill={C.s2}
              name="Sentinel-2"
              isAnimationActive={false}
            />
            <Bar
              yAxisId="obs"
              dataKey="n_obs_awfi"
              stackId="obs"
              fill={C.awfi}
              name="CBERS-4A AWFI"
              isAnimationActive={false}
            />
            <Line
              yAxisId="gap"
              type="monotone"
              dataKey="gap_dias_max"
              stroke={C.gap}
              strokeWidth={1.6}
              dot={false}
              name="Gap máximo (días)"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[11px] italic text-neutral-muted dark:text-dk-muted">
        Cuando S2 está nublado, AWFI rellena (5 días de revisita y swath
        866 km). Un gap mayor a 10 días suele explicar una caída temporal
        en la frescura de NDVI/NDBI.
      </p>
    </div>
  );
}

export default CoberturaSatelitalMensual;
