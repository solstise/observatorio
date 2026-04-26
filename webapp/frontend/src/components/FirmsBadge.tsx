"use client";

// Badge de focos de calor FIRMS (NASA). Suma los focos detectados en
// todos los años disponibles del poligono y reporta total + pico
// anual. Para los poligonos urbanos de Posadas lo habitual es 0
// focos; cualquier valor positivo es una alerta cualitativa.

import type { FirmsRow } from "@/lib/types";

interface FirmsBadgeProps {
  rows: FirmsRow[];
}

const COLOR_ALERTA = "#c97d3c"; // accent naranja (>=1 foco)
const COLOR_OK = "#6b7280"; // muted (0 focos)

export function FirmsBadge({ rows }: FirmsBadgeProps) {
  if (!rows.length) {
    return (
      <div className="flex h-full min-h-[160px] flex-col items-start justify-center">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Focos de calor / incendios
        </h3>
        <p className="mt-2 text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos de focos para este polígono.
        </p>
      </div>
    );
  }

  const focosTotales = rows.reduce((acc, r) => acc + (r.n_focos ?? 0), 0);
  const pctMax = rows.reduce(
    (acc, r) => Math.max(acc, r.pct_area_afectada ?? 0),
    0,
  );
  const anios = [...rows].map((r) => r.anio).sort();
  const rangoAnios = anios.length
    ? `${anios[0]}–${anios[anios.length - 1]}`
    : "";

  const tieneFocos = focosTotales > 0;
  const color = tieneFocos ? COLOR_ALERTA : COLOR_OK;

  const titulo = tieneFocos
    ? `${focosTotales} foco${focosTotales === 1 ? "" : "s"} detectado${focosTotales === 1 ? "" : "s"}`
    : "Sin focos de calor detectados";

  const tooltip =
    "Focos de calor detectados desde el espacio por los satélites VIIRS y MODIS (NASA FIRMS). Suma anual de detecciones superpuestas al polígono. En zona urbana suele tratarse de quemas puntuales, no de incendios forestales.";

  return (
    <div
      className="flex flex-col gap-2"
      title={tooltip}
      aria-label={titulo}
    >
      <div>
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Focos de calor / incendios
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Alerta de incendios y quemas detectados desde el espacio. Cualquier
          dato positivo en zona urbana es señal de inspección.
        </p>
      </div>
      <div className="flex items-center gap-4 rounded-md border border-neutral-border p-4 dark:border-dk-border dark:bg-dk-elevated/40">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        >
          {focosTotales}
        </div>
        <div className="flex flex-col">
          <span className="text-base font-semibold" style={{ color }}>
            {titulo}
          </span>
          <span className="text-[11px] text-neutral-muted dark:text-dk-muted">
            {rangoAnios ? `Período analizado: ${rangoAnios}. ` : null}
            {tieneFocos
              ? `Pico de ${pctMax.toFixed(1)}% del área afectada en el peor año.`
              : "Ningún foco superpuesto al polígono."}
          </span>
          <span className="mt-1 text-[10px] italic text-neutral-muted dark:text-dk-muted">
            Datos: NASA FIRMS (VIIRS / MODIS).
          </span>
        </div>
      </div>
    </div>
  );
}
