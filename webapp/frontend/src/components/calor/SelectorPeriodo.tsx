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
  { value: "lst", label: "Temperatura superficie (LST)" },
  { value: "uhi_vs_rural", label: "UHI vs baseline rural" },
  { value: "uhi_vs_ciudad", label: "UHI vs promedio Posadas" },
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
  return (
    <div className="flex flex-wrap gap-3">
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
      <span className="text-xs font-medium uppercase tracking-wider text-secondary">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-border bg-white px-3 py-2 text-sm text-neutral-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {children}
      </select>
    </label>
  );
}
