"use client";

import { useState } from "react";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { NinoClimate, NinoConfig, NinoObservedDay } from "@/lib/nino-types";
import type { ObservedRain } from "@/lib/nino-live/parse";
import { frequencyText } from "@/lib/nino-escurrimiento";
import { clockTime, dayName, formatRain, formatNinoNumber as num } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

interface Day { fecha: string; mm: number | null; parcial: boolean; tormenta: boolean; granizo: boolean; descartado: boolean }

const TZ = "America/Argentina/Buenos_Aires";
const longDate = (fecha: string) => new Date(`${fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// El registro guardado cubre años; el dato en vivo, los últimos 8 días con el día en curso.
// Un total descartado por el control de calidad (en vivo o en el registro) queda sin dato.
export function mergeDays(record: NinoObservedDay[], live: ObservedRain | null | undefined): Day[] {
  const days = new Map<string, Day>(record.map(d => [d.fecha, { fecha: d.fecha, mm: d.mm, tormenta: d.tormenta, granizo: d.granizo, parcial: false, descartado: d.control === "dudoso" }]));
  for (const d of live?.dias ?? []) {
    const previous = days.get(d.fecha);
    const descartado = d.control === "dudoso" || !!previous?.descartado;
    days.set(d.fecha, { fecha: d.fecha, parcial: d.parcial, descartado, mm: descartado ? null : d.mm ?? previous?.mm ?? null, tormenta: d.tormenta || !!previous?.tormenta, granizo: d.granizo || !!previous?.granizo });
  }
  return [...days.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

const noData = (day: Day) => (day.descartado ? "Dato descartado: no cuadra con los demás reportes" : "Sin dato");

// Pluviómetro: el agua sube hasta lo medido y su superficie se mueve.
function RainGauge({ mm, scale }: { mm: number; scale: number }) {
  const level = Math.min(1, mm / scale);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(scale * f));
  return <svg className={styles.gauge} viewBox="0 0 120 220" aria-hidden="true">
    <defs><clipPath id="gauge-tube"><rect x="34" y="14" width="52" height="190" rx="12" /></clipPath></defs>
    <rect x="34" y="14" width="52" height="190" rx="12" className={styles.gaugeTube} />
    <g clipPath="url(#gauge-tube)">
      <g className={styles.gaugeWater} style={{ transform: `translateY(${(1 - level) * 190}px)` }}>
        <path className={styles.gaugeWave} d="M0 14 q13 -7 26 0 t26 0 t26 0 t26 0 t26 0 t26 0 t26 0 V230 H0 Z" />
      </g>
    </g>
    {ticks.map(t => <g key={t}><line x1="86" x2="94" y1={204 - (t / scale) * 190} y2={204 - (t / scale) * 190} className={styles.gaugeTick} /><text x="98" y={208 - (t / scale) * 190} className={styles.gaugeLabel}>{t}</text></g>)}
  </svg>;
}

export function NinoObserved({ live, record, climate, config, now, threshold24h }: { live: ObservedRain | null | undefined; record: NinoObservedDay[]; climate: NinoClimate | null; config: NinoConfig; now: number; threshold24h: number }) {
  const [period, setPeriod] = useState<24 | 72 | 168>(24);
  const all = mergeDays(record, live);
  const last = all.slice(-10).map(day => ({ ...day, label: String(Number(day.fecha.slice(8, 10))), value: day.mm ?? 0 }));
  const maxValue = Math.max(0, ...last.map(d => d.value));
  const strong = all.filter(d => d.mm != null && d.mm >= config.dia_fuerte_registro_mm && !d.parcial).reverse();
  const total = live?.totales.find(t => t.horas === period);
  const freq = total && climate && period !== 168 ? frequencyText(total.mm, period === 24 ? climate.diarios_desde_10mm : climate.tres_dias_desde_20mm, climate.n_anios) : null;
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
  const monthKey = today.slice(5, 7);
  const monthName = MONTHS[Number(monthKey) - 1];
  const monthTotal = all.filter(d => d.fecha.startsWith(today.slice(0, 7)) && d.mm != null).reduce((s, d) => s + (d.mm ?? 0), 0);
  const typical = climate?.mensual[monthKey];

  return <section id="lo-que-llovio" className={styles.card} aria-labelledby="llovio-title">
    <div className={styles.cardHead}>
      <h2 id="llovio-title" className={styles.cardTitle}>Lo que ya llovió</h2>
      <span className={styles.cardMeta}>estación del SMN · aeropuerto</span>
    </div>
    <div className={styles.segmented} role="group" aria-label="Período">
      {([[24, "24 horas"], [72, "3 días"], [168, "7 días"]] as const).map(([h, label]) => <button key={h} type="button" aria-pressed={period === h} onClick={() => setPeriod(h)}>{label}</button>)}
    </div>
    <div className={styles.waterGrid}>
      <RainGauge mm={total?.mm ?? 0} scale={Math.max(100, Math.ceil(((total?.mm ?? 0) * 1.15) / 25) * 25)} />
      <div className={styles.waterText}>
        <p className={styles.hugeNumber}>{total ? <>{formatRain(total.mm)}<span> mm{!total.completo && " o más"}</span></> : "Sin dato"}</p>
        {freq && <p className={styles.freq}><strong>¿Es mucho?</strong> {freq.startsWith("No pasó") ? freq : `${freq} en Posadas`}.</p>}
        {period === 168 && <p className={styles.smallLine}>Para 7 días no calculamos frecuencia.</p>}
        {total && <p className={styles.smallLine}>Hasta las {clockTime(total.hasta)} de {dayName(new Date(Date.parse(total.hasta) - 3 * 3_600_000).toISOString().slice(0, 10), now)}. La estación informa cada 6 horas.</p>}
        {typical && <p className={styles.monthLine}>{monthName.replace(/^./, c => c.toUpperCase())} lleva <strong>{num(Math.round(monthTotal))} mm</strong>. En un {monthName} típico llueven {num(Math.round(typical.mediana))} mm.</p>}
      </div>
    </div>

    {last.length > 0 && <div className={styles.daysStrip} role="img" aria-label={`Lluvia por día en los últimos ${last.length} días. Máximo: ${num(maxValue)} milímetros.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={last} margin={{ top: 18, right: 0, left: 0, bottom: 0 }} barCategoryGap="18%">
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--nino-grid)" }} tick={{ fontSize: 11, fill: "var(--color-muted)" }} interval={0} />
          <Tooltip cursor={{ fill: "var(--nino-hover)" }} content={({ active, payload }) => {
            const day = payload?.[0]?.payload as (Day & { label: string }) | undefined;
            return active && day ? <div className={styles.tooltip}><p className="font-semibold">{longDate(day.fecha)}</p><p>{day.mm == null ? noData(day) : `${formatRain(day.mm)} mm`}{day.parcial ? " hasta ahora" : ""}</p>{(day.tormenta || day.granizo) && <p className="text-sm">{day.granizo ? "Tormenta con granizo" : "Hubo tormenta"}</p>}</div> : null;
          }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={22}>
            {last.map(day => <Cell key={day.fecha} fill={day.parcial ? "var(--nino-rain-soft)" : day.value >= threshold24h ? "var(--nino-rain-strong)" : "var(--nino-rain)"} />)}
            <LabelList dataKey="value" position="top" fontSize={11} fill="var(--color-text)" formatter={(value: number) => (value >= 1 ? num(Math.round(value)) : "")} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>}
    <p className={styles.footnote}>Últimos días, de 9 a 9 h; el último es hoy, hasta ahora. Más oscuro: {num(threshold24h)} mm o más. Es un solo punto, el aeropuerto: en tu barrio pudo llover más o menos.</p>

    <details className={styles.details}>
      <summary>Ver la lista y los días con mucha lluvia</summary>
      <div className={styles.detailsBody}>
        <ul className={styles.dayTable}>{[...last].reverse().map(day => <li key={day.fecha}><span>{dayName(day.fecha, now, true)}</span><span>{day.mm == null ? noData(day) : `${formatRain(day.mm)} mm`}{day.parcial ? " (hasta ahora)" : ""}</span><span>{day.granizo ? "Tormenta con granizo" : day.tormenta ? "Hubo tormenta" : ""}</span></li>)}</ul>
        {strong.length > 0 && <>
          <h3 className={styles.subTitle}>Días con {num(config.dia_fuerte_registro_mm)} mm o más</h3>
          <ol className={styles.recordList}>{strong.slice(0, 15).map(day => <li key={day.fecha}><span className={styles.recordMm}>{formatRain(day.mm)} mm</span><span>{longDate(day.fecha)}</span><span className={styles.muted}>{day.granizo ? "tormenta con granizo" : day.tormenta ? "con tormenta" : ""}</span></li>)}</ol>
        </>}
        {climate && <p className={styles.footnote}>Frecuencias calculadas con {climate.n_anios} años completos de la estación (desde {climate.anios_completos[0]}): se cuenta cuántas veces por año hubo al menos esa lluvia.</p>}
      </div>
    </details>
  </section>;
}
