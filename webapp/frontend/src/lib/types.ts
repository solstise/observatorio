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
