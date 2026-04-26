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
  // Slug original del pipeline (asentamiento_crecimiento_rapido,
  // consolidado_crecimiento, control_consolidado, zona_sensible o
  // ciudad_completa). Lo usamos para filtrar el contorno de la ciudad
  // (`ciudad_completa`) de rankings, coropletas y comparaciones.
  categoria_original?: string;
  score_expansion: number;
  superficie_km2: number;
  poblacion_estimada: number;
  edificios_2018: number;
  edificios_2026: number;
  // Flag editorial opcional usado por sitemap.ts para excluir polígonos
  // del SEO sin removerlos del dataset (default true cuando ausente).
  publicar_en_sitio?: boolean;
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

// Sentinel-5P TROPOMI multi-gas anual (output script 48).
// Cada gas tiene además un n_imagenes_<gas> que cuenta cuántas
// observaciones diarias L3 entraron en la media. CH4 y O3 vienen con
// `*_calidad="baja"` siempre (resolución espacial pobre y/o columna
// total atmosférica respectivamente). Cualquier columna numérica
// puede llegar como null si TROPOMI no tuvo cobertura ese año.
export interface AireMultigasRow {
  poligono_id: string;
  anio: number;
  no2_mol_m2: number | null;
  no2_relativo_bbox: number | null;
  n_imagenes_no2: number;
  so2_mol_m2: number | null;
  n_imagenes_so2: number;
  co_mol_m2: number | null;
  n_imagenes_co: number;
  hcho_mol_m2: number | null;
  n_imagenes_hcho: number;
  ch4_ppb: number | null;
  n_imagenes_ch4: number;
  ch4_calidad: "alta" | "baja";
  o3_du: number | null;
  n_imagenes_o3: number;
  o3_calidad: "alta" | "baja";
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

// ---------------------------------------------------------------------------
// Capa de calor urbano (Landsat LST + UHI)
// ---------------------------------------------------------------------------

// Estadísticas mensuales de LST por polígono (urbanos + rurales baseline).
// Si pct_validos < 30, los valores numéricos vienen como null (CSV vacío).
export interface CalorMensualRow {
  poligono_id: string;
  tipo_poligono: "urbano" | "rural";
  anio: number;
  mes: number;
  pct_validos: number;
  count_validos: number;
  lst_mean: number | null;
  lst_median: number | null;
  lst_std: number | null;
  lst_p10: number | null;
  lst_p90: number | null;
  lst_max: number | null;
}

// UHI mensual por polígono urbano: 3 métricas + stats del histórico.
// uhi_anomalia es null cuando no hay años anteriores del mismo mes.
export interface UhiMensualRow {
  poligono_id: string;
  anio: number;
  mes: number;
  lst_mean: number;
  uhi_vs_rural: number;
  uhi_vs_ciudad: number;
  uhi_anomalia: number | null;
  lst_rural_baseline: number;
  n_observaciones_historico: number;
  std_historico: number | null;
}

// Agregación estacional (verano DJF, otoño MAM, invierno JJA, primavera SON).
export interface UhiEstacionalRow {
  poligono_id: string;
  anio: number;
  estacion: "verano" | "otono" | "invierno" | "primavera";
  uhi_vs_rural_mean: number;
  uhi_vs_ciudad_mean: number;
  lst_mean: number;
  n_meses: number;
}

// ---------------------------------------------------------------------------
// Capa social (acceso a servicios + ranking político de prioridad)
// ---------------------------------------------------------------------------

// Output de scripts/53_servicios_distancias.py. Para cada polígono, distancia
// mínima en metros desde el centroide a la categoría correspondiente, y
// densidad de servicios por km² (puntos dentro del polígono / area_km2).
// Las distancias pueden venir null cuando la fuente correspondiente no
// tiene puntos en el bbox de Posadas.
export interface SocialDistanciasRow {
  poligono_id: string;
  area_km2: number;
  dist_caps_m: number | null;
  dist_escuela_m: number | null;
  dist_hospital_m: number | null;
  dist_transporte_m: number | null;
  n_caps_dentro: number;
  n_escuela_dentro: number;
  n_hospital_dentro: number;
  n_transporte_dentro: number;
  densidad_caps_km2: number;
  densidad_escuela_km2: number;
  densidad_transporte_km2: number;
  fuente_caps: string;
  fuente_hospital: string;
  fuente_escuela: string;
  fuente_transporte: string;
}

// Output de scripts/54_ranking_politico.py. indice_prioridad ∈ [0, 1],
// mayor = mayor prioridad de inversión política.
// Si vulnerabilidad o uhi_verano son null, el script los neutraliza a 0.5
// en el cálculo del componente normalizado pero deja la columna cruda en
// null para trazabilidad.
export interface RankingPoliticoRow {
  poligono_id: string;
  vulnerabilidad: number | null;
  uhi_verano: number | null;
  dist_caps_m: number | null;
  dist_escuela_m: number | null;
  dist_hospital_m: number | null;
  dist_transporte_m: number | null;
  vulnerabilidad_norm: number;
  uhi_verano_norm: number;
  acceso_servicios_norm: number;
  indice_prioridad: number;
  ranking: number;
}

// ---------------------------------------------------------------------------
// Capa de pronóstico climático (paquete A1 + A2 + A3 + A4)
// ---------------------------------------------------------------------------

// Output de scripts/57_forecast_clima.py. Una fila por (barrio, fecha).
// Las columnas p10/p50/p90 son los percentiles del ensemble de 6 modelos
// meteorológicos (ECMWF/GFS/ICON/JMA/GEM/BoM); cuando los modelos
// discrepan, la banda p10–p90 se ensancha. weather_code es WMO code.
export interface ForecastDiarioRow {
  poligono_id: string;
  fecha: string; // YYYY-MM-DD
  tmin_p10: number;
  tmin_p50: number;
  tmin_p90: number;
  tmax_p10: number;
  tmax_p50: number;
  tmax_p90: number;
  precipitation_mm: number | null;
  weather_code: number | null;
  offset_calor_c: number;
  offset_frio_c: number;
  offset_origen: string;
  generated_at: string;
}

// Output de scripts/57_forecast_clima.py — bloque horario para Posadas
// centro (próximas 72 h por defecto). Útil para gráficos finos.
export interface ForecastHorarioRow {
  time: string; // ISO local con timezone America/Argentina/Cordoba
  temp_p10: number;
  temp_p50: number;
  temp_p90: number;
  rh_p50: number;
  precip_p50: number;
  wind_p50: number;
}

// AQI diario europeo + contaminantes principales. NO se desagrega por
// barrio (resolución del modelo ≈ 10 km); se aplica a Posadas global.
export interface AqiDiarioRow {
  fecha: string;
  pm10: number;
  pm2_5: number;
  no2: number;
  so2: number;
  ozone: number;
  european_aqi: number;
}

export type AlertaSeveridad = "roja" | "naranja" | "amarilla";

// Una alerta climática activa (output de scripts/58_alertas_clima.py).
// Las severidades se ordenan: roja > naranja > amarilla. Los nombres
// legibles vienen pre-resueltos para que el frontend no necesite cruzar
// con el GeoJSON solo para mostrar la lista.
export interface AlertaActiva {
  tipo:
    | "frio_extremo"
    | "frio_severo"
    | "calor_extremo"
    | "lluvia_intensa"
    | "aqi_malo";
  severidad: AlertaSeveridad;
  fecha_inicio: string;
  fecha_fin: string;
  n_dias: number;
  n_barrios_afectados: number;
  barrios_afectados: string[];
  barrios_afectados_nombres: string[];
  barrios_prioritarios: string[];
  barrios_prioritarios_nombres: string[];
  descripcion: string;
}

export interface AlertasPayload {
  generated_at: string;
  script_version: string;
  n_alertas: number;
  ventana_dias: number;
  alertas: AlertaActiva[];
}

// ---------------------------------------------------------------------------
// Capa de proyecciones a futuro (script 59)
// ---------------------------------------------------------------------------

// Métricas soportadas por el motor de proyección. El sufijo `_verano` para
// UHI viene del script y queda visible al cliente para no perder contexto.
export type ProyeccionMetrica =
  | "viviendas"
  | "poblacion"
  | "urbano"
  | "uhi_verano";

// Modelo elegido por el script (mejor R² con bonus de simplicidad para
// el lineal — Δ R² < 0.05 desempata a favor del lineal).
export type ProyeccionModelo = "lineal" | "exp";

// Confianza derivada del R² del modelo elegido. Si es "baja" y la métrica
// es UHI, el script NO emite filas para 2035 (extrapolación demasiado
// agresiva sobre series cortas y ruidosas).
export type ProyeccionConfianza = "alta" | "media" | "baja";

// Output de scripts/59_proyecciones_futuras.py — una fila por
// (polígono × métrica × año_proyección). El IC del 95 % es analítico
// (prediction-interval OLS con factor Student-t, n-2 g.l.). Para
// modelos exponenciales el IC se computa en log-espacio y luego se
// anti-loguea, por lo que puede ser asimétrico.
export interface ProyeccionRow {
  poligono_id: string;
  metrica: ProyeccionMetrica;
  anio_proyeccion: number;
  valor_pred: number;
  ci_inferior: number;
  ci_superior: number;
  modelo: ProyeccionModelo;
  r2: number | null;
  confianza: ProyeccionConfianza;
  n_obs: number;
}
