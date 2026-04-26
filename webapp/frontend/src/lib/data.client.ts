// Capa de datos para Client Components.
//
// Usa `fetch` hacia los archivos estáticos servidos desde /public/data/.
// NO usa fs ni módulos node:* — es compatible con el bundle del browser.
//
// Si necesitás SSR (Server Components), usá `data.server.ts`.

import Papa from "papaparse";

import type {
  AireMultigasRow,
  AlertasPayload,
  AqiDiarioRow,
  CalorMensualRow,
  CbersHistoricoRow,
  ChirpsRow,
  CoberturaAwfiRow,
  DynamicWorldRow,
  EventoInundacionRow,
  FirmsCrossvalRow,
  FirmsRow,
  ForecastDiarioRow,
  ForecastHorarioRow,
  GhslRow,
  LstCbersRow,
  LstRow,
  MapBiomasRow,
  NdbiNdviCrossvalRow,
  No2Row,
  PoblacionRow,
  PoligonoDetalle,
  PoligonoFeature,
  PoligonosCollection,
  ProyeccionMetrica,
  ProyeccionRow,
  RankingPoliticoRow,
  SerieTemporalRow,
  Sentinel1Row,
  ServicioRow,
  SocialDistanciasRow,
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

// Devuelve solo los polígonos que son barrios — excluye capas de
// referencia como `posadas_completa` (categoria_original "ciudad_completa")
// para que rankings, coropletas y comparaciones operen sobre la unidad
// correcta de análisis.
export async function getPoligonosBarrios(): Promise<PoligonosCollection> {
  const all = await getPoligonos();
  return {
    ...all,
    features: all.features.filter(
      (f) => f.properties.categoria_original !== "ciudad_completa",
    ),
  };
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

// Aire multi-gas anual (script 48 — TROPOMI NO2/SO2/CO/HCHO/CH4/O3).
// Si todavía no se generó, devolvemos []; el componente decide caer al
// CSV legacy `no2.csv` para no dejar la UI vacía.
export async function getAireMultigas(
  poligonoId?: string,
): Promise<AireMultigasRow[]> {
  const rows = await fetchCsvOptional<AireMultigasRow>(
    "/data/ambiental/aire_multigas_anual.csv",
  );
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

// ---------------------------------------------------------------------------
// Descripciones automáticas de mapas (image-to-text con HF BLIP / placeholder)
// ---------------------------------------------------------------------------

// Output de scripts/_descripcion_mapas.py. Mapa filename → caption ES/EN.
// Si el archivo no existe (HF token nunca configurado, script nunca corrió),
// devolvemos `{}` y los consumidores usan el filename como fallback.
export interface MapaDescripcion {
  source: string;
  caption_en: string;
  caption_es: string;
  generated_at: string;
  method: "hf-blip" | "placeholder";
}

let descripcionesCache: Record<string, MapaDescripcion> | null = null;

export async function getDescripcionesMapas(): Promise<
  Record<string, MapaDescripcion>
> {
  if (descripcionesCache) return descripcionesCache;
  try {
    const data = await fetchJson<Record<string, MapaDescripcion>>(
      "/data/calor/mapas_descripciones.json",
    );
    descripcionesCache = data;
    return data;
  } catch {
    descripcionesCache = {};
    return {};
  }
}

// Helper: resolvé el caption en español de un PNG por filename. Devuelve
// undefined si no hay descripción registrada — el consumidor decide el
// fallback (típicamente, derivar uno del filename).
export async function getDescripcionMapa(
  filename: string,
): Promise<MapaDescripcion | undefined> {
  const all = await getDescripcionesMapas();
  return all[filename];
}

// ---------------------------------------------------------------------------
// Capa social — acceso a servicios y ranking político de prioridad
// ---------------------------------------------------------------------------

export async function getDistanciasSociales(
  poligonoId?: string,
): Promise<SocialDistanciasRow[]> {
  const rows = await fetchCsvOptional<SocialDistanciasRow>(
    "/data/social/distancias.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getRankingPolitico(
  poligonoId?: string,
): Promise<RankingPoliticoRow[]> {
  const rows = await fetchCsvOptional<RankingPoliticoRow>(
    "/data/social/ranking.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

// ---------------------------------------------------------------------------
// Capa de pronóstico climático (paquete A1+A2+A3+A4)
// ---------------------------------------------------------------------------

// Pronóstico diario por barrio (14 días por defecto, 6 modelos ensemble,
// percentiles p10/p50/p90 honestos). Si pasás `poligonoId`, devuelve
// solo las filas de ese barrio ordenadas por fecha.
export async function getForecastDiario(
  poligonoId?: string,
): Promise<ForecastDiarioRow[]> {
  const rows = await fetchCsvOptional<ForecastDiarioRow>(
    "/data/forecast/forecast_diario.csv",
  );
  if (!poligonoId) return rows;
  return rows
    .filter((r) => r.poligono_id === poligonoId)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

// Bloque horario (Posadas centro) para gráficos finos próximas 72 h.
export async function getForecastHorario(): Promise<ForecastHorarioRow[]> {
  return fetchCsvOptional<ForecastHorarioRow>(
    "/data/forecast/forecast_horario.csv",
  );
}

// AQI diario europeo. Se aplica a Posadas global (no se desagrega).
export async function getAqiDiario(): Promise<AqiDiarioRow[]> {
  return fetchCsvOptional<AqiDiarioRow>("/data/forecast/aqi_diario.csv");
}

// Alertas climáticas activas. Si el JSON falta o es inválido,
// devolvemos un payload vacío para no romper la UI.
export async function getAlertasActivas(): Promise<AlertasPayload> {
  try {
    return await fetchJson<AlertasPayload>(
      "/data/forecast/alertas_activas.json",
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("Alertas no disponibles", err);
    return {
      generated_at: "",
      script_version: "",
      n_alertas: 0,
      ventana_dias: 0,
      alertas: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Capa de proyecciones a futuro (script 59)
// ---------------------------------------------------------------------------

// Devuelve las filas de proyección, opcionalmente filtradas por polígono
// y/o métrica. Si el CSV no existe (primer deploy, script no corrido)
// devolvemos []. El consumidor decide cómo degradar.
export async function getProyecciones(
  poligonoId?: string,
  metrica?: ProyeccionMetrica,
): Promise<ProyeccionRow[]> {
  const rows = await fetchCsvOptional<ProyeccionRow>(
    "/data/proyecciones/proyecciones.csv",
  );
  return rows.filter(
    (r) =>
      (!poligonoId || r.poligono_id === poligonoId) &&
      (!metrica || r.metrica === metrica),
  );
}

// ---------------------------------------------------------------------------
// Capa CBERS (T1) — backup térmico, cross-val FIRMS, AWFI, histórico,
// índices NDBI/NDVI, eventos de inundación.
//
// Todos los CSV son emitidos por T1 (pipelines paralelos). Si T1 todavía no
// los publicó, los getters devuelven [] y los componentes degradan a un
// skeleton + texto "Datos en preparación, primer cron mensual los publicará".
// ---------------------------------------------------------------------------

export async function getLstCbers(
  poligonoId?: string,
): Promise<LstCbersRow[]> {
  const rows = await fetchCsvOptional<LstCbersRow>(
    "/data/cbers_termico/lst_cbers.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getFirmsCrossval(
  poligonoId?: string,
): Promise<FirmsCrossvalRow[]> {
  const rows = await fetchCsvOptional<FirmsCrossvalRow>(
    "/data/cbers_swir/firms_crossval.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getCoberturaAwfi(): Promise<CoberturaAwfiRow[]> {
  return fetchCsvOptional<CoberturaAwfiRow>("/data/cbers_awfi/cobertura.csv");
}

export async function getCbersHistorico(): Promise<CbersHistoricoRow[]> {
  return fetchCsvOptional<CbersHistoricoRow>(
    "/data/cbers_historico/serie.csv",
  );
}

export async function getNdbiNdviCrossval(
  poligonoId?: string,
): Promise<NdbiNdviCrossvalRow[]> {
  const rows = await fetchCsvOptional<NdbiNdviCrossvalRow>(
    "/data/cbers_indices/ndbi_ndvi.csv",
  );
  if (!poligonoId) return rows;
  return rows.filter((r) => r.poligono_id === poligonoId);
}

export async function getEventosInundacion(): Promise<EventoInundacionRow[]> {
  return fetchCsvOptional<EventoInundacionRow>(
    "/data/cbers_inundacion/eventos.csv",
  );
}
