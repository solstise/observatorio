import "server-only";
import { inflateRawSync } from "node:zlib";
import { cached, fetchBytes, fetchText, mapLimit, type Cached } from "./cache.server";
import { loadLightning } from "./glm.server";
import {
  capLinks, isCapFeed, parseCap, parseMetars, parsePrefectura, parseSynop, parseTiepre, selectAlerts, summarizeSynop,
  type SmnAlert,
} from "./parse";
import type { LiveSource, NinoAhora } from "./types";

const SMN_CAP = "https://ssl.smn.gob.ar/CAP/AR.php";
const SMN_TIEPRE = "https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=tiepre";
const OGIMET = "https://www.ogimet.com/cgi-bin/getsynop";
const METAR = "https://aviationweather.gov/api/data/metar?ids=SARP&hours=12&format=json";
const PREFECTURA = "https://contenidosweb.prefecturanaval.gob.ar/alturas/";
const INA_SERIE = "https://alerta.ina.gob.ar/a5/obs/puntual/series/14/observaciones";
const MIN = 60_000;

// Los archivos CAP tienen nombre único por emisión: se leen una sola vez.
const capFiles = new Map<string, SmnAlert | null>();
// El SMN limita los feeds XML a 200 pedidos cada 10 minutos por IP: ante un 429
// se pausa y se conserva el último dato bueno.
let capPauseUntil = 0;
const rateLimited = (error: unknown) => /respondió 429$/.test(error instanceof Error ? error.message : "");
// Regiones del SMN que nunca incluyen a Posadas. Se excluye, no se incluye: si el
// SMN renombra regiones se leen archivos de más, nunca de menos.
const FAR_REGIONS = /_(Patagonia|Cordillera)_/;

async function loadAlerts() {
  if (Date.now() < capPauseUntil) throw new Error("El SMN pidió esperar antes de nuevas consultas");
  let feed: string;
  try {
    feed = await fetchText(SMN_CAP);
  } catch (error) {
    if (rateLimited(error)) capPauseUntil = Date.now() + 10 * MIN;
    throw error;
  }
  if (!isCapFeed(feed)) throw new Error("El listado CAP del SMN cambió de formato");
  const links = capLinks(feed);
  const relevant = links.filter(url => !FAR_REGIONS.test(url));
  const missing = relevant.filter(url => !capFiles.has(url));
  const results = await mapLimit(missing, 4, async url => {
    if (Date.now() < capPauseUntil) throw new Error("pausa por límite del SMN");
    try {
      return [url, parseCap(await fetchText(url, 10_000), url)] as const;
    } catch (error) {
      if (rateLimited(error)) capPauseUntil = Date.now() + 10 * MIN;
      throw error;
    }
  });
  for (const result of results) if (result.status === "fulfilled") capFiles.set(result.value[0], result.value[1]);
  for (const url of capFiles.keys()) if (!links.includes(url)) capFiles.delete(url);
  // Solo se conservan las que tocan Posadas o están a menos de 300 km.
  const alerts = relevant.map(url => capFiles.get(url)).filter((a): a is SmnAlert => !!a && a.distancia_km <= 300);
  // Archivos sin leer: la página no puede afirmar que no hay alertas.
  const pending = relevant.filter(url => !capFiles.has(url)).length;
  return { alerts, total: links.length, pending };
}

async function loadSynop() {
  const end = new Date();
  const begin = new Date(end.getTime() - 8 * 24 * 60 * MIN);
  const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[-T:]/g, "");
  const text = await fetchText(`${OGIMET}?block=87178&begin=${stamp(begin)}&end=${stamp(end)}`, 25_000);
  const reports = parseSynop(text);
  if (!reports.length) throw new Error("Ogimet no devolvió reportes de Posadas Aero");
  return summarizeSynop(reports);
}

async function loadMetarRows() {
  const rows = JSON.parse(await fetchText(METAR, 12_000));
  if (!Array.isArray(rows)) throw new Error("Respuesta METAR inesperada");
  return rows;
}

