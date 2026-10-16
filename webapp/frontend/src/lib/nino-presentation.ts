import type { NinoLevel } from "./nino-types";

export const formatNinoNumber = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "Sin datos"
    : value.toLocaleString("es-AR", { maximumFractionDigits: 1 });

// No redondear una cantidad positiva muy pequeña a cero.
export const formatRain = (value: number | null | undefined) =>
  value != null && value > 0 && value < 0.1 ? "menos de 0,1" : formatNinoNumber(value);

export const ninoDate = (time: string) =>
  new Date(time).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).replace(/\s/g, " ");

export const ninoHour = (time: string) =>
  new Date(time).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).replace(/\s/g, " ");

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

export function normalizeBarrio(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}
