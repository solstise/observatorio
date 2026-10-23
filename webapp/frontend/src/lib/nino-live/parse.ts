// Lectura de fuentes oficiales en vivo para /nino. Funciones puras, sin imports:
// se prueban con `node --test` y se usan tanto en el servidor como en el cliente.

export const POSADAS = { lat: -27.3667, lon: -55.8967 };

export type AlertColor = "roja" | "naranja" | "amarilla" | "informativa";

export interface SmnAlert {
  id: string;
  tipo: "alerta" | "aviso_corto_plazo";
  evento: string;
  titulo: string;
  color: AlertColor;
  inicio: string | null;
  fin: string | null;
  emitido: string | null;
  descripcion: string;
  instrucciones: string[];
  zona: string;
  afecta_posadas: boolean;
  distancia_km: number;
  url: string;
  // Del texto oficial: rango de lluvia acumulada y mención de granizo.
  lluvia_mm: [number, number] | null;
  menciona_granizo: boolean;
}

export interface SynopReport {
  utc: string;
  ww: number | null;
  // Lluvia por período informado, en horas (6 o 24) → mm.
  lluvia: Record<number, number>;
}

export interface RainBlock { desde: string; hasta: string; mm: number | null }

export interface ObservedRain {
  ultimo_reporte: string | null;
  bloques: RainBlock[];
  totales: Array<{ horas: number; desde: string; hasta: string; mm: number; completo: boolean }>;
  dias: Array<{ fecha: string; mm: number | null; parcial: boolean; tormenta: boolean; granizo: boolean }>;
  horas_tormenta_24h: number;
  granizo_24h: boolean;
}

export interface MetarNow {
  hora: string;
  texto: string;
  crudo: string;
  temperatura: number | null;
  viento_kmh: number | null;
  rafaga_kmh: number | null;
  tormenta: boolean;
  granizo: boolean;
  lluvia_fuerte: boolean;
}

export interface MetarSummary {
  ultimo: MetarNow | null;
  tormenta_ultima_hora: boolean;
  // Último parte con tormenta (truenos oídos en el aeropuerto) en las últimas 12 h.
  ultimo_trueno: string | null;
  granizo_12h: string[];
  reportes_tormenta_12h: number;
}

export interface SmnNow {
  hora: string;
  estado: string;
  temperatura: number | null;
  humedad: number | null;
  viento: string;
}

export interface RiverReading {
  altura_m: number;
  variacion_m: number | null;
  tendencia: string;
  fecha: string;
  anterior_m: number | null;
  alerta_m: number | null;
  evacuacion_m: number | null;
}

export interface LightningSummary {
  ultimo_archivo: string | null;
  radio_km: number;
  zona_km: number;
  cerca_15min: number;
  cerca_60min: number;
  zona_60min: number;
  mas_cercano_km: number | null;
  // Rayo más cercano de la zona (aunque esté fuera del radio cercano).
  cercano: { km: number; rumbo: number; hace_min: number } | null;
  tendencia: LightningTrend;
  // [lat, lon, minutos desde el rayo]: compacto para el navegador.
  puntos: Array<[number, number, number]>;
}

export interface LightningTrend {
  // Distancia del rayo más cercano en tramos de 10 minutos, del más viejo al actual.
  tramos: Array<{ hace_min: number; km: number | null }>;
  estado: "se_acerca" | "se_aleja" | "estable" | "sin_datos";
  velocidad_kmh: number | null;
  llegada_min: number | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

const clean = (text: string) => decodeEntities(text.replace(/<!\[CDATA\[|\]\]>/g, "")).replace(/\s+/g, " ").trim();

// El SMN responde RSS a los programas y una página HTML a los navegadores: se aceptan ambos.
export function capLinks(feed: string) {
  const pattern = /(?:href="|<link>\s*|<guid>\s*)(https:\/\/ssl\.smn\.gob\.ar\/feeds\/CAP\/[^"<\s]+\.xml)/g;
  return [...new Set([...feed.matchAll(pattern)].map(m => m[1]))];
}

export const isCapFeed = (feed: string) => /RSS CAP|Servicio Meteorol[oó]gico Nacional/i.test(feed) && /<(rss|html)\b/i.test(feed);

function tag(xml: string, name: string) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? clean(match[1]) : "";
}

