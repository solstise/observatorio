"use client";

// Badge de focos de calor FIRMS (NASA). Suma los focos detectados en
// todos los años disponibles del poligono y reporta total + pico
// anual. Para los poligonos urbanos de Posadas lo habitual es 0
// focos; cualquier valor positivo es una alerta cualitativa.

import { TerminoGlosario } from "@/components/TerminoGlosario";
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
          Sin datos de focos para este barrio.
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

  // Año con más focos + serie ordenada para el desglose visual.
  const ordenadas = [...rows].sort((a, b) => a.anio - b.anio);
  const anioPico = ordenadas.reduce<FirmsRow | null>((max, r) => {
    if (!max || (r.n_focos ?? 0) > (max.n_focos ?? 0)) return r;
    return max;
  }, null);
  const maxFocosAnio = anioPico?.n_focos ?? 0;

  const tieneFocos = focosTotales > 0;
  const color = tieneFocos ? COLOR_ALERTA : COLOR_OK;

  const titulo = tieneFocos
    ? `${focosTotales} foco${focosTotales === 1 ? "" : "s"} detectado${focosTotales === 1 ? "" : "s"}`
    : "Sin focos de calor detectados";

  const tooltip =
    "Focos de calor detectados desde el espacio por los satélites VIIRS y MODIS (NASA FIRMS). Suma anual de detecciones superpuestas al barrio. En zona urbana suele tratarse de quemas puntuales, no de incendios forestales.";

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
      <div className="flex flex-col gap-3 rounded-md border border-neutral-border p-4 dark:border-dk-border dark:bg-dk-elevated/40">
        <div className="flex items-center gap-4">
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
              {rangoAnios ? `Período: ${rangoAnios}. ` : null}
              {tieneFocos
                ? `${(focosTotales / Math.max(rows.length, 1)).toFixed(1)} focos/año en promedio.`
                : "Ningún foco superpuesto al barrio."}
            </span>
            {tieneFocos && anioPico ? (
              <span className="text-[11px] text-neutral-muted dark:text-dk-muted">
                Peor año: <strong>{anioPico.anio}</strong> con {maxFocosAnio}{" "}
                focos ({pctMax.toFixed(1)}% del área).
              </span>
            ) : null}
          </div>
        </div>

        {tieneFocos ? (
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wider text-secondary dark:text-dk-muted">
              Detecciones por año
            </p>
            <ul className="grid grid-cols-4 gap-1 sm:grid-cols-8">
              {ordenadas.map((r) => {
                const pct =
                  maxFocosAnio > 0
                    ? Math.max(8, Math.round(((r.n_focos ?? 0) / maxFocosAnio) * 100))
                    : 0;
                return (
                  <li
                    key={r.anio}
                    title={`${r.anio}: ${r.n_focos ?? 0} focos · ${(r.pct_area_afectada ?? 0).toFixed(1)}% del área`}
                    className="flex flex-col items-center gap-1"
                  >
                    <div className="flex h-12 w-full items-end overflow-hidden rounded bg-neutral-100 dark:bg-dk-elevated">
                      <div
                        className="w-full"
                        style={{
                          height: `${pct}%`,
                          backgroundColor:
                            (r.n_focos ?? 0) > 0 ? color : "transparent",
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-neutral-muted dark:text-dk-muted">
                      {r.anio}
                    </span>
                    <span className="text-[10px] font-semibold text-neutral-text dark:text-dk-text">
                      {r.n_focos ?? 0}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <p className="text-[10px] italic text-neutral-muted dark:text-dk-muted">
          Datos: NASA <TerminoGlosario id="firms">FIRMS</TerminoGlosario>{" "}
          (<TerminoGlosario id="viirs">VIIRS</TerminoGlosario> /{" "}
          <TerminoGlosario id="modis">MODIS</TerminoGlosario>). Cada foco es
          una detección térmica anómala vista desde 750 m de resolución, así
          que un foco no equivale a un incendio forestal — pueden ser quemas
          de pasto, basurales, vehículos en llamas o industrias.
        </p>
      </div>
    </div>
  );
}
