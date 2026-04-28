// Capa server-only para resolver la "frescura" de cada dataset publicado.
//
// Idealmente cada CSV/JSON viene con su propio timestamp de generación.
// En la práctica algunos lo traen embebido (header `# generated_at: ...`,
// columna `fecha_calculo`, o JSON con campo `generated_at`) y otros no.
//
// Para esos últimos caemos a `mtime` del archivo. No es ideal — un rsync
// puede tocar mtime sin que el contenido haya cambiado — pero sirve como
// proxy razonable mientras los pipelines no incorporen metadata.
//
// Estrategia de resolución (por orden de preferencia):
//   1. JSON con campo `generated_at` (forecast/_metadata.json,
//      forecast/alertas_activas.json)
//   2. CSV con columna `fecha_calculo` (sentinel1, dynamic_world)
//   3. CSV con header de comentario `# generated_at: ISO`
//   4. Sidecar `<csv>.meta.json` con `generated_at`
//   5. Fallback: mtime del archivo en disco
//
// Cualquier fallo se degrada a un objeto con `lastUpdated=""`. El componente
// `<DataFreshness>` interpreta string vacío como "rojo, sin datos".

import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import Papa from "papaparse";

// Frecuencias soportadas. Las strings que no estén acá pasan tal cual al
// componente y la lógica `freshness()` (en el componente cliente) cae a
// los umbrales por defecto.
// `trimestral` se sumó para CBERS-4A WPM (revisita real ~31 días pero el
// cron procesa el último composite "estable" cada 3 meses para amortizar
// la transferencia de S3 INPE, que es pesada).
// `semanal` se sumó para eventos de inundación: el detector multi-sensor
// (SAR + óptico) corre semanalmente para reaccionar a eventos extremos.
export type Frequency =
  | "6h"
  | "diario"
  | "semanal"
  | "mensual"
  | "trimestral"
  | "anual";

// Etiqueta amigable para mostrar al usuario en el badge de "espera".
const FREQUENCY_LABEL: Record<Frequency, string> = {
  "6h": "cada 6 horas",
  diario: "diario",
  semanal: "semanal",
  mensual: "mensual",
  trimestral: "trimestral",
  anual: "anual",
};

export interface DatasetEntry {
  /** Etiqueta humana corta — "Pronóstico clima" en lugar de "forecast". */
  label: string;
  /** Frecuencia esperada de refresh — usada para colorear el dot. */
  frequency: Frequency;
  /**
   * Path al archivo principal del dataset (relativo a `public/`).
   * Sin slash inicial. Ej: `data/calor/lst_mensual.csv`.
   */
  source: string;
  /** Fuente del dato (humano) — "Open-Meteo", "USGS Landsat", etc. */
  fuente: string;
  /**
   * Estrategia de extracción del timestamp. Si se omite, usamos heurística:
   * `.json` → leemos `generated_at` del root, `.csv` → leemos
   * `fecha_calculo` de la última fila o, en su defecto, el header
   * `# generated_at: ...`. Si nada funciona, mtime.
   */
  strategy?: "json-generated-at" | "csv-fecha-calculo" | "csv-header" | "mtime";
}

