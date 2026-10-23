"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NinoConfig, NinoObservedDay } from "@/lib/nino-types";
import type { ObservedRain } from "@/lib/nino-live/parse";
import { clockTime, dayName, formatRain, formatNinoNumber as num } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

interface Day { fecha: string; mm: number | null; parcial: boolean; tormenta: boolean; granizo: boolean }

const shortDay = (fecha: string) => String(Number(fecha.slice(8, 10)));
const longDate = (fecha: string) => new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", year: "numeric" });

// El registro guardado cubre meses; el dato en vivo, los últimos 8 días con el día en curso.
export function mergeDays(record: NinoObservedDay[], live: ObservedRain | null | undefined): Day[] {
  const days = new Map<string, Day>(record.map(d => [d.fecha, { ...d, parcial: false }]));
  for (const d of live?.dias ?? []) {
    const previous = days.get(d.fecha);
    days.set(d.fecha, { ...d, mm: d.mm ?? previous?.mm ?? null, tormenta: d.tormenta || !!previous?.tormenta, granizo: d.granizo || !!previous?.granizo });
  }
  return [...days.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function DayTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: Day & { label: string } }> }) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;
  return <div className={styles.tooltip}>
    <p className="font-semibold">{longDate(day.fecha)}</p>
    <p>{day.mm == null ? "Sin dato" : `${formatRain(day.mm)} mm`}{day.parcial ? " hasta ahora" : ""}</p>
    {(day.tormenta || day.granizo) && <p className="text-sm">{day.granizo ? "Tormenta con granizo" : "Hubo tormenta"}</p>}
  </div>;
}

function RecordItem({ day }: { day: Day }) {
  return <li><span className={styles.recordMm}>{formatRain(day.mm)} mm</span><span>{longDate(day.fecha)}</span><span className={styles.muted}>{day.granizo ? "tormenta con granizo" : day.tormenta ? "con tormenta" : ""}</span></li>;
}

export function NinoObserved({ live, record, config, now, threshold24h }: { live: ObservedRain | null | undefined; record: NinoObservedDay[]; config: NinoConfig; now: number; threshold24h: number }) {
  const all = mergeDays(record, live);
  const last = all.slice(-10).map(day => ({ ...day, label: shortDay(day.fecha), value: day.mm ?? 0 }));
  const maxValue = Math.max(0, ...last.map(d => d.value));
  const strong = all.filter(d => d.mm != null && d.mm >= config.dia_fuerte_registro_mm && !d.parcial).reverse();
  const total = (hours: number) => live?.totales.find(t => t.horas === hours);
  const firstRecord = all.find(d => d.mm != null)?.fecha;

  return <section id="lo-que-llovio" className={styles.section} aria-labelledby="llovio-heading">
    <p className={styles.eyebrow}>Medido</p>
    <h2 id="llovio-heading" className={styles.sectionTitle}>Lo que ya llovió</h2>
    <dl className={styles.totals}>{[[24, "Últimas 24 horas"], [72, "Últimos 3 días"], [168, "Últimos 7 días"]].map(([hours, label]) => {
      const t = total(hours as number);
      return <div key={hours}><dt>{label}</dt><dd>{t ? <>{formatRain(t.mm)}<span> mm{!t.completo && " o más"}</span></> : "Sin dato"}</dd></div>;
    })}</dl>
    {live?.ultimo_reporte && <p className={styles.caption}>Hasta las {clockTime(total(24)?.hasta ?? live.ultimo_reporte)} de {dayName(new Date(Date.parse(total(24)?.hasta ?? live.ultimo_reporte) - 3 * 3_600_000).toISOString().slice(0, 10), now)}. La estación informa la lluvia cada 6 horas.</p>}

    {last.length > 0 ? <>
      <h3 className={styles.subTitle}>Lluvia por día</h3>
      <div className={styles.chartObserved} role="img" aria-label={`Lluvia medida por día en los últimos ${last.length} días. Máximo: ${num(maxValue)} milímetros.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={last} margin={{ top: 22, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="var(--nino-grid)" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--nino-grid)" }} tick={{ fontSize: 11, fill: "var(--color-muted)" }} interval={0} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} allowDecimals={false} domain={[0, (max: number) => Math.max(10, Math.ceil(Math.max(max, threshold24h) * 1.12 / 10) * 10)]} />
            <ReferenceLine y={threshold24h} stroke="var(--nino-threshold)" strokeDasharray="4 4" />
            <Tooltip content={<DayTooltip />} cursor={{ fill: "var(--nino-hover)" }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
              {last.map(day => <Cell key={day.fecha} fill={day.parcial ? "var(--nino-rain-soft)" : "var(--nino-rain)"} />)}
              <LabelList dataKey="value" position="top" fontSize={11} fill="var(--color-text)" formatter={(value: number) => (value === maxValue && value > 0 ? num(value) : "")} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className={styles.chartKey}><span>Abajo, el día del mes</span><span><i className={styles.keyRain} />Día completo, de 9 a 9 h</span><span><i className={styles.keyRainSoft} />Hoy, hasta ahora</span><span><i className={styles.keyThreshold} />{num(threshold24h)} mm en un día: nivel de atención</span></p>
      <details className={styles.details}>
        <summary>Ver los días en una lista</summary>
        <ul className={styles.dayTable}>{[...last].reverse().map(day => <li key={day.fecha}><span>{dayName(day.fecha, now, true)}</span><span>{day.mm == null ? "Sin dato" : `${formatRain(day.mm)} mm`}{day.parcial ? " (hasta ahora)" : ""}</span><span>{day.granizo ? "Tormenta con granizo" : day.tormenta ? "Hubo tormenta" : ""}</span></li>)}</ul>
      </details>
    </> : <p className={styles.notice}>Todavía no tenemos mediciones de la estación. Revisá más tarde.</p>}

    <p className={styles.sourceNote}>Medido por el SMN en la estación Posadas Aero (aeropuerto). Es un solo punto: en otros barrios pudo llover más o menos. Los días van de 9 a 9 h, como en los registros oficiales.</p>

    {strong.length > 0 && <div className={styles.record}>
      <h3 className={styles.subTitle}>Días con {num(config.dia_fuerte_registro_mm)} mm o más</h3>
      <p className={styles.caption}>Registro automático{firstRecord ? ` desde el ${longDate(firstRecord)}` : ""}. Se suma solo cada vez que la estación informa un día así.</p>
      <ol className={styles.recordList}>{strong.slice(0, 5).map(day => <RecordItem key={day.fecha} day={day} />)}</ol>
      {strong.length > 5 && <details className={styles.details}><summary>Ver los otros {strong.length - 5} días</summary><ol className={styles.recordList}>{strong.slice(5).map(day => <RecordItem key={day.fecha} day={day} />)}</ol></details>}
    </div>}
  </section>;
}
