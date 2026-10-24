"use client";

import { ForecastSafety } from "@/components/ForecastSafety";
import type { NinoHail, NinoRain, NinoWrf } from "@/lib/nino-types";
import type { SmnAlert } from "@/lib/nino-live/parse";
import { HAIL_LIKELIHOOD, RAIN_COPY, alertHeadline, clockTime, dayName, formatRain, formatNinoNumber as num, ninoDate, whenText } from "@/lib/nino-presentation";
import { NinoRainChart } from "./NinoRainChart";
import styles from "./nino.module.css";

const TZ = "America/Argentina/Buenos_Aires";
const localDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

export function NinoOutlook({ rain, wrf, hail, fresh, now, officialAlert, issuedAt }: { rain: NinoRain | undefined; wrf: NinoWrf | undefined; hail: NinoHail | null; fresh: boolean; now: number; officialAlert?: SmnAlert; issuedAt: string }) {
  const threshold = rain?.umbrales.atencion?.mm_24h ?? 50;
  // Un día con menos de 3 horas por delante no dice nada útil.
  const days = (rain?.dias ?? []).filter(d => d.horas >= 3);
  const wrfOk = wrf?.estado === "disponible";
  const wrfDays = new Map((wrfOk ? wrf!.dias ?? [] : []).map(d => [d.fecha, d]));
  const hailDays = new Map((hail?.dias ?? []).map(d => [d.fecha, d.consenso]));
  const top = Math.max(threshold, ...days.map(d => d.p90), ...[...wrfDays.values()].map(d => d.max_zona)) * 1.08;
  const scaleMax = ([5, 10, 20, 25, 50, 100].find(s => s * 4 >= top) ?? 100) * 4;
  const pct = (value: number) => `${Math.min(100, Math.max(0, (value / scaleMax) * 100))}%`;
  const level = fresh && rain ? rain.nivel : "a_verificar";
  const alertCovers = (fecha: string) => !!officialAlert && (!officialAlert.inicio || localDate(officialAlert.inicio) <= fecha) && (!officialAlert.fin || localDate(officialAlert.fin) >= fecha);

  return <section id="lluvia" className={styles.card} aria-labelledby="lluvia-heading">
    <div className={styles.cardHead}>
      <h2 id="lluvia-heading" className={styles.cardTitle}>Lo que viene</h2>
      <span className={styles.cardMeta}>{rain?.generated_at ? `pronóstico de ${clockTime(rain.generated_at)}` : ""}</span>
    </div>
    {/* El aviso de vencimiento aplica al pronóstico, no a los datos en vivo. */}
    <ForecastSafety generatedAt={issuedAt} />
    {officialAlert && <p className={styles.officialLine} data-tone={officialAlert.color}><strong>{alertHeadline(officialAlert)}</strong> hasta {whenText(officialAlert.fin, now)}. Lo que dice el SMN pesa más que la estimación de abajo.</p>}
    <p className={styles.estimateLine}>
      <span className={styles.estimateLabel}>Estimación de este observatorio:</span>{" "}
      <span className={`${styles.badge} ${styles[level]}`}>{RAIN_COPY[level].title}</span>
    </p>

    {days.length > 0 ? <ol className={styles.dayCards}>{days.map((day, index) => {
      const partial = index === 0 && localDate(day.desde) === localDate(new Date(now).toISOString()) && day.horas < 24;
      const w = wrfDays.get(day.fecha);
      const hailLevel = hailDays.get(day.fecha);
      return <li key={day.fecha} className={styles.dayCard}>
        <p className={styles.dayName}>{dayName(day.fecha, now, true)}{partial && <span> desde las {clockTime(day.desde)}</span>}</p>
        <p className={styles.dayMm}>{formatRain(day.p50)}<span> mm</span></p>
        <p className={styles.dayRange}>puede ir de {formatRain(day.p10)} a {formatRain(day.p90)}</p>
        <div className={styles.rangeTrack} aria-hidden="true">
          <span className={styles.rangeThreshold} style={{ left: pct(threshold) }} />
          <span className={styles.rangeBar} style={{ left: pct(day.p10), width: `calc(${pct(day.p90)} - ${pct(day.p10)})` }} />
          <span className={styles.rangeMid} style={{ left: pct(day.p50) }} />
        </div>
        <ul className={styles.dayChips}>
          {alertCovers(day.fecha) && <li data-kind="smn">Alerta SMN</li>}
          {hailLevel && hailLevel !== "bajo" && <li data-kind="hail">Granizo {HAIL_LIKELIHOOD[hailLevel]}</li>}
          {day.prob_atencion != null && day.prob_atencion >= 20 && <li>{num(day.prob_atencion)}% llega al nivel de atención</li>}
        </ul>
        {w && <p className={styles.dayWrf}>Modelo del SMN: {formatRain(w.centro)} mm en el centro, hasta <strong>{formatRain(w.max_zona)}</strong> en la zona</p>}
      </li>;
    })}</ol> : <p className={styles.notice}>No hay un pronóstico por día disponible.</p>}
    {days.length > 0 && <p className={styles.footnote}><span className={styles.keyInline}><i className={styles.keyRange} />rango entre escenarios</span> <span className={styles.keyInline}><i className={styles.keyMid} />lo más probable</span> <span className={styles.keyInline}><i className={styles.keyThreshold} />{num(threshold)} mm: nivel de atención</span>. Las tormentas son muy localizadas: un barrio puede recibir mucho más que otro.</p>}

    <details className={styles.details}>
      <summary>Ver hora por hora y cómo se calcula</summary>
      <div className={styles.detailsBody}>
        <p className={styles.footnote}>Pronóstico de {rain?.n_miembros ?? "varios"} escenarios de seis modelos internacionales (vía Open-Meteo){rain?.generated_at ? `, emitido ${ninoDate(rain.generated_at)}` : ""}.{wrfOk ? ` Modelo de alta resolución: WRF 4 km del SMN, corrida de las ${clockTime(wrf!.corrida!)}.` : " El modelo de alta resolución del SMN no está disponible en esta actualización."}</p>
        <NinoRainChart rain={rain} fresh={fresh} />
      </div>
    </details>
  </section>;
}
