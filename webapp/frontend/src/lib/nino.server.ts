import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import type { FeatureCollection } from "geojson";
import { NINO_CONFIG_DEFAULT, type NinoConfig, type NinoEvent, type NinoObservedDay, type NinoSnapshot } from "./nino-types";

export async function getNinoSnapshot(): Promise<NinoSnapshot | null> {
  try { return JSON.parse(await readFile(path.join(process.cwd(), "public/data/nino/estado.json"), "utf8")); }
  catch { return null; }
}
export async function getNinoConfig(): Promise<NinoConfig> {
  const snapshot = await getNinoSnapshot();
  return { ...NINO_CONFIG_DEFAULT, ...(snapshot?.config ?? {}) };
}
export async function getNinoGeometry(name: string): Promise<FeatureCollection> {
  try { return JSON.parse(await readFile(path.join(process.cwd(), "public/data/nino", name), "utf8")); }
  catch { return { type: "FeatureCollection", features: [] }; }
}
export async function getNinoEvents(): Promise<NinoEvent[]> {
  try {
    const csv = await readFile(path.join(process.cwd(), "public/data/nino/eventos_anegamiento.csv"), "utf8");
    return Papa.parse<NinoEvent>(csv, { header: true, skipEmptyLines: true }).data;
  } catch { return []; }
}
// Archivos JSON de la sala (granizo, climatología, escurrimiento): null si faltan.
export async function getNinoJson<T>(name: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path.join(process.cwd(), "public/data/nino", name), "utf8")) as T; }
  catch { return null; }
}
// Registro diario de lluvia medida en Posadas Aero, armado por scripts/63_lluvia_observada.py.
export async function getObservedRecord(): Promise<NinoObservedDay[]> {
  try {
    const csv = await readFile(path.join(process.cwd(), "public/data/nino/lluvia_observada_diaria.csv"), "utf8");
    return Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data.map(row => ({
      fecha: row.fecha,
      mm: row.mm === "" || row.mm == null ? null : Number(row.mm),
      tormenta: row.tormenta === "True" || row.tormenta === "true",
      granizo: row.granizo === "True" || row.granizo === "true",
    })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.fecha));
  } catch { return []; }
}
