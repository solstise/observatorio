"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import { DataFreshness } from "@/components/DataFreshness";
import { ForecastSafety } from "@/components/ForecastSafety";
import type { NinoSnapshot, NinoEvent } from "@/lib/nino-types";
import { IMPACT_LABEL, RAIN_COPY, formatRain, ninoDate } from "@/lib/nino-presentation";
import { NinoRainChart } from "./NinoRainChart";
import { NinoBarrios } from "./NinoBarrios";
import styles from "./nino.module.css";

const NinoMap = dynamic(() => import("./NinoMap"), { ssr: false, loading: () => <p className="p-8">Cargando el mapa de Posadas…</p> });

function eventDate(event: NinoEvent) {
  if (!event.fecha || !/^\d{4}-\d{2}(-\d{2})?$/.test(event.fecha)) return "Fecha del evento sin confirmar";
  return new Date(`${event.fecha.length === 7 ? event.fecha + "-01" : event.fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", month: "long", year: "numeric", ...(event.fecha_precision === "mes" ? {} : { day: "numeric" }),
  });
}

export function NinoDashboard({ snapshot, barrios, zones, facilities, events }: { snapshot: NinoSnapshot | null; barrios: FeatureCollection; zones: FeatureCollection; facilities: FeatureCollection; events: NinoEvent[] }) {
  const [now, setNow] = useState<number | null>(null);
  const [mapMode, setMapMode] = useState<"exposicion" | "impacto">("exposicion");
  const [selectedId, setSelectedId] = useState("");
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const timestamp = Date.parse(snapshot?.generated_at ?? "");
  const fresh = now !== null && Number.isFinite(timestamp) && now - timestamp <= 86_400_000 && timestamp - now <= 300_000;
  const rain = snapshot?.lluvia;
  const rows = snapshot?.barrios ?? [];
  const level = fresh && rain ? rain.nivel : "a_verificar";
  const status = RAIN_COPY[level];
  const sortedBarrios = [...rows].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return <div className={`${styles.page} nino-page`}>
    <ForecastSafety generatedAt={snapshot?.generated_at ?? ""} />
    <header className={styles.header}>
      <p className={styles.eyebrow}>Posadas · Próximas 72 horas</p>
      <h1>Sala de situación El Niño</h1>
      <p className={styles.lead}>Cuánta lluvia se espera en Posadas y qué zonas de tu barrio están más expuestas.</p>
      <div className={styles.status} data-level={level}>
        <p className={styles.statusTitle}>{status.title}</p>
        <p className={styles.statusDescription}>{fresh ? status.description : "No tenemos un pronóstico vigente confirmado. Los datos anteriores no permiten informar el nivel actual. Consultá las alertas oficiales del SMN."}</p>
        {fresh && rain && <p className={styles.statusWindow}>{rain.lluvia_max_1h > 0
          ? `La hora con más lluvia prevista: de ${ninoDate(rain.ventana_inicio)} a ${ninoDate(rain.ventana_fin)}. Estimación central: ${formatRain(rain.lluvia_max_1h)} mm en esa hora.`
          : "Previsión central: sin lluvia en las próximas 72 horas. Otros escenarios pueden variar."}</p>}
        <div className={styles.freshness}><DataFreshness dataset="forecast" lastUpdated={snapshot?.generated_at ?? ""} frequency="6h" />{snapshot?.generated_at && <span>Emitido: {ninoDate(snapshot.generated_at)} · Hora de Posadas</span>}</div>
      </div>
      <nav className={styles.jumpNav} aria-label="En esta página"><a href="#lluvia">Ver la lluvia</a><a href="#barrios">Buscar mi barrio</a><a href="#mapa">Entender el mapa</a></nav>
      <p className={styles.technicalNote}>Es una estimación experimental, no una alerta oficial. El nombre “El Niño” no confirma que ese fenómeno esté activo. <Link className="underline" href="/datos/metodologia#anegamiento-v2">Cómo se calcula y qué límites tiene</Link>.</p>
    </header>

    <NinoRainChart rain={rain} fresh={fresh} />
    <NinoBarrios rows={rows} fresh={fresh} onLocate={setSelectedId} />

    <section id="mapa" className={styles.section} aria-labelledby="mapa-heading">
      <p className={styles.eyebrow}>03 · El mapa</p>
      <h2 id="mapa-heading" className={styles.sectionTitle}>Ubicá las zonas y tu barrio</h2>
      <p className={styles.intro}>{mapMode === "exposicion" ? "El azul señala zonas cercanas a cursos de agua o de terreno bajo según el cálculo. Es una característica del lugar: no muestra agua observada ni una inundación en curso." : "El color combina la lluvia prevista con la proporción de edificios expuestos de cada barrio. Un nivel bajo no significa que no pueda haber problemas puntuales."}</p>
      <div className={styles.mapControls}>
        <div className={styles.segmented} role="group" aria-label="Qué muestra el mapa"><button aria-pressed={mapMode === "exposicion"} onClick={() => setMapMode("exposicion")}>Zonas expuestas</button><button aria-pressed={mapMode === "impacto"} onClick={() => setMapMode("impacto")}>Impacto con la lluvia</button></div>
        <div className={styles.mapSelect}><label htmlFor="nino-map-barrio">Acercar a un barrio</label><select id="nino-map-barrio" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">Ver toda Posadas</option>{sortedBarrios.map(row => <option key={row.poligono_id} value={row.poligono_id}>{row.nombre}</option>)}</select></div>
      </div>
      <div className={styles.mapLegend} aria-label="Referencias del mapa">{mapMode === "exposicion" ? <><span><i style={{ background: "#62b2d4" }} />Zona expuesta estimada</span><span><i style={{ background: "transparent", borderColor: "#64748b" }} />Límite del barrio</span></> : <>{[["sin_umbral", "#537e72"], ["atencion", "#b45309"], ["alto", "#c2410c"], ["muy_alto", "#991b1b"], ["a_verificar", "#737373"]].map(([key, color]) => <span key={key}><i style={{ background: color }} />{key === "a_verificar" ? "Sin datos vigentes o suficientes" : IMPACT_LABEL[key as keyof typeof IMPACT_LABEL]}</span>)}</>}</div>
      {!fresh && mapMode === "impacto" && <p className={styles.notice}>Sin pronóstico vigente: los barrios aparecen en gris. Eso no significa que no haya riesgo.</p>}
      <div className={styles.mapWrap}><NinoMap barrios={barrios} zones={zones} facilities={facilities} rows={rows} fresh={fresh} mode={mapMode} selectedId={selectedId} /></div>
      <p className={styles.mapHint}>Tocá un barrio para leer sus datos. En el botón de capas podés mostrar escuelas y centros de salud. Que una zona no esté pintada de azul no garantiza que esté libre de riesgo.</p>
      {!zones.features.length && <p className={styles.notice}>No está disponible la capa de zonas expuestas. Su ausencia no significa ausencia de riesgo.</p>}
      <p className={styles.caption}>Datos del terreno y edificios calculados: {snapshot?.exposicion_generated_at ? ninoDate(snapshot.exposicion_generated_at) : "fecha sin confirmar"}. Se actualizan por separado del pronóstico de lluvia.</p>
    </section>

    <section className={styles.section} aria-labelledby="lugares-heading"><h2 id="lugares-heading" className={styles.sectionTitle}>Escuelas, salud y otros lugares de referencia</h2><p className={styles.intro}>Son lugares registrados en el mapa público OpenStreetMap. Su disponibilidad debe confirmarse: <strong>no están identificados como refugios oficiales.</strong></p>
      <details className={styles.details}><summary>Ver los {facilities.features.length} lugares registrados</summary><div className={styles.detailsBody}><p>Incluye escuelas, centros de salud, espacios deportivos y Centros de Atención al Vecino (CAV). También podés activar estos puntos en el mapa.</p><ul className="mt-4 grid gap-3 sm:grid-cols-2">{facilities.features.map((feature, index) => <li key={index}>{String(feature.properties?.nombre ?? "Sin nombre")} · {String(feature.properties?.tipo ?? "Tipo sin confirmar")}</li>)}</ul></div></details>
    </section>

    <section className={styles.section} aria-labelledby="eventos-heading"><h2 id="eventos-heading" className={styles.sectionTitle}>Qué pasó en otras tormentas</h2><p className={styles.intro}>Antecedentes publicados por medios locales. Sirven como contexto: no describen lo que va a pasar con el pronóstico actual. Cuando una fecha no está confirmada, lo aclaramos.</p>
      <ol className={styles.eventList}>{events.map((event, index) => <li key={index}><p className="font-semibold">{eventDate(event)}{event.fecha_precision === "mes" ? " · día sin confirmar" : ""}</p><p>{event.zonas_texto}{event.mm_reportados ? ` · ${event.mm_reportados} mm` : ""}{event.duracion ? ` en ${event.duracion}` : ""}</p>{/pendientes de verificación/.test(event.notas) && <p className={styles.muted}>Falta confirmar la fecha y el contenido de este registro.</p>}<a href={event.fuente_url} target="_blank" rel="noreferrer">Leer la nota en {event.fuente_medio} <span aria-hidden="true">↗</span></a><details><summary className="cursor-pointer py-2 text-sm">Notas y verificación de la fuente</summary><p className={styles.muted}>{event.notas.replace(/registro semilla/g, "registro inicial")}</p></details></li>)}</ol>
    </section>

    <aside className={styles.official} aria-label="Canales oficiales"><div><p className="font-semibold">Este observatorio no emite alertas oficiales.</p><a className="inline-block py-1" href="https://www.smn.gob.ar/alertas" target="_blank" rel="noreferrer">Alertas del SMN ↗</a></div><a href="tel:103" aria-label="Llamar 103" className={styles.phone} title="Ante una emergencia, comunicate con Defensa Civil al 103"><span className="text-xs font-normal">Defensa Civil</span><span>Llamar 103</span></a></aside>

    <section className={styles.section} aria-labelledby="descargas-heading"><h2 id="descargas-heading" className={styles.sectionTitle}>Descargar los datos</h2><p className={styles.intro}>Para consultar las cifras en una planilla, trabajar con los mapas o revisar las fuentes.</p><ul className={styles.downloads}>{[["barrios.csv", "Barrios · planilla CSV"], ["exposicion_hidrica.kml", "Zonas · mapa KML"], ["exposicion_hidrica.geojson", "Zonas · mapa GeoJSON"], ["eventos_anegamiento.csv", "Antecedentes · planilla CSV"]].filter(([file]) => file === "eventos_anegamiento.csv" || (file === "barrios.csv" ? rows.length > 0 : zones.features.length > 0)).map(([file, label]) => <li key={file}><a download className={styles.secondaryButton} href={`/data/nino/${file}`}>{label}</a></li>)}</ul>
      <details className={styles.details}><summary>Información técnica y comparación con el modelo anterior</summary><div className={styles.detailsBody}><p>CSV se abre en una planilla; KML se puede importar a herramientas como Google My Maps; GeoJSON sirve para programas de mapas. Las exportaciones son agregadas, sin edificios individuales.</p><p><a className="underline" href="/data/nino/anegamiento_v1.csv" download>Descargar el cálculo anterior (anegamiento_v1, no vigente)</a>. Usa otra escala; sus puntajes no son directamente comparables con los del modelo actual.</p><Link className="underline" href="/datos/metodologia#anegamiento-v2">Consultar la metodología completa</Link></div></details>
    </section>
  </div>;
}
