import type { LightningSummary, MetarSummary, ObservedRain, RiverReading, SmnAlert, SmnNow } from "./parse";

export type SourceStatus = "ok" | "desactualizado" | "sin_datos";

export interface LiveSource<T> {
  estado: SourceStatus;
  datos: T | null;
  actualizado: string | null;
  error: string | null;
  fuente: string;
  url: string;
}

export interface NinoAhora {
  generado: string;
  // pendientes: archivos CAP sin leer (límite del SMN); con pendientes no se afirma que no haya alertas.
  alertas: LiveSource<{ posadas: SmnAlert[]; cerca: SmnAlert[]; total_pais: number; pendientes: number }>;
  metar: LiveSource<MetarSummary>;
  smn_ahora: LiveSource<SmnNow>;
  lluvia: LiveSource<ObservedRain>;
  rayos: LiveSource<LightningSummary & { cobertura: number }>;
  rio: LiveSource<RiverReading & { historial: Array<{ fecha: string; altura_m: number }> }>;
}
