// Capa de datos del frontend.
// Si existe NEXT_PUBLIC_API_BASE, se usa el backend FastAPI.
// Si no, se leen archivos estaticos de /data/*.csv y /data/*.geojson.

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

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Error ${res.status} al leer ${path}`);
  }
  return (await res.json()) as T;
}

async function fetchCsv<T>(path: string): Promise<T[]> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Error ${res.status} al leer ${path}`);
  }
  const text = await res.text();
  const parsed = Papa.parse<T>(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    comments: "#",
  });
  if (parsed.errors.length) {
    // No tiramos error para que un CSV sintetico con warnings no rompa el UI.
    // eslint-disable-next-line no-console
    console.warn("Advertencias al parsear", path, parsed.errors);
  }
  return parsed.data;
}

// Expuesto para uso server/client.
export async function getPoligonos(): Promise<PoligonosCollection> {
  if (API_BASE) {
    return fetchJson<PoligonosCollection>(`${API_BASE}/api/poligonos`);
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
    const res = await fetch("/data/updated_at.txt", { cache: "no-store" });
    if (!res.ok) return "";
    return (await res.text()).trim();
  } catch {
    return "";
  }
}
