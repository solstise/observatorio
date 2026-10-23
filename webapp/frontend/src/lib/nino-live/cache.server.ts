import "server-only";

// Caché en memoria del proceso Node (un solo contenedor). La página es dinámica,
// así que el fetch de Next no cachea: cada fuente define su propio vencimiento.
// Si una fuente falla se conserva el último dato bueno con su hora real.

export interface Cached<T> {
  value: T | null;
  updatedAt: string | null;
  error: string | null;
  stale: boolean;
}

interface Entry<T> {
  value: T | null;
  at: number;
  error: string | null;
  pending: Promise<void> | null;
}

const entries = new Map<string, Entry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>, waitMs: number): Promise<Cached<T>> {
  const entry = (entries.get(key) ?? { value: null, at: 0, error: null, pending: null }) as Entry<T>;
  entries.set(key, entry);
  const fresh = entry.value !== null && Date.now() - entry.at < ttlMs;
  if (!fresh && !entry.pending) {
    entry.pending = loader()
      .then(value => { entry.value = value; entry.at = Date.now(); entry.error = null; })
      .catch(error => { entry.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { entry.pending = null; });
  }
  // Primera carga: esperar un poco. Con un dato previo se responde enseguida.
  if (entry.pending && (entry.value === null || waitMs > 0)) {
    await Promise.race([entry.pending, new Promise(resolve => setTimeout(resolve, entry.value === null ? waitMs : Math.min(waitMs, 300)))]);
  }
  return {
    value: entry.value,
    updatedAt: entry.at ? new Date(entry.at).toISOString() : null,
    error: entry.error,
    stale: entry.value !== null && Date.now() - entry.at >= ttlMs,
  };
}

export async function fetchText(url: string, timeoutMs = 15_000, encoding: "utf-8" | "latin1" = "utf-8") {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "sateliteposadas.com (Observatorio Urbano Posadas)" },
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} respondió ${response.status}`);
  return new TextDecoder(encoding).decode(await response.arrayBuffer());
}

export async function fetchBytes(url: string, timeoutMs = 20_000) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} respondió ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { status: "fulfilled", value: await fn(items[index]) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }));
  return results;
}
