"use client";

// <DataFreshness /> — chip de transparencia de actualización.
//
// Filosofía:
//   El visitante debería poder mirar cualquier capa y saber, sin abrir
//   metodología, si lo que está viendo está fresco o congelado. Este
//   componente comunica eso en una línea: dot pulsante coloreado por
//   edad relativa a la frecuencia esperada + texto "hace X" + (opcional)
//   badge gris "espera: cada 6h".
//
// Diseño visual:
//   verde   — dentro del 100% del periodo esperado (p.ej. mensual y
//             llegó hace 20 días) → estado normal, "fresco".
//   amarillo — entre 100% y 200% del periodo (p.ej. mensual y llegó
//             hace 45 días) → un poco atrasado, no panic.
//   rojo    — >200% (p.ej. mensual y llegó hace 90 días) o sin
//             timestamp → cron caído / dataset congelado.
//
// Es complementario (no reemplazo) de <UpdateIndicator>:
//   - UpdateIndicator: SSE + polling para clima en vivo.
//   - DataFreshness:  estado estático del CSV publicado, sin red.
//
// Accesibilidad:
//   - role="status" → cambios anunciados sin interrumpir.
//   - aria-label resumido para lectores de pantalla.
//   - Tooltip nativo via title.

import { useEffect, useMemo, useState } from "react";

interface DataFreshnessProps {
  /** Slug del dataset — solo informativo (no consulta nada). */
  dataset: string;
  /** ISO timestamp del último refresh. String vacío = sin datos. */
  lastUpdated: string;
  /** "cada 6 horas" | "mensual" | "anual" | string custom. */
  frequency: string;
  /** Render minimalista (solo dot + tiempo). Default: false. */
  compact?: boolean;
  /** Mostrar badge gris con la frecuencia esperada. Default: true. */
  showFrequency?: boolean;
  /** Clase CSS extra para integrar en grids/headers. */
  className?: string;
}

type Freshness = "verde" | "amarillo" | "rojo";

// Convierte "cada 6 horas" / "6h" / "mensual" / "anual" / "diario"
// a un periodo expresado en milisegundos. Si el string es desconocido,
// devolvemos null y dejamos que la lógica caiga a un default permisivo
// (24h) para no marcar todo como rojo cuando no entendemos la unidad.
function parseFrequencyMs(frequency: string): number | null {
  const f = frequency.toLowerCase().trim();
  if (f.includes("6 hora") || f === "6h" || f.includes("6h")) {
    return 6 * 60 * 60 * 1000;
  }
  if (f.includes("12 hora") || f === "12h") {
    return 12 * 60 * 60 * 1000;
  }
  if (f.includes("hora") || f === "hourly") return 60 * 60 * 1000;
  if (f.includes("diari") || f.includes("daily")) {
    return 24 * 60 * 60 * 1000;
  }
  if (f.includes("seman")) return 7 * 24 * 60 * 60 * 1000;
  if (f.includes("mensu") || f.includes("month")) {
    return 30 * 24 * 60 * 60 * 1000;
  }
  if (f.includes("trimestral") || f.includes("quarter")) {
    return 90 * 24 * 60 * 60 * 1000;
  }
  if (f.includes("anual") || f.includes("annual") || f.includes("year")) {
    return 365 * 24 * 60 * 60 * 1000;
  }
  return null;
}

/**
 * Texto relativo en español natural, alineado al estilo de UpdateIndicator
 * pero más completo (incluye "meses" y "años"). Mantiene el resultado
 * conciso — "hace 3 horas" en lugar de "hace 3 horas y 12 minutos".
 */
export function tiempoRelativo(iso: string): string {
  if (!iso) return "sin datos";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "timestamp inválido";
  const delta = Date.now() - t;
  if (delta < 0) return "en el futuro";
  const minutos = Math.floor(delta / 60_000);
  if (minutos < 1) return "hace segundos";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    return `hace ${horas} h`;
  }
  const dias = Math.floor(horas / 24);
  if (dias < 30) {
    return `hace ${dias} día${dias === 1 ? "" : "s"}`;
  }
  const meses = Math.floor(dias / 30);
  if (meses < 12) {
    return `hace ${meses} mes${meses === 1 ? "" : "es"}`;
  }
  const anios = Math.floor(dias / 365);
  return `hace ${anios} año${anios === 1 ? "" : "s"}`;
}

/**
 * Clasifica un timestamp en función de la frecuencia esperada.
 * - verde:   <100% del periodo
 * - amarillo: 100-200%
 * - rojo:    >200% o timestamp inválido/ausente
 *
 * Frecuencias desconocidas usan 24h por defecto (permisivo).
 */
