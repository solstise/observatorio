import type { HailLevel, NinoHail, NinoLevel } from "./nino-types";
import type { AlertColor, SmnAlert } from "./nino-live/parse";
import type { NinoAhora } from "./nino-live/types";

const TZ = "America/Argentina/Buenos_Aires";

export const formatNinoNumber = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "Sin datos"
    : value.toLocaleString("es-AR", { maximumFractionDigits: 1 });

// Alturas del río: dos decimales, como las publica Prefectura.
export const formatMeters = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "Sin datos"
    : value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// No redondear una cantidad positiva muy pequeña a cero.
export const formatRain =(value: number | null | undefined) =>
  value != null && value > 0 && value < 0.1 ? "menos de 0,1" : formatNinoNumber(value);

export const ninoDate = (time: string) =>
  new Date(time).toLocaleString("es-AR", {
    timeZone: TZ,
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).replace(/\s/g, " ");

export const ninoHour = (time: string) =>
  new Date(time).toLocaleString("es-AR", {
    timeZone: TZ,
    weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).replace(/\s/g, " ");

export const clockTime = (time: string) =>
  new Date(time).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const localDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });

// "hoy", "mañana" o el día de la semana, para fechas AAAA-MM-DD en hora de Posadas.
export function dayName(isoDate: string, now: number, capitalize = false) {
  const today = localDay(now);
  const tomorrow = localDay(now + 86_400_000);
  const yesterday = localDay(now - 86_400_000);
  const name = isoDate === today ? "hoy" : isoDate === tomorrow ? "mañana" : isoDate === yesterday ? "ayer"
    : new Date(`${isoDate}T12:00:00-03:00`).toLocaleDateString("es-AR", { timeZone: TZ, weekday: "long", day: "numeric" });
  return capitalize ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

// "hoy 22:42", "mañana 9:00", "sábado 24, 15:00".
export function whenText(time: string | null, now: number) {
  if (!time) return "sin fecha";
  const ms = Date.parse(time);
  if (!Number.isFinite(ms)) return "sin fecha";
  const day = dayName(localDay(ms), now);
  return `${/\d/.test(day) ? "el " : ""}${day} a las ${clockTime(time)}`;
}

export function agoText(time: string | null, now: number) {
  if (!time) return "sin datos";
  const minutes = Math.round((now - Date.parse(time)) / 60_000);
  if (!Number.isFinite(minutes)) return "sin datos";
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

// Ambiente para granizo en las próximas horas: el nivel más alto que alcanzan al menos dos
// modelos (o el único disponible), igual que el consenso diario de 66_ambiente_granizo.py.
// Las horas de Open-Meteo vienen en hora de Posadas (UTC−3, sin horario de verano).
const HAIL_ORDER: HailLevel[] = ["bajo", "moderado", "alto"];
// Palabras de probabilidad, no de intensidad: "granizo moderado" se lee como cantidad.
export const HAIL_LIKELIHOOD: Record<HailLevel, string> = { bajo: "poco probable", moderado: "posible", alto: "muy posible" };
export function hailNext(hail: NinoHail | null, now: number, hours = 12): { nivel: HailLevel | null; modelos: number } {
  const cuts = hail?.cortes ?? { moderado: 0.5, alto: 1 };
  const levels = Object.values(hail?.modelos ?? {}).flatMap(model => {
    const values = model.horas
      .filter(h => {
        const t = Date.parse(`${h.time}:00-03:00`);
        return t > now - 3_600_000 && t <= now + hours * 3_600_000;
      })
      .map(h => h.ship)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (!values.length) return [];
    const max = Math.max(...values);
    return [max >= cuts.alto ? "alto" : max >= cuts.moderado ? "moderado" : "bajo"] satisfies HailLevel[];
  });
  if (levels.length <= 1) return { nivel: levels[0] ?? null, modelos: levels.length };
  const reached = (level: HailLevel) => levels.filter(l => HAIL_ORDER.indexOf(l) >= HAIL_ORDER.indexOf(level)).length;
  return { nivel: [...HAIL_ORDER].reverse().find(level => reached(level) >= 2) ?? "bajo", modelos: levels.length };
}

export const RAIN_COPY: Record<NinoLevel, { title: string; description: string }> = {
  sin_umbral: {
    title: "Sin señal de lluvia intensa",
    description: "La lluvia prevista queda por debajo del nivel de atención. Pueden ocurrir chaparrones o problemas puntuales.",
  },
  atencion: {
    title: "Lluvia para prestar atención",
    description: "La estimación central alcanza el primer nivel de atención por lluvia en poco tiempo o por acumulación durante el día. Consultá las alertas oficiales del SMN.",
  },
  alto: {
    title: "Se prevén lluvias fuertes",
    description: "La estimación central alcanza el nivel alto de este observatorio. Las zonas más expuestas podrían tener problemas. Consultá las alertas oficiales del SMN.",
  },
  muy_alto: {
    title: "Se prevén lluvias muy fuertes",
    description: "La estimación central alcanza el nivel más alto de este observatorio. Consultá las alertas oficiales y las indicaciones de Defensa Civil.",
  },
  a_verificar: {
    title: "Datos a verificar",
    description: "Faltan datos para resumir la lluvia esperada. Consultá el pronóstico y las alertas oficiales del SMN.",
  },
};

export const IMPACT_LABEL: Record<NinoLevel, string> = {
  sin_umbral: "Bajo", atencion: "Atención", alto: "Alto",
  muy_alto: "Muy alto", a_verificar: "Sin datos suficientes",
};

export const ALERT_LABEL: Record<AlertColor, string> = {
  roja: "Alerta roja", naranja: "Alerta naranja", amarilla: "Alerta amarilla", informativa: "Aviso",
};

// Rayos por antigüedad en minutos: rampa de un solo tono validada (más oscuro = más reciente).
export const LIGHTNING_COLORS = [[15, "#7c2d12"], [30, "#c2410c"], [60, "#f97316"]] as const;
export const lightningColor = (minutes: number) => LIGHTNING_COLORS.find(([limit]) => minutes <= limit)?.[1] ?? "#f97316";

export function normalizeBarrio(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").trim();
}

export function alertHeadline(alert: SmnAlert) {
  const event = alert.evento ? alert.evento.charAt(0).toUpperCase() + alert.evento.slice(1).toLowerCase() : "Fenómeno meteorológico";
  return alert.tipo === "aviso_corto_plazo"
    ? `Aviso ${alert.color === "informativa" ? "" : alert.color + " "}a muy corto plazo: ${event.toLowerCase()}`
    : `${ALERT_LABEL[alert.color]} por ${event.toLowerCase()}`;
}

export type HeroTone = AlertColor | "tormenta" | "lluvia" | "calma" | "sin_datos";

// title/detail: texto completo (accesible); badge/headline: versión corta para la tarjeta.
export interface HeroState { tone: HeroTone; title: string; detail: string; badge: string; headline: string }

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Lo que dice el texto oficial, en una línea: lluvia, granizo y ráfagas.
export function alertSummary(alert: SmnAlert) {
  const parts: string[] = [];
  if (alert.lluvia_mm) parts.push(`${alert.lluvia_mm[0]} a ${alert.lluvia_mm[1]} mm`);
  if (alert.menciona_granizo) parts.push("granizo");
  const gust = alert.descripcion.match(/r[aá]fagas[^.]*?(\d{2,3})\s*km\/h/i);
  if (gust) parts.push(`ráfagas de hasta ${gust[1]} km/h`);
  if (/el[eé]ctrica/i.test(alert.descripcion)) parts.push("muchos rayos");
  if (!parts.length) return "";
  const last = parts.pop()!;
  return capitalize(parts.length ? `${parts.join(", ")} y ${last}` : last) + ".";
}

// Intensidad para la animación, según el último parte del aeropuerto (no se inventa lluvia).
export function rainIntensity(live: NinoAhora | null): 0 | 1 | 2 | 3 {
  const now = live?.metar.datos?.ultimo;
  if (!now) return 0;
  if (now.lluvia_fuerte) return 3;
  if (/lluvia(?! débil)|chaparrones(?! débiles)/.test(now.texto)) return 2;
  return /lluvia|llovizna|chaparrones/.test(now.texto) ? 1 : 0;
}

// Prioridad: alerta oficial vigente > alerta próxima > tormenta observada > pronóstico propio.
export function heroState(live: NinoAhora | null, forecastLevel: NinoLevel, forecastFresh: boolean, now: number): HeroState {
  const alerts = live?.alertas.datos?.posadas ?? [];
  const active = alerts.filter(a => !a.inicio || Date.parse(a.inicio) <= now);
  const upcoming = alerts.filter(a => a.inicio && Date.parse(a.inicio) > now);
  if (active.length) {
    const top = active[0];
    return { tone: top.color, title: alertHeadline(top), detail: `El SMN la emitió para Posadas. Vigente hasta ${whenText(top.fin, now)}.`,
      badge: `${top.tipo === "aviso_corto_plazo" ? "Aviso" : ALERT_LABEL[top.color]} del SMN`, headline: `${capitalize(top.evento.toLowerCase())} hasta ${whenText(top.fin, now)}` };
  }
  if (upcoming.length) {
    const next = upcoming[0];
    return { tone: next.color, title: alertHeadline(next), detail: `Empieza ${whenText(next.inicio, now)} y sigue hasta ${whenText(next.fin, now)}.`,
      badge: `${ALERT_LABEL[next.color]} del SMN`, headline: `${capitalize(next.evento.toLowerCase())} desde ${whenText(next.inicio, now)}` };
  }
  const lightning = live?.rayos.estado === "ok" ? live.rayos.datos : null;
  const stormNow = live?.metar.datos?.tormenta_ultima_hora || (lightning?.cerca_15min ?? 0) > 0;
  // Solo se afirma que no hay alerta si se leyeron todas las alertas del SMN.
  const alertsComplete = live?.alertas.estado === "ok" && (live.alertas.datos?.pendientes ?? 0) === 0;
  if (stormNow) {
    const where = lightning?.mas_cercano_km != null ? ` El rayo más cercano cayó a ${lightning.mas_cercano_km} km.` : "";
    const official = alertsComplete ? "Sin alerta del SMN para la ciudad en este momento." : "Todavía no pudimos confirmar las alertas del SMN.";
    return { tone: "tormenta", title: "Hay tormenta en Posadas", detail: `${official}${where}`, badge: "Tormenta ahora", headline: "Hay tormenta en Posadas" };
  }
  if (live?.alertas.estado === "sin_datos") {
    return live.alertas.error
      ? { tone: "sin_datos", title: "No pudimos consultar las alertas del SMN", detail: "Revisalas directamente en smn.gob.ar/alertas.", badge: "SMN", headline: "No pudimos consultar las alertas" }
      : { tone: "sin_datos", title: "Consultando las alertas del SMN…", detail: "En unos segundos aparece si hay alertas para Posadas.", badge: "SMN", headline: "Consultando las alertas…" };
  }
  if (!alertsComplete) {
    return { tone: "sin_datos", title: "No pudimos revisar todas las alertas del SMN", detail: "Lo reintentamos en unos minutos. Mientras tanto, revisalas en smn.gob.ar/alertas.", badge: "SMN", headline: "No pudimos revisar todas las alertas" };
  }
  if (forecastFresh && ["atencion", "alto", "muy_alto"].includes(forecastLevel)) {
    return { tone: "lluvia", title: RAIN_COPY[forecastLevel].title, detail: "Sin alertas del SMN para Posadas por ahora. Es una estimación de este observatorio.", badge: "Estimación del observatorio", headline: RAIN_COPY[forecastLevel].title };
  }
  return { tone: "calma", title: "Sin alertas para Posadas", detail: "El SMN no tiene alertas vigentes para la ciudad.", badge: "SMN", headline: "Sin alertas para Posadas" };
}
