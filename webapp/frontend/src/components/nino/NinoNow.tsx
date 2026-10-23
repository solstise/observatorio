"use client";

import type { NinoConfig } from "@/lib/nino-types";
import type { NinoAhora } from "@/lib/nino-live/types";
import { soilState } from "@/lib/nino-live/parse";
import { agoText, alertHeadline, clockTime, formatMeters, formatNinoNumber as num, formatRain, whenText, type HeroState } from "@/lib/nino-presentation";
import { NinoIcon } from "./NinoIcons";
import styles from "./nino.module.css";

const HERO_ICON = { roja: "alert", naranja: "alert", amarilla: "alert", informativa: "alert", tormenta: "storm", lluvia: "rain", calma: "check", sin_datos: "alert" } as const;

const SOIL = {
  saturado: { title: "Muy mojado", note: "Con poca lluvia más ya puede haber anegamientos." },
  mojado: { title: "Mojado", note: "Absorbe menos agua que lo habitual." },
  seco: { title: "Sin lluvia acumulada importante", note: "" },
  sin_dato: { title: "Sin dato", note: "No hay lluvia medida reciente." },
} as const;

// Sin dato y sin error: la fuente todavía está respondiendo (arranque en frío).
const pendingText = (source: { estado: string; error: string | null } | undefined, missing: string) =>
  !source || (source.estado === "sin_datos" && !source.error) ? "Consultando…" : missing;

