// Tabla de cobertura de servicios publicos por poligono.
// Accesible, con scope en th y resumen de filas.

import { isMissing } from "@/lib/format";
import type { ServicioRow } from "@/lib/types";

interface ServiceTableProps {
  rows: ServicioRow[];
}

const SERVICIO_LABEL: Record<string, string> = {
  agua_red: "Agua de red",
  cloaca: "Cloaca",
  gas_natural: "Gas natural",
  energia_electrica: "Energia electrica",
  alumbrado: "Alumbrado publico",
  transporte_publico: "Transporte publico",
};

export function ServiceTable({ rows }: ServiceTableProps) {
  if (!rows.length) {
    return (
      <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
        Sin datos de servicios para este poligono.
      </p>
    );
  }

  return (
    <table className="data-table" aria-label="Cobertura de servicios publicos">
      <caption className="text-left text-sm font-semibold text-primary mb-2 dark:text-dk-primary">
        Cobertura declarada por fuente publica
      </caption>
      <thead>
        <tr>
          <th scope="col">Servicio</th>
          <th scope="col">Cobertura</th>
          <th scope="col">Fuente</th>
          <th scope="col">Anio</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.servicio}-${idx}`}>
            <th
              scope="row"
              className="font-medium text-primary dark:text-dk-primary"
            >
              {SERVICIO_LABEL[r.servicio] ?? r.servicio}
            </th>
            <td>
              <CoverageBar value={r.cobertura_pct} />
            </td>
            <td className="text-sm text-neutral-muted dark:text-dk-muted">
              {r.fuente}
            </td>
            <td className="text-sm text-neutral-muted dark:text-dk-muted">
              {r.anio_referencia}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Barra compacta sin rojos, tono segun cobertura. Los tres tonos
// (azul intenso / azul medio / naranja) se mantienen porque comunican
// jerarquía cuantitativa, no estado. La pista (track) sí cambia con el
// tema para que la barra siga siendo visible sobre el fondo dark.
//
// Si el valor es null/undefined/NaN, mostramos "s/d" en lugar de una
// barra vacía con "0%": son significados distintos. Cobertura 0% real
// (ej. servicio inexistente registrado en la fuente) sí muestra la
// barra vacía + "0%".
function CoverageBar({ value }: { value: number | null | undefined }) {
  if (isMissing(value)) {
    return (
      <span
        className="text-sm italic text-neutral-muted dark:text-dk-muted"
        aria-label="Sin datos de cobertura"
        title="Sin datos para esta combinación de servicio y polígono"
      >
        s/d
      </span>
    );
  }
  const numeric = value as number;
  const clamped = Math.max(0, Math.min(100, numeric));
  // Azul intenso para alta cobertura, naranja para baja.
  const color = clamped > 60 ? "#1a3a5c" : clamped > 30 ? "#5a7a9c" : "#c97d3c";
  return (
    <div
      className="flex items-center gap-3"
      aria-label={`Cobertura ${clamped.toFixed(0)} por ciento`}
    >
      <div
        className="h-2 w-28 rounded-full bg-primary-50 dark:bg-dk-elevated"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-10 text-right text-sm font-medium text-primary dark:text-dk-primary">
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}