export function capColor(severity: string, headline = ""): AlertColor {
  const text = headline.toUpperCase();
  if (/\bROJ[OA]\b/.test(text)) return "roja";
  if (/\bNARANJA\b/.test(text)) return "naranja";
  if (/\bAMARILL[OA]\b/.test(text)) return "amarilla";
  return { Extreme: "roja", Severe: "naranja", Moderate: "amarilla" }[severity] as AlertColor ?? "informativa";
}

export function splitInstructions(text: string) {
  if (!text) return [];
  const numbered = text.split(/\s*\d+\s*-\s+/).map(s => s.trim()).filter(Boolean);
  if (numbered.length > 1) return numbered;
  return text.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/).map(s => s.trim()).filter(Boolean);
}

type Ring = Array<[number, number]>;

export function parsePolygon(text: string): Ring {
  return text.trim().split(/\s+/).map(pair => pair.split(",").map(Number) as [number, number]).filter(p => p.length === 2 && p.every(Number.isFinite));
}

export function insidePolygon(point: { lat: number; lon: number }, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i], [yj, xj] = ring[j];
    if ((yi > point.lat) !== (yj > point.lat) && point.lon < (xj - xi) * (point.lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Distancia del punto al borde del polígono, en una proyección local (válida a escala regional).
export function distanceToRingKm(point: { lat: number; lon: number }, ring: Ring) {
  if (insidePolygon(point, ring)) return 0;
  const kx = 111.32 * Math.cos(point.lat * Math.PI / 180), ky = 110.57;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [aLat, aLon] = ring[i], [bLat, bLon] = ring[(i + 1) % ring.length];
    const ax = (aLon - point.lon) * kx, ay = (aLat - point.lat) * ky;
    const bx = (bLon - point.lon) * kx, by = (bLat - point.lat) * ky;
    const dx = bx - ax, dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export function parseCap(xmlRaw: string, url: string, point = POSADAS): SmnAlert | null {
  const xml = xmlRaw.replace(/<(\/?)cap:/g, "<$1");
  if (/<msgType>\s*Cancel\s*<\/msgType>/.test(xml) || !/<info>/.test(xml)) return null;
  const rings = [...xml.matchAll(/<polygon>([^<]+)<\/polygon>/g)].map(m => parsePolygon(m[1])).filter(r => r.length >= 3);
  if (!rings.length) return null;
  const distance = Math.min(...rings.map(r => distanceToRingKm(point, r)));
  const headline = tag(xml, "headline");
  const sent = tag(xml, "sent") || null;
  const description = tag(xml, "description");
  const range = description.match(/entre\s+(\d+)\s+y\s+(\d+)\s*mm/i);
  return {
    id: tag(xml, "identifier") || url,
    tipo: url.includes("/avisocortoplazo/") ? "aviso_corto_plazo" : "alerta",
    evento: tag(xml, "event"),
    titulo: headline,
    color: capColor(tag(xml, "severity"), headline),
    inicio: tag(xml, "onset") || sent,
    fin: tag(xml, "expires") || null,
    emitido: sent,
    descripcion: description,
    instrucciones: splitInstructions(tag(xml, "instruction")),
    zona: tag(xml, "areaDesc").replace(/\.\s*$/, ""),
    afecta_posadas: distance === 0,
    distancia_km: Math.round(distance),
    url,
    lluvia_mm: range ? [Number(range[1]), Number(range[2])] : null,
    menciona_granizo: /granizo/i.test(`${headline} ${description}`),
  };
}

const COLOR_RANK: Record<AlertColor, number> = { roja: 3, naranja: 2, amarilla: 1, informativa: 0 };

// Alertas vigentes o próximas que tocan Posadas, y avisos cortos cercanos.
export function selectAlerts(alerts: SmnAlert[], now: number, nearKm = 50) {
  const active = alerts.filter(a => !a.fin || Date.parse(a.fin) > now);
  const unique = [...new Map(active.map(a => [a.id, a])).values()];
  const sort = (a: SmnAlert, b: SmnAlert) => COLOR_RANK[b.color] - COLOR_RANK[a.color] || Date.parse(a.inicio ?? "") - Date.parse(b.inicio ?? "");
  return {
    posadas: unique.filter(a => a.afecta_posadas).sort(sort),
    cerca: unique.filter(a => !a.afecta_posadas && a.tipo === "aviso_corto_plazo" && a.distancia_km <= nearKm).sort((a, b) => a.distancia_km - b.distancia_km),
  };
}

export const isActive = (a: SmnAlert, now: number) => (!a.inicio || Date.parse(a.inicio) <= now) && (!a.fin || Date.parse(a.fin) > now);

// --- SYNOP (FM-12) de la estación Posadas Aero ------------------------------------

const rrr = (code: string) => {
  const v = Number(code);
  if (v === 990) return 0;
  return v > 990 ? (v - 990) / 10 : v;
};

export function parseSynop(text: string, station = "87178"): SynopReport[] {
  const out: SynopReport[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().replace(/=$/, "").split(",");
    if (parts.length < 7 || parts[0] !== station) continue;
    const [y, m, d, h] = parts.slice(1, 5).map(Number);
    const groups = parts[6].split(/\s+/);
    if (groups[0] !== "AAXX" || groups.length < 5) continue;
    const body = groups.slice(3);
    // Sección 1 hasta "333"; sección 3 hasta "444" o "555" (la 555 es nacional:
    // su grupo 7 no es lluvia y leerlo así inventaba totales).
    const stop = (list: string[], marks: string[]) => { const i = list.findIndex(g => marks.includes(g)); return i < 0 ? list.length : i; };
    const s3 = body.indexOf("333");
    const s1 = body.slice(0, stop(body, ["333", "444", "555"]));
    const rest = s3 >= 0 ? body.slice(s3 + 1) : [];
    const sec3 = rest.slice(0, stop(rest, ["444", "555"]));
    const lluvia: Record<number, number> = {};
    let ww: number | null = null;
    let next = 1;
    for (const g of s1.slice(2)) {
      if (!/^\d[\d/]{4}$/.test(g) || Number(g[0]) < next) continue;
      next = Number(g[0]) + 1;
      if (g[0] === "6" && /^\d{3}$/.test(g.slice(1, 4)) && "1234".includes(g[4])) lluvia[{ 1: 6, 2: 12, 3: 18, 4: 24 }[Number(g[4]) as 1 | 2 | 3 | 4]] = rrr(g.slice(1, 4));
      if (g[0] === "7" && /^\d{2}$/.test(g.slice(1, 3))) ww = Number(g.slice(1, 3));
    }
    for (const g of sec3) if (/^7\d{4}$/.test(g) && lluvia[24] === undefined) lluvia[24] = g === "79999" ? 0 : Number(g.slice(1)) / 10;
    // iR=3: sin lluvia en el período; el grupo se omite.
    if (s1[0]?.[0] === "3" && h % 6 === 0 && lluvia[6] === undefined && lluvia[24] === undefined) lluvia[h === 12 ? 24 : 6] = 0;
    out.push({ utc: new Date(Date.UTC(y, m - 1, d, h)).toISOString(), ww, lluvia });
  }
  return out.sort((a, b) => a.utc.localeCompare(b.utc));
}

const MAX_BLOQUE_6H = 200;
const WW_TORMENTA = new Set([17, 29, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
const WW_GRANIZO = new Set([27, 87, 88, 89, 90, 93, 94, 96, 99]);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

// Bloques de 6 h: 00, 06 y 18 UTC informan 6 h; a las 12 UTC llega el total de 24 h
// y el bloque de 06 a 12 se obtiene por diferencia, solo si están los otros tres.
export function rainBlocks(reports: SynopReport[]): RainBlock[] {
  const byTime = new Map(reports.map(r => [Date.parse(r.utc), r]));
  const times = reports.map(r => Date.parse(r.utc)).filter(t => new Date(t).getUTCHours() % 6 === 0);
  const blocks: RainBlock[] = [];
  for (const t of times) {
    const r = byTime.get(t)!;
    const hour = new Date(t).getUTCHours();
    let mm: number | null = null;
    if (hour !== 12) mm = r.lluvia[6] ?? null;
    else if (r.lluvia[24] !== undefined) {
      const prev = [18, 12, 6].map(back => byTime.get(t - back * HOUR)?.lluvia[6]);
      if (prev.every(v => v !== undefined)) {
        // Control de calidad: si el total no cuadra con sus partes, el bloque queda sin dato.
        const derived = r.lluvia[24] - prev.reduce((a, b) => a! + b!, 0)!;
        mm = derived < -1 || derived > MAX_BLOQUE_6H ? null : Math.max(0, Math.round(derived * 10) / 10);
      }
    }
    blocks.push({ desde: iso(t - 6 * HOUR), hasta: iso(t), mm });
  }
  return blocks;
}

export function summarizeSynop(reports: SynopReport[], windows = [24, 72, 120, 168]): ObservedRain {
  const blocks = rainBlocks(reports);
  const lastEnd = blocks.length ? Date.parse(blocks[blocks.length - 1].hasta) : null;
  const totales = lastEnd === null ? [] : windows.map(hours => {
    const from = lastEnd - hours * HOUR;
    const inside = blocks.filter(b => Date.parse(b.desde) >= from && Date.parse(b.hasta) <= lastEnd);
    const known = inside.filter(b => b.mm !== null);
    return { horas: hours, desde: iso(from), hasta: iso(lastEnd), mm: Math.round(known.reduce((s, b) => s + b.mm!, 0) * 10) / 10, completo: inside.length === hours / 6 && known.length === inside.length };
  });
  // Día pluviométrico: de 12 a 12 UTC (9 a 9 en Posadas), con fecha del día en que termina.
  const days = new Map<string, { mm: number | null; parcial: boolean; tormenta: boolean; granizo: boolean }>();
  for (const r of reports) {
    const t = Date.parse(r.utc);
    const end = new Date(t + (new Date(t).getUTCHours() <= 12 ? 0 : 24 * HOUR)).toISOString().slice(0, 10);
    const day = days.get(end) ?? { mm: null, parcial: true, tormenta: false, granizo: false };
    if (new Date(t).getUTCHours() === 12 && r.lluvia[24] !== undefined) { day.mm = r.lluvia[24]; day.parcial = false; }
    if (r.ww !== null && WW_TORMENTA.has(r.ww)) day.tormenta = true;
    if (r.ww !== null && WW_GRANIZO.has(r.ww)) day.granizo = true;
    days.set(end, day);
  }
  // El día en curso suma los bloques informados desde las 12 UTC.
  const last = reports.length ? Date.parse(reports[reports.length - 1].utc) : null;
  if (last !== null) {
    const end = new Date(last + (new Date(last).getUTCHours() <= 12 ? 0 : 24 * HOUR)).toISOString().slice(0, 10);
    const current = days.get(end);
    if (current?.parcial) {
      const start = Date.parse(`${end}T12:00:00Z`) - 24 * HOUR;
      const partial = blocks.filter(b => Date.parse(b.desde) >= start && b.mm !== null);
      current.mm = partial.length ? Math.round(partial.reduce((s, b) => s + b.mm!, 0) * 10) / 10 : null;
    }
  }
  const recent = reports.filter(r => last !== null && Date.parse(r.utc) > last - 24 * HOUR);
  return {
    ultimo_reporte: reports.length ? reports[reports.length - 1].utc : null,
    bloques: blocks,
    totales,
    dias: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, v]) => ({ fecha, ...v })),
    horas_tormenta_24h: recent.filter(r => r.ww !== null && WW_TORMENTA.has(r.ww)).length,
    granizo_24h: recent.some(r => r.ww !== null && WW_GRANIZO.has(r.ww)),
  };
}

// --- METAR del aeropuerto (SARP) -------------------------------------------------

const WX_PHENOMENA: Record<string, string> = {
  RA: "lluvia", DZ: "llovizna", GR: "granizo", GS: "granizo pequeño", FG: "niebla",
  BR: "neblina", HZ: "bruma", SQ: "turbonada", FU: "humo",
};

// Códigos de tiempo presente METAR (OACI): intensidad, descriptor y fenómenos.
export function describeWx(wx: string) {
  return wx.split(/\s+/).filter(Boolean).map(token => {
    const m = token.match(/^([+-]|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?([A-Z]*)$/);
    if (!m) return "";
    const [, intensity, descriptor, rest] = m;
    const phenomena = (rest.match(/.{2}/g) ?? []).map(code => WX_PHENOMENA[code]).filter(Boolean);
    const strength = intensity === "+" ? " fuerte" : intensity === "-" ? " débil" : "";
    const precipitation = phenomena.length ? phenomena.join(" y ") + strength : "";
    const near = intensity === "VC" ? " en las cercanías" : "";
    if (descriptor === "TS") return `tormenta${near}${precipitation ? ` con ${precipitation}` : ""}`;
    if (descriptor === "SH") {
      const kind = phenomena.filter(p => p !== "lluvia");
      const plural = intensity === "+" ? " fuertes" : intensity === "-" ? " débiles" : "";
      return `chaparrones${plural}${kind.length ? ` de ${kind.join(" y ")}` : ""}${near}`;
    }
    return precipitation ? precipitation + near : "";
  }).filter(Boolean).join("; ");
}

interface MetarJson { obsTime?: number; reportTime?: string; rawOb?: string; temp?: number; wspd?: number; wgst?: number; wxString?: string }

export function parseMetars(rows: MetarJson[], now: number): MetarSummary {
  const parsed = rows.filter(r => r.rawOb).map(r => {
    const raw = r.rawOb!;
    const wx = r.wxString ?? "";
    const time = r.obsTime ? r.obsTime * 1000 : Date.parse(r.reportTime ?? "");
    const recent = (raw.match(/\bRE([A-Z]{2,6})\b/g) ?? []).join(" ");
    return {
      hora: iso(time),
      texto: describeWx(wx) || (/\bCAVOK\b/.test(raw) ? "despejado" : "sin fenómenos"),
      crudo: raw,
      temperatura: r.temp ?? null,
      viento_kmh: r.wspd != null ? Math.round(r.wspd * 1.852) : null,
      rafaga_kmh: r.wgst != null ? Math.round(r.wgst * 1.852) : null,
      tormenta: /TS/.test(wx) || /RETS/.test(recent),
      granizo: /GR|GS/.test(wx) || /REGR|REGS/.test(recent),
      lluvia_fuerte: /\+(TS|SH)?RA/.test(wx),
    } satisfies MetarNow;
  }).filter(r => Number.isFinite(Date.parse(r.hora))).sort((a, b) => b.hora.localeCompare(a.hora));
  const within = (h: number) => parsed.filter(r => now - Date.parse(r.hora) <= h * HOUR);
  return {
    ultimo: parsed[0] ?? null,
    tormenta_ultima_hora: within(1.1).some(r => r.tormenta),
    ultimo_trueno: within(12).find(r => r.tormenta)?.hora ?? null,
    granizo_12h: within(12).filter(r => r.granizo).map(r => r.hora),
    reportes_tormenta_12h: within(12).filter(r => r.tormenta).length,
  };
}

// --- Estado del tiempo del SMN (datos abiertos, archivo tiepre) -------------------

export function parseTiepre(text: string, station = "Posadas"): SmnNow | null {
  const line = text.split(/\r?\n/).map(l => l.trim()).find(l => l.toLowerCase().startsWith(station.toLowerCase() + ";"));
  if (!line) return null;
  const [, fecha, hora, estado, , temp, , humedad, viento] = line.split(";").map(s => s.trim());
  const num = (s: string) => (s && Number.isFinite(Number(s)) ? Number(s) : null);
  return { hora: `${fecha} ${hora}`, estado, temperatura: num(temp), humedad: num(humedad), viento: viento ?? "" };
}

// --- Prefectura Naval: altura del Paraná ------------------------------------------

const MONTHS: Record<string, number> = { ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, SEP: 8, OCT: 9, NOV: 10, DIC: 11 };

export function prefecturaDate(text: string) {
  const m = text.match(/(\d{1,2})\/([A-Z]{3})\/(\d{2})\s*-\s*(\d{2})(\d{2})/);
  if (!m || MONTHS[m[2]] === undefined) return null;
  // Hora argentina (UTC-3).
  return new Date(Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1]), Number(m[4]) + 3, Number(m[5]))).toISOString();
}