// Catálogo central. Mantener ordenado por importancia/visibilidad — los
// 5 primeros son los que aparecen en el footer compacto.
export const DATASET_INFO: Record<string, DatasetEntry> = {
  forecast: {
    label: "Pronóstico clima",
    frequency: "6h",
    source: "data/forecast/_metadata.json",
    fuente: "Open-Meteo Ensemble (ECMWF + GFS + ICON + JMA + GEM + BoM)",
    strategy: "json-generated-at",
  },
  alertas: {
    label: "Alertas activas",
    frequency: "6h",
    source: "data/forecast/alertas_activas.json",
    fuente: "Open-Meteo + reglas config/alertas.yaml",
    strategy: "json-generated-at",
  },
  calor_landsat: {
    label: "Calor urbano (Landsat)",
    frequency: "mensual",
    source: "data/calor/lst_mensual.csv",
    fuente: "USGS Landsat 8/9 Collection 2 — banda térmica ST_B10",
  },
  aire_no2: {
    label: "Calidad del aire (NO₂)",
    frequency: "mensual",
    source: "data/no2.csv",
    fuente: "ESA Sentinel-5P TROPOMI",
  },
  dynamic_world: {
    label: "Cobertura del suelo (Dynamic World)",
    frequency: "mensual",
    source: "data/dynamic_world.csv",
    fuente: "Google + WRI Dynamic World V1",
    strategy: "csv-fecha-calculo",
  },
  sentinel1: {
    label: "Cambio estructural (Sentinel-1)",
    frequency: "mensual",
    source: "data/sentinel1.csv",
    fuente: "ESA Sentinel-1 SAR GRD",
    strategy: "csv-fecha-calculo",
  },
  chirps: {
    label: "Lluvias (CHIRPS)",
    frequency: "mensual",
    source: "data/chirps.csv",
    fuente: "USGS Climate Hazards InfraRed",
  },
  firms: {
    label: "Focos de incendio (FIRMS)",
    frequency: "diario",
    source: "data/firms.csv",
    fuente: "NASA FIRMS (VIIRS / MODIS)",
  },
  mapbiomas: {
    label: "Uso del suelo (MapBiomas)",
    frequency: "anual",
    source: "data/mapbiomas.csv",
    fuente: "MapBiomas Argentina Col.1",
  },
  ghsl: {
    label: "Huella urbana (GHSL)",
    frequency: "anual",
    source: "data/ghsl.csv",
    fuente: "Global Human Settlement Layer (JRC)",
  },
  viirs: {
    label: "Luces nocturnas (VIIRS)",
    frequency: "mensual",
    source: "data/viirs.csv",
    fuente: "NOAA VIIRS Day-Night Band",
  },
  viviendas: {
    label: "Conteo de viviendas",
    frequency: "anual",
    source: "data/serie_temporal.csv",
    fuente: "Google Open Buildings + Microsoft Building Footprints",
  },
  ranking: {
    label: "Ranking de prioridades",
    frequency: "anual",
    source: "data/social/ranking.csv",
    fuente: "Combinación interna (script 54)",
  },
  // CBERS-4A WPM pansharpen — capa de imagen alta resolución (5-8 m).
  // El pipeline Python (S-A) genera `_metadata.json` con `generated_at`,
  // así que la estrategia json-generated-at lo resuelve directo. Si el
  // archivo aún no existe (S-A todavía no corrió por primera vez),
  // resolveTimestamp degrada a string vacío → DataFreshness pinta rojo.
  cbers_pansharpen: {
    label: "Imagen alta resolución (CBERS)",
    frequency: "trimestral",
    // sync_webapp.py copia el _metadata.json del CBERS pansharpen a
    // data/media/cbers/_metadata.json (junto con los PNGs, no a la raíz).
    source: "data/media/cbers/_metadata.json",
    fuente: "INPE/CRESDA CBERS-4A WPM (pan 8 m + MS 16 m, pansharpen)",
    strategy: "json-generated-at",
  },
  // CBERS PAN5 (5 m B&N): la pancromática nativa de CBERS-4 sobre la WPM.
  // Mayor detalle espacial que el WPM color, sin información cromática.
  // T1 publica los PNG en `/data/media/cbers_pan5/` y un metadata JSON
  // sidecar para resolver `generated_at` deterministically.
  cbers_pan5: {
    label: "Imagen ultra-detalle (CBERS PAN5)",
    frequency: "trimestral",
    source: "data/cbers_pan5/_metadata.json",
    fuente: "INPE CBERS-4 PAN5 (banda pancromática 5 m B&N)",
    strategy: "json-generated-at",
  },
  // LST térmica derivada del IRS de CBERS-4 (40 m TIR). Backup para
  // ventanas mensuales sin observación Landsat. El CSV agrega `mes`/`anio`
  // así que `mtime` del archivo es un proxy razonable de su frescura.
  cbers_termico: {
    label: "Calor urbano backup (CBERS IRS)",
    frequency: "mensual",
    source: "data/cbers_termico/lst_cbers.csv",
    fuente: "INPE CBERS-4 IRS (banda térmica 40 m + SWIR 80 m)",
  },
  // Validación cruzada FIRMS (NASA) vs CBERS SWIR. Mensual: el comparador
  // corre tras cada update de FIRMS para mantener el agreement_pct fresco.
  cbers_swir_firms: {
    label: "Validación cruzada incendios (CBERS SWIR + FIRMS)",
    frequency: "mensual",
    source: "data/cbers_swir/firms_crossval.csv",
    fuente: "NASA FIRMS + INPE CBERS-4 IRS SWIR",
  },
  // Cobertura mensual S2 + AWFI: cuántas observaciones limpias entraron
  // en cada composite. Útil para explicar al lector por qué un mes tiene
  // gaps. AWFI agrega un swath de 866 km cada 5 días.
  cbers_awfi: {
    label: "Cobertura satelital mensual (S2 + CBERS AWFI)",
    frequency: "mensual",
    source: "data/cbers_awfi/cobertura.csv",
    fuente: "ESA Sentinel-2 + INPE CBERS-4A AWFI (64 m, swath 866 km)",
  },
  // Serie histórica 1999-2026 — pansharpen anual de Posadas usando lo
  // mejor disponible cada año (CBERS-1/2/2B/4/4A). Conceptualmente "anual"
  // pero el dataset es cuasi-estable: refresca solo cuando T1 reprocesa
  // un año específico.
  cbers_historico: {
    label: "Serie histórica Posadas (CBERS 1999-2026)",
    frequency: "anual",
    source: "data/cbers_historico/serie.csv",
    fuente: "INPE CBERS-1/2/2B/4/4A — composite anual pansharpen",
  },
  // Validación cruzada NDBI/NDVI: S2 vs CBERS WPM. Cuando dos sensores
  // coinciden sube la confianza. Mensual: corre tras cada update de S2.
  cbers_indices: {
    label: "Validación cruzada de índices urbanos",
    frequency: "mensual",
    source: "data/cbers_indices/ndbi_ndvi.csv",
    fuente: "ESA Sentinel-2 + INPE CBERS-4A WPM (NDBI, NDVI)",
  },
  // Eventos de inundación detectados vía composite multi-sensor (SAR +
  // óptico). Frecuencia semanal o on-event según severidad. Si no hay
  // eventos detectados el CSV puede tener 0 filas (válido, no es error).
  cbers_inundacion: {
    label: "Eventos de inundación detectados",
    frequency: "semanal",
    source: "data/cbers_inundacion/eventos.csv",
    fuente: "Composite multi-sensor: Sentinel-1 SAR + S2 + CBERS-4A WPM",
  },
};

