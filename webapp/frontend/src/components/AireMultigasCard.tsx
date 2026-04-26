"use client";

// AireMultigasCard — tarjeta de calidad de aire con dos modos.
//
// Modo "forecast" (CAMS modelado):
//   - Tabla con PM10, PM2.5, NO2, O3, AQI europeo de los próximos 5 días.
//   - Lee `/data/forecast/aqi_diario.csv` (refresh cada 6 h por cron).
//   - Origen: modelo CAMS vía Open-Meteo. NO es medición real, es predicción.
//
// Modo "histórico" (Sentinel-5P TROPOMI real):
//   - Serie temporal de NO2, SO2, CO, HCHO con gráfico recharts (multi-línea).
//   - Lee `/data/ambiental/aire_multigas_anual.csv` (script 48). Si no
//     existe, cae a `/data/no2.csv` (legacy script 47) y solo dibuja NO2.
//   - Origen: medición satelital ESA Sentinel-5P TROPOMI, agregado anual.
//
// El usuario alterna con un toggle. Cada modo lleva un badge que aclara
// la procedencia y el ritmo de refresh, y un tooltip educativo dice
// explícitamente que histórico (real) y forecast (modelado) son cosas
// distintas y no comparables 1-a-1.
//
// CH4 y O3 vienen del CSV multigas con `*_calidad="baja"`: no se muestran
// en el chart (baja resolución espacial / columna estratosférica) pero sí
// se reportan en una nota al pie del modo histórico.
//
// Comportamiento si no hay datos:
//   - Forecast vacío → "Sin pronóstico CAMS disponible".
//   - Histórico vacío → "Sin mediciones TROPOMI todavía para este barrio".
//   - Cualquier gas individual sin dato → fila con guión "—".
//
// Dark mode: usa los tokens dk-* del proyecto. Charts ajustan grid/muted.

import { useEffect, useMemo, useState } from "react";
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

import { TerminoGlosario } from "@/components/TerminoGlosario";
import { useTheme } from "@/hooks/useTheme";
import {
  getAireMultigas,
  getAqiDiario,
  getNo2,
} from "@/lib/data.client";
import type {
  AireMultigasRow,
  AqiDiarioRow,
  No2Row,
} from "@/lib/types";

// Si el barrio no tiene multigas todavía, los CSV legacy (no2.csv) sí
// alcanzan para el chart histórico. Ese fallback evita que la card se
// vea vacía mientras el cron mensual aún no corrió 48_aire_multigas.

interface Props {
  poligonoId: string;
  /** Nombre legible del barrio (para títulos accesibles). */
  poligonoNombre?: string;
}

type Modo = "forecast" | "historico";

// Bandas del AQI europeo. Fuente: EEA.
function bandaAqi(aqi: number): {
  label: string;
  color: string; // hex para mostrar el chip semaforico.
  textoEs: string;
} {
  if (aqi < 20) return { label: "Muy bueno", color: "#10b981", textoEs: "Aire muy bueno" };
  if (aqi < 40) return { label: "Bueno", color: "#65a30d", textoEs: "Aire bueno" };
  if (aqi < 60) return { label: "Medio", color: "#eab308", textoEs: "Calidad media" };
  if (aqi < 80) return { label: "Pobre", color: "#f97316", textoEs: "Calidad pobre" };
  if (aqi < 100) return { label: "Malo", color: "#dc2626", textoEs: "Aire malo" };
  return { label: "Muy malo", color: "#7f1d1d", textoEs: "Aire muy malo" };
}

function fmtNum(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(decimals);
}

