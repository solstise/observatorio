export type NinoLevel = "sin_umbral" | "atencion" | "alto" | "muy_alto" | "a_verificar";
export const NIVEL: Record<NinoLevel, string> = { sin_umbral: "Sin umbral superado", atencion: "Atención", alto: "Alto", muy_alto: "Muy alto", a_verificar: "A verificar" };
export interface NinoRain {
  generated_at: string;
  nivel: NinoLevel;
  lluvia_max_1h: number;
  lluvia_max_3h: number;
  lluvia_24h: number;
  lluvia_48h: number;
  ventana_inicio: string;
  ventana_fin: string;
  n_miembros: number;
  probabilidades: Record<string, number>;
  umbrales: Record<string, { mm_1h: number; mm_24h: number }>;
  horas: Array<{ time: string; p10: number; p50: number; p90: number }>;
}
export interface NinoRow {
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
