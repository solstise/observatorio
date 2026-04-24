// Capa de datos para Client Components.
//
// Usa `fetch` hacia los archivos estáticos servidos desde /public/data/.
// NO usa fs ni módulos node:* — es compatible con el bundle del browser.
//
// Si necesitás SSR (Server Components), usá `data.server.ts`.

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

async function fetchText(relativePath: string): Promise<string> {
  // En el cliente (browser) fetch relativo funciona contra el server que
  // sirve `public/`. Si definimos una API externa, redirigimos a ella.
  const url = API_BASE
    ? `${API_BASE}${relativePath}`
    : relativePath;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Error ${res.status} al leer ${url}`);
  }
  return res.text();
}

async function fetchJson<T>(relativePath: string): Promise<T> {
  const text = await fetchText(relativePath);
  return JSON.parse(text) as T;
}

async function fetchCsv<T>(relativePath: string): Promise<T[]> {
  const text = await fetchText(relativePath);
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
    return fetchJson<PoligonosCollection>(`${API_BASE}/api/poligonos/geojson`);
  }
  return fetchJson<PoligonosCollection>("/data/poligonos.geojson");
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
  const rows = await fetchCsv<SerieTemporalRow>("/data/serie_temporal.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getPoblacion(
  poligonoId?: string,
): Promise<PoblacionRow[]> {
  const rows = await fetchCsv<PoblacionRow>("/data/poblacion.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getServicios(
  poligonoId?: string,
): Promise<ServicioRow[]> {
  const rows = await fetchCsv<ServicioRow>("/data/servicios.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getVulnerabilidad(
  poligonoId?: string,
): Promise<VulnerabilidadRow[]> {
  const rows = await fetchCsv<VulnerabilidadRow>("/data/vulnerabilidad.csv");
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
    return (await fetchText("/data/updated_at.txt")).trim();
  } catch {
    return "";
  }
}
