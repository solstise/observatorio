// SSE (Server-Sent Events) endpoint — GET /api/forecast/stream
//
// El cliente abre EventSource("/api/forecast/stream") y recibe eventos
// `update` cada vez que detectamos que Upstash tiene un timestamp nuevo
// en la clave `forecast:lastUpdate`.
//
// Diseño:
// - SSE se elige sobre WebSockets porque (1) no requiere infra extra,
//   (2) reconnect automático del browser, (3) atraviesa proxies HTTP sin
//   problemas (Cloudflare, nginx, Hostinger).
// - El servidor hace polling a Upstash cada 30s y emite el evento solo
//   cuando el timestamp cambia, no en cada tick. Así el cliente solo
//   re-fetchea cuando hay novedad real.
// - Si Upstash no está configurado, la conexión se cierra inmediatamente
//   con un `event: closed`. El frontend cae a polling cada 5min en ese
//   caso (ver useLiveData).
// - Heartbeat cada 25s para mantener la conexión abierta atrás de proxies
//   con timeouts agresivos (Cloudflare cierra conexiones idle a >100s).

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // Edge no soporta long-lived ReadableStream con setInterval

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "") ?? "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

// Cadencia del polling al backend. 30s es un compromiso: suficientemente
// frecuente para parecer "vivo", suficientemente lento para no costar
// requests Upstash de más (free-tier: 10k req/día).
const POLL_INTERVAL_MS = 30_000;
// Heartbeat para que el browser no cierre la conexión por inactividad.
const HEARTBEAT_INTERVAL_MS = 25_000;

async function getLastUpdate(): Promise<string | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(UPSTASH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["GET", "forecast:lastUpdate"]),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: string | null };
    return json.result ?? null;
  } catch {
    return null;
  }
}

export function GET(): Response {
  const encoder = new TextEncoder();
  let lastSeen: string | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // El cliente cerró la conexión. Liberamos timers en cleanup.
          closed = true;
        }
      };

      // Mensaje inicial — útil para debugging desde DevTools y para que el
      // cliente sepa que está conectado antes del primer poll.
      send(
        "open",
        JSON.stringify({
          ok: true,
          upstash_configured: Boolean(UPSTASH_URL && UPSTASH_TOKEN),
          poll_interval_ms: POLL_INTERVAL_MS,
        }),
      );

      if (!UPSTASH_URL || !UPSTASH_TOKEN) {
        // Sin Upstash no podemos detectar updates. Cerramos limpio para
        // que el cliente caiga al fallback de polling local.
        send("closed", JSON.stringify({ reason: "upstash_not_configured" }));
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
        return;
      }

      // Primer poll inmediato — bootstrap del lastSeen para no emitir un
      // "update" en el primer tick si el dato ya estaba.
      lastSeen = await getLastUpdate();

      pollTimer = setInterval(async () => {
        const ts = await getLastUpdate();
        if (ts && ts !== lastSeen) {
          lastSeen = ts;
          send("update", JSON.stringify({ generated_at: ts }));
        }
      }, POLL_INTERVAL_MS);

      heartbeatTimer = setInterval(() => {
        // Comentario SSE — no dispara handlers en el cliente, solo
        // mantiene la conexión activa. La spec SSE permite líneas que
        // empiecen con ":" como no-op.
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      // El cliente cerró la conexión (page unload, navegación, etc.).
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Sin esto, nginx (en el VPS) bufferea la respuesta hasta que se
      // cierra. Con X-Accel-Buffering: no, los chunks pasan en cuanto
      // se enqueuean.
      "X-Accel-Buffering": "no",
    },
  });
}
