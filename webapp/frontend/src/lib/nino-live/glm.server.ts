import "server-only";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchBytes, fetchText, mapLimit } from "./cache.server";
import { POSADAS, distanceKm, summarizeFlashes } from "./parse";

// Rayos detectados por el GLM del satélite GOES-19 (NOAA). Cada archivo cubre
// 20 segundos y pesa unos 350 KB: se procesan solo los nuevos y se guardan en
// memoria los rayos de la última hora cerca de Posadas.
const BUCKET = "https://noaa-goes19.s3.amazonaws.com/";
const KEEP_KM = 100;
const WINDOW_MS = 60 * 60_000;
const FILES_PER_HOUR = 180;

const state = {
  processed: new Map<string, number>(),
  flashes: [] as Array<{ t: number; lat: number; lon: number }>,
};

function hourPrefix(ms: number) {
  const date = new Date(ms);
  const doy = Math.floor((ms - Date.UTC(date.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
  return `GLM-L2-LCFA/${date.getUTCFullYear()}/${String(doy).padStart(3, "0")}/${String(date.getUTCHours()).padStart(2, "0")}/`;
}

export function fileStart(key: string) {
  const m = key.match(/_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_/);
  if (!m) return null;
  const [y, doy, h, min, s, tenth] = m.slice(1).map(Number);
  return Date.UTC(y, 0, 1) + (doy - 1) * 86_400_000 + h * 3_600_000 + min * 60_000 + s * 1000 + tenth * 100;
}

async function listKeys(prefix: string) {
  const xml = await fetchText(`${BUCKET}?list-type=2&prefix=${encodeURIComponent(prefix)}`, 15_000);
  return [...xml.matchAll(/<Key>([^<]+\.nc)<\/Key>/g)].map(m => m[1]);
}

type H5 = typeof import("h5wasm/node").default;
let library: Promise<H5> | null = null;
const h5wasm = () => (library ??= import("h5wasm/node").then(async module => { await module.default.ready; return module.default; }));

async function readFlashes(key: string) {
  const [bytes, lib] = await Promise.all([fetchBytes(BUCKET + key), h5wasm()]);
  const path = join(tmpdir(), `glm-${randomUUID()}.nc`);
  await writeFile(path, bytes);
  try {
    const file = new lib.File(path, "r");
    try {
      const lat = (file.get("flash_lat") as InstanceType<H5["Dataset"]>).value as Float32Array;
      const lon = (file.get("flash_lon") as InstanceType<H5["Dataset"]>).value as Float32Array;
      const points: Array<{ lat: number; lon: number }> = [];
      for (let i = 0; i < lat.length; i++) {
        // Filtro rápido por caja antes de la distancia exacta.
        if (Math.abs(lat[i] - POSADAS.lat) > 1.5 || Math.abs(lon[i] - POSADAS.lon) > 1.7) continue;
        const point = { lat: lat[i], lon: lon[i] };
        if (distanceKm(POSADAS, point) <= KEEP_KM) points.push(point);
      }
      return points;
    } finally {
      file.close();
    }
  } finally {
    await unlink(path).catch(() => undefined);
  }
}

export async function loadLightning(nearKm: number) {
  const now = Date.now();
  const keys = (await Promise.all([hourPrefix(now - 3_600_000), hourPrefix(now)].map(listKeys))).flat();
  const pending = keys.filter(key => {
    const start = fileStart(key);
    return start !== null && now - start <= WINDOW_MS + 60_000 && !state.processed.has(key);
  });
  const results = await mapLimit(pending, 8, async key => ({ key, start: fileStart(key)!, points: await readFlashes(key) }));
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    state.processed.set(result.value.key, result.value.start);
    for (const point of result.value.points) state.flashes.push({ t: result.value.start, ...point });
  }
  state.flashes = state.flashes.filter(flash => now - flash.t <= WINDOW_MS);
  for (const [key, start] of state.processed) if (now - start > 2 * WINDOW_MS) state.processed.delete(key);
  const lastHour = [...state.processed.values()].filter(start => now - start <= WINDOW_MS);
  if (!lastHour.length) throw new Error("No se pudo leer ningún archivo reciente del GLM");
  const latest = Math.max(...lastHour);
  return {
    ...summarizeFlashes(state.flashes, now, nearKm, new Date(latest).toISOString(), KEEP_KM),
    // Proporción de la última hora efectivamente procesada (180 archivos por hora).
    cobertura: Math.min(1, Math.round((lastHour.length / FILES_PER_HOUR) * 100) / 100),
  };
}
