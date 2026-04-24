"use client";

// Badge de isla de calor urbana. Compara la LST diurna de verano del
// poligono contra el promedio del bbox Posadas (delta en grados
// celsius). Positivo = mas caliente que el promedio local, negativo =
// enfriamiento relativo (tipicamente por cobertura vegetal o cuerpos
// de agua). Rompe la regla "sin rojos" del resto del sitio porque en
// climatologia urbana el rojo/naranja/azul es la convencion estandar
// para mapas termicos y la semantica ganaria peso sobre la paleta.

import type { LstRow } from "@/lib/types";

interface IslaCalorBadgeProps {
  rows: LstRow[];
}

// Umbrales elegidos por convencion de la literatura UHI: delta > 2 C
// se considera isla de calor clara, 0-2 C es zona caliente moderada,
// negativo es enfriamiento neto (oasis urbano). El cruce en 2 C es
// el que usan la EPA y varios papers rioplatenses.
const COLOR_CALIENTE_FUERTE = "#dc2626"; // rojo 600 (> +2 C)
const COLOR_CALIENTE_LEVE = "#c97d3c"; // accent naranja (0 a +2 C)
const COLOR_FRESCO = "#1a3a5c"; // primary azul institucional (< 0 C)

function tomarMasReciente(rows: LstRow[]): LstRow | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => b.anio - a.anio)[0];
}

export function IslaCalorBadge({ rows }: IslaCalorBadgeProps) {
  const ultima = tomarMasReciente(rows);

  if (!ultima) {
    return (
      <div className="flex h-full min-h-[160px] flex-col items-start justify-center">
        <h3 className="text-sm font-semibold text-primary">
          Isla de calor urbana
        </h3>
        <p className="mt-2 text-sm italic text-neutral-muted">
          MODIS LST sin datos para este poligono.
        </p>
      </div>
    );
  }

  const delta = ultima.isla_calor_c;
  const lstDia = ultima.lst_dia_verano_c;
  const lstNoche = ultima.lst_noche_verano_c;

  let color = COLOR_FRESCO;
  let etiqueta = "Enfriamiento neto vs promedio Posadas";
  if (delta > 2) {
    color = COLOR_CALIENTE_FUERTE;
    etiqueta = "Isla de calor marcada vs promedio Posadas";
  } else if (delta >= 0) {
    color = COLOR_CALIENTE_LEVE;
    etiqueta = "Isla de calor leve vs promedio Posadas";
  }

  const signo = delta > 0 ? "+" : "";
  const tooltip =
    "Diferencia de temperatura de superficie (MODIS LST dia verano) entre este poligono y el promedio del bbox Posadas. Positivo = isla de calor urbana, negativo = enfriamiento relativo.";

  return (
    <div
      className="flex flex-col gap-2"
      title={tooltip}
      aria-label={`Isla de calor: delta ${signo}${delta.toFixed(1)} grados celsius. ${etiqueta}.`}
    >
      <h3 className="text-sm font-semibold text-primary">
        Isla de calor urbana
      </h3>
      <div className="flex items-center gap-4 rounded-md border border-neutral-border p-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        >
          {"ΔT"}
        </div>
        <div className="flex flex-col">
          <span className="text-2xl font-bold" style={{ color }}>
            {signo}
            {delta.toFixed(1)}
            {"°"}C
          </span>
          <span className="text-xs font-medium text-primary">{etiqueta}</span>
          <span className="text-[11px] text-neutral-muted">
            MODIS LST {ultima.anio} &middot; dia verano.
          </span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-1 text-[11px] text-neutral-muted">
        <div className="flex flex-col">
          <dt className="uppercase tracking-wider text-secondary">
            LST dia verano
          </dt>
          <dd className="text-sm font-semibold text-primary">
            {lstDia.toFixed(1)}
            {"°"}C
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="uppercase tracking-wider text-secondary">
            LST noche verano
          </dt>
          <dd className="text-sm font-semibold text-primary">
            {lstNoche.toFixed(1)}
            {"°"}C
          </dd>
        </div>
      </dl>
    </div>
  );
}
