// Capa de datos para Client Components.
//
// Usa `fetch` hacia los archivos estáticos servidos desde /public/data/.
// NO usa fs ni módulos node:* — es compatible con el bundle del browser.
//
// Si necesitás SSR (Server Components), usá `data.server.ts`.

import Papa from "papaparse";

import type {
  CalorMensualRow,
  ChirpsRow,
  DynamicWorldRow,
  FirmsRow,
  GhslRow,
  LstRow,
  MapBiomasRow,
  No2Row,
  PoblacionRow,
  PoligonoDetalle,
  PoligonoFeature,
  PoligonosCollection,
  SerieTemporalRow,
  Sentinel1Row,
  ServicioRow,
  UhiEstacionalRow,
  UhiMensualRow,
  ViirsRow,
  VulnerabilidadRow,
  WdpaRow,
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

// Lectura resiliente de CSVs opcionales: si el archivo no existe
// todavia (por ejemplo durante el primer deploy), devolvemos [] en
// lugar de crashear la UI.
async function fetchCsvOptional<T>(relativePath: string): Promise<T[]> {
  try {
    return await fetchCsv<T>(relativePath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`CSV opcional no disponible: ${relativePath}`, err);
    return [];
  }
}

export async function getDynamicWorld(
  poligonoId?: string,
): Promise<DynamicWorldRow[]> {
  const rows = await fetchCsvOptional<DynamicWorldRow>(
    "/data/dynamic_world.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getSentinel1(
  poligonoId?: string,
): Promise<Sentinel1Row[]> {
  const rows = await fetchCsvOptional<Sentinel1Row>("/data/sentinel1.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getMapBiomas(
  poligonoId?: string,
): Promise<MapBiomasRow[]> {
  const rows = await fetchCsvOptional<MapBiomasRow>("/data/mapbiomas.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getGhsl(poligonoId?: string): Promise<GhslRow[]> {
  const rows = await fetchCsvOptional<GhslRow>("/data/ghsl.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getViirs(poligonoId?: string): Promise<ViirsRow[]> {
  const rows = await fetchCsvOptional<ViirsRow>("/data/viirs.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

// Capa ambiental (clima, aire, calor, fuegos, areas protegidas).
// Espejo del server data con fetch en lugar de fs.

export async function getChirps(poligonoId?: string): Promise<ChirpsRow[]> {
  const rows = await fetchCsvOptional<ChirpsRow>("/data/chirps.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getNo2(poligonoId?: string): Promise<No2Row[]> {
  const rows = await fetchCsvOptional<No2Row>("/data/no2.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getLst(poligonoId?: string): Promise<LstRow[]> {
  const rows = await fetchCsvOptional<LstRow>("/data/lst.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getFirms(poligonoId?: string): Promise<FirmsRow[]> {
  const rows = await fetchCsvOptional<FirmsRow>("/data/firms.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getWdpa(poligonoId?: string): Promise<WdpaRow[]> {
  const rows = await fetchCsvOptional<WdpaRow>("/data/wdpa.csv");
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

// ---------------------------------------------------------------------------
// Capa de calor urbano (Landsat LST + UHI)
// ---------------------------------------------------------------------------

export async function getCalorMensual(
  poligonoId?: string,
): Promise<CalorMensualRow[]> {
  const rows = await fetchCsvOptional<CalorMensualRow>("/data/calor/lst_mensual.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getUhiMensual(
  poligonoId?: string,
): Promise<UhiMensualRow[]> {
  const rows = await fetchCsvOptional<UhiMensualRow>("/data/calor/uhi_mensual.csv");
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getUhiEstacional(
  poligonoId?: string,
): Promise<UhiEstacionalRow[]> {
  const rows = await fetchCsvOptional<UhiEstacionalRow>(
    "/data/calor/uhi_estacional.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}
