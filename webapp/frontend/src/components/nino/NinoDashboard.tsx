"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FeatureCollection } from "geojson";
import { DataFreshness } from "@/components/DataFreshness";
import { ForecastSafety } from "@/components/ForecastSafety";
import { NIVEL, type NinoSnapshot, type NinoRow, type NinoEvent } from "@/lib/nino-types";

const NinoMap = dynamic(() => import("./NinoMap"), { ssr: false, loading: () => <p className="p-8">Cargando mapa…</p> });
const num = (v: number | null | undefined) => v == null ? "A verificar" : v.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const date = (t: string) => new Date(t).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).replace(/\s/g, " ");

export function NinoDashboard({ snapshot, barrios, zones, facilities, events }: { snapshot: NinoSnapshot | null; barrios: FeatureCollection; zones: FeatureCollection; facilities: FeatureCollection; events: NinoEvent[] }) {
  const [now, setNow] = useState<number | null>(null);
  const [sort, setSort] = useState<keyof NinoRow>("score_anegamiento");
  const [ascending, setAscending] = useState(false);
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
  const ts = Date.parse(snapshot?.generated_at ?? "");
  const fresh = now !== null && Number.isFinite(ts) && now - ts <= 86_400_000 && ts - now <= 300_000;
  const rain = snapshot?.lluvia;
  const rows = [...(snapshot?.barrios ?? [])].sort((a, b) => {
    const av = a[sort], bv = b[sort];
    if (av == null) return 1; if (bv == null) return -1;
    const diff = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "es");
    return ascending ? diff : -diff;
  });
  const chart = rain?.horas.map(h => ({ ...h, banda: [h.p10, h.p90] }));
  function order(key: keyof NinoRow) { if (key === sort) setAscending(!ascending); else { setSort(key); setAscending(key === "nombre"); } }
  const heads: Array<[keyof NinoRow, string]> = [["nombre", "Barrio"], ["viviendas_expuestas", "Viviendas expuestas*"], ["poblacion_expuesta_estimada", "Población estimada"], ["lluvia_max_1h", "Máx. 1 h"], ["score_anegamiento", "Impacto /100"], ["nivel", "Nivel"]];
  return <div className="space-y-10 pb-28">
    <ForecastSafety generatedAt={snapshot?.generated_at ?? ""} />
    <header className="border-b-2 border-primary-800 pb-8 dark:border-primary-300">
      <p className="text-sm font-semibold uppercase tracking-widest text-primary-700 dark:text-primary-300">Posadas · Lluvia y exposición · Próximas 72 horas</p>
      <h1 className="mt-3 text-3xl font-bold sm:text-5xl">Sala de situación El Niño</h1>
      <div className="mt-6 flex flex-wrap items-center gap-4"><strong className={`rounded-md px-4 py-2 text-xl ${fresh && rain?.nivel === "muy_alto" ? "bg-red-900 text-white" : fresh && rain?.nivel === "alto" ? "bg-orange-800 text-white" : "bg-stone-200 text-stone-900"}`}>{fresh && rain ? NIVEL[rain.nivel] : "Datos a verificar"}</strong><DataFreshness dataset="forecast" lastUpdated={snapshot?.generated_at ?? ""} frequency="6h" /></div>
      <p className="mt-4 text-lg">{fresh && rain ? rain.lluvia_max_1h > 0 ? `Mayor intensidad estimada: ${date(rain.ventana_inicio)} a ${date(rain.ventana_fin)}. Hasta ${num(rain.lluvia_max_1h)} mm/h (mediana).` : "La mediana del ensemble no prevé lluvia en las próximas 72 h." : "No hay un pronóstico vigente confirmado para informar el nivel actual."}</p>
      <p className="mt-2 text-sm text-neutral-muted dark:text-dk-muted">Herramienta experimental. El nombre de esta sala no confirma una fase ENSO activa. <Link className="underline" href="/datos/metodologia#anegamiento-v2">Ver método y limitaciones</Link>.</p>
    </header>

    <section aria-labelledby="lluvia-heading"><h2 id="lluvia-heading" className="text-2xl font-semibold">Lluvia hora por hora</h2>
      <p className="my-3 text-sm">Una celda meteorológica para toda Posadas. Mediana y banda P10–P90; cada hora indica el final del intervalo de lluvia. {fresh ? "" : "Serie archivada: no usar para decisiones."}</p>
      {chart?.length ? <div className="h-80 w-full" role="img" aria-label="Lluvia horaria en milímetros, mediana y banda del ensemble, umbrales de 20, 40 y 70 mm por hora"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} margin={{ top: 20, right: 25, left: 0, bottom: 20 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="time" minTickGap={70} tickFormatter={t => date(t)} tick={{ fontSize: 10 }} /><YAxis unit=" mm" domain={[0, (max: number) => Math.max(75, max)]} tick={{ fontSize: 11 }} /><Tooltip labelFormatter={t => date(String(t))} /><Area dataKey="banda" name="P10–P90 (mm)" stroke="none" fill="#7dd3fc" fillOpacity={.4} /><Line dataKey="p50" name="Mediana (mm)" dot={false} stroke="#0369a1" strokeWidth={2} isAnimationActive={false} />{Object.entries(rain!.umbrales).map(([level, t]) => <ReferenceLine key={level} y={t.mm_1h} stroke={level === "muy_alto" ? "#991b1b" : "#b45309"} strokeDasharray="6 4" label={{ value: `${NIVEL[level as keyof typeof NIVEL]} ${t.mm_1h}`, fontSize: 10, position: "insideTopRight" }} />)}</ComposedChart></ResponsiveContainer></div> : <p>Serie horaria a verificar.</p>}
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">{[["Máximo 1 h", rain?.lluvia_max_1h], ["Máximo móvil 3 h", rain?.lluvia_max_3h], ["Máximo móvil 24 h", rain?.lluvia_24h], ["Máximo móvil 48 h", rain?.lluvia_48h]].map(([label, v]) => <div key={String(label)} className="border-l-2 border-sky-700 pl-3"><dt className="text-sm">{String(label)}</dt><dd className="text-2xl font-semibold">{fresh ? num(v as number) : "—"}<span className="text-sm"> mm</span></dd></div>)}</dl>
      <p className="mt-4 text-sm">Probabilidad de superar al menos un umbral en las 72 h ({rain?.n_miembros ?? "—"} miembros válidos): {fresh && rain ? Object.entries(rain.probabilidades).map(([level, v]) => `${NIVEL[level as keyof typeof NIVEL]}: ${num(v)} %`).join(" · ") : "a verificar"}. Frecuencia de miembros, sin calibración probabilística local.</p>
    </section>

    <section><h2 className="mb-3 text-2xl font-semibold">Dónde se concentra la exposición</h2><p className="mb-3 text-sm">Azul: exposición estática estimada. Barrios: verde sin umbral, ámbar atención, naranja alto, rojo muy alto; gris sin pronóstico vigente o sin cálculo.</p><div className="overflow-hidden rounded-lg border border-neutral-border"><NinoMap barrios={barrios} zones={zones} facilities={facilities} rows={rows} fresh={fresh} /></div>{!zones.features.length && <p className="mt-3 text-amber-800 dark:text-amber-300">Capa de exposición a verificar: no interpretar su ausencia como ausencia de riesgo.</p>}</section>

    <section><h2 className="text-2xl font-semibold">Impacto esperado por barrio</h2><p className="my-3 text-sm">Orden inicial por impacto. Tocá un encabezado para ordenar. *Footprints como aproximación de viviendas; población WorldPop 2020, banda orientativa ±20%.</p>
      <div className="max-h-[40rem] overflow-auto rounded-lg border border-neutral-border"><table className="w-full min-w-[690px] text-left text-sm"><caption className="sr-only">Barrios por impacto esperado; columnas ordenables</caption><thead className="sticky top-0 z-10 bg-stone-100 text-stone-900"><tr>{heads.map(([key, label]) => <th key={key} aria-sort={sort === key ? ascending ? "ascending" : "descending" : "none"}><button className="min-h-12 w-full p-3 text-left font-semibold focus-visible:outline focus-visible:outline-2" onClick={() => order(key)}>{label}{sort === key ? ascending ? " ↑" : " ↓" : " ↕"}</button></th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.poligono_id} className="border-t border-neutral-border"><th scope="row" className="p-3 font-medium"><Link className="underline" href={`/poligono/${r.poligono_id}`}>{r.nombre}</Link></th><td className="p-3">{r.estado === "calculado" ? num(r.viviendas_expuestas) : "A verificar"}<small className="block">{num(r.viviendas_muy_expuestas)} muy expuestas</small></td><td className="p-3">{num(r.poblacion_expuesta_estimada)}<small className="block">{r.poblacion_expuesta_estimada == null ? "WorldPop incompleto: a verificar" : num(r.poblacion_expuesta_min) + "–" + num(r.poblacion_expuesta_max)}</small></td><td className="p-3">{fresh ? `${num(r.lluvia_max_1h)} mm` : "A verificar"}</td><td className="p-3">{fresh ? num(r.score_anegamiento) : "—"}</td><td className="p-3">{fresh ? NIVEL[r.nivel] : "A verificar"}</td></tr>)}</tbody></table></div>{!rows.length && <p className="mt-3">Exposición pendiente de cálculo; no hay base para estimar impacto por barrio.</p>}
      <p className="mt-2 text-xs">Exposición calculada: {snapshot?.exposicion_generated_at ? date(snapshot.exposicion_generated_at) : "a verificar"}. La exposición no significa que una vivienda vaya a inundarse. <a className="underline" href="/data/nino/anegamiento_v1.csv" download>Comparar con anegamiento_v1 (snapshot previo, no vigente)</a>.</p>
    </section>

    <section><h2 className="text-2xl font-semibold">Equipamientos de referencia</h2><p className="my-3 font-medium">Equipamiento cercano — no es un refugio oficial.</p><p className="mb-3 text-sm">Escuelas, centros de salud, espacios deportivos y CAV registrados en OSM. Activá la capa en el mapa. Cobertura y disponibilidad a verificar.</p><details><summary className="min-h-11 cursor-pointer py-2">Ver {facilities.features.length} equipamientos</summary><ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{facilities.features.map((f, i) => <li key={i}>{String(f.properties?.nombre ?? "Sin nombre")} · {String(f.properties?.tipo ?? "A verificar")}</li>)}</ul></details></section>

    <section><h2 className="mb-5 text-2xl font-semibold">Registro de anegamientos</h2><ol className="space-y-6 border-l-2 border-sky-700 pl-5">{events.map((e, i) => <li key={i}><p className="text-sm font-semibold">{e.fecha || "Fecha a verificar"} · {e.fecha_precision === "mes" ? "precisión mensual" : "precisión a verificar"}</p><p className="mt-1">{e.zonas_texto}{e.mm_reportados ? ` · ${e.mm_reportados} mm` : ""}{e.duracion ? ` en ${e.duracion}` : ""}</p><p className="my-1 text-sm text-neutral-muted dark:text-dk-muted">{e.notas}</p><a className="text-sm underline" href={e.fuente_url} target="_blank" rel="noreferrer">Fuente: {e.fuente_medio}</a></li>)}</ol></section>

    <aside className="fixed bottom-3 left-3 right-3 z-[1000] rounded-lg border-2 border-primary-800 bg-white p-4 text-stone-900 shadow-lg sm:left-auto sm:right-6 sm:w-[440px]" aria-label="Canales oficiales"><p className="font-semibold">Este observatorio no emite alertas oficiales. Ante una emergencia, comunicate con el <a href="tel:103" className="underline">103</a>.</p><p className="mt-1 text-sm">Defensa Civil · <a href="https://www.smn.gob.ar/alertas" className="underline" target="_blank" rel="noreferrer">Alertas oficiales del SMN</a></p></aside>

    <section><h2 className="mb-3 text-2xl font-semibold">Descargas abiertas</h2><ul className="flex flex-wrap gap-4 text-sm">{[["exposicion_hidrica.geojson", "Exposición GeoJSON"], ["exposicion_hidrica.kml", "Exposición KML"], ["barrios.csv", "Tabla CSV"], ["eventos_anegamiento.csv", "Eventos CSV"]].filter(([file]) => file === "eventos_anegamiento.csv" || (file === "barrios.csv" ? rows.length > 0 : zones.features.length > 0)).map(([file, label]) => <li key={file}><a download className="inline-block rounded border border-current px-4 py-3 underline" href={`/data/nino/${file}`}>{label}</a></li>)}</ul></section>
  </div>;
}
