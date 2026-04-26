// API route handler — GET /api/forecast?key=<redis-key>
//
// Lee de Upstash Redis (REST API). Si Upstash no está configurado o falla,
// hace fallback a leer los CSV/JSON locales servidos desde /public/data/.
// Esto garantiza que el frontend nunca vea "blanco": si el cron tira,
// seguimos mostrando el snapshot anterior aunque sea de hace varias horas.
//
// Ejemplos:
//   /api/forecast                                    → resumen general
//   /api/forecast?key=forecast:diario:posadas_completa
//   /api/forecast?key=forecast:diario:itaembe-mini
//   /api/forecast?key=alertas:activas

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

// Config de Next: este endpoint debe correr en cada request (no cachear),
// porque el dato vivo cambia cada 6h y queremos servir el más fresco.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Tipo del response uniforme — el frontend siempre puede contar con `data`,
// `source` y `generated_at`, sin caer en undefined-checks.
interface ForecastResponse {
  data: unknown;
  source: "upstash" | "local";
  generated_at: string;
  key: string;
  // Si Upstash falló y caímos a local, lo reportamos para debugging.
  fallback_reason?: string;
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "") ?? "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

const DEFAULT_KEY = "forecast:diario:posadas_completa";

// ---------------------------------------------------------------------------
// Upstash GET
// ---------------------------------------------------------------------------

async function getFromUpstash(key: string): Promise<unknown> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("Upstash no configurado");
  }
  // El REST API acepta el comando como JSON array en el body.
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["GET", key]),
    cache: "no-store",
    // 5s de timeout vía AbortController para no bloquear el response del API
    // si Upstash está lento. Si tarda más, caemos al local.
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(`Upstash HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: string | null };
  if (json.result == null) {
    throw new Error(`key '${key}' no existe en Upstash (¿TTL expiró?)`);
  }
  // El payload está stringified (lo metimos así desde Python).
  return JSON.parse(json.result);
}

// ---------------------------------------------------------------------------
// Fallback local — lee de /public/data/forecast/<id>.json
// ---------------------------------------------------------------------------

// Mapea una clave Redis a la ruta local correspondiente.
// Convención (espejo del helper Python):
//   `forecast:diario:<id>`            → forecast/<id>.json
//   `forecast:diario:posadas_completa`→ forecast/_resumen.json
//   `forecast:metadata`               → forecast/_metadata.json
//   `alertas:activas`                 → forecast/alertas_activas.json (o alertas/activas.json legado)
function keyToLocalPath(key: string): string | null {
  if (key === "alertas:activas") {
    // Probamos primero la ubicación nueva (dentro de forecast/), después
    // la antigua. El handler hace catch del ENOENT y prueba la siguiente.
    return "forecast/alertas_activas.json";
  }
  if (key === "forecast:metadata" || key === "forecast:lastUpdate") {
    return "forecast/_metadata.json";
  }
  const match = key.match(/^forecast:diario:(.+)$/);
  if (!match) return null;
  const id = match[1];
  if (id === "posadas_completa") {
    return "forecast/_resumen.json";
  }
  return `forecast/${id}.json`;
}

async function getFromLocal(key: string): Promise<{ data: unknown; generated_at: string }> {
  const rel = keyToLocalPath(key);
  if (!rel) {
    throw new Error(`Clave no mapeable a archivo local: ${key}`);
  }
  // process.cwd() en Next es la raíz del proyecto frontend, así que public/data/...
  const filePath = path.join(process.cwd(), "public", "data", rel);
  const raw = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as Record<string, unknown> | unknown[];
  const generated_at =
    (Array.isArray(data) ? "" : (data?.["generated_at"] as string | undefined)) || "";
  return { data, generated_at };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? DEFAULT_KEY;

  // 1. Intento Upstash primero — es el camino feliz y el más rápido.
  try {
    const data = await getFromUpstash(key);
    const generated_at =
      (typeof data === "object" && data !== null && "generated_at" in data
        ? (data as { generated_at?: string }).generated_at
        : undefined) ?? new Date().toISOString();
    const body: ForecastResponse = {
      data,
      source: "upstash",
      generated_at,
      key,
    };
    return NextResponse.json(body, {
      headers: {
        // Cache muy corto en CDN — los datos cambian cada 6h pero queremos
        // picos de tráfico amortiguados. stale-while-revalidate: si el dato
        // está stale, lo servimos igual mientras refresca atrás.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Upstash unknown error";

    // 2. Fallback al CSV/JSON local. Si esto también falla, devolvemos 503
    //    explícito para que el frontend pueda mostrar un mensaje "datos no
    //    disponibles, intentá en unos minutos".
    try {
      const { data, generated_at } = await getFromLocal(key);
      const body: ForecastResponse = {
        data,
        source: "local",
        generated_at: generated_at || new Date().toISOString(),
        key,
        fallback_reason: reason,
      };
      return NextResponse.json(body, {
        // Sin cache cuando estamos en fallback: queremos que el próximo
        // request reintente Upstash (que podría haberse recuperado).
        headers: { "Cache-Control": "no-store" },
      });
    } catch (localErr) {
      const localReason =
        localErr instanceof Error ? localErr.message : "Local unknown error";
      return NextResponse.json(
        {
          error: "Forecast no disponible",
          upstash_error: reason,
          local_error: localReason,
          key,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
}