// Datasets a mostrar en el footer compacto. Orden = importancia.
export const FOOTER_DATASETS: readonly string[] = [
  "forecast",
  "alertas",
  "calor_landsat",
  "viviendas",
  "ranking",
  "cbers_pansharpen",
] as const;

export interface FreshnessResult {
  /** ISO timestamp del último refresh. String vacío si no se pudo resolver. */
  lastUpdated: string;
  /** Frecuencia esperada — string que el componente entiende. */
  frequency: string;
  /** Etiqueta humana del dataset (o el slug si no está en el catálogo). */
  label: string;
  /** Fuente de los datos (texto humano). */
  fuente: string;
}

// Resuelve la ruta absoluta dentro de /public para un path relativo del
// catálogo. Acepta tanto "data/foo.csv" como "/data/foo.csv".
function resolvePublic(relative: string): string {
  const normalized = relative.replace(/^\//, "");
  return path.join(process.cwd(), "public", normalized);
}

async function readJsonGeneratedAt(absPath: string): Promise<string | null> {
  try {
    const text = await readFile(absPath, "utf-8");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const ts = obj.generated_at;
    if (typeof ts === "string" && ts.length > 0) {
      // El script genera timestamps locales sin TZ ("2026-04-25T22:24:36").
      // Asumimos que vienen en hora local de Argentina (-03:00) — coincide
      // con el TZ del cron y de los servidores. Si algún día migran a UTC
      // estricto, este append es seguro de eliminar.
      if (/[zZ+\-]\d{2}:?\d{2}$/.test(ts)) return ts;
      if (/Z$/.test(ts)) return ts;
      return `${ts}-03:00`;
    }
  } catch {
    // ignored — caemos a mtime
  }
  return null;
}

// Lee la última fila del CSV y extrae `fecha_calculo`. Como las filas
// del mismo run comparten ese timestamp, agarramos la última no-vacía.
async function readCsvFechaCalculo(absPath: string): Promise<string | null> {
  try {
    const text = await readFile(absPath, "utf-8");
    const parsed = Papa.parse<Record<string, string | number | null>>(text, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      comments: "#",
    });
    const rows = parsed.data;
    for (let i = rows.length - 1; i >= 0; i--) {
      const v = rows[i]?.fecha_calculo;
      if (typeof v === "string" && v.length > 0) {
        if (/[zZ+\-]\d{2}:?\d{2}$/.test(v)) return v;
        if (/Z$/.test(v)) return v;
        return `${v}-03:00`;
      }
    }
  } catch {
    // ignored
  }
  return null;
}

