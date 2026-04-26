"use client";

// Gráfico de proyección a futuro (2027 / 2030 / 2035) para una métrica
// y un polígono dado. Combina:
//
//   - Histórico (Line sólida, color azul institucional) — viviendas /
//     población / % urbano / UHI verano según la métrica.
//   - Proyección (Line dashed) — valores 2027/2030/2035 predichos por
//     el modelo lineal o exponencial elegido en script 59.
//   - Banda de confianza 95 % (Area sombreada) — usa la fórmula clásica
//     de prediction-interval OLS con factor Student-t (n-2 g.l.).
//
// Eje X: años 2018..2035 (puede arrancar antes si la serie histórica
// va más atrás, ej. MapBiomas 1998-2022). Eje Y: depende de la métrica.
// Se muestra una línea vertical punteada en el "ahora" (2026) para
// separar visualmente histórico vs proyección.
//
// Banner de confianza: alto/medio/bajo, color-codificado (verde/durazno/
// rojo). Y un disclaimer prominente abajo del gráfico:
//   "Proyección estadística. Asume continuidad de tendencia histórica.
//    NO usar para decisiones de largo plazo sin validación adicional."
//
// El componente es defensivo: si la métrica + polígono no tiene
// proyecciones (ej. UHI con confianza baja saltó 2035, o el script
// no se corrió), muestra placeholder y no rompe la página.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useTheme } from "@/hooks/useTheme";
import type {
  ProyeccionMetrica,
  ProyeccionRow,
} from "@/lib/types";

// El "ahora" — el último año observado. Lo usamos para dibujar la línea
// vertical de separación histórico/proyección. Sirve también como
// argumento contra confundir el último dato real (ej. 2025 viviendas)
// con la proyección 2027.
const ANIO_HOY = 2026;
const ANIO_HORIZONTE = 2035;

// Punto consolidado del gráfico — combina histórico (`real`) y proyección
// (`pred` + banda CI). Cada año puede tener uno, otro o ambos (en el
// borde, para conectar visualmente la línea histórica con la proyectada).
interface PuntoChart {
  anio: number;
  real?: number;
  pred?: number;
  band?: [number, number];
}

interface Props {
  // Filas del histórico (lo que el observatorio ya midió). El componente
  // espera tuplas {anio, valor} — el caller las extrae del CSV correcto
  // según la métrica (serie_temporal.csv → edificios_total, etc.).
  historico: Array<{ anio: number; valor: number }>;
  // Filas de proyección filtradas a (poligono × métrica). Pueden ser
  // 0..3 (depende de cuántos años aplican según la confianza).
  proyecciones: ProyeccionRow[];
  // Métrica seleccionada — define unidad/label y rangos del eje Y.
  metrica: ProyeccionMetrica;
  nombreBarrio?: string;
  height?: number;
}

// Mapping de cada métrica a etiqueta humana, unidad y dominio razonable
// del eje Y. Para % usamos [0,100] fijo; para los demás dejamos auto.
const METRICA_INFO: Record<
  ProyeccionMetrica,
  {
    label: string;
    unidad: string;
    formatTick: (v: number) => string;
    formatValor: (v: number | undefined | null) => string;
    yDomain?: [number, number];
  }
> = {
  viviendas: {
    label: "Viviendas detectadas",
    unidad: "viv",
    formatTick: (v) => Math.round(v).toLocaleString("es-AR"),
    formatValor: (v) =>
      v === null || v === undefined || Number.isNaN(v)
        ? "s/d"
        : `${Math.round(v).toLocaleString("es-AR")} viv`,
  },
  poblacion: {
    label: "Población estimada",
    unidad: "hab",
    formatTick: (v) => Math.round(v).toLocaleString("es-AR"),
    formatValor: (v) =>
      v === null || v === undefined || Number.isNaN(v)
        ? "s/d"
        : `${Math.round(v).toLocaleString("es-AR")} hab`,
  },
  urbano: {
    label: "% cobertura urbana (MapBiomas)",
    unidad: "%",
    formatTick: (v) => `${v.toFixed(0)}%`,
    formatValor: (v) =>
      v === null || v === undefined || Number.isNaN(v)
        ? "s/d"
        : `${v.toFixed(1)}%`,
    yDomain: [0, 100],
  },
  uhi_verano: {
    label: "UHI verano vs rural",
    unidad: "°C",
    formatTick: (v) => `${v.toFixed(1)}°`,
    formatValor: (v) =>
      v === null || v === undefined || Number.isNaN(v)
        ? "s/d"
        : `${v >= 0 ? "+" : ""}${v.toFixed(2)}°C`,
  },
};

