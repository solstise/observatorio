"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Feature, FeatureCollection } from "geojson";
import type { NinoClimate, NinoConfig, NinoEvent, NinoHail as Hail, NinoHydro, NinoObservedDay, NinoSnapshot } from "@/lib/nino-types";
import type { NinoAhora } from "@/lib/nino-live/types";
import { insidePolygon } from "@/lib/nino-live/parse";
import { type Amc, amcFromAntecedent, barrioRunoff } from "@/lib/nino-escurrimiento";
import { IMPACT_LABEL, LIGHTNING_COLORS, heroState, formatNinoNumber as num } from "@/lib/nino-presentation";
import type { MapLayerKey } from "./NinoMapGL";
import { NinoNow } from "./NinoNow";
import { NinoLightning } from "./NinoLightning";
import { NinoObserved } from "./NinoObserved";
import { NinoSimulator } from "./NinoSimulator";
import { NinoOutlook } from "./NinoOutlook";
import { NinoHail } from "./NinoHail";
import { NinoBarrios } from "./NinoBarrios";
import { NinoRiver } from "./NinoRiver";
import { NinoSources } from "./NinoSources";
import { NinoIcon } from "./NinoIcons";
import styles from "./nino.module.css";

const NinoMapGL = dynamic(() => import("./NinoMapGL"), { ssr: false, loading: () => <div className={styles.mapLoading}>Cargando el mapa de Posadas…</div> });
const REFRESH_MS = 3 * 60_000;
const LAYERS: Array<{ key: MapLayerKey; label: string }> = [
  { key: "agua", label: "Arroyos y zonas bajas" },
  { key: "escurrimiento", label: "Cuánto escurre" },
  { key: "rayos", label: "Rayos" },
  { key: "lugares", label: "Escuelas y salud" },
];

function eventDate(event: NinoEvent) {
  if (!event.fecha || !/^\d{4}-\d{2}(-\d{2})?$/.test(event.fecha)) return "Fecha del evento sin confirmar";
  return new Date(`${event.fecha.length === 7 ? event.fecha + "-01" : event.fecha}T12:00:00-03:00`).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", month: "long", year: "numeric", ...(event.fecha_precision === "mes" ? {} : { day: "numeric" }),
  });
}

// Barrio que contiene un punto (lat, lon), con los anillos exteriores de cada polígono.
function barrioAt(lat: number, lon: number, barrios: FeatureCollection) {
  const hit = barrios.features.find((f: Feature) => {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    return polys.some(p => insidePolygon({ lat, lon }, p[0].map(([x, y]) => [y, x] as [number, number])));
  });
  return hit ? String(hit.properties?.id) : null;
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
  hail: Hail | null;
  climate: NinoClimate | null;
  hydro: NinoHydro | null;
}

