"use client";

// Card de equidad de áreas verdes — capa 3.
//
// KPI principal: % de población viviendo en barrios sub-OMS (<9 m²/cap).
// Histograma con 4 buckets (<5, 5-9, 9-15, ≥15 m²/cap) usando Recharts.
//
// Es client component porque Recharts requiere el ResponsiveContainer con
// medición DOM (en SSR usa fallback width=0). El padre Server Component
// le pasa los rows ya cargados.

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import { useTheme } from "@/hooks/useTheme";
import type { GreenEquityRow, PoligonoFeature } from "@/lib/types";

interface Props {
  rows: GreenEquityRow[];
  features: PoligonoFeature[];
}

interface Bucket {
  label: string;
  rango: string;
  min: number;
  max: number;
  color: string;
}

const BUCKETS: Bucket[] = [
  {
    label: "Crítico",
    rango: "< 5",
    min: -Infinity,
    max: 5,
    color: "#dc2626",
  },
  {
    label: "Deficitario",
    rango: "5 – 9",
    min: 5,
    max: 9,
    color: "#ea580c",
  },
  {
    label: "Aceptable",
    rango: "9 – 15",
    min: 9,
    max: 15,
    color: "#facc15",
  },
  {
    label: "Óptimo",
    rango: "≥ 15",
    min: 15,
    max: Infinity,
    color: "#16a34a",
  },
];

function bucketIndex(value: number): number {
  for (let i = 0; i < BUCKETS.length; i++) {
    if (value >= BUCKETS[i].min && value < BUCKETS[i].max) return i;
  }
  return BUCKETS.length - 1;
}

export function GreenEquityCard({ rows, features }: Props) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const popById = new Map(
    features.map(
      (f) => [f.properties.id, f.properties.poblacion_estimada ?? 0] as const,
    ),
  );

  const valid = rows.filter(
    (r): r is GreenEquityRow & { m2_per_capita: number } =>
      r.m2_per_capita !== null && Number.isFinite(r.m2_per_capita),
  );

  // KPI: población viviendo en barrios sub-OMS (<9 m²/cap)
  let popTotal = 0;
  let popSubOms = 0;
  for (const r of valid) {
    const pop = popById.get(r.poligono_id) ?? 0;
    popTotal += pop;
    if (r.m2_per_capita < 9) popSubOms += pop;
  }
  const pctSubOms = popTotal > 0 ? (popSubOms / popTotal) * 100 : 0;

  // Histograma de barrios por bucket
  const counts = BUCKETS.map((b) => ({
    label: b.label,
    rango: b.rango,
    color: b.color,
    n: 0,
  }));
  for (const r of valid) {
    counts[bucketIndex(r.m2_per_capita)].n += 1;
  }

  const tickColor = isDark ? "#94a0b8" : "#6b7280";
  const gridColor = isDark ? "#2a3247" : "#e5e7eb";

  return (
    <article className="card flex h-full flex-col">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          <TerminoGlosario id="green-equity">
            Equidad de áreas verdes
          </TerminoGlosario>
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          m² de verde por habitante. La OMS recomienda un mínimo de
          9 m²/cap.
        </p>
      </header>

      <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-700/60 dark:bg-rose-900/30">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums text-rose-700 dark:text-rose-200">
            {pctSubOms.toFixed(0)}%
          </span>
          <span className="text-xs text-neutral-text dark:text-rose-100">
            de la población vive en barrios{" "}
            <strong>por debajo del mínimo OMS</strong>
          </span>
        </div>
        <p className="mt-1 text-[11px] text-neutral-muted dark:text-rose-200/80">
          {Math.round(popSubOms).toLocaleString("es-AR")} de{" "}
          {Math.round(popTotal).toLocaleString("es-AR")} habitantes estimados
        </p>
      </div>

      <section
        aria-label="Distribución de barrios por m² verde por habitante"
        className="flex-1"
      >
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
          Distribución por barrio (m²/cap)
        </h4>
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={counts}
              margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
            >
              <XAxis
                dataKey="rango"
                tick={{ fill: tickColor, fontSize: 11 }}
                stroke={gridColor}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: tickColor, fontSize: 11 }}
                stroke={gridColor}
              />
              <Tooltip
                cursor={{ fill: isDark ? "#1f2937" : "#f3f4f6" }}
                contentStyle={{
                  backgroundColor: isDark ? "#0f172a" : "#ffffff",
                  border: `1px solid ${gridColor}`,
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value: number) => [`${value} barrios`, "Cantidad"]}
                labelFormatter={(label) => `${label} m²/cap`}
              />
              <Bar dataKey="n" radius={[4, 4, 0, 0]}>
                {counts.map((b) => (
                  <Cell key={b.label} fill={b.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-neutral-text dark:text-dk-text">
          {counts.map((b) => (
            <li key={b.label} className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: b.color }}
              />
              <span className="font-medium">{b.label}</span>
              <span className="text-neutral-muted dark:text-dk-muted">
                ({b.n})
              </span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-3 pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        <em>
          OMS Europa 2017: las ciudades deberían garantizar al menos 9 m² de
          espacio verde por habitante; 15 m²/cap es el óptimo asociado a
          mejor salud mental y resiliencia térmica.
        </em>
      </footer>
    </article>
  );
}

export default GreenEquityCard;
