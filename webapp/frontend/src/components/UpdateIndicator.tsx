"use client";

// Indicador "datos vivos" — dot pulsante + texto relativo.
//
// Diseño:
//   - Verde pulsante  : <12h desde generated_at  (datos frescos)
//   - Naranja         : 12h ≤ delta < 24h        (datos OK pero ya viejos)
//   - Rojo            : >=24h o sin timestamp    (cron caído)
//
// Accesibilidad:
//   - aria-live="polite" en el texto relativo: cuando re-fetchea, los
//     lectores de pantalla anuncian el cambio sin interrumpir.
//   - El dot tiene aria-hidden — el estado se comunica vía texto.
//   - Tooltip explicativo (title + sr-only) para el por qué.
//
// Uso:
//   <UpdateIndicator generatedAt={data.generated_at} status={liveData.status} />
//
// Si querés que él mismo fetchee, pasale `selfFetch` y omití generatedAt.

import { useEffect, useMemo, useState } from "react";

import { LottieAnimation } from "@/components/LottieAnimation";
import { useLiveData } from "@/hooks/useLiveData";

interface UpdateIndicatorProps {
  /** ISO timestamp del último refresh. Si ausente, intenta auto-fetch o muestra "—". */
  generatedAt?: string | null;
  /** Estado de conexión (de useLiveData). Determina si mostramos el dot pulsando. */
  status?: "idle" | "live" | "polling" | "error";
  /** Si true, el componente fetchea su propio timestamp (uso standalone en header). */
  selfFetch?: boolean;
  /** Estilo: "compact" para header, "full" para páginas. */
  variant?: "compact" | "full";
  /** Clase extra opcional. */
  className?: string;
}

// Umbrales en milisegundos. Los magic numbers están centralizados acá para
// poder ajustarlos sin grep por todo el código.
const FRESH_MS = 12 * 60 * 60 * 1000; // 12h
const STALE_MS = 24 * 60 * 60 * 1000; // 24h

type Freshness = "fresh" | "stale" | "old";

function classifyFreshness(generatedAt: string | null | undefined): Freshness {
  if (!generatedAt) return "old";
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return "old";
  const delta = Date.now() - t;
  if (delta < FRESH_MS) return "fresh";
  if (delta < STALE_MS) return "stale";
  return "old";
}

// Formatea el delta como "hace X minutos / horas / días". Mantenemos
// la lógica simple y en español sin depender de Intl.RelativeTimeFormat
// (que en algunos browsers genera strings incomodos como "hace 0 horas").
function formatRelative(generatedAt: string | null | undefined): string {
  if (!generatedAt) return "Sin datos recientes";
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return "Timestamp inválido";
  const deltaMs = Date.now() - t;
  if (deltaMs < 0) return "En el futuro (?)";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "Actualizado hace segundos";
  if (minutes < 60) return `Actualizado hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes - hours * 60;
    if (remMin === 0 || hours >= 6) return `Actualizado hace ${hours} h`;
    return `Actualizado hace ${hours}h ${remMin}min`;
  }
  const days = Math.floor(hours / 24);
  return `Actualizado hace ${days} día${days === 1 ? "" : "s"}`;
}

export function UpdateIndicator({
  generatedAt,
  status,
  selfFetch = false,
  variant = "compact",
  className = "",
}: UpdateIndicatorProps) {
  // Si selfFetch=true, usamos el hook con la clave "lastUpdate". Esto le da
  // sentido a usar el componente en el header sin pasarle props.
  const live = useLiveData<{ generated_at?: string }>("forecast:lastUpdate", {
    enabled: selfFetch,
  });

  const effectiveGeneratedAt = selfFetch
    ? live.data?.generated_at || live.generatedAt
    : generatedAt;
  const effectiveStatus = selfFetch ? live.status : status;

  // Re-render cada minuto para que el "hace X min" se mantenga preciso
  // sin depender de updates externos.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const freshness = useMemo(
    () => classifyFreshness(effectiveGeneratedAt),
    [effectiveGeneratedAt],
  );
  const relText = useMemo(
    () => formatRelative(effectiveGeneratedAt),
    [effectiveGeneratedAt],
  );

  const dotColor = {
    fresh: "bg-emerald-500 dark:bg-emerald-400",
    stale: "bg-amber-500 dark:bg-amber-400",
    old: "bg-rose-500 dark:bg-rose-400",
  }[freshness];

  // El dot pulsa solo cuando está fresco Y el SSE confirma que está vivo.
  // Si caímos a polling, el indicador es estático: comunica honestamente
  // que no estamos en tiempo real pleno.
  const shouldPulse = freshness === "fresh" && effectiveStatus === "live";

  const tooltip =
    "Datos refrescados automáticamente cada 6 horas mediante un cron en GitHub Actions. " +
    "Si el indicador queda en naranja o rojo, contactá al operador.";

  if (variant === "full") {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-md border border-neutral-border bg-white/70 px-3 py-1.5 text-xs text-neutral-text shadow-sm dark:border-dk-border dark:bg-dk-elevated/70 dark:text-dk-text ${className}`}
        title={tooltip}
        role="status"
      >
        <Dot color={dotColor} pulse={shouldPulse} />
        {/* Lottie data-flow animado: solo aparece cuando los datos están
            frescos Y la conexión está viva. En ese caso es un acento
            decorativo de "datos fluyendo". Si la conexión cae, el dot
            naranja/rojo + el texto comunican el estado y la animación
            desaparece para no contradecir el dot. */}
        {shouldPulse && (
          <LottieAnimation
            src="/animations/data-flow.json"
            ariaLabel={undefined}
            width={36}
            height={12}
            fallback={null}
          />
        )}
        <span className="font-medium" aria-live="polite">
          {relText}
        </span>
        {effectiveStatus === "live" && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            En vivo
          </span>
        )}
        {effectiveStatus === "polling" && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            Polling
          </span>
        )}
        <span className="sr-only">{tooltip}</span>
      </div>
    );
  }

  // Variante compact (header) — minimalista, solo dot + texto corto.
  return (
    <div
      className={`inline-flex items-center gap-1.5 text-xs text-neutral-muted dark:text-dk-muted ${className}`}
      title={tooltip}
      role="status"
    >
      <Dot color={dotColor} pulse={shouldPulse} />
      <span aria-live="polite">{relText}</span>
      <span className="sr-only">{tooltip}</span>
    </div>
  );
}

// Dot reutilizable. Cuando `pulse=true`, agregamos un anillo expandiéndose
// en loop (animate-ping de Tailwind) para señalar "estoy vivo".
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
