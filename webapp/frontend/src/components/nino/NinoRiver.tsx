"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NinoAhora } from "@/lib/nino-live/types";
import { agoText, formatMeters as m, formatNinoNumber as num, ninoDate } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short" }).replace(".", "");

function RiverTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: { fecha: string; altura_m: number } }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className={styles.tooltip}><p className="font-semibold">{shortDate(row.fecha)}</p><p>{m(row.altura_m)} m</p></div>;
}

export function NinoRiver({ river, now }: { river: NinoAhora["rio"] | undefined; now: number }) {
  const data = river?.datos;
  const history = data?.historial ?? [];
  const alert = data?.alerta_m ?? null, evac = data?.evacuacion_m ?? null;
  const values = [...history.map(h => h.altura_m), data?.altura_m ?? 0];
  const low = Math.floor(Math.min(...values) - 0.5);
  const high = Math.ceil(Math.max(...values, evac ?? 0) + 0.5);
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - low) / (high - low)) * 100))}%`;
  const state = !data || alert == null ? "sin_dato" : evac != null && data.altura_m >= evac ? "evacuacion" : data.altura_m >= alert ? "alerta" : "normal";

  return <section id="rio" className={styles.section} aria-labelledby="rio-heading">
    <p className={styles.eyebrow}>Río</p>
    <h2 id="rio-heading" className={styles.sectionTitle}>El Paraná en Posadas</h2>
    {data ? <>
      <p className={styles.riverValue}><strong>{m(data.altura_m)} m</strong> <span>{data.tendencia}{data.variacion_m != null && data.variacion_m !== 0 ? ` ${num(Math.abs(data.variacion_m) * 100)} cm` : ""}</span></p>
      <p className={styles.intro}>{state === "normal" && alert != null ? `Está ${m(alert - data.altura_m)} m por debajo del nivel de alerta.` : state === "alerta" ? "Está sobre el nivel de alerta de Prefectura." : state === "evacuacion" ? "Está sobre el nivel de evacuación de Prefectura." : ""} En Posadas el nivel depende en buena parte del embalse de Yacyretá. Un río alto puede hacer más lento el desagüe de los arroyos que desembocan en él.</p>
      {alert != null && <div className={styles.meter} role="img" aria-label={`Altura ${m(data.altura_m)} metros. Alerta en ${m(alert)} metros${evac != null ? `, evacuación en ${m(evac)} metros` : ""}.`}>
        <div className={styles.meterTrack}>
          <span className={styles.meterFill} data-state={state} style={{ width: pos(data.altura_m) }} />
          <span className={styles.meterMark} style={{ left: pos(alert) }}><em>Alerta {m(alert)} m</em></span>
          {evac != null && <span className={styles.meterMark} data-kind="evac" style={{ left: pos(evac) }}><em>Evacuación {m(evac)} m</em></span>}
        </div>
      </div>}
      {history.length > 3 && <>
        <h3 className={styles.subTitle}>Últimos 30 días</h3>
        <div className={styles.chartRiver} role="img" aria-label={`Altura del río en los últimos ${history.length} días, entre ${num(Math.min(...history.map(h => h.altura_m)))} y ${num(Math.max(...history.map(h => h.altura_m)))} metros.`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={history} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--nino-grid)" />
              <XAxis dataKey="fecha" tickFormatter={shortDate} minTickGap={40} tickLine={false} axisLine={{ stroke: "var(--nino-grid)" }} tick={{ fontSize: 11, fill: "var(--color-muted)" }} />
              <YAxis domain={[low, high]} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickFormatter={v => num(Number(v))} />
              <Tooltip content={<RiverTooltip />} />
              {alert != null && <ReferenceLine y={alert} stroke="var(--nino-threshold)" strokeDasharray="4 4" label={{ value: "Alerta", position: "insideTopLeft", fontSize: 11, fill: "var(--color-muted)" }} />}
              <Line dataKey="altura_m" stroke="var(--nino-river)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </>}
      <p className={styles.sourceNote}>Prefectura Naval Argentina, lectura de {ninoDate(data.fecha)} (consultado {agoText(river!.actualizado, now)}). Historial diario: Instituto Nacional del Agua.</p>
    </> : <p className={styles.notice}>No pudimos consultar a Prefectura. <a className="underline" href="https://contenidosweb.prefecturanaval.gob.ar/alturas/" target="_blank" rel="noreferrer">Ver alturas en Prefectura ↗</a></p>}
  </section>;
}
