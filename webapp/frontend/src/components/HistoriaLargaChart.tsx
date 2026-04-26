"use client";

// Grafico combinado "Transformacion urbana 1975-2030" para un poligono.
// Combina tres fuentes independientes en un mismo eje temporal:
//
//   - MapBiomas Col.1 Argentina (1998-2022, cobertura por clase):
//     area stacked con pct_urbano + pct_vegetacion.
//   - GHSL P2023A (1975-2030, superficie construida relativa):
//     linea principal sobre el mismo eje porcentual.
//   - VIIRS NOAA Nightlights (2014-2025, radiancia media de julio):
//     linea punteada sobre eje derecho, proxy de actividad nocturna.
//
// Se usa ComposedChart con dos ejes (pct a izquierda, viirs a derecha)
// para superponer naturaleza distinta en una sola lectura. Separar en
// tres charts independientes fragmentaba la narrativa historica.

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

import { EducationalTooltip } from "@/components/charts/EducationalTooltip";
import { useTheme } from "@/hooks/useTheme";
import type { GhslRow, MapBiomasRow, ViirsRow } from "@/lib/types";

interface HistoriaLargaChartProps {
  poligonoId: string;
  mapbiomas: MapBiomasRow[];
  ghsl: GhslRow[];
  viirs: ViirsRow[];
  height?: number;
}

// Paletas por tema. Urbano y VIIRS conservan su sentido cromático
// (naranja = construido, amarillo = luz nocturna) en ambos temas para
// que el lector mantenga el mapa mental. Grid/muted se ajustan.
function buildPalette(isDark: boolean) {
  return {
    urbano: isDark ? "#e0945c" : "#c97d3c",
    vegetacion: isDark ? "#7faed8" : "#5a7a9c",
    built: isDark ? "#b3c7df" : "#1a3a5c",
    viirs: isDark ? "#fbbf24" : "#eab308",
    grid: isDark ? "#2a3247" : "#e5e7eb",
    muted: isDark ? "#94a0b8" : "#6b7280",
    surface: isDark ? "#161d2f" : "#ffffff",
    border: isDark ? "#2a3247" : "#e5e7eb",
    text: isDark ? "#e6ebf2" : "#222222",
  };
}

// Fila consolidada: un anio puede tener datos de una o varias fuentes.
interface RowCombinada {
  anio: number;
  pct_urbano?: number;
  pct_vegetacion?: number;
  pct_built?: number;
  viirs_mean?: number;
}

// Extrae el anio de un string tipo "YYYY-MM" o "YYYY-MM-DD".
function fechaToAnio(fecha: string): number | null {
  if (!fecha) return null;
  const m = /^(\d{4})/.exec(fecha);
  return m ? Number(m[1]) : null;
}

// Extrae el mes (1-12) de un string tipo "YYYY-MM" o "YYYY-MM-DD".
function fechaToMes(fecha: string): number | null {
  if (!fecha) return null;
  const m = /^\d{4}-(\d{2})/.exec(fecha);
  return m ? Number(m[1]) : null;
}