function buildPalette(isDark: boolean) {
  return {
    historico: isDark ? "#7faed8" : "#1a3a5c",
    proyeccion: isDark ? "#e0945c" : "#c97d3c",
    banda: isDark ? "rgba(224,148,92,0.18)" : "rgba(201,125,60,0.16)",
    grid: isDark ? "#2a3247" : "#e5e7eb",
    muted: isDark ? "#94a0b8" : "#6b7280",
    surface: isDark ? "#161d2f" : "#ffffff",
    border: isDark ? "#2a3247" : "#e5e7eb",
    text: isDark ? "#e6ebf2" : "#222222",
    refLine: isDark ? "#94a0b8" : "#94a3b8",
  };
}

interface TooltipItem {
  name?: string;
  dataKey?: string;
  value?: number | number[];
  payload?: PuntoChart & {
    confianza?: string;
    modelo?: string;
    r2?: number | null;
  };
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  metrica: ProyeccionMetrica;
  isDark: boolean;
}

function ChartTooltip({ active, payload, label, metrica, isDark }: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  const info = METRICA_INFO[metrica];

  // recharts manda la misma `payload` para todas las series; tomamos
  // el primer item para acceder al row consolidado.
  const row = payload[0]?.payload as
    | (PuntoChart & {
        confianza?: string;
        modelo?: string;
        r2?: number | null;
      })
    | undefined;

  const real = row?.real;
  const pred = row?.pred;
  const band = row?.band;
  const isProyeccion = pred !== undefined && pred !== null;

  return (
    <div
      className="rounded border border-neutral-border bg-white p-2 text-xs shadow-sm dark:border-dk-border dark:bg-dk-surface dark:text-dk-text"
      style={{ backgroundColor: isDark ? "#161d2f" : "#ffffff" }}
    >
      <p className="font-semibold text-primary dark:text-dk-primary">
        {label}
      </p>
      {real !== undefined && real !== null && (
        <p className="text-[#1a3a5c] dark:text-[#7faed8]">
          Valor real: {info.formatValor(real)}
        </p>
      )}
      {isProyeccion && (
        <>
          <p className="text-[#c97d3c] dark:text-[#e0945c]">
            Proyección: {info.formatValor(pred)}
          </p>
          {Array.isArray(band) && band.length === 2 && (
            <p className="text-[10px] text-neutral-muted dark:text-dk-muted">
              IC 95%: {info.formatValor(band[0])} – {info.formatValor(band[1])}
            </p>
          )}
          {row?.modelo && (
            <p className="mt-1 text-[10px] italic text-neutral-muted dark:text-dk-muted">
              Modelo {row.modelo}
              {row.r2 !== null && row.r2 !== undefined
                ? `, R²=${row.r2.toFixed(3)}`
                : ""}
              {row.confianza ? ` (${row.confianza})` : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// Banner de confianza con color codificado. Conserva el patrón de
// disclaimer del resto del sitio.
function ConfianzaBanner({ confianza }: { confianza: "alta" | "media" | "baja" }) {
  const cfg = {
    alta: {
      label: "Confianza: alta",
      detalle: "R² ≥ 0.85 sobre el histórico — la tendencia se ajusta bien.",
      bg: "bg-emerald-50 dark:bg-emerald-900/30",
      border: "border-emerald-200 dark:border-emerald-700/60",
      text: "text-emerald-900 dark:text-emerald-100",
    },
    media: {
      label: "Confianza: media",
      detalle:
        "R² entre 0.55 y 0.85 — la proyección es razonable pero con margen.",
      bg: "bg-accent-50 dark:bg-amber-900/30",
      border: "border-accent-200 dark:border-amber-700/60",
      text: "text-neutral-text dark:text-amber-100",
    },
    baja: {
      label: "Confianza: baja — preliminar",
      detalle:
        "R² < 0.55. Tendencia ruidosa o mal ajustada por modelo lineal/exp. Tomar como hipótesis, no como predicción robusta.",
      bg: "bg-rose-50 dark:bg-rose-900/30",
      border: "border-rose-200 dark:border-rose-700/60",
      text: "text-rose-900 dark:text-rose-100",
    },
  }[confianza];

  return (
    <div
      role="status"
      className={`rounded-md border ${cfg.border} ${cfg.bg} px-3 py-2 text-xs ${cfg.text}`}
    >
      <strong>{cfg.label}.</strong> {cfg.detalle}
    </div>
  );
}

export function ProyeccionChart({
  historico,
  proyecciones,
  metrica,
  nombreBarrio,
  height = 340,
}: Props) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const PALETTE = buildPalette(isDark);
  const info = METRICA_INFO[metrica];

  // Si no hay nada que mostrar, placeholder amable.
  if ((!historico || historico.length === 0) && (!proyecciones || proyecciones.length === 0)) {
    return (
      <div className="rounded-md border border-neutral-border bg-white p-4 text-sm italic text-neutral-muted dark:border-dk-border dark:bg-dk-surface dark:text-dk-muted">
        Sin datos disponibles para combinar histórico + proyección de esta
        métrica/polígono. Verificá que los scripts del pipeline hayan corrido.
      </div>
    );
  }

  // Tomamos la confianza/modelo/R² del primer registro de proyección —
  // por construcción del script 59, los tres años para una misma
  // (polígono × métrica) comparten el mismo modelo y la misma confianza
  // (porque el modelo se fitea una sola vez y se evalúa en cada año).
  const proyOrdenadas = [...proyecciones].sort(
    (a, b) => a.anio_proyeccion - b.anio_proyeccion,
  );
  const confianza = proyOrdenadas[0]?.confianza ?? "baja";
  const modelo = proyOrdenadas[0]?.modelo;
  const r2 = proyOrdenadas[0]?.r2 ?? null;
  const nObs = proyOrdenadas[0]?.n_obs ?? historico.length;

  // Construimos el dataset combinado por año.
  const byYear = new Map<number, PuntoChart & { confianza?: string; modelo?: string; r2?: number | null }>();
  const ensure = (anio: number) => {
    let row = byYear.get(anio);
    if (!row) {
      row = { anio };
      byYear.set(anio, row);
    }
    return row;
  };

  for (const h of historico) {
    if (!Number.isFinite(h.anio) || !Number.isFinite(h.valor)) continue;
    ensure(h.anio).real = h.valor;
  }

  for (const p of proyOrdenadas) {
    const row = ensure(p.anio_proyeccion);
    row.pred = p.valor_pred;
    row.band = [p.ci_inferior, p.ci_superior];
    row.confianza = p.confianza;
    row.modelo = p.modelo;
    row.r2 = p.r2;
  }

  // Anclaje en el último valor real para que la línea de proyección
  // empiece sin un "salto" visual: copiamos el último valor histórico
  // como si fuera también la base de la proyección, conectándolas.
  if (historico.length > 0 && proyOrdenadas.length > 0) {
    const sortedHist = [...historico].sort((a, b) => a.anio - b.anio);
    const ultimo = sortedHist[sortedHist.length - 1];
    if (ultimo) {
      const r = ensure(ultimo.anio);
      // Solo si todavía no se le asignó pred (no debería, pero defensivo)
      if (r.pred === undefined) {
        r.pred = ultimo.valor;
        r.band = [ultimo.valor, ultimo.valor];
      }
    }
  }

  const data: Array<PuntoChart & { confianza?: string; modelo?: string; r2?: number | null }> =
    Array.from(byYear.values()).sort((a, b) => a.anio - b.anio);

  // Si la métrica es % urbano, recortamos los CIs a 100 (el script ya
  // lo hace pero lo blindamos por las dudas).
  if (metrica === "urbano") {
    for (const r of data) {
      if (r.band) {
        r.band = [Math.max(0, r.band[0]), Math.min(100, r.band[1])];
      }
    }
  }

  return (
    <section
      aria-labelledby="proyeccion-titulo"
      className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3
            id="proyeccion-titulo"
            className="text-base font-semibold text-primary dark:text-dk-primary"
          >
            {info.label}
            {nombreBarrio ? ` — ${nombreBarrio}` : ""}
          </h3>
          <p className="text-xs text-neutral-text dark:text-dk-text">
            Histórico (azul) + proyección (naranja punteada) con banda de
            confianza 95 % a 2027 / 2030 / 2035.
          </p>
        </div>
        <div className="text-right text-[10px] italic text-neutral-muted dark:text-dk-muted">
          {modelo ? `Modelo: ${modelo}` : ""}
          {r2 !== null && r2 !== undefined ? `, R²=${r2.toFixed(3)}` : ""}
          {nObs ? ` · n=${nObs} años` : ""}
        </div>
      </header>

      <div className="mb-3">
        <ConfianzaBanner confianza={confianza as "alta" | "media" | "baja"} />
      </div>

      <div
        role="img"
        aria-label={`Proyección de ${info.label}${
          nombreBarrio ? ` para ${nombreBarrio}` : ""
        } a 2027, 2030 y 2035 con banda de confianza 95 %.`}
        style={{ height }}
        className="w-full"
      >
        <ResponsiveContainer>
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="anio"
              type="number"
              domain={["dataMin", ANIO_HORIZONTE]}
              allowDecimals={false}
              tickCount={8}
              stroke={PALETTE.muted}
              tick={{ fill: PALETTE.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: PALETTE.grid }}
            />
            <YAxis
              domain={info.yDomain ?? ["auto", "auto"]}
              stroke={PALETTE.muted}
              tick={{ fill: PALETTE.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: PALETTE.grid }}
              tickFormatter={info.formatTick}
              label={{
                value: info.unidad,
                angle: -90,
                position: "insideLeft",
                style: { fill: PALETTE.muted, fontSize: 11 },
              }}
            />
            <Tooltip
              content={
                <ChartTooltip metrica={metrica} isDark={isDark} />
              }
            />
            <Legend
              wrapperStyle={{
                fontSize: 11,
                paddingBottom: 4,
                color: PALETTE.muted,
              }}
              verticalAlign="top"
            />

            {/* Línea vertical "ahora" (2026) */}
            <ReferenceLine
              x={ANIO_HOY}
              stroke={PALETTE.refLine}
              strokeDasharray="2 4"
              ifOverflow="extendDomain"
              label={{
                value: "hoy",
                position: "top",
                fill: PALETTE.muted,
                fontSize: 10,
              }}
            />

            {/* Banda de confianza 95% — Area de [ci_inferior, ci_superior] */}
            <Area
              type="monotone"
              dataKey="band"
              fill={PALETTE.banda}
              stroke="none"
              name="Banda IC 95%"
              isAnimationActive={false}
              connectNulls={false}
            />

            {/* Línea histórica (sólida, azul institucional) */}
            <Line
              type="monotone"
              dataKey="real"
              stroke={PALETTE.historico}
              strokeWidth={2.4}
              dot={{ r: 2.5, fill: PALETTE.historico }}
              name="Histórico"
              connectNulls={false}
              isAnimationActive={false}
            />

            {/* Línea de proyección (dashed, naranja) */}
            <Line
              type="monotone"
              dataKey="pred"
              stroke={PALETTE.proyeccion}
              strokeWidth={2.2}
              strokeDasharray="6 4"
              dot={{ r: 3.5, fill: PALETTE.proyeccion, stroke: PALETTE.proyeccion }}
              name="Proyección"
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-[11px] italic text-neutral-muted dark:text-dk-muted">
        <strong>Proyección estadística.</strong> Asume continuidad de tendencia
        histórica de {nObs} años. <strong>NO usar para decisiones de largo
        plazo</strong> sin validación adicional. La banda 95 % es de la
        regresión y NO incluye incertidumbre del modelo (epistemic
        uncertainty). Para 2035 los R² caen por extrapolación a futuro
        lejano — usar con criterio.
      </p>
    </section>
  );
}
