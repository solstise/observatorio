"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { NinoConfig, NinoEvent, NinoObservedDay, NinoSnapshot } from "@/lib/nino-types";
import type { NinoAhora } from "@/lib/nino-live/types";
import { IMPACT_LABEL, LIGHTNING_COLORS, heroState, formatNinoNumber as num, ninoDate } from "@/lib/nino-presentation";
import { NinoNow } from "./NinoNow";
import { NinoObserved } from "./NinoObserved";
import { NinoOutlook } from "./NinoOutlook";
import { NinoBarrios } from "./NinoBarrios";
import { NinoRiver } from "./NinoRiver";
import { NinoSources } from "./NinoSources";
import { NinoIcon } from "./NinoIcons";
import styles from "./nino.module.css";

const NinoMap = dynamic(() => import("./NinoMap"), { ssr: false, loading: () => <p className="p-8">Cargando el mapa de Posadas…</p> });
const REFRESH_MS = 3 * 60_000;

function eventDate(event: NinoEvent) {
  if (!event.fecha || !/^\d{4}-\d{2}(-\d{2})?$/.test(event.fecha)) return "Fecha del evento sin confirmar";
  return new Date(`${event.fecha.length === 7 ? event.fecha + "-01" : event.fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", month: "long", year: "numeric", ...(event.fecha_precision === "mes" ? {} : { day: "numeric" }),
  });
}

interface Props {
  snapshot: NinoSnapshot | null;
  barrios: FeatureCollection;
  zones: FeatureCollection;
  facilities: FeatureCollection;
  events: NinoEvent[];
  record: NinoObservedDay[];
  config: NinoConfig;
  initialLive: NinoAhora | null;
}

export function NinoDashboard({ snapshot, barrios, zones, facilities, events, record, config, initialLive }: Props) {
  const [now, setNow] = useState<number | null>(null);
  const [live, setLive] = useState<NinoAhora | null>(initialLive);
  const [loading, setLoading] = useState(!initialLive);
  const [mapMode, setMapMode] = useState<"exposicion" | "impacto">("exposicion");
  const [showLightning, setShowLightning] = useState(true);
  const [selectedId, setSelectedId] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/nino/ahora", { cache: "no-store" });
      if (response.ok) setLive(await response.json());
    } catch {
      // Sin conexión: se conserva el último dato con su hora real.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    // Si el servidor no llegó a traer todo, completar enseguida en el navegador.
    if (!initialLive || Object.values(initialLive).some(source => typeof source === "object" && source?.estado === "sin_datos")) refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(clock); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [initialLive, refresh]);

  const timestamp = Date.parse(snapshot?.generated_at ?? "");
  const fresh = now !== null && Number.isFinite(timestamp) && now - timestamp <= 86_400_000 && timestamp - now <= 300_000;
  const rain = snapshot?.lluvia;
  const rows = snapshot?.barrios ?? [];
  const level = fresh && rain ? rain.nivel : "a_verificar";
  // Antes de hidratar se usa la hora del servidor, igual en ambos lados.
  const clock = now ?? (Date.parse(live?.generado ?? snapshot?.generated_at ?? "") || 0);
  const hero = heroState(live, level, fresh, clock);
  const lightning = live?.rayos.datos;
  const sortedBarrios = [...rows].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return <div className={`${styles.page} nino-page`}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>Sala de situación El Niño · Posadas</p>
      <h1>Lluvia y tormentas, en vivo</h1>
      <p className={styles.lead}>Alertas del SMN, lluvia medida, rayos, río y pronóstico para Posadas. Todo de fuentes oficiales y actualizado solo.</p>
      <nav className={styles.jumpNav} aria-label="En esta página">
        <a href="#ahora">Ahora</a><a href="#lo-que-llovio">Lo que llovió</a><a href="#lluvia">Lo que viene</a><a href="#mapa">Mapa</a><a href="#barrios">Tu barrio</a><a href="#rio">Río</a><a href="#fuentes">Fuentes</a>
      </nav>
    </header>

    <NinoNow live={live} hero={hero} now={clock} config={config} loading={loading} />
    <NinoObserved live={live?.lluvia.datos} record={record} config={config} now={clock} threshold24h={rain?.umbrales.atencion?.mm_24h ?? 50} />
    <NinoOutlook rain={rain} wrf={snapshot?.wrf_smn} fresh={fresh} now={clock} officialAlert={live?.alertas.datos?.posadas[0]} issuedAt={snapshot?.generated_at ?? ""} />

    <section id="mapa" className={styles.section} aria-labelledby="mapa-heading">
      <p className={styles.eyebrow}>Mapa</p>
      <h2 id="mapa-heading" className={styles.sectionTitle}>Rayos, zonas bajas y tu barrio</h2>
      <p className={styles.intro}>{mapMode === "exposicion" ? "El azul señala zonas cercanas a cursos de agua o de terreno bajo según el cálculo. Es una característica del lugar: no muestra agua observada ni una inundación en curso." : "El color combina la lluvia prevista con la proporción de edificios expuestos de cada barrio. Un nivel bajo no significa que no pueda haber problemas puntuales."}</p>
      <div className={styles.mapControls}>
        <div className={styles.segmented} role="group" aria-label="Qué muestra el mapa"><button type="button" aria-pressed={mapMode === "exposicion"} onClick={() => setMapMode("exposicion")}>Zonas expuestas</button><button type="button" aria-pressed={mapMode === "impacto"} onClick={() => setMapMode("impacto")}>Impacto con la lluvia</button></div>
        <label className={styles.toggle}><input type="checkbox" checked={showLightning} onChange={event => setShowLightning(event.target.checked)} /><span>Rayos de la última hora</span></label>
        <div className={styles.mapSelect}><label htmlFor="nino-map-barrio">Acercar a un barrio</label><select id="nino-map-barrio" value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">Ver toda Posadas</option>{sortedBarrios.map(row => <option key={row.poligono_id} value={row.poligono_id}>{row.nombre}</option>)}</select></div>
      </div>
      <div className={styles.mapLegend} aria-label="Referencias del mapa">
        {mapMode === "exposicion" ? <><span><i style={{ background: "#62b2d4" }} />Zona expuesta estimada</span><span><i style={{ background: "transparent", borderColor: "#64748b" }} />Límite del barrio</span></> : <>{[["sin_umbral", "#537e72"], ["atencion", "#b45309"], ["alto", "#c2410c"], ["muy_alto", "#991b1b"], ["a_verificar", "#737373"]].map(([key, color]) => <span key={key}><i style={{ background: color }} />{key === "a_verificar" ? "Sin datos vigentes o suficientes" : IMPACT_LABEL[key as keyof typeof IMPACT_LABEL]}</span>)}</>}
        {showLightning && <span className={styles.legendGroup}><NinoIcon name="bolt" size={16} />Rayos hace: {LIGHTNING_COLORS.map(([limit, color], index) => <span key={limit}><i className={styles.legendDot} style={{ background: color }} />{index === 0 ? `0–${limit}` : `${LIGHTNING_COLORS[index - 1][0]}–${limit}`} min</span>)}</span>}
      </div>
      {!fresh && mapMode === "impacto" && <p className={styles.notice}>Sin pronóstico vigente: los barrios aparecen en gris. Eso no significa que no haya riesgo.</p>}
      <div className={styles.mapWrap}><NinoMap barrios={barrios} zones={zones} facilities={facilities} rows={rows} fresh={fresh} mode={mapMode} selectedId={selectedId} lightning={lightning?.puntos} showLightning={showLightning} /></div>
      <p className={styles.mapHint}>Tocá un barrio para leer sus datos. Con el botón de capas podés mostrar escuelas y centros de salud. Los rayos los detecta un satélite: la ubicación puede variar unos kilómetros. Que una zona no esté pintada no garantiza que esté libre de riesgo.</p>
      {!zones.features.length && <p className={styles.notice}>No está disponible la capa de zonas expuestas. Su ausencia no significa ausencia de riesgo.</p>}
      <p className={styles.caption}>Datos del terreno y edificios calculados: {snapshot?.exposicion_generated_at ? ninoDate(snapshot.exposicion_generated_at) : "fecha sin confirmar"}. Se actualizan por separado del pronóstico de lluvia.</p>
    </section>

    <NinoBarrios rows={rows} fresh={fresh} onLocate={setSelectedId} />
    <NinoRiver river={live?.rio} now={clock} />

    <section className={styles.section} aria-labelledby="lugares-heading"><p className={styles.eyebrow}>Referencias</p><h2 id="lugares-heading" className={styles.sectionTitle}>Escuelas, salud y otros lugares</h2><p className={styles.intro}>Son lugares registrados en el mapa público OpenStreetMap. Su disponibilidad debe confirmarse: <strong>no están identificados como refugios oficiales.</strong></p>
      <details className={styles.details}><summary>Ver los {facilities.features.length} lugares registrados</summary><div className={styles.detailsBody}><p>Incluye escuelas, centros de salud, espacios deportivos y Centros de Atención al Vecino (CAV). También podés activar estos puntos en el mapa.</p><ul className="mt-4 grid gap-3 sm:grid-cols-2">{facilities.features.map((feature, index) => <li key={index}>{String(feature.properties?.nombre ?? "Sin nombre")} · {String(feature.properties?.tipo ?? "Tipo sin confirmar")}</li>)}</ul></div></details>
    </section>

    <section className={styles.section} aria-labelledby="eventos-heading"><p className={styles.eyebrow}>Antecedentes</p><h2 id="eventos-heading" className={styles.sectionTitle}>Qué pasó en otras tormentas</h2><p className={styles.intro}>Notas de medios locales sobre anegamientos. Sirven como contexto: no describen lo que va a pasar ahora. Las lluvias medidas por el SMN están más arriba, en <a className="underline" href="#lo-que-llovio">Lo que ya llovió</a>.</p>
      <ol className={styles.eventList}>{events.map((event, index) => <li key={index}><p className="font-semibold">{eventDate(event)}{event.fecha_precision === "mes" ? " · día sin confirmar" : ""}</p><p>{event.zonas_texto}{event.mm_reportados ? ` · ${event.mm_reportados} mm` : ""}{event.duracion ? ` en ${event.duracion}` : ""}</p>{/pendientes de verificación/.test(event.notas) && <p className={styles.muted}>Falta confirmar la fecha y el contenido de este registro.</p>}<a href={event.fuente_url} target="_blank" rel="noreferrer">Leer la nota en {event.fuente_medio} <span aria-hidden="true">↗</span></a><details><summary className="cursor-pointer py-2 text-sm">Notas y verificación de la fuente</summary><p className={styles.muted}>{event.notas.replace(/registro semilla/g, "registro inicial")}</p></details></li>)}</ol>
    </section>

    <NinoSources live={live} snapshot={snapshot} now={clock} />

    <section className={styles.section} aria-labelledby="descargas-heading"><p className={styles.eyebrow}>Datos abiertos</p><h2 id="descargas-heading" className={styles.sectionTitle}>Descargar los datos</h2><p className={styles.intro}>Para consultar las cifras en una planilla, trabajar con los mapas o revisar las fuentes.</p><ul className={styles.downloads}>{[["barrios.csv", "Barrios · planilla CSV"], ["lluvia_observada_diaria.csv", "Lluvia medida por día · CSV"], ["exposicion_hidrica.kml", "Zonas · mapa KML"], ["exposicion_hidrica.geojson", "Zonas · mapa GeoJSON"], ["eventos_anegamiento.csv", "Antecedentes · planilla CSV"]].filter(([file]) => file === "eventos_anegamiento.csv" || (file === "lluvia_observada_diaria.csv" ? record.length > 0 : file === "barrios.csv" ? rows.length > 0 : zones.features.length > 0)).map(([file, label]) => <li key={file}><a download className={styles.secondaryButton} href={`/data/nino/${file}`}>{label}</a></li>)}</ul>
      <details className={styles.details}><summary>Información técnica y comparación con el modelo anterior</summary><div className={styles.detailsBody}><p>CSV se abre en una planilla; KML se puede importar a herramientas como Google My Maps; GeoJSON sirve para programas de mapas. Las exportaciones son agregadas, sin edificios individuales.</p><p><a className="underline" href="/data/nino/anegamiento_v1.csv" download>Descargar el cálculo anterior (anegamiento_v1, no vigente)</a>. Usa otra escala; sus puntajes no son directamente comparables con los del modelo actual.</p><p>Los datos en vivo están en <a className="underline" href="/api/nino/ahora">/api/nino/ahora</a> (JSON).</p><Link className="underline" href="/datos/metodologia#anegamiento-v2">Consultar la metodología completa</Link></div></details>
    </section>

    <p className={styles.technicalNote}>Este observatorio no emite alertas: las oficiales son las del SMN. El nombre “El Niño” identifica la herramienta y no confirma que ese fenómeno esté activo. <Link className="underline" href="/datos/metodologia#anegamiento-v2">Cómo se calcula y qué límites tiene</Link>.</p>

    <aside className={styles.official} aria-label="Canales oficiales"><div><p className="font-semibold">Emergencias: Defensa Civil</p><a className="inline-block py-1" href="https://www.smn.gob.ar/alertas" target="_blank" rel="noreferrer">Alertas del SMN ↗</a></div><a href="tel:103" aria-label="Llamar 103" className={styles.phone} title="Ante una emergencia, comunicate con Defensa Civil al 103"><NinoIcon name="phone" size={18} /><span>Llamar 103</span></a></aside>
  </div>;
}