function fmtFechaCorta(iso: string): string {
  // YYYY-MM-DD → "lun 25/04". Sin libs externas para no inflar bundle.
  const d = new Date(iso + "T12:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dias[d.getDay()]} ${dd}/${mm}`;
}

// Helper: convierte el CSV legacy no2.csv al shape "compatible" del
// multigas para que el chart pueda renderear NO2 aunque no haya multigas.
function legacyNo2ARow(rows: No2Row[]): AireMultigasRow[] {
  return rows.map((r) => ({
    poligono_id: r.poligono_id,
    anio: r.anio,
    no2_mol_m2: r.no2_mean_mol_m2,
    no2_relativo_bbox: r.no2_relativo_bbox,
    n_imagenes_no2: 0,
    so2_mol_m2: null,
    n_imagenes_so2: 0,
    co_mol_m2: null,
    n_imagenes_co: 0,
    hcho_mol_m2: null,
    n_imagenes_hcho: 0,
    ch4_ppb: null,
    n_imagenes_ch4: 0,
    ch4_calidad: "baja" as const,
    o3_du: null,
    n_imagenes_o3: 0,
    o3_calidad: "baja" as const,
  }));
}

// Colores semánticos (compartidos light/dark con ajustes en dark).
const COLOR_NO2_LIGHT = "#dc2626"; // rojo — tráfico
const COLOR_NO2_DARK = "#f87171";
const COLOR_SO2_LIGHT = "#7c3aed"; // violeta — industria
const COLOR_SO2_DARK = "#a78bfa";
const COLOR_CO_LIGHT = "#c97d3c"; // naranja — quemas
const COLOR_CO_DARK = "#e0945c";
const COLOR_HCHO_LIGHT = "#10b981"; // verde — biogénico
const COLOR_HCHO_DARK = "#34d399";

export function AireMultigasCard({ poligonoId, poligonoNombre }: Props) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

  const [modo, setModo] = useState<Modo>("forecast");
  const [aqi, setAqi] = useState<AqiDiarioRow[] | null>(null);
  const [historico, setHistorico] = useState<AireMultigasRow[] | null>(null);
  const [historicoFuente, setHistoricoFuente] = useState<
    "multigas" | "legacy-no2" | null
  >(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);

    Promise.all([
      getAqiDiario().catch(() => [] as AqiDiarioRow[]),
      getAireMultigas(poligonoId).catch(() => [] as AireMultigasRow[]),
      getNo2(poligonoId).catch(() => [] as No2Row[]),
    ])
      .then(([aqiRows, multigasRows, no2Rows]) => {
        if (cancelado) return;
        setAqi(aqiRows);
        if (multigasRows.length > 0) {
          setHistorico(multigasRows);
          setHistoricoFuente("multigas");
        } else if (no2Rows.length > 0) {
          setHistorico(legacyNo2ARow(no2Rows));
          setHistoricoFuente("legacy-no2");
        } else {
          setHistorico([]);
          setHistoricoFuente(null);
        }
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });

    return () => {
      cancelado = true;
    };
  }, [poligonoId]);

  // Datos del chart histórico, ordenados por año y normalizados a una
  // misma escala para que líneas con magnitudes muy distintas (ej. CO
  // típicamente 1e-2, NO2 1e-5) sean visualmente legibles. Estrategia:
  // mostramos cada gas en su propia unidad pero con eje izquierdo en
  // notación científica; recharts lo hace OK con `tickFormatter`.
  const chartData = useMemo(() => {
    if (!historico) return [];
    return [...historico]
      .sort((a, b) => a.anio - b.anio)
      .map((r) => ({
        anio: r.anio,
        no2: r.no2_mol_m2,
        so2: r.so2_mol_m2,
        co: r.co_mol_m2,
        hcho: r.hcho_mol_m2,
        ch4: r.ch4_ppb,
        o3: r.o3_du,
      }));
  }, [historico]);

  const ultimoMultigas = useMemo(() => {
    if (!historico || historico.length === 0) return null;
    return [...historico].sort((a, b) => b.anio - a.anio)[0];
  }, [historico]);

  return (
    <section
      aria-labelledby={`aire-${poligonoId}`}
      className="flex flex-col gap-4"
    >
      <header className="flex flex-col gap-1">
        <h3
          id={`aire-${poligonoId}`}
          className="text-base font-semibold text-primary dark:text-dk-primary"
        >
          Calidad del aire — {poligonoNombre ?? "Posadas"}
        </h3>
        <p className="text-xs text-neutral-text dark:text-dk-text">
          Dos lentes complementarias: el satélite{" "}
          <TerminoGlosario id="tropomi">Sentinel-5P TROPOMI</TerminoGlosario>{" "}
          mide gases <strong>realmente</strong> presentes en la atmósfera (serie
          anual histórica). El modelo{" "}
          <TerminoGlosario id="cams">CAMS</TerminoGlosario>{" "}
          de Copernicus <strong>predice</strong> cómo va a estar el aire mañana
          y los próximos días.
        </p>
        <p
          className="rounded-md border-l-2 border-accent/60 bg-accent/5 px-2 py-1 text-[11px] italic text-neutral-muted dark:border-dk-accent/60 dark:bg-dk-accent/10 dark:text-dk-muted"
          role="note"
        >
          Histórico = mediciones reales del satélite. Forecast = predicción del
          modelo. Son cosas distintas — no las comparés punto a punto.
        </p>
      </header>

      {/* Toggle */}
      <div
        className="inline-flex w-full rounded-full border border-neutral-border bg-neutral-50 p-1 text-xs font-medium dark:border-dk-border dark:bg-dk-elevated"
        role="tablist"
        aria-label="Selector de modo de calidad de aire"
      >
        <button
          type="button"
          role="tab"
          aria-selected={modo === "forecast"}
          onClick={() => setModo("forecast")}
          className={[
            "flex-1 rounded-full px-3 py-1.5 transition-colors",
            modo === "forecast"
              ? "bg-primary text-white shadow-sm dark:bg-dk-primary dark:text-dk-bg"
              : "text-neutral-muted hover:text-primary dark:text-dk-muted dark:hover:text-dk-primary",
          ].join(" ")}
        >
          Forecast hoy + 5 días
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={modo === "historico"}
          onClick={() => setModo("historico")}
          className={[
            "flex-1 rounded-full px-3 py-1.5 transition-colors",
            modo === "historico"
              ? "bg-primary text-white shadow-sm dark:bg-dk-primary dark:text-dk-bg"
              : "text-neutral-muted hover:text-primary dark:text-dk-muted dark:hover:text-dk-primary",
          ].join(" ")}
        >
          Histórico anual (satélite)
        </button>
      </div>

      {loading ? (
        <SkeletonAire />
      ) : modo === "forecast" ? (
        <ForecastPanel rows={aqi ?? []} />
      ) : (
        <HistoricoPanel
          chartData={chartData}
          ultimo={ultimoMultigas}
          fuente={historicoFuente}
          isDark={isDark}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Forecast panel (CAMS / Open-Meteo)
// ---------------------------------------------------------------------------

function ForecastPanel({ rows }: { rows: AqiDiarioRow[] }) {
  if (!rows.length) {
    return (
      <div className="rounded-md border border-dashed border-neutral-border p-4 text-sm italic text-neutral-muted dark:border-dk-border dark:text-dk-muted">
        Sin pronóstico <TerminoGlosario id="cams">CAMS</TerminoGlosario>{" "}
        disponible. El cron de 6 horas debería refrescarlo pronto.
      </div>
    );
  }

  const proximos = rows.slice(0, 5);

  return (
    <div className="flex flex-col gap-3">
      <Badge
        modo="forecast"
        ariaLabel="Origen de los datos: modelo CAMS vía Open-Meteo, refresco cada 6 horas"
      />

      <div className="overflow-x-auto rounded-md border border-neutral-border dark:border-dk-border">
        <table className="w-full min-w-[420px] text-xs">
          <thead className="bg-neutral-50 dark:bg-dk-elevated">
            <tr className="text-neutral-muted dark:text-dk-muted">
              <th className="px-2 py-2 text-left font-medium">Día</th>
              <th className="px-2 py-2 text-right font-medium">PM10</th>
              <th className="px-2 py-2 text-right font-medium">PM2.5</th>
              <th
                className="px-2 py-2 text-right font-medium"
                title="NO2 superficie (µg/m³)"
              >
                NO₂
              </th>
              <th
                className="px-2 py-2 text-right font-medium"
                title="O3 superficie (µg/m³)"
              >
                O₃
              </th>
              <th className="px-2 py-2 text-right font-medium">
                <TerminoGlosario id="aqi">AQI</TerminoGlosario>
              </th>
            </tr>
          </thead>
          <tbody>
            {proximos.map((r) => {
              const banda = bandaAqi(r.european_aqi);
              return (
                <tr
                  key={r.fecha}
                  className="border-t border-neutral-border odd:bg-white even:bg-neutral-50/50 dark:border-dk-border dark:odd:bg-dk-bg dark:even:bg-dk-elevated/30"
                >
                  <td className="px-2 py-2 font-medium text-primary dark:text-dk-primary">
                    {fmtFechaCorta(r.fecha)}
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-text dark:text-dk-text">
                    {fmtNum(r.pm10, 1)}
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-text dark:text-dk-text">
                    {fmtNum(r.pm2_5, 1)}
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-text dark:text-dk-text">
                    {fmtNum(r.no2, 1)}
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-text dark:text-dk-text">
                    {fmtNum(r.ozone, 1)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <span
                      title={banda.textoEs}
                      className="inline-flex min-w-[2.5rem] items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
                      style={{ backgroundColor: banda.color }}
                    >
                      {Math.round(r.european_aqi)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] italic text-neutral-muted dark:text-dk-muted">
        Valores en µg/m³ (PM10, PM2.5, NO₂, O₃). El AQI europeo combina los
        contaminantes en un solo número 0-100+: bandas verdes son aire bueno,
        rojas son aire malo. <strong>Esto es predicción</strong>, no medición.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico panel (Sentinel-5P TROPOMI)
// ---------------------------------------------------------------------------

interface HistoricoPanelProps {
  chartData: Array<{
    anio: number;
    no2: number | null;
    so2: number | null;
    co: number | null;
    hcho: number | null;
    ch4: number | null;
    o3: number | null;
  }>;
  ultimo: AireMultigasRow | null;
  fuente: "multigas" | "legacy-no2" | null;
  isDark: boolean;
}

function HistoricoPanel({
  chartData,
  ultimo,
  fuente,
  isDark,
}: HistoricoPanelProps) {
  if (!chartData.length || !ultimo) {
    return (
      <div className="rounded-md border border-dashed border-neutral-border p-4 text-sm italic text-neutral-muted dark:border-dk-border dark:text-dk-muted">
        Sin mediciones <TerminoGlosario id="tropomi">TROPOMI</TerminoGlosario>{" "}
        anuales para este polígono todavía.
      </div>
    );
  }

  const colorNo2 = isDark ? COLOR_NO2_DARK : COLOR_NO2_LIGHT;
  const colorSo2 = isDark ? COLOR_SO2_DARK : COLOR_SO2_LIGHT;
  const colorCo = isDark ? COLOR_CO_DARK : COLOR_CO_LIGHT;
  const colorHcho = isDark ? COLOR_HCHO_DARK : COLOR_HCHO_LIGHT;
  const colorGrid = isDark ? "#2a3247" : "#e5e7eb";
  const colorMuted = isDark ? "#94a0b8" : "#6b7280";

  // Filtramos series sin ningún dato (ej. si solo tenemos NO2 legacy).
  const tieneSo2 = chartData.some((d) => d.so2 != null);
  const tieneCo = chartData.some((d) => d.co != null);
  const tieneHcho = chartData.some((d) => d.hcho != null);

  const fuenteLegacy = fuente === "legacy-no2";

  return (
    <div className="flex flex-col gap-3">
      <Badge
        modo="historico"
        ariaLabel="Origen de los datos: medición satelital ESA Sentinel-5P TROPOMI, agregado anual"
      />

      {fuenteLegacy && (
        <p
          className="rounded-md border border-neutral-border bg-neutral-50 p-2 text-[11px] text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted"
          role="note"
        >
          Mostrando solo NO₂ porque el CSV multi-gas (script 48) aún no se
          generó para este barrio. Cuando el cron mensual lo corra,
          aparecerán SO₂, CO y HCHO en el mismo gráfico.
        </p>
      )}

      <div
        role="img"
        aria-label="Serie temporal de gases medidos por Sentinel-5P TROPOMI por año."
        className="w-full"
        style={{ height: 240 }}
      >
        <ResponsiveContainer>
          <LineChart
            data={chartData}
            margin={{ top: 10, right: 12, bottom: 0, left: -8 }}
          >
            <CartesianGrid stroke={colorGrid} strokeDasharray="3 3" />
            <XAxis
              dataKey="anio"
              stroke={colorMuted}
              tick={{ fill: colorMuted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: colorGrid }}
            />
            <YAxis
              stroke={colorMuted}
              tick={{ fill: colorMuted, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: colorGrid }}
              tickFormatter={(v: number) =>
                Number.isFinite(v) ? v.toExponential(1) : ""
              }
              width={56}
            />
            <Tooltip content={<HistoricoTooltip isDark={isDark} />} />
            <Legend
              wrapperStyle={{
                fontSize: 11,
                paddingBottom: 8,
                color: colorMuted,
              }}
              verticalAlign="top"
            />
            <Line
              type="monotone"
              dataKey="no2"
              name="NO₂ (mol/m²)"
              stroke={colorNo2}
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
              isAnimationActive={false}
            />
            {tieneSo2 && (
              <Line
                type="monotone"
                dataKey="so2"
                name="SO₂ (mol/m²)"
                stroke={colorSo2}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {tieneCo && (
              <Line
                type="monotone"
                dataKey="co"
                name="CO (mol/m²)"
                stroke={colorCo}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            )}
            {tieneHcho && (
              <Line
                type="monotone"
                dataKey="hcho"
                name="HCHO (mol/m²)"
                stroke={colorHcho}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Resumen del último año disponible. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ResumenChip
          gas="NO₂"
          glosarioId="no2"
          valor={ultimo.no2_mol_m2}
          unidad="mol/m²"
          tipo="cientifico"
          color={colorNo2}
          anio={ultimo.anio}
        />
        <ResumenChip
          gas="SO₂"
          glosarioId="so2"
          valor={ultimo.so2_mol_m2}
          unidad="mol/m²"
          tipo="cientifico"
          color={colorSo2}
          anio={ultimo.anio}
        />
        <ResumenChip
          gas="CO"
          glosarioId="co-monoxido"
          valor={ultimo.co_mol_m2}
          unidad="mol/m²"
          tipo="cientifico"
          color={colorCo}
          anio={ultimo.anio}
        />
        <ResumenChip
          gas="HCHO"
          glosarioId="hcho"
          valor={ultimo.hcho_mol_m2}
          unidad="mol/m²"
          tipo="cientifico"
          color={colorHcho}
          anio={ultimo.anio}
        />
      </div>

      {/* Nota CH4 / O3 — calidad baja, se reporta solo como referencia. */}
      <details className="group rounded-md border border-neutral-border bg-neutral-50 p-2 text-[11px] dark:border-dk-border dark:bg-dk-elevated">
        <summary className="cursor-pointer font-medium text-neutral-text dark:text-dk-text">
          Otros gases medidos (calidad limitada)
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2 text-neutral-muted dark:text-dk-muted">
          <p>
            <TerminoGlosario id="ch4">CH₄</TerminoGlosario>:{" "}
            {ultimo.ch4_ppb != null
              ? `${ultimo.ch4_ppb.toFixed(0)} ppb`
              : "sin dato"}{" "}
            ({ultimo.anio}).{" "}
            <em>Resolución ~7 km — no diferencia barrios.</em>
          </p>
          <p>
            O₃ columna total:{" "}
            {ultimo.o3_du != null
              ? `${ultimo.o3_du.toFixed(0)} DU`
              : "sin dato"}{" "}
            ({ultimo.anio}).{" "}
            <em>
              Dominado por estratosférico — no útil para health urbana.
            </em>
          </p>
        </div>
      </details>
    </div>
  );
}

// Tooltip del chart histórico — formatea cada serie en notación científica.
function HistoricoTooltip({
  active,
  payload,
  label,
  isDark,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: number | string;
  isDark?: boolean;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div
      className="max-w-xs rounded border border-neutral-border bg-white p-2 text-xs shadow-sm dark:border-dk-border dark:bg-dk-surface dark:text-dk-text"
      role="tooltip"
    >
      <p className="font-semibold text-primary dark:text-dk-primary">
        Año {label}
      </p>
      {payload.map((p, idx) => (
        <p
          key={idx}
          style={{ color: p.color ?? (isDark ? "#94a0b8" : "#6b7280") }}
        >
          {p.name}:{" "}
          {typeof p.value === "number" ? p.value.toExponential(2) : "—"}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers de UI menores
// ---------------------------------------------------------------------------

function Badge({
  modo,
  ariaLabel,
}: {
  modo: Modo;
  ariaLabel?: string;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium";
  if (modo === "forecast") {
    return (
      <span
        className={`${base} border border-secondary/30 bg-secondary/10 text-secondary dark:border-dk-secondary/40 dark:bg-dk-secondary/15 dark:text-dk-secondary`}
        aria-label={ariaLabel}
      >
        <span aria-hidden="true">🌬️</span>
        Modelo <TerminoGlosario id="cams">CAMS</TerminoGlosario> · Open-Meteo ·
        refresh 6 h
      </span>
    );
  }
  return (
    <span
      className={`${base} border border-accent/30 bg-accent/10 text-accent dark:border-dk-accent/40 dark:bg-dk-accent/15 dark:text-dk-accent`}
      aria-label={ariaLabel}
    >
      <span aria-hidden="true">🛰️</span>
      Medido por{" "}
      <TerminoGlosario id="tropomi">Sentinel-5P TROPOMI</TerminoGlosario> ·
      agregado anual
    </span>
  );
}

interface ResumenChipProps {
  gas: string;
  glosarioId: string;
  valor: number | null | undefined;
  unidad: string;
  tipo: "cientifico" | "fijo";
  color: string;
  anio: number;
}

function ResumenChip({
  gas,
  glosarioId,
  valor,
  unidad,
  tipo,
  color,
  anio,
}: ResumenChipProps) {
  const tieneDato = valor != null && Number.isFinite(valor);
  return (
    <div className="rounded-md border border-neutral-border bg-white p-2 dark:border-dk-border dark:bg-dk-elevated/40">
      <p
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color }}
      >
        <TerminoGlosario id={glosarioId}>{gas}</TerminoGlosario>
      </p>
      <p className="mt-1 text-sm font-bold text-neutral-text dark:text-dk-text">
        {tieneDato
          ? tipo === "cientifico"
            ? (valor as number).toExponential(2)
            : (valor as number).toFixed(2)
          : "—"}
      </p>
      <p className="text-[10px] text-neutral-muted dark:text-dk-muted">
        {tieneDato ? `${unidad} (${anio})` : "Sin dato disponible"}
      </p>
    </div>
  );
}

// Skeleton de carga: una caja gris animada, mismas dimensiones aprox.
function SkeletonAire() {
  return (
    <div
      className="flex animate-pulse flex-col gap-3"
      role="status"
      aria-label="Cargando datos de calidad del aire"
    >
      <div className="h-7 w-2/3 rounded bg-neutral-200 dark:bg-dk-elevated" />
      <div className="h-32 w-full rounded bg-neutral-200 dark:bg-dk-elevated" />
      <div className="h-12 w-full rounded bg-neutral-200 dark:bg-dk-elevated" />
    </div>
  );
}

export default AireMultigasCard;