export function parsePrefectura(html: string, port = "POSADAS"): RiverReading | null {
  const rows = html.split(/<tr\b/i);
  const row = rows.find(r => new RegExp(`data-label="Puerto:">\\s*${port}\\s*<`, "i").test(r));
  if (!row) return null;
  const cell = (label: string) => clean((row.match(new RegExp(`data-label="${label}[^"]*"[^>]*>([\\s\\S]*?)</td>`, "i"))?.[1] ?? "").replace(/<[^>]+>/g, " "));
  const num = (s: string) => (s && Number.isFinite(Number(s)) ? Number(s) : null);
  const altura = num(cell("Ultimo Registro"));
  const fecha = prefecturaDate(cell("Fecha Hora"));
  if (altura === null || !fecha) return null;
  return {
    altura_m: altura, variacion_m: num(cell("Variacion")), tendencia: cell("Estado").toLowerCase(), fecha,
    anterior_m: num(cell("Registro Anterior")), alerta_m: num(cell("Alerta")), evacuacion_m: num(cell("Evacuaci")),
  };
}

// --- Resumen de rayos (GOES-19 GLM) ----------------------------------------------

// Los conteos usan todos los rayos; al mapa viajan los más recientes dentro de mapKm.
// Rumbo desde Posadas, en grados (0 = norte, 90 = este).
export function bearingDeg(to: { lat: number; lon: number }, from = POSADAS) {
  const dx = (to.lon - from.lon) * Math.cos(from.lat * Math.PI / 180);
  const dy = to.lat - from.lat;
  return Math.round((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360);
}

const DIRECTIONS = ["norte", "noreste", "este", "sureste", "sur", "suroeste", "oeste", "noroeste"];
export const directionName = (deg: number) => DIRECTIONS[Math.round(deg / 45) % 8];

// Tendencia simple: recta sobre la distancia mínima de los últimos 40 minutos.
// No es un seguimiento de celdas: si hay varias tormentas, sigue a la más cercana.
export function lightningTrend(flashes: Array<{ t: number; km: number }>, now: number): LightningTrend {
  const tramos = [50, 40, 30, 20, 10, 0].map(start => {
    const inBin = flashes.filter(f => now - f.t > start * 60_000 && now - f.t <= (start + 10) * 60_000);
    return { hace_min: start, km: inBin.length ? Math.round(Math.min(...inBin.map(f => f.km))) : null };
  });
  const recent = tramos.slice(-4).filter((b): b is { hace_min: number; km: number } => b.km !== null);
  if (recent.length < 3 || tramos[tramos.length - 1].km === null && tramos[tramos.length - 2].km === null) {
    return { tramos, estado: "sin_datos", velocidad_kmh: null, llegada_min: null };
  }
  const xs = recent.map(b => -b.hace_min), ys = recent.map(b => b.km);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const kmh = Math.round(slope * 60);
  const estado = kmh <= -10 ? "se_acerca" : kmh >= 10 ? "se_aleja" : "estable";
  const last = recent[recent.length - 1].km;
  const llegada = estado === "se_acerca" && last > 5 ? Math.round((last / -kmh) * 60) : null;
  return { tramos, estado, velocidad_kmh: kmh, llegada_min: llegada !== null && llegada <= 180 ? llegada : null };
}

export function summarizeFlashes(flashes: Array<{ t: number; lat: number; lon: number }>, now: number, nearKm: number, lastFile: string | null, zoneKm = 100, maxPoints = 1500): LightningSummary {
  const withDistance = flashes.filter(f => now - f.t <= HOUR).map(f => ({ ...f, km: distanceKm(POSADAS, f) })).filter(f => f.km <= zoneKm);
  const near = withDistance.filter(f => f.km <= nearKm);
  const near15 = near.filter(f => now - f.t <= 15 * 60_000);
  const mapKm = zoneKm;
  const recentZone = withDistance.filter(f => now - f.t <= 15 * 60_000);
  const pool = recentZone.length ? recentZone : withDistance;
  const closest = pool.length ? pool.reduce((a, b) => (b.km < a.km ? b : a)) : null;
  return {
    cercano: closest ? { km: Math.round(closest.km), rumbo: bearingDeg(closest), hace_min: Math.round((now - closest.t) / 60_000) } : null,
    tendencia: lightningTrend(withDistance, now),
    ultimo_archivo: lastFile,
    radio_km: nearKm,
    zona_km: zoneKm,
    cerca_15min: near15.length,
    cerca_60min: near.length,
    zona_60min: withDistance.length,
    mas_cercano_km: near15.length ? Math.round(Math.min(...near15.map(f => f.km))) : null,
    puntos: withDistance.filter(f => f.km <= mapKm).sort((a, b) => b.t - a.t).slice(0, maxPoints)
      .map(f => [Math.round(f.lat * 1000) / 1000, Math.round(f.lon * 1000) / 1000, Math.round((now - f.t) / 60_000)] as [number, number, number]),
  };
}

