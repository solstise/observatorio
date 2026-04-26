"use client";

// Selectores de estación, año y métrica para la página /calor.

import type { MetricaCalor } from "./MapaCalor";

export type Estacion = "verano" | "otono" | "invierno" | "primavera";

interface Props {
  aniosDisponibles: number[];
  anio: number;
  onAnio: (a: number) => void;
  estacion: Estacion;
  onEstacion: (e: Estacion) => void;
  metrica: MetricaCalor;
  onMetrica: (m: MetricaCalor) => void;
}

const ESTACIONES: Array<{ value: Estacion; label: string }> = [
  { value: "verano", label: "Verano (DJF)" },
  { value: "otono", label: "Otoño (MAM)" },
  { value: "invierno", label: "Invierno (JJA)" },
  { value: "primavera", label: "Primavera (SON)" },
];

const METRICAS: Array<{ value: MetricaCalor; label: string }> = [
  { value: "lst", label: "Temperatura del suelo (°C)" },
  { value: "uhi_vs_rural", label: "Cuánto más caliente que el campo" },
  { value: "uhi_vs_ciudad", label: "Cuánto más que el promedio de la ciudad" },
];

export function SelectorPeriodo({
  aniosDisponibles,
  anio,
  onAnio,
  estacion,
  onEstacion,
  metrica,
  onMetrica,
}: Props) {
  // Grid responsive: 1 columna en mobile (apilado vertical), 2 en sm, 3 en md+.
  // Esto evita que tres selects con labels largos se aprieten en pantallas
  // chicas y entrega un objetivo táctil cómodo (44px de alto en cada select).
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
      <Sel label="Estación" value={estacion} onChange={(v) => onEstacion(v as Estacion)}>
        {ESTACIONES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Sel>
      <Sel
        label="Año"
        value={String(anio)}
        onChange={(v) => onAnio(Number(v))}
      >
        {aniosDisponibles.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </Sel>
      <Sel
        label="Métrica"
        value={metrica}
        onChange={(v) => onMetrica(v as MetricaCalor)}
      >
        {METRICAS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Sel>
    </div>
  );
}

function Sel({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[44px] w-full rounded-md border border-neutral-border bg-white px-3 py-2 text-sm text-neutral-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-dk-border dark:bg-dk-surface dark:text-dk-text dark:focus:border-dk-primary dark:focus:ring-dk-primary"
      >
        {children}
      </select>
    </label>
  );
}
