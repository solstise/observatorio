"use client";

import type { NinoHail as Hail, HailLevel } from "@/lib/nino-types";
import type { SmnAlert } from "@/lib/nino-live/parse";
import { clockTime, dayName, formatNinoNumber as num } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

const LEVEL_TEXT: Record<HailLevel, string> = { bajo: "Bajo", moderado: "Moderado", alto: "Alto" };
const SCALE = 1.5;

export function NinoHail({ hail, alert, hailSeen, now }: { hail: Hail | null; alert: SmnAlert | undefined; hailSeen: string[]; now: number }) {
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const days = (hail?.dias ?? []).filter(d => d.fecha >= today).slice(0, 3);
  const models = Object.entries(hail?.modelos ?? {});
  const official = alert?.menciona_granizo;
  return <section id="granizo" className={styles.card} aria-labelledby="granizo-title">
    <div className={styles.cardHead}>
      <h2 id="granizo-title" className={styles.cardTitle}>Granizo</h2>
      <span className={styles.cardMeta}>tres fuentes</span>
    </div>
    <ul className={styles.sourcesTriad}>
      <li data-on={official ? "1" : "0"}><strong>SMN</strong>{official ? "Su alerta para Posadas menciona granizo." : alert ? "Su alerta no menciona granizo." : "Sin alerta para Posadas."}</li>
      <li data-on={hailSeen.length ? "1" : "0"}><strong>Aeropuerto</strong>{hailSeen.length ? `Informó granizo a las ${hailSeen.map(clockTime).join(", ")}.` : "No informó granizo en las últimas 12 horas."}</li>
      <li data-on={days.some(d => d.consenso && d.consenso !== "bajo") ? "1" : "0"}><strong>Modelos</strong>{days[0]?.consenso ? `Ambiente ${LEVEL_TEXT[days[0].consenso].toLowerCase()} ${dayName(days[0].fecha, now)}.` : "Sin datos de modelos."}</li>
    </ul>
    {days.length > 0 && <div className={styles.hailDays}>
      {days.map(day => <div key={day.fecha} className={styles.hailDay}>
        <p className={styles.hailDayHead}><span>{dayName(day.fecha, now, true)}</span>{day.consenso && <span className={styles.hailBadge} data-level={day.consenso}>{LEVEL_TEXT[day.consenso]}</span>}</p>
        {models.map(([key, model]) => {
          const value = day.modelos[key]?.ship_max;
          return <div key={key} className={styles.hailModel}>
            <span>{model.nombre.split(" ")[0]}</span>
            <span className={styles.hailTrack} role="img" aria-label={`${model.nombre}: índice ${value == null ? "sin dato" : num(value)}`}>
              <i style={{ width: `${value == null ? 0 : Math.min(100, (value / SCALE) * 100)}%` }} data-level={value == null ? undefined : value >= 1 ? "alto" : value >= 0.5 ? "moderado" : "bajo"} />
              <b style={{ left: `${(0.5 / SCALE) * 100}%` }} /><b style={{ left: `${(1 / SCALE) * 100}%` }} />
            </span>
            <span className={styles.hailValue}>{value == null ? "–" : num(value)}{value != null && day.modelos[key]?.hora ? <small> {day.modelos[key]!.hora} h</small> : null}</span>
          </div>;
        })}
      </div>)}
    </div>}
    <details className={styles.details}>
      <summary>Qué mide este índice</summary>
      <div className={styles.detailsBody}>
        <p>Es el índice SHIP que usa el Centro de Predicción de Tormentas de EE. UU. (NOAA). Combina la energía disponible para tormentas, la humedad, el enfriamiento con la altura y el cambio del viento con la altura. Con 1 o más, el ambiente favorece granizo grande, de 5 cm o más; entre 0,5 y 1 es moderado. Puede caer granizo chico con valores más bajos.</p>
        <p>No es la probabilidad de que caiga granizo en tu casa: dice si el ambiente que prevé cada modelo lo favorece. Mostramos los tres modelos para que se vea cuándo coinciden y cuándo no. Las alertas por granizo son las del SMN.</p>
        <p>Arriba, en la ventana principal, la “chance de granizo” de las próximas 12 horas es el nivel más alto que alcanzan al menos dos de los tres modelos. Si el aeropuerto informó granizo, eso va primero.</p>
      </div>
    </details>
  </section>;
}