export function freshness(iso: string, frequency: string): Freshness {
  if (!iso) return "rojo";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "rojo";
  const delta = Date.now() - t;
  if (delta < 0) return "verde"; // futuro: tratamos como recién emitido
  const period = parseFrequencyMs(frequency) ?? 24 * 60 * 60 * 1000;
  const ratio = delta / period;
  if (ratio <= 1) return "verde";
  if (ratio <= 2) return "amarillo";
  return "rojo";
}

/** Texto humano de "próxima actualización esperada" para el tooltip. */
function proximaActualizacion(iso: string, frequency: string): string {
  if (!iso) return "actualización pendiente — verificar pipeline";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "timestamp inválido";
  const period = parseFrequencyMs(frequency);
  if (!period) return `frecuencia: ${frequency}`;
  const next = t + period;
  const delta = next - Date.now();
  if (delta <= 0) {
    const overdue = Math.abs(delta);
    const hours = Math.floor(overdue / (60 * 60 * 1000));
    if (hours < 24) return `vencida hace ~${hours} h`;
    const dias = Math.floor(hours / 24);
    return `vencida hace ~${dias} día${dias === 1 ? "" : "s"}`;
  }
  const minutos = Math.floor(delta / 60_000);
  if (minutos < 60) return `próxima en ~${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `próxima en ~${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `próxima en ~${dias} día${dias === 1 ? "" : "s"}`;
  const meses = Math.floor(dias / 30);
  return `próxima en ~${meses} mes${meses === 1 ? "" : "es"}`;
}

// Mapa de color → clases tailwind. Se usan dos: el dot (sólido) y el
// "halo" pulsante (con animate-ping y opacidad reducida).
const COLOR_DOT: Record<Freshness, string> = {
  verde: "bg-emerald-500 dark:bg-emerald-400",
  amarillo: "bg-amber-500 dark:bg-amber-400",
  rojo: "bg-rose-500 dark:bg-rose-400",
};

// Glosario corto del estado para el aria-label/screen reader.
const ESTADO_HUMANO: Record<Freshness, string> = {
  verde: "datos al día",
  amarillo: "datos algo atrasados",
  rojo: "datos desactualizados",
};

export function DataFreshness({
  dataset,
  lastUpdated,
  frequency,
  compact = false,
  showFrequency = true,
  className = "",
}: DataFreshnessProps) {
  // Re-render cada minuto para que el "hace X" se mantenga preciso aunque
  // la pestaña esté abierta sin recibir updates externos. Mismo truco que
  // UpdateIndicator. El cleanup desmonta el interval correctamente.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const estado = useMemo(
    () => freshness(lastUpdated, frequency),
    [lastUpdated, frequency],
  );
  const relText = useMemo(() => tiempoRelativo(lastUpdated), [lastUpdated]);
  const proxima = useMemo(
    () => proximaActualizacion(lastUpdated, frequency),
    [lastUpdated, frequency],
  );

  const dotColor = COLOR_DOT[estado];
  // Solo pulsa cuando está fresco. Si está amarillo/rojo, el dot estático
  // refuerza visualmente que algo no está fluyendo.
  const shouldPulse = estado === "verde" && Boolean(lastUpdated);

  const tooltip = `Dataset "${dataset}" — ${ESTADO_HUMANO[estado]}. ${relText}. Próxima actualización esperada: ${proxima}.`;

  // Variante compact: solo dot + "hace X". Ideal para integrar al lado de
  // un título de tarjeta o en una grid de servicios.
  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs text-neutral-muted dark:text-dk-muted ${className}`}
        title={tooltip}
        role="status"
        aria-label={tooltip}
      >
        <Dot color={dotColor} pulse={shouldPulse} />
        <span aria-live="polite">{relText}</span>
      </span>
    );
  }

  // Variante expandida: card chico con dot, texto y badge de frecuencia.
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-2 rounded-md border border-neutral-border bg-white/70 px-2.5 py-1 text-xs text-neutral-text shadow-sm dark:border-dk-border dark:bg-dk-elevated/70 dark:text-dk-text ${className}`}
      title={tooltip}
      role="status"
      aria-label={tooltip}
    >
      <Dot color={dotColor} pulse={shouldPulse} />
      <span className="font-medium" aria-live="polite">
        {relText}
      </span>
      {showFrequency && (
        <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-secondary dark:bg-dk-surface dark:text-dk-muted">
          espera: {frequency}
        </span>
      )}
    </span>
  );
}

// Sub-componente: dot con halo animado opcional. Igual al de
// UpdateIndicator para mantener consistencia visual entre ambos chips.
function Dot({ color, pulse }: { color: string; pulse: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${color}`}
        />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}
