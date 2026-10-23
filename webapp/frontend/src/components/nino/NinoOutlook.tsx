"use client";

import { ForecastSafety } from "@/components/ForecastSafety";
import type { NinoRain, NinoWrf } from "@/lib/nino-types";
import type { SmnAlert } from "@/lib/nino-live/parse";
import { RAIN_COPY, alertHeadline, clockTime, dayName, formatRain, formatNinoNumber as num, ninoDate, whenText } from "@/lib/nino-presentation";
import { NinoRainChart } from "./NinoRainChart";
import styles from "./nino.module.css";

const localDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

export function NinoOutlook({ rain, wrf, fresh, now, officialAlert, issuedAt }: { rain: NinoRain | undefined; wrf: NinoWrf | undefined; fresh: boolean; now: number; officialAlert?: SmnAlert; issuedAt: string }) {
  const threshold = rain?.umbrales.atencion?.mm_24h ?? 50;
  // Un día con menos de 3 horas por delante no dice nada útil.
  const days = (rain?.dias ?? []).filter(d => d.horas >= 3);
  const wrfOk = wrf?.estado === "disponible";
  const wrfDays = new Map((wrfOk ? wrf!.dias ?? [] : []).map(d => [d.fecha, d]));
  const top = Math.max(threshold, ...days.map(d => d.p90), ...[...wrfDays.values()].map(d => d.max_zona)) * 1.08;
  // Escala con 4 tramos redondos (10, 20, 25, 50 mm...).
  const step = [5, 10, 20, 25, 50, 100].find(s => s * 4 >= top) ?? 100;
  const scaleMax = step * 4;
  const pct = (value: number) => `${Math.min(100, Math.max(0, (value / scaleMax) * 100))}%`;
  const ticks = [0, 1, 2, 3, 4].map(i => i * step);
  const level = fresh && rain ? rain.nivel : "a_verificar";

  return <section id="lluvia" className={styles.section} aria-labelledby="lluvia-heading">
    <p className={styles.eyebrow}>Pronóstico</p>
    <h2 id="lluvia-heading" className={styles.sectionTitle}>Lo que viene</h2>
    {/* El aviso de vencimiento aplica al pronóstico, no a los datos en vivo. */}
    <ForecastSafety generatedAt={issuedAt} />
    {officialAlert && <p className={styles.officialLine} data-tone={officialAlert.color}><strong>{alertHeadline(officialAlert)}</strong> hasta {whenText(officialAlert.fin, now)}. Lo que dice el SMN pesa más que la estimación de abajo.</p>}
    <p className={styles.intro}>
      <span className={styles.estimateLabel}>Estimación de este observatorio:</span>{" "}
      <span className={`${styles.badge} ${styles[level]}`}>{RAIN_COPY[level].title}</span>{" "}
      {fresh && !officialAlert ? RAIN_COPY[level].description : ""}
    </p>

    {days.length > 0 ? <>
      <ol className={styles.dayList}>{days.map((day, index) => {
        const start = index === 0 && localDate(day.desde) === localDate(new Date(now).toISOString()) && day.horas < 24;
        const w = wrfDays.get(day.fecha);
        return <li key={day.fecha} className={styles.dayRow}>
          <p className={styles.dayHead}><strong>{dayName(day.fecha, now, true)}</strong>{start && <span> desde las {clockTime(day.desde)}</span>}</p>
          <div className={styles.rangeTrack} aria-hidden="true">
            <span className={styles.rangeThreshold} style={{ left: pct(threshold) }} />
            <span className={styles.rangeBar} style={{ left: pct(day.p10), width: `calc(${pct(day.p90)} - ${pct(day.p10)})` }} />
            <span className={styles.rangeMid} style={{ left: pct(day.p50) }} />
          </div>
          <p className={styles.dayText}>Lo más probable: <strong>{formatRain(day.p50)} mm</strong>. Puede ir de {formatRain(day.p10)} a {formatRain(day.p90)} mm.</p>
          <p className={styles.dayMeta}>{day.prob_atencion != null && `${num(day.prob_atencion)} % de escenarios llegan al nivel de atención`}{day.prob_lluvioso != null && ` · ${num(day.prob_lluvioso)} % superan ${num(rain?.dia_lluvioso_mm ?? 20)} mm`}</p>
          {w && <p className={styles.dayWrf}>Modelo del SMN de alta resolución: {formatRain(w.centro)} mm en el centro y hasta <strong>{formatRain(w.max_zona)} mm</strong> en algún punto a menos de {wrf?.radio_km ?? 12} km{w.horas < 24 ? ` (${w.horas} horas)` : ""}.</p>}
        </li>;
      })}</ol>
      <div className={styles.rangeAxis} aria-hidden="true">{ticks.map(t => <span key={t} style={{ left: pct(t) }}>{num(t)}</span>)}<span className={styles.rangeUnit}>mm por día</span></div>
      <p className={styles.chartKey}><span><i className={styles.keyRange} />Rango entre escenarios</span><span><i className={styles.keyMid} />Lo más probable</span><span><i className={styles.keyThreshold} />{num(threshold)} mm: nivel de atención</span></p>
    </> : <p className={styles.notice}>No hay un pronóstico por día disponible.</p>}

    <p className={styles.sourceNote}>
      Pronóstico de {rain?.n_miembros ?? "varios"} escenarios de seis modelos internacionales (vía Open-Meteo){rain?.generated_at ? `, emitido ${ninoDate(rain.generated_at)}` : ""}.
      {wrfOk ? ` El modelo de alta resolución es el WRF del SMN de las ${clockTime(wrf!.corrida!)} (4 km).` : " El modelo de alta resolución del SMN no está disponible en esta actualización."}
      {" "}Las tormentas son muy localizadas: un barrio puede recibir mucho más que otro.
    </p>

    <details className={styles.details}>
      <summary>Ver hora por hora y cómo se calcula</summary>
      <div className={styles.detailsBody}><NinoRainChart rain={rain} fresh={fresh} /></div>
    </details>
  </section>;
}
