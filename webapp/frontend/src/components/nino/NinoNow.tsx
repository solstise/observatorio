"use client";

import type { NinoClimate, NinoHail } from "@/lib/nino-types";
import type { NinoAhora } from "@/lib/nino-live/types";
import { directionName } from "@/lib/nino-live/parse";
import { timesPerYear } from "@/lib/nino-escurrimiento";
import { agoText, alertHeadline, alertSummary, clockTime, formatMeters, formatNinoNumber as num, formatRain, HAIL_LIKELIHOOD, hailNext, rainIntensity, whenText, type HeroState } from "@/lib/nino-presentation";
import { NinoIcon } from "./NinoIcons";
import { NinoSky } from "./NinoSky";
import styles from "./nino.module.css";

const HERO_ICON = { roja: "alert", naranja: "alert", amarilla: "alert", informativa: "alert", tormenta: "storm", lluvia: "rain", calma: "check", sin_datos: "alert" } as const;

export function NinoNow({ live, hero, now, climate, hail, loading }: { live: NinoAhora | null; hero: HeroState; now: number; climate: NinoClimate | null; hail: NinoHail | null; loading: boolean }) {
  const alerts = live?.alertas.datos;
  const top = alerts?.posadas[0];
  const others = alerts?.posadas.slice(1) ?? [];
  const smn = live?.smn_ahora.datos;
  const rain = live?.lluvia.datos;
  const lightning = live?.rayos.datos;
  const river = live?.rio.datos;
  const total = (hours: number) => rain?.totales.find(t => t.horas === hours);
  const closest = lightning?.cercano;
  const recentClose = !!closest && closest.hace_min <= 15;
  const nearLightning = (lightning?.cerca_15min ?? 0) > 0;
  const freq = total(24) && climate ? timesPerYear(total(24)!.mm, climate.diarios_desde_10mm, climate.n_anios) : null;
  // Granizo: lo informado por el aeropuerto manda; después la alerta del SMN y el ambiente de los modelos.
  const hailSeen = live?.metar.datos?.granizo_12h ?? [];
  const hailOfficial = !!alerts?.posadas.some(alert => alert.menciona_granizo);
  const hailModels = hailNext(hail, now);
  const likelihood = hailModels.nivel ? HAIL_LIKELIHOOD[hailModels.nivel] : null;
  const hailChip = hailSeen.length ? { value: `Cayó a las ${clockTime(hailSeen[0])}`, sub: "en el aeropuerto" }
    : hailOfficial && (!hailModels.nivel || hailModels.nivel === "bajo") ? { value: "Posible", sub: "lo menciona la alerta del SMN" }
    : likelihood ? { value: likelihood.charAt(0).toUpperCase() + likelihood.slice(1), sub: hailOfficial ? "próximas 12 h · lo menciona el SMN" : `próximas 12 h · ${hailModels.modelos} modelos` }
    : { value: "Sin datos", sub: "" };
  const hailHot = hailSeen.length > 0 || hailModels.nivel === "alto" || (hailOfficial && hailModels.nivel === "moderado");
  const summary = top ? alertSummary(top) : "";
  const freqText = !freq || freq.count === 0 ? "estación del SMN"
    : freq.porAnio >= 1.5 ? `~${Math.round(freq.porAnio)} veces por año`
    : freq.porAnio >= 0.75 ? "~1 vez por año" : `1 vez cada ${Math.round(1 / freq.porAnio)} años`;

  return <section id="ahora" className={styles.heroCard} data-tone={hero.tone} aria-labelledby="ahora-heading">
    <NinoSky intensity={rainIntensity(live)} lightning={nearLightning || !!live?.metar.datos?.tormenta_ultima_hora} />
    <div className={styles.heroInner}>
      <p className={styles.heroBadge}><NinoIcon name={HERO_ICON[hero.tone]} size={18} />{hero.badge}</p>
      <h2 id="ahora-heading" className={styles.heroHeadline}>{loading && !live ? "Consultando al SMN…" : hero.headline}</h2>
      <p className={styles.heroSummary}>{summary || hero.detail}</p>
      {top && top.instrucciones.length > 0 && <details className={styles.heroTodo}>
        <summary>Qué recomienda el SMN</summary>
        <ol>{top.instrucciones.map(step => <li key={step}>{step.replace(/\.$/, "")}.</li>)}</ol>
      </details>}
      {others.length > 0 && <ul className={styles.heroMore}>{others.map(alert => <li key={alert.id}>{alertHeadline(alert)}: desde {whenText(alert.inicio, now)} hasta {whenText(alert.fin, now)}.</li>)}</ul>}
      <a className={styles.heroLink} href="https://www.smn.gob.ar/alertas" target="_blank" rel="noreferrer">Ver alertas en el SMN <span aria-hidden="true">↗</span></a>
    </div>

    <ul className={styles.chips} aria-label="Ahora en Posadas">
      <li><a href="#rayos" className={styles.chip} data-hot={recentClose && closest!.km <= 30 ? "1" : undefined}>
        <NinoIcon name="bolt" size={20} />
        <span className={styles.chipLabel}>Rayos</span>
        <span className={styles.chipValue}>{!lightning ? "Sin datos" : recentClose ? `A ${closest!.km} km` : "Lejos"}</span>
        <span className={styles.chipSub}>{!lightning ? "" : recentClose ? `al ${directionName(closest!.rumbo)}${lightning.tendencia.estado === "se_acerca" ? " · se acerca" : lightning.tendencia.estado === "se_aleja" ? " · se aleja" : ""}` : "nada en 15 min"}</span>
      </a></li>
      <li><a href="#lo-que-llovio" className={styles.chip}>
        <NinoIcon name="drop" size={20} />
        <span className={styles.chipLabel}>Llovió en 24 h</span>
        <span className={styles.chipValue}>{total(24) ? `${formatRain(total(24)!.mm)} mm` : "Sin datos"}</span>
        <span className={styles.chipSub}>{freqText}</span>
      </a></li>
      <li><a href="#granizo" className={styles.chip} data-hot={hailHot ? "1" : undefined}>
        <NinoIcon name="hail" size={20} />
        <span className={styles.chipLabel}>Granizo</span>
        <span className={styles.chipValue}>{hailChip.value}</span>
        <span className={styles.chipSub}>{hailChip.sub}</span>
      </a></li>
      <li><a href="#rio" className={styles.chip}>
        <NinoIcon name="river" size={20} />
        <span className={styles.chipLabel}>Paraná</span>
        <span className={styles.chipValue}>{river ? `${formatMeters(river.altura_m)} m` : "Sin datos"}</span>
        <span className={styles.chipSub}>{river ? river.tendencia : ""}</span>
      </a></li>
      <li><span className={styles.chip}>
        <NinoIcon name="storm" size={20} />
        <span className={styles.chipLabel}>Ahora</span>
        <span className={styles.chipValue}>{smn?.temperatura != null ? `${num(smn.temperatura)} °C` : "Sin datos"}</span>
        <span className={styles.chipSub}>{smn?.estado ?? ""}</span>
      </span></li>
    </ul>

    {alerts?.cerca.length ? <p className={styles.nearby}><NinoIcon name="storm" size={18} /><span><strong>Aviso del SMN cerca:</strong> {alerts.cerca.map(a => `${alertHeadline(a)} a ${a.distancia_km} km`).join(" · ")}.</span></p> : null}
    <p className={styles.liveLine}><span className={styles.liveDot} data-live={live ? "1" : "0"} aria-hidden="true" />{live ? `Actualizado ${agoText(live.generado, now)} · se actualiza solo` : "Cargando datos en vivo…"}</p>
  </section>;
}