export function NinoNow({ live, hero, now, config, loading }: { live: NinoAhora | null; hero: HeroState; now: number; config: NinoConfig; loading: boolean }) {
  const alerts = live?.alertas.datos;
  const top = alerts?.posadas[0];
  const others = alerts?.posadas.slice(1) ?? [];
  const smn = live?.smn_ahora.datos;
  const metar = live?.metar.datos;
  const rain = live?.lluvia.datos;
  const lightning = live?.rayos.estado !== "sin_datos" ? live?.rayos.datos : null;
  const river = live?.rio.datos;
  const total = (hours: number) => rain?.totales.find(t => t.horas === hours);
  const soil = soilState(total(72)?.mm, config);
  const nearLightning = (lightning?.cerca_15min ?? 0) > 0;

  return <section id="ahora" className={styles.now} aria-labelledby="ahora-heading">
    <div className={styles.hero} data-tone={hero.tone} role={["roja", "naranja", "amarilla", "tormenta"].includes(hero.tone) ? "alert" : undefined}>
      <div className={styles.heroIcon}><NinoIcon name={HERO_ICON[hero.tone]} size={28} /></div>
      <div className={styles.heroBody}>
        <h2 id="ahora-heading" className={styles.heroTitle}>{loading && !live ? "Consultando al SMN…" : hero.title}</h2>
        <p className={styles.heroDetail}>{loading && !live ? "Estamos buscando alertas, lluvia medida y rayos." : hero.detail}</p>
        {top && <p className={styles.heroOfficial}>{top.descripcion}</p>}
        {top && top.instrucciones.length > 0 && <details className={styles.heroTodo}>
          <summary>Qué recomienda el SMN</summary>
          <ol>{top.instrucciones.map(step => <li key={step}>{step.replace(/\.$/, "")}.</li>)}</ol>
        </details>}
        {others.length > 0 && <ul className={styles.heroMore}>{others.map(alert => <li key={alert.id}>{alertHeadline(alert)}: desde {whenText(alert.inicio, now)} hasta {whenText(alert.fin, now)}.</li>)}</ul>}
        <p className={styles.heroLinks}><a href="https://www.smn.gob.ar/alertas" target="_blank" rel="noreferrer">Ver alertas en el SMN <span aria-hidden="true">↗</span></a></p>
      </div>
    </div>

    {alerts?.cerca.length ? <div className={styles.nearby} role="status">
      <NinoIcon name="storm" size={20} />
      <p><strong>Aviso del SMN cerca de Posadas.</strong> {alerts.cerca.map(a => `${alertHeadline(a)} en ${a.zona.toLowerCase().replace(/^misiones:\s*/, "")} (a ${a.distancia_km} km)`).join(" · ")}. Estos avisos duran un par de horas y las tormentas se mueven.</p>
    </div> : null}

    <h3 className={styles.nowHeading}>Ahora en Posadas</h3>
    <ul className={styles.facts}>
      <li>
        <NinoIcon name="storm" />
        <div>
          <p className={styles.factLabel}>Cómo está el tiempo</p>
          {smn || metar?.ultimo ? <>
            <p className={styles.factValue}>{smn ? smn.estado : metar!.ultimo!.texto.replace(/^./, c => c.toUpperCase())}{smn?.temperatura != null && ` · ${num(smn.temperatura)} °C`}</p>
            <p className={styles.factNote}>{[
              smn?.humedad != null ? `Humedad ${num(smn.humedad)} %` : null,
              smn?.viento ? `viento ${smn.viento.replace(/\s+/g, " ").toLowerCase()} km/h` : null,
              metar?.ultimo ? `aeropuerto a las ${clockTime(metar.ultimo.hora)}: ${metar.ultimo.texto}` : null,
            ].filter(Boolean).join(" · ")}.</p>
            {metar && metar.granizo_12h.length > 0 && <p className={styles.factWarn}>El aeropuerto informó granizo a las {metar.granizo_12h.map(clockTime).join(", ")}.</p>}
          </> : <p className={styles.factValue}>{pendingText(live?.smn_ahora, "Sin datos del SMN en este momento")}</p>}
        </div>
      </li>
      <li>
        <NinoIcon name="bolt" />
        <div>
          <p className={styles.factLabel}>Rayos a menos de {lightning?.radio_km ?? config.rayos_cerca_km} km</p>
          {lightning ? <>
            <p className={styles.factValue}>{nearLightning ? `${num(lightning.cerca_15min)} en los últimos 15 minutos` : "Ninguno en los últimos 15 minutos"}</p>
            <p className={styles.factNote}>{nearLightning && lightning.mas_cercano_km != null ? `El más cercano, a ${lightning.mas_cercano_km} km. ` : ""}{num(lightning.cerca_60min)} en la última hora. Detectados por el satélite GOES-19.</p>
            {nearLightning && <p className={styles.factWarn}>Si escuchás truenos, estás al alcance de un rayo: quedate bajo techo.</p>}
          </> : <p className={styles.factValue}>{pendingText(live?.rayos, "Sin datos de rayos en este momento")}</p>}
        </div>
      </li>
      <li>
        <NinoIcon name="drop" />
        <div>
          <p className={styles.factLabel}>Lluvia medida en las últimas 24 horas</p>
          {total(24) ? <>
            <p className={styles.factValue}>{formatRain(total(24)!.mm)} mm{!total(24)!.completo && " o más"}</p>
            <p className={styles.factNote}>Estación del SMN en el aeropuerto, hasta las {clockTime(total(24)!.hasta)}. <a href="#lo-que-llovio">Ver los últimos días</a></p>
          </> : <p className={styles.factValue}>{pendingText(live?.lluvia, "Sin datos de la estación")}</p>}
        </div>
      </li>
      <li>
        <NinoIcon name="ground" />
        <div>
          <p className={styles.factLabel}>El suelo</p>
          <p className={styles.factValue}>{SOIL[soil].title}</p>
          <p className={styles.factNote}>{soil === "sin_dato" ? SOIL.sin_dato.note : `${SOIL[soil].note} Llovieron ${formatRain(total(72)?.mm)} mm en 3 días.`.trim()}</p>
        </div>
      </li>
      <li>
        <NinoIcon name="river" />
        <div>
          <p className={styles.factLabel}>Río Paraná en Posadas</p>
          {river ? <>
            <p className={styles.factValue}>{formatMeters(river.altura_m)} m · {river.tendencia}</p>
            <p className={styles.factNote}>Alerta desde {formatMeters(river.alerta_m)} m, evacuación desde {formatMeters(river.evacuacion_m)} m. <a href="#rio">Ver el río</a></p>
          </> : <p className={styles.factValue}>{pendingText(live?.rio, "Sin datos de Prefectura")}</p>}
        </div>
      </li>
    </ul>
    <p className={styles.liveLine}><span className={styles.liveDot} data-live={live ? "1" : "0"} aria-hidden="true" />{live ? `Actualizado ${agoText(live.generado, now)}. Se actualiza solo cada 3 minutos.` : "Cargando datos en vivo…"}</p>
  </section>;
}
