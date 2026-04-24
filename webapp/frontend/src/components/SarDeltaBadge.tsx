"use client";

// Badge que resume el ultimo delta VV detectado por Sentinel-1 (SAR).
// El delta_vv_mean_db compara la retrodispersion VV del poligono con
// la fecha anterior disponible: valores positivos sugieren edificacion
// nueva o modificacion estructural (mas superficies duras que reflejan
// mejor el radar); valores negativos sugieren perdida o suavizado.

import type { Sentinel1Row } from "@/lib/types";

interface SarDeltaBadgeProps {
  rows: Sentinel1Row[];
}

const COLOR_POS = "#c97d3c";
const COLOR_NEG = "#5a7a9c";
const COLOR_NEUTRO = "#6b7280";

// Ordenamos descendente por fecha para que la "actual" sea la mas
// reciente con delta no-null.
function cmpFechaDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

export function SarDeltaBadge({ rows }: SarDeltaBadgeProps) {
  if (!rows.length) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center">
        <p className="text-sm italic text-neutral-muted">
          Sentinel-1 sin datos para este poligono.
        </p>
      </div>
    );
  }

  const ordenadas = [...rows].sort((a, b) => cmpFechaDesc(a.fecha, b.fecha));
  const actual = ordenadas.find(
    (r) => r.delta_vv_mean_db != null && Number.isFinite(r.delta_vv_mean_db),
  );

  if (!actual || actual.delta_vv_mean_db == null) {
    return (
      <div className="flex h-full min-h-[160px] items-center justify-center">
        <p className="text-sm italic text-neutral-muted">
          Sin delta SAR todavia (serie demasiado corta).
        </p>
      </div>
    );
  }

  const delta = actual.delta_vv_mean_db;
  // Fecha previa: el siguiente registro mas antiguo que "actual".
  const idxActual = ordenadas.indexOf(actual);
  const previa = ordenadas[idxActual + 1];

  // Umbral para clasificar el delta. |delta| < 0.1 dB es ruido, a
  // partir de 1 dB es una senal claramente estructural.
  const magnitud = Math.abs(delta);
  let color = COLOR_NEUTRO;
  let flecha = "→";
  let etiqueta = "Sin cambio significativo";
  if (magnitud >= 0.1) {
    if (delta > 0) {
      color = COLOR_POS;
      flecha = "↑";
      etiqueta =
        magnitud >= 1
          ? "Senal fuerte de edificacion / cambio estructural"
          : "Tendencia a mas superficies reflectantes";
    } else {
      color = COLOR_NEG;
      flecha = "↓";
      etiqueta =
        magnitud >= 1
          ? "Perdida de superficies reflectantes"
          : "Tendencia a suavizado de superficie";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-primary">
        Delta SAR &mdash; Sentinel-1 VV
      </h3>
      <div
        className="flex items-center gap-4 rounded-md border border-neutral-border p-4"
        title="Valores positivos indican edificacion nueva o modificacion estructural; tipicamente |delta| mayor a 1 dB es una senal fuerte."
        aria-label={`Delta VV: ${delta.toFixed(2)} dB entre ${previa ? previa.fecha : "fecha anterior"} y ${actual.fecha}. ${etiqueta}`}
      >
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-3xl font-bold text-white"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        >
          {flecha}
        </div>
        <div className="flex flex-col">
          <span
            className="text-2xl font-bold"
            style={{ color }}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(2)} dB
          </span>
          <span className="text-xs font-medium text-primary">{etiqueta}</span>
          <span className="text-[11px] text-neutral-muted">
            Cambio estructural detectado por SAR entre
            {previa ? ` ${previa.fecha} y ${actual.fecha}` : ` ${actual.fecha}`}.
          </span>
        </div>
      </div>
      <p className="text-[11px] italic text-neutral-muted">
        Valores positivos indican edificacion nueva o modificacion estructural;
        tipicamente &gt; 1 dB es senal fuerte.
      </p>
    </div>
  );
}
