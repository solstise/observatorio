"use client";

import type { NinoAhora } from "@/lib/nino-live/types";
import { agoText, formatMeters as m, ninoDate } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short" }).replace(".", "");

// Regla de nivel: el agua llega a la altura actual; las rayas marcan alerta y evacuación.
function RiverGauge({ value, alert, evac, low, high }: { value: number; alert: number | null; evac: number | null; low: number; high: number }) {
  const y = (v: number) => 214 - ((v - low) / (high - low)) * 196;
  const marks = Array.from({ length: Math.floor(high - low) + 1 }, (_, i) => low + i);
  return <svg className={styles.riverGauge} viewBox="0 0 176 230" aria-hidden="true">
    <defs><clipPath id="river-tube"><rect x="18" y="18" width="56" height="196" rx="10" /></clipPath></defs>
    <rect x="18" y="18" width="56" height="196" rx="10" className={styles.gaugeTube} />
    <g clipPath="url(#river-tube)">
      <g className={styles.gaugeWater} style={{ transform: `translateY(${y(value) - 14}px)` }}>
        <path className={styles.riverWave} d="M-30 14 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V240 H-30 Z" />
      </g>
    </g>
    {marks.map(v => <g key={v}><line x1="74" x2="80" y1={y(v)} y2={y(v)} className={styles.gaugeTick} /><text x="84" y={y(v) + 4} className={styles.gaugeLabel}>{v} m</text></g>)}
    {alert != null && <g><line x1="14" x2="78" y1={y(alert)} y2={y(alert)} className={styles.riverAlert} /><text x="112" y={y(alert) + 4} className={styles.riverMarkLabel}>alerta</text></g>}
    {evac != null && <g><line x1="14" x2="78" y1={y(evac)} y2={y(evac)} className={styles.riverEvac} /><text x="112" y={y(evac) + 4} className={styles.riverMarkLabel}>evacuación</text></g>}
  </svg>;
}

function Sparkline({ history, alert }: { history: Array<{ fecha: string; altura_m: number }>; alert: number | null }) {
  const values = history.map(h => h.altura_m);
  const min = Math.min(...values) - 0.1, max = Math.max(...values, alert ?? -Infinity) + 0.1;
  const x = (i: number) => 4 + (i / (history.length - 1)) * 292;
  const y = (v: number) => 54 - ((v - min) / (max - min)) * 48;
  const d = history.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h.altura_m).toFixed(1)}`).join(" ");
  const first = history[0], last = history[history.length - 1];
  return <figure className={styles.spark}>
    <svg viewBox="0 0 300 60" preserveAspectRatio="none" role="img" aria-label={`Altura en los últimos ${history.length} días: de ${m(first.altura_m)} a ${m(last.altura_m)} metros.`}>
      {alert != null && alert <= max && <line x1="0" x2="300" y1={y(alert)} y2={y(alert)} className={styles.riverAlert} vectorEffect="non-scaling-stroke" />}
      <path d={d} className={styles.sparkLine} vectorEffect="non-scaling-stroke" />
    </svg>
    <figcaption><span>{shortDate(first.fecha)}: {m(first.altura_m)} m</span><span>{shortDate(last.fecha)}: {m(last.altura_m)} m</span></figcaption>
  </figure>;
}

export function NinoRiver({ river, now }: { river: NinoAhora["rio"] | undefined; now: number }) {
  const data = river?.datos;
  const history = data?.historial ?? [];
  const alert = data?.alerta_m ?? null, evac = data?.evacuacion_m ?? null;
  const values = [...history.map(h => h.altura_m), data?.altura_m ?? 0];
  const low = Math.floor(Math.min(...values) - 0.5);
  const high = Math.ceil(Math.max(...values, evac ?? 0) + 0.3);
  const state = !data || alert == null ? "sin_dato" : evac != null && data.altura_m >= evac ? "evacuacion" : data.altura_m >= alert ? "alerta" : "normal";
  const change = data?.variacion_m ? Math.round(Math.abs(data.variacion_m) * 100) : 0;
  const trend = data?.tendencia ?? "";

  return <section id="rio" className={styles.card} aria-labelledby="rio-heading">
    <div className={styles.cardHead}>
      <h2 id="rio-heading" className={styles.cardTitle}>Río Paraná</h2>
      <span className={styles.cardMeta}>Prefectura · puerto de Posadas</span>
    </div>
    {data ? <div className={styles.riverGrid}>
      <RiverGauge value={data.altura_m} alert={alert} evac={evac} low={low} high={high} />
      <div>
        <p className={styles.hugeNumber}>{m(data.altura_m)}<span> m</span></p>
        <p className={styles.riverTrend} data-trend={trend.includes("crece") ? "up" : trend.includes("baja") ? "down" : "flat"}>{trend.includes("crece") ? "↑ Sube" : trend.includes("baja") ? "↓ Baja" : "→ Estable"}{change ? ` ${change} cm` : ""}</p>
        <p className={styles.smallLine}>{state === "normal" && alert != null ? `Le faltan ${m(alert - data.altura_m)} m para el nivel de alerta.` : state === "alerta" ? "Está sobre el nivel de alerta de Prefectura." : state === "evacuacion" ? "Está sobre el nivel de evacuación de Prefectura." : ""}</p>
        {history.length > 3 && <Sparkline history={history} alert={alert} />}
        <p className={styles.footnote}>Lectura de {ninoDate(data.fecha)} (consultada {agoText(river!.actualizado, now)}). Historial: INA. En Posadas el nivel depende mucho del embalse de Yacyretá; con el río alto, los arroyos desagotan más lento.</p>
      </div>
    </div> : <p className={styles.notice}>No pudimos consultar a Prefectura. <a className="underline" href="https://contenidosweb.prefecturanaval.gob.ar/alturas/" target="_blank" rel="noreferrer">Ver alturas en Prefectura ↗</a></p>}
  </section>;
}
