// Capa de datos para Server Components (SSR / build / generateStaticParams).
//
// Lee directamente del filesystem (public/data/) con fs. NO importar desde
// Client Components — daría errores de bundling.
//
// Tiene `import "server-only"` al tope para que Next.js falle rápido si
// alguien intenta usarlo desde un componente cliente.

import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import Papa from "papaparse";

import type {
  DynamicWorldRow,
  GhslRow,
  MapBiomasRow,
  PoblacionRow,
  PoligonoDetalle,
  PoligonoFeature,
  PoligonosCollection,
  SerieTemporalRow,
  Sentinel1Row,
  ServicioRow,
  ViirsRow,
  VulnerabilidadRow,
} from "./types";

async function readPublicFile(relativePath: string): Promise<string> {
  const normalized = relativePath.replace(/^\//, "");
  const full = path.join(process.cwd(), "public", normalized);
  return readFile(full, "utf-8");
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
  const rows = await readStaticCsv<VulnerabilidadRow>("/data/vulnerabilidad.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

// Lectura resiliente: si el CSV todavia no existe en disco, devolvemos
// [] para que el componente degrade graciosamente (NO crashear el SSR).
async function readStaticCsvOptional<T>(
  relativePath: string,
): Promise<T[]> {
  try {
    return await readStaticCsv<T>(relativePath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`CSV opcional no disponible: ${relativePath}`, err);
    return [];
  }
}

export async function getDynamicWorld(
  poligonoId?: string,
): Promise<DynamicWorldRow[]> {
  const rows = await readStaticCsvOptional<DynamicWorldRow>(
    "/data/dynamic_world.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getSentinel1(
  poligonoId?: string,
): Promise<Sentinel1Row[]> {
  const rows = await readStaticCsvOptional<Sentinel1Row>(
    "/data/sentinel1.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getMapBiomas(
  poligonoId?: string,
): Promise<MapBiomasRow[]> {
  const rows = await readStaticCsvOptional<MapBiomasRow>(
    "/data/mapbiomas.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getGhsl(poligonoId?: string): Promise<GhslRow[]> {
  const rows = await readStaticCsvOptional<GhslRow>("/data/ghsl.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getViirs(poligonoId?: string): Promise<ViirsRow[]> {
  const rows = await readStaticCsvOptional<ViirsRow>("/data/viirs.csv");
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
