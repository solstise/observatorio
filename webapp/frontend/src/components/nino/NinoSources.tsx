"use client";

import type { NinoSnapshot } from "@/lib/nino-types";
import type { LiveSource, NinoAhora } from "@/lib/nino-live/types";
import { agoText, ninoDate } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

const STATUS = { ok: "Al día", desactualizado: "Último dato disponible", sin_datos: "No disponible ahora" } as const;

export function NinoSources({ live, snapshot, now }: { live: NinoAhora | null; snapshot: NinoSnapshot | null; now: number }) {
  const rows: Array<{ name: string; what: string; source: LiveSource<unknown> | null }> = [
    { name: "Alertas y avisos", what: "Alertas por zona y avisos a muy corto plazo para tormentas, granizo y ráfagas.", source: live?.alertas ?? null },
    { name: "Estado del tiempo", what: "Lo que informa el SMN para Posadas cada hora.", source: live?.smn_ahora ?? null },
    { name: "Aeropuerto", what: "Parte meteorológico (METAR) del aeropuerto, con tormenta y granizo.", source: live?.metar ?? null },
    { name: "Lluvia medida", what: "Milímetros de la estación Posadas Aero, cada 6 horas.", source: live?.lluvia ?? null },
    { name: "Rayos", what: "Detector de rayos del satélite GOES-19, archivos cada 20 segundos.", source: live?.rayos ?? null },
    { name: "Río Paraná", what: "Altura en el puerto de Posadas.", source: live?.rio ?? null },
  ];
  const wrf = snapshot?.wrf_smn;
  return <section id="fuentes" className={styles.section} aria-labelledby="fuentes-heading">
    <p className={styles.eyebrow}>Transparencia</p>
    <h2 id="fuentes-heading" className={styles.sectionTitle}>De dónde salen los datos</h2>
    <p className={styles.intro}>Todo se actualiza solo, desde fuentes oficiales. No usamos reportes de redes ni de vecinos. Si una fuente no responde, lo mostramos en vez de completar el dato.</p>
    <ul className={styles.sources}>
      {rows.map(row => <li key={row.name}>
        <p className={styles.sourceName}><span className={styles.sourceDot} data-state={row.source?.estado ?? "sin_datos"} aria-hidden="true" />{row.name}<span className={styles.sourceState}>{STATUS[row.source?.estado ?? "sin_datos"]}{row.source?.actualizado ? ` · ${agoText(row.source.actualizado, now)}` : ""}</span></p>
        <p className={styles.sourceWhat}>{row.what} {row.source ? <a href={row.source.url} target="_blank" rel="noreferrer">{row.source.fuente} <span aria-hidden="true">↗</span></a> : null}</p>
      </li>)}
      <li>
        <p className={styles.sourceName}><span className={styles.sourceDot} data-state={snapshot ? "ok" : "sin_datos"} aria-hidden="true" />Pronóstico por escenarios<span className={styles.sourceState}>{snapshot ? `Emitido ${ninoDate(snapshot.generated_at)}` : STATUS.sin_datos}</span></p>
        <p className={styles.sourceWhat}>Seis modelos internacionales (ECMWF, NOAA GFS, DWD ICON, JMA, GEM y BOM) vía Open-Meteo. Se actualiza cada 6 horas.</p>
      </li>
      <li>
        <p className={styles.sourceName}><span className={styles.sourceDot} data-state={wrf?.estado === "disponible" ? "ok" : "sin_datos"} aria-hidden="true" />Modelo de alta resolución<span className={styles.sourceState}>{wrf?.estado === "disponible" && wrf.corrida ? `Corrida ${ninoDate(wrf.corrida)}` : STATUS.sin_datos}</span></p>
        <p className={styles.sourceWhat}>WRF 4 km del Servicio Meteorológico Nacional, publicado como datos abiertos. <a href="https://registry.opendata.aws/smn-ar-wrf-dataset/" target="_blank" rel="noreferrer">Datos abiertos del SMN <span aria-hidden="true">↗</span></a></p>
      </li>
    </ul>
    <p className={styles.caption}>Las alertas del SMN se publican bajo licencia CC BY 4.0. Los reportes de la estación (SYNOP) se leen a través de Ogimet y los partes del aeropuerto (METAR) a través de NOAA Aviation Weather, que los redistribuyen sin cambios. No disponemos de imágenes de radar de acceso automático.</p>
  </section>;
}
