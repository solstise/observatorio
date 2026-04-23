// Tabla de cobertura de servicios publicos por poligono.
// Accesible, con scope en th y resumen de filas.

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
      <p className="text-sm italic text-neutral-muted">
        Sin datos de servicios para este poligono.
      </p>
    );
  }

  return (
    <table className="data-table" aria-label="Cobertura de servicios publicos">
      <caption className="text-left text-sm font-semibold text-primary mb-2">
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
            <th scope="row" className="font-medium text-primary">
              {SERVICIO_LABEL[r.servicio] ?? r.servicio}
            </th>
            <td>
              <CoverageBar value={r.cobertura_pct} />
            </td>
            <td className="text-sm text-neutral-muted">{r.fuente}</td>
            <td className="text-sm text-neutral-muted">{r.anio_referencia}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Barra compacta sin rojos, tono segun cobertura.
function CoverageBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  // Azul intenso para alta cobertura, naranja para baja.
  const color = clamped > 60 ? "#1a3a5c" : clamped > 30 ? "#5a7a9c" : "#c97d3c";
  return (
    <div
      className="flex items-center gap-3"
      aria-label={`Cobertura ${clamped.toFixed(0)} por ciento`}
    >
      <div
        className="h-2 w-28 rounded-full bg-primary-50"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-10 text-right text-sm font-medium text-primary">
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}
