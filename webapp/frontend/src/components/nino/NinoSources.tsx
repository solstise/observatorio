"use client";

import type { NinoClimate, NinoHail, NinoSnapshot } from "@/lib/nino-types";
import type { LiveSource, NinoAhora } from "@/lib/nino-live/types";
import { agoText, ninoDate } from "@/lib/nino-presentation";
import styles from "./nino.module.css";

const STATUS = { ok: "Al día", desactualizado: "Último dato disponible", sin_datos: "No disponible ahora" } as const;

export function NinoSources({ live, snapshot, hail, climate, now }: { live: NinoAhora | null; snapshot: NinoSnapshot | null; hail: NinoHail | null; climate: NinoClimate | null; now: number }) {
  const rows: Array<{ name: string; what: string; source: LiveSource<unknown> | null }> = [
    { name: "Alertas y avisos", what: "Alertas por zona y avisos a muy corto plazo para tormentas, granizo y ráfagas.", source: live?.alertas ?? null },
    { name: "Estado del tiempo", what: "Lo que informa el SMN para Posadas cada hora.", source: live?.smn_ahora ?? null },
    { name: "Aeropuerto", what: "Parte meteorológico (METAR): tormenta, truenos y granizo.", source: live?.metar ?? null },
    { name: "Lluvia medida", what: "Milímetros de la estación Posadas Aero, cada 6 horas.", source: live?.lluvia ?? null },
    { name: "Rayos", what: "Detector de rayos del satélite GOES-19, archivos cada 20 segundos.", source: live?.rayos ?? null },
    { name: "Río Paraná", what: "Altura en el puerto de Posadas.", source: live?.rio ?? null },
  ];
  const wrf = snapshot?.wrf_smn;
  const statics: Array<{ name: string; what: string; ok: boolean; when: string }> = [
    { name: "Pronóstico por escenarios", what: "Seis modelos internacionales (ECMWF, NOAA GFS, DWD ICON, JMA, GEM y BOM) vía Open-Meteo, cada 6 horas.", ok: !!snapshot, when: snapshot ? `Emitido ${ninoDate(snapshot.generated_at)}` : STATUS.sin_datos },
    { name: "Modelo de alta resolución", what: "WRF 4 km del Servicio Meteorológico Nacional, publicado como datos abiertos.", ok: wrf?.estado === "disponible", when: wrf?.estado === "disponible" && wrf.corrida ? `Corrida ${ninoDate(wrf.corrida)}` : STATUS.sin_datos },
    { name: "Ambiente para granizo", what: "Índice SHIP (NOAA) con los modelos GFS, ECMWF e ICON vía Open-Meteo.", ok: hail?.estado === "disponible", when: hail?.estado === "disponible" ? `Calculado ${ninoDate(hail.generated_at)}` : STATUS.sin_datos },
    { name: "Climatología", what: "Registro diario de la estación Posadas Aero; solo años con 90 % de los días informados.", ok: !!climate, when: climate ? `${climate.n_anios} años completos` : STATUS.sin_datos },
    { name: "Anegamientos", what: "Caminos del agua con el relieve Copernicus GLO-30 y los arroyos oficiales; obras de desagüe 2019–2025, de la IDE de la Municipalidad de Posadas.", ok: true, when: "Capa fija" },
    { name: "Mapa", what: "Calles y nombres de OpenStreetMap (OpenFreeMap); arroyos de OpenStreetMap.", ok: true, when: "Base cartográfica" },
  ];
  return <section id="fuentes" className={styles.card} aria-labelledby="fuentes-heading">
    <div className={styles.cardHead}>
      <h2 id="fuentes-heading" className={styles.cardTitle}>De dónde salen los datos</h2>
      <span className={styles.cardMeta}>todo automático</span>
    </div>
    <p className={styles.smallLine}>Fuentes oficiales y datos abiertos, sin reportes de redes ni de vecinos. Si una fuente no responde, lo mostramos.</p>
    <ul className={styles.sourceSummary} aria-label="Estado de cada fuente">
      {rows.map(row => <li key={row.name}><span className={styles.sourceDot} data-state={row.source?.estado ?? "sin_datos"} aria-hidden="true" />{row.name}</li>)}
      {statics.map(row => <li key={row.name}><span className={styles.sourceDot} data-state={row.ok ? "ok" : "sin_datos"} aria-hidden="true" />{row.name}</li>)}
    </ul>
    <details className={styles.details}><summary>Ver cada fuente, cuándo se actualizó y los enlaces</summary>
    <ul className={styles.sources}>
      {rows.map(row => <li key={row.name}>
        <p className={styles.sourceName}><span className={styles.sourceDot} data-state={row.source?.estado ?? "sin_datos"} aria-hidden="true" />{row.name}<span className={styles.sourceState}>{STATUS[row.source?.estado ?? "sin_datos"]}{row.source?.actualizado ? ` · ${agoText(row.source.actualizado, now)}` : ""}</span></p>
        <p className={styles.sourceWhat}>{row.what} {row.source ? <a href={row.source.url} target="_blank" rel="noreferrer">{row.source.fuente} <span aria-hidden="true">↗</span></a> : null}</p>
      </li>)}
      {statics.map(row => <li key={row.name}>
        <p className={styles.sourceName}><span className={styles.sourceDot} data-state={row.ok ? "ok" : "sin_datos"} aria-hidden="true" />{row.name}<span className={styles.sourceState}>{row.when}</span></p>
        <p className={styles.sourceWhat}>{row.what}</p>
      </li>)}
    </ul>
    </details>
    <p className={styles.footnote}>Las alertas del SMN se publican bajo licencia CC BY 4.0. Los reportes de la estación (SYNOP) se leen a través de Ogimet y los partes del aeropuerto (METAR) a través de NOAA Aviation Weather, que los redistribuyen sin cambios. No disponemos de imágenes de radar de acceso automático.</p>
  </section>;
}
