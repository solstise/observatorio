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

// CHIRPS (Climate Hazards InfraRed Precipitation with Station data).
// Precipitacion mensual 0.05 grados, resamplada a totales anuales y
// estacionales (verano oct-mar, invierno abr-sep). Valores en mm.
export interface ChirpsRow {
  poligono_id: string;
  anio: number;
  precip_mm_anual: number;
  precip_mm_verano: number;
  precip_mm_invierno: number;
}

// Sentinel-5P TROPOMI NO2 troposferico. Columna media en mol/m2 y
// ratio relativo al promedio del bbox Posadas (>1 = peor que el
// promedio local, <1 = mejor calidad de aire relativa).
export interface No2Row {
  poligono_id: string;
  anio: number;
  no2_mean_mol_m2: number;
  no2_relativo_bbox: number;
}

// MODIS Land Surface Temperature (MOD11A2 / MYD11A2): temperatura de
// superficie dia/noche promedio en verano e invierno, y delta de isla
// de calor urbana contra el promedio del bbox Posadas. En grados C.
export interface LstRow {
  poligono_id: string;
  anio: number;
  lst_dia_verano_c: number;
  lst_noche_verano_c: number;
  lst_dia_invierno_c: number;
  lst_noche_invierno_c: number;
  isla_calor_c: number;
}

// FIRMS (Fire Information for Resource Management System, NASA):
// focos de calor detectados por VIIRS / MODIS. n_focos es conteo
// anual y pct_area_afectada es el porcentaje del poligono quemado.
export interface FirmsRow {
  poligono_id: string;
  anio: number;
  n_focos: number;
  pct_area_afectada: number;
}

// WDPA (World Database on Protected Areas, UNEP-WCMC): interseccion
// del poligono con areas protegidas. intersecta_ap puede venir como
// boolean nativo o string "True"/"False" desde papaparse segun
// configuracion. Se normaliza en el componente consumidor.
export interface WdpaRow {
  poligono_id: string;
  intersecta_ap: boolean | string;
  nombre_ap: string;
  pct_area_protegida: number;
}