export function HistoriaLargaChart({
  poligonoId,
  mapbiomas,
  ghsl,
  viirs,
  height = 340,
}: HistoriaLargaChartProps) {
  const { resolved } = useTheme();
  const PALETTE = buildPalette(resolved === "dark");

  const mb = mapbiomas.filter((r) => r.poligono_id === poligonoId);
  const gh = ghsl.filter((r) => r.poligono_id === poligonoId);
  const vi = viirs.filter((r) => r.poligono_id === poligonoId);

  const faltantes: string[] = [];
  if (!mb.length) {
    faltantes.push("MapBiomas");
    // eslint-disable-next-line no-console
    console.warn(`MapBiomas sin cobertura para ${poligonoId}`);
  }
  if (!gh.length) {
    faltantes.push("GHSL");
    // eslint-disable-next-line no-console
    console.warn(`GHSL sin cobertura para ${poligonoId}`);
  }
  if (!vi.length) {
    faltantes.push("VIIRS");
    // eslint-disable-next-line no-console
    console.warn(`VIIRS sin cobertura para ${poligonoId}`);
  }

  // Si no hay NADA, mostramos placeholder y salimos.
  if (!mb.length && !gh.length && !vi.length) {
    return (
      <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
        Sin datos historicos disponibles para este poligono.
      </p>
    );
  }

  // Consolidamos por anio en un map -> array ordenado.
  const byYear = new Map<number, RowCombinada>();

  const ensure = (anio: number): RowCombinada => {
    let row = byYear.get(anio);
    if (!row) {
      row = { anio };
      byYear.set(anio, row);
    }
    return row;
  };

  for (const r of mb) {
    const row = ensure(r.anio);
    row.pct_urbano = r.pct_urbano;
    row.pct_vegetacion = r.pct_vegetacion;
  }

  for (const r of gh) {
    const row = ensure(r.anio);
    row.pct_built = r.pct_built;
  }

  // VIIRS: solo usamos las muestras de julio para no saturar el grafico
  // con dos puntos por anio, y para empatar con la estacion "seca" del
  // resto de las fuentes.
  for (const r of vi) {
    const anio = fechaToAnio(r.fecha);
    const mes = fechaToMes(r.fecha);
    if (anio == null) continue;
    if (mes !== 7) continue;
    const row = ensure(anio);
    row.viirs_mean = r.viirs_mean;
  }

  const data = Array.from(byYear.values()).sort((a, b) => a.anio - b.anio);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold text-primary dark:text-dk-primary">
          Cómo cambió este barrio en 50 años
        </h3>
        <p className="text-xs text-neutral-text dark:text-dk-text">
          Combina cobertura del suelo (urbano vs vegetación), huella construida
          y luces nocturnas para mostrar la transformación del territorio entre
          1975 y 2030.
        </p>
        <p className="text-[11px] italic text-neutral-muted dark:text-dk-muted">
          Datos: MapBiomas Argentina Col.1 (cobertura), GHSL P2023A (huella
          construida, Comisión Europea), VIIRS NOAA (luces nocturnas).
        </p>
      </div>

      {faltantes.length > 0 && (
        <p className="text-xs italic text-neutral-muted dark:text-dk-muted">
          {faltantes.join(", ")} sin cobertura para este polígono.
        </p>
      )}

      <div
        role="img"
        aria-label={`Historia de largo plazo de ${poligonoId}: superficie construida, vegetación y luces nocturnas.`}
        className="w-full"
        style={{ height }}
      >
        <ResponsiveContainer>
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 12, bottom: 0, left: -8 }}
          >
            <CartesianGrid stroke={PALETTE.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="anio"
              type="number"
              domain={["dataMin", "dataMax"]}
              allowDecimals={false}
              tickCount={8}
              stroke={PALETTE.muted}
              tick={{ fill: PALETTE.muted }}
              tickLine={false}
              axisLine={{ stroke: PALETTE.grid }}
            />
            <YAxis
              yAxisId="pct"
              domain={[0, 100]}
              stroke={PALETTE.muted}
              tick={{ fill: PALETTE.muted }}
              tickLine={false}
              axisLine={{ stroke: PALETTE.grid }}
              label={{
                value: "%",
                angle: -90,
                position: "insideLeft",
                style: { fill: PALETTE.muted, fontSize: 12 },
              }}
            />
            <YAxis
              yAxisId="viirs"
              orientation="right"
              stroke={PALETTE.muted}
              tick={{ fill: PALETTE.muted }}
              tickLine={false}
              axisLine={{ stroke: PALETTE.grid }}
              label={{
                value: "VIIRS",
                angle: 90,
                position: "insideRight",
                style: { fill: PALETTE.muted, fontSize: 12 },
              }}
            />
            <Tooltip
              content={
                <EducationalTooltip
                  labelFormatter={(label) => `Año ${label}`}
                  formatter={(value, name) => {
                    if (typeof value !== "number") return [String(value), name];
                    const nombre = String(name ?? "");
                    if (nombre.toLowerCase().startsWith("luces")) {
                      return [`${value.toFixed(2)} (radiancia)`, name];
                    }
                    return [`${value.toFixed(1)}%`, name];
                  }}
                  interpretacion={
                    "Las áreas miden cobertura del suelo (MapBiomas), la línea " +
                    "azul oscuro la huella construida (GHSL, Comisión Europea) y " +
                    "la línea amarilla las luces nocturnas (VIIRS, NOAA). En " +
                    "Posadas, % urbano subió de ~6% (1985) a ~30% (2022)."
                  }
                />
              }
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingBottom: 8, color: PALETTE.muted }}
              verticalAlign="top"
            />
            {mb.length > 0 && (
              <Area
                yAxisId="pct"
                type="monotone"
                dataKey="pct_urbano"
                stackId="cobertura"
                stroke={PALETTE.urbano}
                fill={PALETTE.urbano}
                fillOpacity={0.55}
                name="% urbano"
                isAnimationActive={false}
              />
            )}
            {mb.length > 0 && (
              <Area
                yAxisId="pct"
                type="monotone"
                dataKey="pct_vegetacion"
                stackId="cobertura"
                stroke={PALETTE.vegetacion}
                fill={PALETTE.vegetacion}
                fillOpacity={0.35}
                name="% vegetación"
                isAnimationActive={false}
              />
            )}
            {gh.length > 0 && (
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="pct_built"
                stroke={PALETTE.built}
                strokeWidth={2.4}
                dot={{ r: 2.5, fill: PALETTE.built }}
                name="Huella construida"
                connectNulls
                isAnimationActive={false}
              />
            )}
            {vi.length > 0 && (
              <Line
                yAxisId="viirs"
                type="monotone"
                dataKey="viirs_mean"
                stroke={PALETTE.viirs}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 3, fill: PALETTE.viirs, stroke: PALETTE.viirs }}
                name="Luces nocturnas (julio)"
                connectNulls
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
