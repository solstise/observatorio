"use client";

// Pronóstico 7 días para un barrio dado, con banda de confianza honesta
// p10–p90 (sombreada) sobre la mediana p50 del ensemble Open-Meteo.
//
// Composición del ComposedChart (recharts):
// - Area "tmax_p90 - tmax_p10": banda naranja translúcida.
// - Line "tmax_p50": línea naranja sólida.
// - Area "tmin_p90 - tmin_p10": banda azul translúcida.
// - Line "tmin_p50": línea azul sólida.
// - Bar "precipitation_mm" en eje Y secundario: bars sutiles abajo.
// - Por día, un emoji WMO arriba de la barra X (en chip).
//
// Elegimos ComposedChart en lugar de dos gráficos separados porque
// queremos que tmax/tmin compartan eje X y se lean como una sola
// historia ("la temperatura del día"), con la lluvia como contexto.
//
// Dark mode: bandas con opacidad reducida sobre fondo oscuro,
// ejes/grid en gris-azul muted. Convención cromática se mantiene
// (azul=frío, naranja=cálido) para no romper la lectura.

import {
  Area,
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

import { useTheme } from "@/hooks/useTheme";
import type { ForecastDiarioRow } from "@/lib/types";

interface Props {
  // Filas ya filtradas a un barrio y ordenadas por fecha. Si vienen
  // desordenadas, las re-ordenamos defensivamente.
  rows: ForecastDiarioRow[];
  nombreBarrio?: string | null;
  // Cuántos días mostrar (default 7). El CSV trae 14 pero típicamente
  // 7 d es suficiente para uso público; el resto del ensemble pierde
  // skill rápidamente.
  dias?: number;
  height?: number;
}

// Emojis WMO simplificados, espejo del WeatherWidget para coherencia.
const WMO_EMOJI: Record<number, { emoji: string; label: string }> = {
  0: { emoji: "☀", label: "Despejado" },
  1: { emoji: "🌤", label: "Mayormente despejado" },
  2: { emoji: "⛅", label: "Parcialmente nublado" },
  3: { emoji: "☁", label: "Nublado" },
  45: { emoji: "🌫", label: "Niebla" },
  48: { emoji: "🌫", label: "Niebla con escarcha" },
  51: { emoji: "🌦", label: "Llovizna ligera" },
  53: { emoji: "🌦", label: "Llovizna" },
  55: { emoji: "🌧", label: "Llovizna intensa" },
  61: { emoji: "🌧", label: "Lluvia ligera" },
  63: { emoji: "🌧", label: "Lluvia" },
  65: { emoji: "🌧", label: "Lluvia intensa" },
  80: { emoji: "🌦", label: "Chubascos" },
  81: { emoji: "🌧", label: "Chubascos fuertes" },
  82: { emoji: "⛈", label: "Chubascos violentos" },
  95: { emoji: "⛈", label: "Tormenta" },
  96: { emoji: "⛈", label: "Tormenta + granizo" },
  99: { emoji: "⛈", label: "Tormenta intensa" },
};

const DIAS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function describirClima(code: number | null): { emoji: string; label: string } {
  if (code === null || code === undefined) {
    return { emoji: "•", label: "Sin clasificar" };
  }
  return WMO_EMOJI[code] ?? { emoji: "•", label: "Sin clasificar" };
}

function fechaCorta(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${DIAS_ES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

interface TooltipItem {
  name?: string;
  value?: number | number[];
  color?: string;
  dataKey?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  isDark?: boolean;
}

function fmt(v: number | undefined | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "s/d";
  return `${v.toFixed(1)}°`;
}

function fmtMm(v: number | undefined | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "0 mm";
  return `${v.toFixed(1)} mm`;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  // Buscamos los datapoints por dataKey conocidos.
  const find = (key: string) => payload.find((p) => p.dataKey === key);
  const tmaxP50 = find("tmax_p50")?.value as number | undefined;
  const tminP50 = find("tmin_p50")?.value as number | undefined;
  const tmaxBand = find("tmax_band")?.value as number[] | undefined;
  const tminBand = find("tmin_band")?.value as number[] | undefined;
  const pp = find("precipitation_mm")?.value as number | undefined;
  return (
    <div className="rounded border border-neutral-border bg-white p-2 text-xs shadow-sm dark:border-dk-border dark:bg-dk-surface dark:text-dk-text">
      <p className="font-semibold text-primary dark:text-dk-primary">{label}</p>
      <p className="text-[#c97d3c] dark:text-[#e0945c]">
        Máx: {fmt(tmaxP50)}
        {Array.isArray(tmaxBand) && tmaxBand.length === 2 && (
          <span className="ml-1 text-[10px] text-neutral-muted dark:text-dk-muted">
            ({fmt(tmaxBand[0])} – {fmt(tmaxBand[1])})
          </span>
        )}
      </p>
      <p className="text-[#5a7a9c] dark:text-[#7faed8]">
        Mín: {fmt(tminP50)}
        {Array.isArray(tminBand) && tminBand.length === 2 && (
          <span className="ml-1 text-[10px] text-neutral-muted dark:text-dk-muted">
            ({fmt(tminBand[0])} – {fmt(tminBand[1])})
          </span>
        )}
      </p>
      {pp !== undefined && pp !== null && pp > 0 && (
        <p className="text-secondary dark:text-dk-muted">Lluvia: {fmtMm(pp)}</p>
      )}
    </div>
  );
}

export function PronosticoBarrio({
  rows,
  nombreBarrio,
  dias = 7,
  height = 340,
}: Props) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

  if (!rows || !rows.length) {
    return (
      <div className="rounded-md border border-neutral-border bg-white p-4 text-sm italic text-neutral-muted dark:border-dk-border dark:bg-dk-surface dark:text-dk-muted">
        Sin pronóstico disponible para este barrio. Verificá que el script{" "}
        <code>57_forecast_clima.py</code> haya corrido recientemente.
      </div>
    );
  }

  const sorted = [...rows].sort((a, b) =>
    a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0,
  );
  const subset = sorted.slice(0, dias);

  // Datapoints. Las "bandas" se construyen como [low, high] para que
  // recharts dibuje un Area entre ambas — su Area soporta tuplas en value.
  const data = subset.map((r) => ({
    fecha: r.fecha,
    fechaLabel: fechaCorta(r.fecha),
    tmin_p10: r.tmin_p10,
    tmin_p50: r.tmin_p50,
    tmin_p90: r.tmin_p90,
    tmin_band: [r.tmin_p10, r.tmin_p90] as [number, number],
    tmax_p10: r.tmax_p10,
    tmax_p50: r.tmax_p50,
    tmax_p90: r.tmax_p90,
    tmax_band: [r.tmax_p10, r.tmax_p90] as [number, number],
    precipitation_mm: r.precipitation_mm ?? 0,
    weather_code: r.weather_code,
  }));

  const colorMaxLine = isDark ? "#e0945c" : "#c97d3c";
  const colorMaxBand = isDark ? "rgba(224,148,92,0.22)" : "rgba(201,125,60,0.18)";
  const colorMinLine = isDark ? "#7faed8" : "#5a7a9c";
  const colorMinBand = isDark ? "rgba(127,174,216,0.22)" : "rgba(90,122,156,0.18)";
  const colorRain = isDark ? "#94a0b8" : "#9ca3af";
  const colorGrid = isDark ? "#2a3247" : "#e5e7eb";
  const colorMuted = isDark ? "#94a0b8" : "#6b7280";

  // El primer offset_origen es el mismo para todas las filas del barrio.
  const offsetOrigen = subset[0]?.offset_origen ?? "ninguno";
  const offsetCalor = subset[0]?.offset_calor_c ?? 0;
  const offsetFrio = subset[0]?.offset_frio_c ?? 0;

  return (
    <section
      aria-labelledby="pronostico-titulo"
      className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h3
            id="pronostico-titulo"
            className="text-base font-semibold text-primary dark:text-dk-primary"
          >
            Pronóstico {dias} días — {nombreBarrio ?? "barrio"}
          </h3>
          <p className="text-xs text-neutral-text dark:text-dk-text">
            Banda <strong>p10–p90</strong> = rango del ensamble (6 modelos
            meteorológicos). Cuanto más ancha, más incertidumbre.
          </p>
        </div>
        <div className="text-right text-[10px] italic text-neutral-muted dark:text-dk-muted">
          Datos: Open-Meteo Ensemble
          <br />
          + offset Landsat por barrio
        </div>
      </header>

      <div
        role="img"
        aria-label={`Pronóstico de temperatura mínima y máxima para los próximos ${dias} días con banda de confianza p10-p90, y precipitación diaria.`}
        style={{ height }}
        className="w-full"
      >
        <ResponsiveContainer>
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 10, bottom: 0, left: -10 }}
          >
            <CartesianGrid stroke={colorGrid} strokeDasharray="3 3" />
            <XAxis
              dataKey="fechaLabel"
              stroke={colorMuted}
              tick={{ fill: colorMuted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colorGrid }}
            />
            <YAxis
              yAxisId="temp"
              stroke={colorMuted}
              tick={{ fill: colorMuted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colorGrid }}
              label={{
                value: "°C",
                angle: -90,
                position: "insideLeft",
                style: { fill: colorMuted, fontSize: 11 },
              }}
            />
            <YAxis
              yAxisId="rain"
              orientation="right"
              stroke={colorMuted}
              tick={{ fill: colorMuted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colorGrid }}
              label={{
                value: "mm",
                angle: 90,
                position: "insideRight",
                style: { fill: colorMuted, fontSize: 11 },
              }}
            />
            <Tooltip content={<ChartTooltip isDark={isDark} />} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingBottom: 4, color: colorMuted }}
              verticalAlign="top"
            />

            {/* Banda de confianza Tmax (p10..p90) */}
            <Area
              yAxisId="temp"
              type="monotone"
              dataKey="tmax_band"
              fill={colorMaxBand}
              stroke="none"
              name="Banda Tmax (p10–p90)"
              isAnimationActive={false}
            />
            {/* Banda de confianza Tmin (p10..p90) */}
            <Area
              yAxisId="temp"
              type="monotone"
              dataKey="tmin_band"
              fill={colorMinBand}
              stroke="none"
              name="Banda Tmin (p10–p90)"
              isAnimationActive={false}
            />

            {/* Lluvia: bars sutiles en eje Y secundario */}
            <Bar
              yAxisId="rain"
              dataKey="precipitation_mm"
              fill={colorRain}
              name="Lluvia (mm)"
              barSize={18}
              isAnimationActive={false}
              fillOpacity={isDark ? 0.4 : 0.55}
            />

            {/* Líneas mediana */}
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="tmax_p50"
              stroke={colorMaxLine}
              strokeWidth={2.2}
              dot={{ r: 3, fill: colorMaxLine, stroke: colorMaxLine }}
              name="Tmax (mediana)"
              isAnimationActive={false}
            />
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="tmin_p50"
              stroke={colorMinLine}
              strokeWidth={2.2}
              dot={{ r: 3, fill: colorMinLine, stroke: colorMinLine }}
              name="Tmin (mediana)"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Tira de tarjetas con emoji WMO + min/max */}
      <ol className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-7">
        {data.map((d) => {
          const c = describirClima(d.weather_code);
          return (
            <li
              key={d.fecha}
              className="rounded border border-neutral-border bg-primary-50 p-2 text-center dark:border-dk-border dark:bg-dk-elevated"
              title={c.label}
            >
              <div className="text-[10px] uppercase tracking-wider text-secondary dark:text-dk-muted">
                {d.fechaLabel}
              </div>
              <div className="my-1 text-xl" aria-label={c.label}>
                {c.emoji}
              </div>
              <div className="text-xs font-semibold text-primary dark:text-dk-primary">
                {Math.round(d.tmax_p50)}°
                <span className="ml-1 font-normal text-neutral-muted dark:text-dk-muted">
                  {Math.round(d.tmin_p50)}°
                </span>
              </div>
              {d.precipitation_mm > 0 && (
                <div className="text-[10px] text-secondary dark:text-dk-muted">
                  {d.precipitation_mm.toFixed(1)} mm
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] italic text-neutral-muted dark:text-dk-muted">
        Offset por barrio (calor diurno {offsetCalor >= 0 ? "+" : ""}
        {offsetCalor.toFixed(2)}°C, frío nocturno {offsetFrio >= 0 ? "+" : ""}
        {offsetFrio.toFixed(2)}°C) derivado de UHI Landsat —{" "}
        {offsetOrigen === "ninguno"
          ? "barrio sin UHI calculado, se usa el centro como base"
          : `fuente: ${offsetOrigen}`}
        . Banda p10–p90 viene del ensamble ECMWF/GFS/ICON/JMA/GEM/BoM.
      </p>
    </section>
  );
}
