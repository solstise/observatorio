"use client";

import type { NinoAhora } from "@/lib/nino-live/types";
import { POSADAS, directionName } from "@/lib/nino-live/parse";
import { LIGHTNING_COLORS, agoText, clockTime, formatNinoNumber as num, lightningColor } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

const RINGS = [15, 30, 60, 100];
const R = 100; // km en el borde del gráfico

// Posición en km al este (x) y al norte (y) de Posadas.
const toKm = (lat: number, lon: number) => ({
  x: (lon - POSADAS.lon) * 111.32 * Math.cos((POSADAS.lat * Math.PI) / 180),
  y: (lat - POSADAS.lat) * 110.57,
});

function TrendLine({ tramos }: { tramos: Array<{ hace_min: number; km: number | null }> }) {
  const max = Math.max(60, ...tramos.map(t => t.km ?? 0));
  return <ol className={styles.trend} aria-label="Distancia del rayo más cercano cada 10 minutos">
    {tramos.map(t => <li key={t.hace_min}>
      <span className={styles.trendBar} style={{ height: t.km == null ? 0 : `${Math.max(6, 100 - (t.km / max) * 100)}%` }} data-empty={t.km == null ? "1" : undefined} />
      <span className={styles.trendKm}>{t.km == null ? "–" : `${t.km}`}</span>
      <span className={styles.trendAgo}>{t.hace_min === 0 ? "ahora" : `-${t.hace_min}′`}</span>
    </li>)}
  </ol>;
}

export function NinoLightning({ rayos, metar, now }: { rayos: NinoAhora["rayos"] | undefined; metar: NinoAhora["metar"]["datos"] | undefined; now: number }) {
  const data = rayos?.datos;
  const points = (data?.puntos ?? []).map(([lat, lon, min]) => ({ ...toKm(lat, lon), min })).filter(p => Math.hypot(p.x, p.y) <= R);
  const closest = data?.cercano;
  const trend = data?.tendencia;
  const headline = !data ? "Sin datos del satélite ahora"
    : closest && closest.hace_min <= 15 ? `El más cercano, a ${closest.km} km al ${directionName(closest.rumbo)}`
    : data.zona_60min ? "Sin rayos cerca en los últimos 15 minutos" : "Sin rayos en 100 km a la redonda";
  const trendText = trend?.estado === "se_acerca"
    ? `Se acerca a unos ${Math.abs(trend.velocidad_kmh ?? 0)} km/h${trend.llegada_min ? `: si sigue así, llegaría en ${trend.llegada_min} minutos` : ""}.`
    : trend?.estado === "se_aleja" ? `Se aleja a unos ${trend.velocidad_kmh} km/h.`
    : trend?.estado === "estable" ? "Se mantiene a una distancia parecida." : "";

  return <section id="rayos" className={styles.card} aria-labelledby="rayos-title">
    <div className={styles.cardHead}>
      <h2 id="rayos-title" className={styles.cardTitle}>Rayos</h2>
      <span className={styles.cardMeta}>{data ? `última hora · ${agoText(rayos!.actualizado, now)}` : ""}</span>
    </div>
    <div className={styles.lightningGrid}>
      <figure className={styles.polar}>
        <svg viewBox="-112 -112 224 224" role="img" aria-label={`${num(points.length)} rayos en la última hora a menos de ${R} km de Posadas. ${headline}.`}>
          <defs>
            <radialGradient id="sweep" cx="0" cy="0" r="1"><stop offset="0" stopColor="var(--nino-rain)" stopOpacity=".18" /><stop offset="1" stopColor="var(--nino-rain)" stopOpacity="0" /></radialGradient>
          </defs>
          {RINGS.map(r => <g key={r}>
            <circle r={r} className={styles.polarRing} data-near={r === 30 ? "1" : undefined} />
            <text x={r * 0.71 + 2} y={-r * 0.71 - 2} className={styles.polarLabel}>{r} km</text>
          </g>)}
          {["N", "E", "S", "O"].map((d, i) => <text key={d} x={[0, 106, 0, -106][i]} y={[-103, 4, 110, 4][i]} className={styles.polarCardinal} textAnchor="middle">{d}</text>)}
          <g className={styles.polarSweep}><path d="M0 0 L0 -100 A100 100 0 0 1 70.7 -70.7 Z" fill="url(#sweep)" /></g>
          {[...points].sort((a, b) => b.min - a.min).map((p, i) => <circle key={i} cx={p.x} cy={-p.y} r={p.min <= 5 ? 2.6 : 2} fill={lightningColor(p.min)} className={p.min <= 5 ? styles.polarFresh : undefined} />)}
          <circle r="3.5" className={styles.polarHome} />
          <text y="12" textAnchor="middle" className={styles.polarHomeLabel}>Posadas</text>
        </svg>
        <figcaption className={styles.polarKey}>{LIGHTNING_COLORS.map(([limit, color], i) => <span key={limit}><i style={{ background: color }} />{i === 0 ? `0–${limit}` : `${LIGHTNING_COLORS[i - 1][0]}–${limit}`} min</span>)}</figcaption>
      </figure>
      <div className={styles.lightningText}>
        <p className={styles.bigLine}>{headline}</p>
        {closest && closest.hace_min <= 15 && <p className={styles.smallLine}>Hace {closest.hace_min === 0 ? "menos de un minuto" : `${closest.hace_min} min`}. {num(data!.cerca_60min)} rayos a menos de {data!.radio_km} km en la última hora.</p>}
        {trendText && <p className={styles.trendText} data-state={trend?.estado}>{trendText}</p>}
        {trend && trend.estado !== "sin_datos" && <TrendLine tramos={trend.tramos} />}
        {metar?.ultimo_trueno && <p className={styles.smallLine}>En el aeropuerto se oyeron truenos {now - Date.parse(metar.ultimo_trueno) < 70 * 60_000 ? "en la última hora" : `a las ${clockTime(metar.ultimo_trueno)}`}.</p>}
        <p className={styles.footnote}>Detectados por el satélite GOES-19 de la NOAA: no registra todos los rayos y la ubicación puede variar unos km. Si escuchás truenos, estás al alcance: quedate bajo techo.</p>
      </div>
    </div>
  </section>;
}