// Lee el header de comentario `# generated_at: 2026-04-25T...` si está
// presente en las primeras líneas del CSV.
async function readCsvHeaderTimestamp(absPath: string): Promise<string | null> {
  try {
    const text = await readFile(absPath, "utf-8");
    const head = text.slice(0, 500);
    const match = head.match(/^#\s*generated_at\s*:\s*(\S+)/im);
    if (match) {
      const v = match[1];
      if (/[zZ+\-]\d{2}:?\d{2}$/.test(v)) return v;
      if (/Z$/.test(v)) return v;
      return `${v}-03:00`;
    }
  } catch {
    // ignored
  }
  return null;
}

async function readMtime(absPath: string): Promise<string | null> {
  try {
    const s = await stat(absPath);
    return s.mtime.toISOString();
  } catch {
    return null;
  }
}

// Resolución robusta: aplica la estrategia declarada y, si falla, recorre
// las demás antes de caer a mtime. Esto le da a cada CSV/JSON la mejor
// chance de aportar su timestamp real sin necesidad de tocar pipelines.
async function resolveTimestamp(
  entry: DatasetEntry,
): Promise<string> {
  const abs = resolvePublic(entry.source);
  const isJson = entry.source.endsWith(".json");

  // Orden preferido por estrategia explícita; luego intentamos las demás.
  const order: Array<DatasetEntry["strategy"] | undefined> = [
    entry.strategy,
    isJson ? "json-generated-at" : "csv-fecha-calculo",
    "csv-header",
    "mtime",
  ];

  // Dedup preservando orden.
  const seen = new Set<string>();
  for (const strat of order) {
    if (!strat || seen.has(strat)) continue;
    seen.add(strat);
    let ts: string | null = null;
    if (strat === "json-generated-at") {
      ts = await readJsonGeneratedAt(abs);
    } else if (strat === "csv-fecha-calculo") {
      ts = await readCsvFechaCalculo(abs);
    } else if (strat === "csv-header") {
      ts = await readCsvHeaderTimestamp(abs);
    } else if (strat === "mtime") {
      ts = await readMtime(abs);
    }
    if (ts) return ts;
  }
  return "";
}

/**
 * Devuelve la frescura del dataset solicitado. Si el slug no está en el
 * catálogo, devuelve un objeto degradado (label = slug, lastUpdated = "").
 *
 * Es safe para llamar desde Server Components — no hace network ni cachea.
 * En build time se ejecuta una vez por página; en SSR runtime se ejecuta
 * por request, lo cual está bien porque solo lee del filesystem local.
 */
export async function getDatasetFreshness(
  dataset: string,
): Promise<FreshnessResult> {
  const entry = DATASET_INFO[dataset];
  if (!entry) {
    return {
      lastUpdated: "",
      frequency: "desconocida",
      label: dataset,
      fuente: "—",
    };
  }
  const lastUpdated = await resolveTimestamp(entry);
  return {
    lastUpdated,
    frequency: FREQUENCY_LABEL[entry.frequency],
    label: entry.label,
    fuente: entry.fuente,
  };
}

/**
 * Devuelve la frescura de varios datasets en paralelo. Útil para la página
 * /metodologia (sección "Frescura de datos") y para el footer.
 */
export async function getManyFreshness(
  datasets: readonly string[],
): Promise<Record<string, FreshnessResult>> {
  const entries = await Promise.all(
    datasets.map(
      async (d) => [d, await getDatasetFreshness(d)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

/** Lista todos los slugs registrados — útil para la tabla completa. */
export function listDatasets(): string[] {
  return Object.keys(DATASET_INFO);
}
