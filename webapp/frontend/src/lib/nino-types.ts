export type NinoLevel = "sin_umbral" | "atencion" | "alto" | "muy_alto" | "a_verificar";
export const NIVEL: Record<NinoLevel, string> = { sin_umbral: "Sin umbral superado", atencion: "Atención", alto: "Alto", muy_alto: "Muy alto", a_verificar: "A verificar" };
export interface NinoDay {
  fecha: string;
  horas: number;
  desde: string;
  hasta: string;
  p10: number;
  p50: number;
  p90: number;
  max_1h: number;
  prob_lluvioso: number | null;
  prob_atencion: number | null;
  prob_tormenta: number | null;
  prob_rafagas: number | null;
}
export interface NinoRain {
  generated_at: string;
  nivel: NinoLevel;
  lluvia_max_1h: number;
  lluvia_max_3h: number;
  lluvia_24h: number;
  lluvia_48h: number;
  // Escenario alto (percentil 90 de los picos). Ausente en snapshots anteriores.
  lluvia_max_1h_p90?: number;
  lluvia_24h_p90?: number;
  lluvia_48h_p90?: number;
  ventana_inicio: string;
  ventana_fin: string;
  n_miembros: number;
  probabilidades: Record<string, number>;
  umbrales: Record<string, { mm_1h: number; mm_24h: number }>;
  horas: Array<{ time: string; p10: number; p50: number; p90: number; media?: number }>;
  dias?: NinoDay[];
  dia_lluvioso_mm?: number;
  metodo?: string;
  tormenta?: { prob_tormenta: number | null; n_miembros_tormenta: number; prob_rafagas: number | null; n_miembros_rafagas: number; rafaga_fuerte_kmh: number };
}
export interface NinoWrf {
  estado: "disponible" | "no_disponible";
  generated_at?: string;
  motivo?: string;
  fuente?: string;
  fuente_url?: string;
  radio_km?: number;
  corrida?: string;
  horas?: Array<{ time: string; centro: number; max_zona: number }>;
  dias?: Array<{ fecha: string; horas: number; centro: number; max_zona: number }>;
  max_1h_centro?: number | null;
  max_1h_zona?: number | null;
  max_24h_centro?: number | null;
}
export interface NinoConfig {
  rafaga_fuerte_kmh: number;
  dia_lluvioso_mm: number;
  dia_fuerte_registro_mm: number;
  rayos_cerca_km: number;
}
export const NINO_CONFIG_DEFAULT: NinoConfig = {
  rafaga_fuerte_kmh: 60, dia_lluvioso_mm: 20, dia_fuerte_registro_mm: 30, rayos_cerca_km: 30,
};
export interface NinoRow {
  edificios_total?: number;
  cobertura_worldpop?: string;
  poligono_id: string;
  nombre: string;
  viviendas_expuestas: number;
  viviendas_muy_expuestas: number;
  pct_viviendas_expuestas: number | null;
  poblacion_expuesta_estimada: number | null;
  poblacion_expuesta_min: number | null;
  poblacion_expuesta_max: number | null;
  score_anegamiento: number | null;
  anegamiento_v1: number | null;
  lluvia_max_1h: number;
  nivel: NinoLevel;
  estado: string;
}
export interface NinoSnapshot {
  generated_at: string;
  lluvia: NinoRain;
  barrios: NinoRow[];
  exposicion_generated_at: string | null;
  estado_exposicion: string;
  config?: Partial<NinoConfig>;
  wrf_smn?: NinoWrf;
}
export interface NinoEvent {
  fecha: string;
  fecha_precision: string;
  mm_reportados: string;
  duracion: string;
  zonas_texto: string;
  fuente_medio: string;
  fuente_url: string;
  notas: string;
}
export type HailLevel = "bajo" | "moderado" | "alto";
export interface NinoHail {
  generated_at: string;
  estado: "disponible" | "no_disponible";
  cortes: { moderado: number; alto: number };
  modelos: Record<string, { nombre: string; horas: Array<{ time: string; ship: number | null }> }>;
  dias: Array<{
    fecha: string;
    consenso: HailLevel | null;
    modelos: Record<string, { ship_max: number; hora: string | null; cape_max: number; categoria: HailLevel | null } | null>;
  }>;
}
export interface NinoClimate {
  generated_at: string;
  fuente: string;
  primer_dato: string;
  anios_completos: number[];
  n_anios: number;
  diarios_desde_10mm: number[];
  tres_dias_desde_20mm: number[];
  mensual: Record<string, { mediana: number; p25: number; p75: number; maximo: number; n_anios: number }>;
}
export interface NinoHydroBarrio {
  poligono_id: string;
  nombre: string;
  area_m2: number;
  edificios: number;
  techos_frac: number | null;
  construido_frac: number | null;
  lote_medio_m2: number | null;
  impermeable_alto: number;
  cn_ii_min: number;
  cn_ii_max: number;
}
export interface NinoHydro {
  generated_at: string;
  metodo: string;
  barrios: NinoHydroBarrio[];
}
export interface NinoObservedDay {
  fecha: string;
  mm: number | null;
  tormenta: boolean;
  granizo: boolean;
}
