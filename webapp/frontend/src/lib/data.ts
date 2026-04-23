// Capa de datos del frontend.
//
// Fuentes de datos, en orden de precedencia:
// 1. NEXT_PUBLIC_API_BASE (si esta definida): se consulta el backend FastAPI.
// 2. En server-side (SSR / build / RSC): lee directo de public/data con fs.
// 3. En client-side: hace fetch("/data/...") al asset estatico.
//
// Esto permite que pages como /poligono/[id] con generateStaticParams
// funcionen durante `next build` sin necesitar un servidor HTTP intermedio.

import Papa from "papaparse";

import type {
  PoblacionRow,
  PoligonoDetalle,
  PoligonoFeature,
  PoligonosCollection,
  SerieTemporalRow,
  ServicioRow,
  VulnerabilidadRow,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";
const IS_SERVER = typeof window === "undefined";

async function readPublicFile(relativePath: string): Promise<string> {
  if (IS_SERVER) {
    // En server usamos fs directamente. "relativePath" empieza con "/data/..."
    // y apunta a public/<relativePath>.
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const normalized = relativePath.replace(/^\//, "");
    const full = path.join(process.cwd(), "public", normalized);
    return readFile(full, "utf-8");
  }
  const res = await fetch(relativePath, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Error ${res.status} al leer ${relativePath}`);
  }
  return res.text();
}

async function fetchJsonFromApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Error ${res.status} al leer ${path}`);
  }
  return (await res.json()) as T;
}

async function readStaticJson<T>(relativePath: string): Promise<T> {
  const text = await readPublicFile(relativePath);
  return JSON.parse(text) as T;
}

async function readStaticCsv<T>(relativePath: string): Promise<T[]> {
  const text = await readPublicFile(relativePath);
  const parsed = Papa.parse<T>(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    comments: "#",
  });
  if (parsed.errors.length) {
    // eslint-disable-next-line no-console
    console.warn("Advertencias al parsear", relativePath, parsed.errors);
  }
  return parsed.data;
}

export async function getPoligonos(): Promise<PoligonosCollection> {
  if (API_BASE) {
    return fetchJsonFromApi<PoligonosCollection>("/api/poligonos/geojson");
  }
  return readStaticJson<PoligonosCollection>("/data/poligonos.geojson");
}

export async function getPoligonoFeature(
  id: string,
): Promise<PoligonoFeature | null> {
  const collection = await getPoligonos();
  return collection.features.find((f) => f.properties.id === id) ?? null;
}

export async function getSerieTemporal(
  poligonoId?: string,
): Promise<SerieTemporalRow[]> {
  const rows = await readStaticCsv<SerieTemporalRow>("/data/serie_temporal.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getPoblacion(
  poligonoId?: string,
): Promise<PoblacionRow[]> {
  const rows = await readStaticCsv<PoblacionRow>("/data/poblacion.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getServicios(
  poligonoId?: string,
): Promise<ServicioRow[]> {
  const rows = await readStaticCsv<ServicioRow>("/data/servicios.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getVulnerabilidad(
  poligonoId?: string,
): Promise<VulnerabilidadRow[]> {
  const rows = await readStaticCsv<VulnerabilidadRow>(
    "/data/vulnerabilidad.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getPoligonoDetalle(
  id: string,
): Promise<PoligonoDetalle | null> {
  const feature = await getPoligonoFeature(id);
  if (!feature) return null;
  const [serie_temporal, poblacion, servicios, vulnerabilidadRows] =
    await Promise.all([
      getSerieTemporal(id),
      getPoblacion(id),
      getServicios(id),
      getVulnerabilidad(id),
    ]);
  return {
    properties: feature.properties,
    serie_temporal,
    poblacion,
    servicios,
    vulnerabilidad: vulnerabilidadRows[0] ?? null,
  };
}

export async function getUpdatedAt(): Promise<string> {
  try {
    return (await readPublicFile("/data/updated_at.txt")).trim();
  } catch {
    return "";
  }
}