// El SMN entrega el estado del tiempo en un ZIP con un único archivo de texto.
export function unzipFirst(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP del SMN inválido");
  const central = view.getUint32(eocd + 16, true);
  const method = view.getUint16(central + 10, true);
  const size = view.getUint32(central + 20, true);
  const local = view.getUint32(central + 42, true);
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const data = zip.subarray(start, start + size);
  return method === 8 ? new Uint8Array(inflateRawSync(data)) : data;
}

async function loadSmnNow() {
  const text = new TextDecoder("latin1").decode(unzipFirst(await fetchBytes(SMN_TIEPRE)));
  const now = parseTiepre(text);
  if (!now) throw new Error("El SMN no informó el estado del tiempo de Posadas");
  return now;
}

async function loadRiver() {
  const reading = parsePrefectura(await fetchText(PREFECTURA, 20_000));
  if (!reading) throw new Error("Prefectura no publicó la altura de Posadas");
  return reading;
}

async function loadRiverHistory() {
  const end = new Date(), start = new Date(end.getTime() - 30 * 24 * 60 * MIN);
  const rows = JSON.parse(await fetchText(`${INA_SERIE}?timestart=${start.toISOString().slice(0, 10)}&timeend=${end.toISOString().slice(0, 10)}`, 20_000));
  if (!Array.isArray(rows)) throw new Error("Respuesta inesperada del INA");
  return rows
    .filter((r: { timestart?: string; valor?: number }) => r.timestart && Number.isFinite(r.valor))
    .map((r: { timestart: string; valor: number }) => ({ fecha: r.timestart, altura_m: r.valor }))
    .sort((a: { fecha: string }, b: { fecha: string }) => a.fecha.localeCompare(b.fecha));
}

function source<T, R>(result: Cached<T>, fuente: string, url: string, maxAgeMs: number, transform: (value: T) => R): LiveSource<R> {
  const age = result.updatedAt ? Date.now() - Date.parse(result.updatedAt) : Infinity;
  return {
    estado: result.value === null ? "sin_datos" : age > maxAgeMs ? "desactualizado" : "ok",
    datos: result.value === null ? null : transform(result.value),
    actualizado: result.updatedAt,
    error: result.error,
    fuente,
    url,
  };
}

export async function getNinoAhora(waitMs = 2500, rayosKm = 30): Promise<NinoAhora> {
  const [alerts, synop, metar, smnNow, lightning, river, history] = await Promise.all([
    cached("smn-cap", 3 * MIN, loadAlerts, waitMs),
    cached("synop", 15 * MIN, loadSynop, waitMs),
    cached("metar", 5 * MIN, loadMetarRows, waitMs),
    cached("tiepre", 10 * MIN, loadSmnNow, waitMs),
    cached(`glm-${rayosKm}`, 3 * MIN, () => loadLightning(rayosKm), waitMs),
    cached("prefectura", 60 * MIN, loadRiver, waitMs),
    cached("ina-14", 6 * 60 * MIN, loadRiverHistory, waitMs),
  ]);
  const now = Date.now();
  return {
    generado: new Date(now).toISOString(),
    alertas: source(alerts, "Servicio Meteorológico Nacional (CAP, CC BY 4.0)", "https://www.smn.gob.ar/alertas", 30 * MIN, value => ({ ...selectAlerts(value.alerts, now), total_pais: value.total, pendientes: value.pending })),
    metar: source(metar, "SMN · METAR del aeropuerto de Posadas (vía NOAA Aviation Weather)", "https://aviationweather.gov/data/metar/?id=SARP", 2 * 60 * MIN, rows => parseMetars(rows, now)),
    smn_ahora: source(smnNow, "Servicio Meteorológico Nacional (datos abiertos)", "https://www.smn.gob.ar/", 3 * 60 * MIN, value => value),
    lluvia: source(synop, "SMN · estación Posadas Aero (SYNOP 87178 vía Ogimet)", "https://www.ogimet.com/cgi-bin/gsynres?ind=87178", 12 * 60 * MIN, value => value),
    rayos: source(lightning, "NOAA · satélite GOES-19, detector de rayos GLM", "https://www.goes-r.gov/spacesegment/glm.html", 20 * MIN, value => value),
    rio: source(river, "Prefectura Naval Argentina · historial: INA", PREFECTURA, 36 * 60 * MIN, value => ({ ...value, historial: history.value ?? [] })),
  };
}
