// Tipos compartidos del Observatorio Urbano Posadas.
// Espejo de los esquemas del backend (webapp/backend/models.py).

export type CategoriaPoligono =
  | "expansion_activa"
  | "emergente"
  | "consolidado"
  | "desconocido";

export interface PoligonoProperties {
  id: string;
  nombre: string;
  categoria: CategoriaPoligono;
  score_expansion: number;
  superficie_km2: number;
  poblacion_estimada: number;
  edificios_2018: number;
  edificios_2026: number;
  _synthetic?: boolean;
}

export interface PoligonoFeature {
  type: "Feature";
  properties: PoligonoProperties;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}

export interface PoligonosCollection {
  type: "FeatureCollection";
  features: PoligonoFeature[];
  _synthetic?: boolean;
  _generated_at?: string;
  _note?: string;
}

export interface SerieTemporalRow {
  poligono_id: string;
  anio: number;
  superficie_construida_km2: number;
  superficie_vegetacion_km2: number;
  edificios_total: number;
  confianza_inferior: number;
  confianza_superior: number;
}

export interface PoblacionRow {
  poligono_id: string;
  anio: number;
  poblacion_estimada: number;
  densidad_hab_km2: number;
  confianza_inferior: number;
  confianza_superior: number;
}

export interface ServicioRow {
  poligono_id: string;
  servicio: string;
  cobertura_pct: number;
  fuente: string;
  anio_referencia: number;
}

export interface VulnerabilidadRow {
  poligono_id: string;
  indice_vulnerabilidad: number;
  carencia_servicios: number;
  riesgo_inundacion: number;
  accesibilidad_salud: number;
  accesibilidad_educacion: number;
  confianza_inferior: number;
  confianza_superior: number;
}

export interface PoligonoDetalle {
  properties: PoligonoProperties;
  serie_temporal: SerieTemporalRow[];
  poblacion: PoblacionRow[];
  servicios: ServicioRow[];
  vulnerabilidad: VulnerabilidadRow | null;
}

// Nuevos datasets satelitales / poblacionales que enriquecen la ficha
// del poligono. Todos se leen desde CSVs en /public/data/.

// Dynamic World (Google): probabilidad de superficie construida,
// derivada de Sentinel-2 segmentado por Deep Learning.
// dw_built_pct_ge_50 viene expresado en fraccion 0-1 (no 0-100).
export interface DynamicWorldRow {
  poligono_id: string;
  fecha: string; // YYYY-MM
  dw_built_mean: number;
  dw_built_median: number;
  dw_built_pct_ge_50: number;
  dw_n_images?: number;
}

// Sentinel-1 (SAR): retrodispersion VV/VH en dB para deteccion de
// cambios estructurales (edificacion nueva, demoliciones, movimientos
// de tierra). delta_vv_mean_db es null en la primera fecha de cada
// poligono (no hay referencia anterior).
export interface Sentinel1Row {
  poligono_id: string;
  fecha: string;
  s1_vv_mean_db: number;
  s1_vh_mean_db: number;
  s1_cross_ratio: number;
  delta_vv_mean_db: number | null;
}

// MapBiomas Argentina Col.1: clasificacion anual de cobertura del
// suelo 1998-2022 a partir de Landsat. Porcentajes 0-100.
// clase_dominante es el codigo numerico de la clase MapBiomas.
export interface MapBiomasRow {
  poligono_id: string;
  anio: number;
  pct_urbano: number;
  pct_vegetacion: number;
  pct_agua: number;
  pct_cultivos: number;
  clase_dominante: number | string;
}

// GHSL P2023A (Global Human Settlement Layer): superficie construida
// y poblacion estimada cada 5 anios desde 1975, con proyecciones
// hasta 2030. pct_built en 0-100.
export interface GhslRow {
  poligono_id: string;
  anio: number;
  built_surface_m2: number;
  pop_estimada: number;
  pct_built: number;
  densidad_pop_km2: number;
}

// VIIRS/NOAA Nightlights: radiancia nocturna media del poligono,
// muestreada en enero y julio de cada anio desde 2014. Proxy de
// actividad humana y consolidacion urbana.
export interface ViirsRow {
  poligono_id: string;
  fecha: string; // YYYY-MM o YYYY-MM-DD segun fuente
  viirs_mean: number;
  viirs_sum: number;
}