export function NinoDashboard({ snapshot, barrios, zones, facilities, events, record, config, initialLive, hail, climate, hydro }: Props) {
  const [now, setNow] = useState<number | null>(null);
  const [live, setLive] = useState<NinoAhora | null>(initialLive);
  const [loading, setLoading] = useState(!initialLive);
  const [layers, setLayers] = useState<Record<MapLayerKey, boolean>>({ agua: true, escurrimiento: false, rayos: false, lugares: false });
  const [selectedId, setSelectedId] = useState("");
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState<"idle" | "busy" | "fuera" | "error">("idle");
  const rain = snapshot?.lluvia;
  const [simMm, setSimMm] = useState(() => Math.max(5, Math.round(rain?.lluvia_24h ?? 30)));
  const mm5 = live?.lluvia.datos?.totales.find(t => t.horas === 120)?.mm ?? null;
  const todayAmc = amcFromAntecedent(mm5);
  const [amcChoice, setAmcChoice] = useState<Amc | null>(null);
  const simAmc: Amc = amcChoice ?? todayAmc ?? "II";

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
  const rows = snapshot?.barrios ?? [];
  const level = fresh && rain ? rain.nivel : "a_verificar";
  // Antes de hidratar se usa la hora del servidor, igual en ambos lados.
  const clock = now ?? (Date.parse(live?.generado ?? snapshot?.generated_at ?? "") || 0);
  const hero = heroState(live, level, fresh, clock);
  const lightning = live?.rayos.datos;
  const officialAlert = live?.alertas.datos?.posadas[0];
  const runoff = useMemo(() => Object.fromEntries((hydro?.barrios ?? []).map(b => [b.poligono_id, barrioRunoff(b, simMm, simAmc).porcentaje[1]])), [hydro, simMm, simAmc]);
  const selectedRow = rows.find(r => r.poligono_id === selectedId);
  const selectedHydro = hydro?.barrios.find(b => b.poligono_id === selectedId);

  const locate = () => {
    if (!navigator.geolocation) { setLocating("error"); return; }
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude } = position.coords;
      setUserLocation([latitude, longitude]);
      const id = barrioAt(latitude, longitude, barrios);
      if (id) { setSelectedId(id); setLocating("idle"); } else setLocating("fuera");
    }, () => setLocating("error"), { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
  };

  return <div className={`${styles.page} nino-page`}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>Sala de situación El Niño · Posadas</p>
      <h1>Lluvia y tormentas, en vivo</h1>
      <nav className={styles.jumpNav} aria-label="En esta página">
        <a href="#ahora">Ahora</a><a href="#rayos">Rayos</a><a href="#lo-que-llovio">Lo que llovió</a><a href="#simulador">Simulador</a><a href="#mapa">Mapa</a><a href="#lluvia">Pronóstico</a><a href="#granizo">Granizo</a><a href="#rio">Río</a>
      </nav>
    </header>

    <NinoNow live={live} hero={hero} now={clock} climate={climate} loading={loading} />

    <div className={styles.duo}>
      <NinoLightning rayos={live?.rayos} metar={live?.metar.datos} now={clock} />
      <NinoObserved live={live?.lluvia.datos} record={record} climate={climate} config={config} now={clock} threshold24h={rain?.umbrales.atencion?.mm_24h ?? 50} />
    </div>

    <NinoSimulator hydro={hydro} rain={rain} wrf={snapshot?.wrf_smn} alert={officialAlert} mm5days={mm5} todayAmc={todayAmc} amc={simAmc} onAmc={setAmcChoice} mm={simMm} onMm={setSimMm} selectedId={selectedId} onSelect={setSelectedId} />

    <section id="mapa" className={styles.card} aria-labelledby="mapa-heading">
      <div className={styles.cardHead}>
        <h2 id="mapa-heading" className={styles.cardTitle}>Mapa</h2>
        <button type="button" className={styles.locate} onClick={locate} disabled={locating === "busy"}><NinoIcon name="radar" size={18} />{locating === "busy" ? "Buscando…" : "Mi ubicación"}</button>
      </div>
      {locating === "fuera" && <p className={styles.smallLine}>Tu ubicación está fuera de los barrios que analizamos.</p>}
      {locating === "error" && <p className={styles.smallLine}>No pudimos acceder a tu ubicación. Elegí tu barrio en la lista.</p>}
      <div className={styles.filters} role="group" aria-label="Qué mostrar en el mapa">
        {LAYERS.map(layer => <button key={layer.key} type="button" className={styles.filter} data-layer={layer.key} aria-pressed={layers[layer.key]} onClick={() => setLayers(current => ({ ...current, [layer.key]: !current[layer.key] }))}>{layer.label}</button>)}
      </div>
      <div className={styles.mapWrap}>
        <NinoMapGL barrios={barrios} zones={zones} facilities={facilities} lightning={lightning?.puntos ?? []} runoff={runoff} layers={layers} selectedId={selectedId} userLocation={userLocation} onSelect={setSelectedId} />
      </div>
      <div className={styles.mapLegend}>
        {layers.agua && <span><i className={styles.legendFlow} />Arroyos: el agua se mueve en el sentido de la corriente</span>}
        {layers.agua && <span><i style={{ background: "#3a9bd1", opacity: 0.45 }} />Zonas bajas o cerca de arroyos</span>}
        {layers.escurrimiento && <span><i className={styles.legendRamp} />Escurre con {simMm} mm: poco → mucho</span>}
        {layers.rayos && <span>Rayos hace: {LIGHTNING_COLORS.map(([limit, color], index) => <span key={limit} className={styles.legendInline}><i className={styles.legendDot} style={{ background: color }} />{index === 0 ? `0–${limit}` : `${LIGHTNING_COLORS[index - 1][0]}–${limit}`} min</span>)} · anillos de 15 y 30 km</span>}
        {layers.lugares && <span><i className={styles.legendDot} style={{ background: "#6d4c9f" }} />Escuelas y salud (no son refugios oficiales)</span>}
      </div>
      {selectedId && (selectedRow || selectedHydro) && <div className={styles.barrioCard}>
        <p className={styles.bigLine}>{selectedRow?.nombre ?? selectedHydro?.nombre}</p>
        <ul>
          {selectedRow?.estado === "calculado" && <li><strong>{num(selectedRow.viviendas_expuestas)}</strong> de {num(selectedRow.edificios_total)} edificios en zonas bajas o cerca de arroyos</li>}
          {selectedHydro && <li>Con {simMm} mm, escurren <strong>{barrioRunoff(selectedHydro, simMm, simAmc).porcentaje.join(" a ")}</strong> de cada 100 litros</li>}
          {selectedRow && fresh && selectedRow.score_anegamiento != null && <li>Impacto estimado con la lluvia prevista: <strong>{IMPACT_LABEL[selectedRow.nivel]}</strong></li>}
        </ul>
        <Link href={`/poligono/${selectedId}`} className={styles.textLink}>Ver todo sobre el barrio</Link>
      </div>}
      {!zones.features.length && <p className={styles.notice}>No está disponible la capa de zonas bajas. Su ausencia no significa ausencia de riesgo.</p>}
    </section>

    <div className={styles.duo}>
      <NinoOutlook rain={rain} wrf={snapshot?.wrf_smn} hail={hail} fresh={fresh} now={clock} officialAlert={officialAlert} issuedAt={snapshot?.generated_at ?? ""} />
      <NinoHail hail={hail} alert={officialAlert} hailSeen={live?.metar.datos?.granizo_12h ?? []} now={clock} />
    </div>

    <NinoBarrios rows={rows} fresh={fresh} onLocate={id => { setSelectedId(id); document.getElementById("mapa")?.scrollIntoView({ behavior: "smooth" }); }} />
    <NinoRiver river={live?.rio} now={clock} />

    <section className={styles.card} aria-labelledby="mas-heading">
      <div className={styles.cardHead}><h2 id="mas-heading" className={styles.cardTitle}>Más información</h2></div>
      <details className={styles.details}><summary>Escuelas, salud y otros lugares ({facilities.features.length})</summary><div className={styles.detailsBody}><p>Lugares registrados en OpenStreetMap. Su disponibilidad debe confirmarse: <strong>no están identificados como refugios oficiales.</strong></p><ul className="mt-4 grid gap-3 sm:grid-cols-2">{facilities.features.map((feature, index) => <li key={index}>{String(feature.properties?.nombre ?? "Sin nombre")} · {String(feature.properties?.tipo ?? "Tipo sin confirmar")}</li>)}</ul></div></details>
      <details className={styles.details}><summary>Qué pasó en otras tormentas</summary><div className={styles.detailsBody}><p>Notas de medios locales sobre anegamientos. Sirven como contexto, no describen lo que va a pasar ahora.</p>
        <ol className={styles.eventList}>{events.map((event, index) => <li key={index}><p className="font-semibold">{eventDate(event)}{event.fecha_precision === "mes" ? " · día sin confirmar" : ""}</p><p>{event.zonas_texto}{event.mm_reportados ? ` · ${event.mm_reportados} mm` : ""}{event.duracion ? ` en ${event.duracion}` : ""}</p>{/pendientes de verificación/.test(event.notas) && <p className={styles.muted}>Falta confirmar la fecha y el contenido de este registro.</p>}<a href={event.fuente_url} target="_blank" rel="noreferrer">Leer la nota en {event.fuente_medio} <span aria-hidden="true">↗</span></a></li>)}</ol>
      </div></details>
      <details className={styles.details}><summary>Descargar los datos</summary><div className={styles.detailsBody}>
        <ul className={styles.downloads}>{[["barrios.csv", "Barrios · CSV"], ["lluvia_observada_diaria.csv", "Lluvia medida por día · CSV"], ["escurrimiento_barrios.json", "Escurrimiento por barrio · JSON"], ["granizo.json", "Ambiente para granizo · JSON"], ["exposicion_hidrica.kml", "Zonas bajas · KML"], ["exposicion_hidrica.geojson", "Zonas bajas · GeoJSON"], ["arroyos_nino.geojson", "Arroyos · GeoJSON"], ["eventos_anegamiento.csv", "Antecedentes · CSV"]].map(([file, label]) => <li key={file}><a download className={styles.secondaryButton} href={`/data/nino/${file}`}>{label}</a></li>)}</ul>
        <p>Los datos en vivo están en <a className="underline" href="/api/nino/ahora">/api/nino/ahora</a> (JSON). <Link className="underline" href="/datos/metodologia#anegamiento-v2">Metodología completa</Link>.</p>
      </div></details>
    </section>

    <NinoSources live={live} snapshot={snapshot} hail={hail} climate={climate} now={clock} />

    <p className={styles.technicalNote}>Este observatorio no emite alertas: las oficiales son las del SMN. Las estimaciones indican rangos y no reemplazan las indicaciones de Defensa Civil. El nombre “El Niño” identifica la herramienta y no confirma que ese fenómeno esté activo. <Link className="underline" href="/datos/metodologia#anegamiento-v2">Cómo se calcula y qué límites tiene</Link>.</p>

    <aside className={styles.official} aria-label="Canales oficiales"><div><p className="font-semibold">Emergencias: Defensa Civil</p><a className="inline-block py-1" href="https://www.smn.gob.ar/alertas" target="_blank" rel="noreferrer">Alertas del SMN ↗</a></div><a href="tel:103" aria-label="Llamar 103" className={styles.phone} title="Ante una emergencia, comunicate con Defensa Civil al 103"><NinoIcon name="phone" size={18} /><span>Llamar 103</span></a></aside>
  </div>;
}
