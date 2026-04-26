"use client";

// Hook para datos "vivos" — fetch + suscripción a updates.
//
// Estrategia:
//   1. fetch inicial a /api/forecast?key=<key> (devuelve {data, generated_at})
//   2. abre EventSource a /api/forecast/stream
//   3. al recibir evento `update`, re-fetch
//   4. fallback: si SSE falla o no soportado, polling cada 5min
//
// El componente que use este hook puede mostrar el spinner solo mientras
// `loading=true && data===null` (carga inicial). Si llega un update y
// re-fetchea, `data` queda con el valor anterior hasta que el nuevo
// arrive — UI no parpadea.

import { useCallback, useEffect, useRef, useState } from "react";

export interface ForecastApiResponse<T> {
  data: T;
  source: "upstash" | "local";
  generated_at: string;
  key: string;
  fallback_reason?: string;
}

export interface UseLiveDataResult<T> {
  /** Payload remoto. null mientras carga la primera vez. */
  data: T | null;
  /** ISO timestamp de cuándo se generó este snapshot. */
  generatedAt: string | null;
  /** "upstash" si vino del cache vivo, "local" si fallback. */
  source: "upstash" | "local" | null;
  /** True solo durante la carga inicial. */
  loading: boolean;
  /** Mensaje de error si falló incluso el fallback local. */
  error: string | null;
  /** "live" si SSE conectado, "polling" si caímos a polling, "idle" si nunca arrancó. */
  status: "idle" | "live" | "polling" | "error";
  /** Forzar un refresh manual (botón "actualizar ahora"). */
  refetch: () => Promise<void>;
}

// Polling fallback: cada 5min si SSE falla. Es el peor caso — incluso
// con cron 6h, esto significa <5min de delay para ver datos nuevos.
const POLLING_FALLBACK_MS = 5 * 60 * 1000;

export function useLiveData<T = unknown>(
  key: string,
  options?: { enabled?: boolean },
): UseLiveDataResult<T> {
  const enabled = options?.enabled ?? true;

  const [data, setData] = useState<T | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [source, setSource] = useState<"upstash" | "local" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<UseLiveDataResult<T>["status"]>("idle");

  // Refs para evitar re-creates de fetcher en cada render — la URL no
  // cambia con frecuencia y queremos que el efecto de SSE/polling solo
  // dependa de `key` y `enabled`.
  const isMountedRef = useRef(true);

  const doFetch = useCallback(async () => {
    if (!enabled) return;
    try {
      const url = `/api/forecast?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const payload = (await res.json()) as ForecastApiResponse<T>;
      if (!isMountedRef.current) return;
      setData(payload.data);
      setGeneratedAt(payload.generated_at || null);
      setSource(payload.source);
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [key, enabled]);

  // Mount / unmount tracking — para no setear estado tras unmount.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch inicial cuando cambia la key.
  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void doFetch();
  }, [doFetch, enabled]);

  // Suscripción SSE + fallback polling. Se ejecuta una sola vez por mount
  // (no depende de key porque el stream es global — todas las keys
  // refrescan al mismo tiempo cuando el cron corre).
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let eventSource: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let cleanedUp = false;

    const startPollingFallback = () => {
      if (cleanedUp || pollTimer) return;
      setStatus("polling");
      pollTimer = setInterval(() => {
        void doFetch();
      }, POLLING_FALLBACK_MS);
    };

    // EventSource solo está disponible en el browser (no SSR). El check
    // arriba con `typeof window` ya nos protege; este es defensa en
    // profundidad por si algún wrapper raro lo importa.
    if (typeof EventSource === "undefined") {
      startPollingFallback();
      return () => {
        cleanedUp = true;
        if (pollTimer) clearInterval(pollTimer);
      };
    }

    try {
      eventSource = new EventSource("/api/forecast/stream");
    } catch {
      startPollingFallback();
      return () => {
        cleanedUp = true;
        if (pollTimer) clearInterval(pollTimer);
      };
    }

    eventSource.addEventListener("open", () => {
      if (cleanedUp) return;
      setStatus("live");
    });

    // Evento custom emitido por el server cuando Upstash tiene un timestamp
    // nuevo. El payload no nos importa demasiado — solo dispara el re-fetch.
    eventSource.addEventListener("update", () => {
      if (cleanedUp) return;
      void doFetch();
    });

    // El server cerró por config faltante — caemos a polling.
    eventSource.addEventListener("closed", () => {
      eventSource?.close();
      startPollingFallback();
    });

    eventSource.onerror = () => {
      // EventSource intenta reconectar solo. Si vemos error, tipicamente
      // es un proxy que cortó — confiamos en el reconnect, pero también
      // armamos polling como red.
      if (cleanedUp) return;
      setStatus((prev) => (prev === "live" ? "live" : "polling"));
      startPollingFallback();
    };

    return () => {
      cleanedUp = true;
      eventSource?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [doFetch, enabled]);

  return {
    data,
    generatedAt,
    source,
    loading,
    error,
    status,
    refetch: doFetch,
  };
}
