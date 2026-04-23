// Sidebar con metricas resumidas + link a PDF para el poligono seleccionado.
// Se muestra en la home al costado del mapa.

import Link from "next/link";

import { CATEGORY_COLORS } from "@/lib/colors";
import type { PoligonoProperties } from "@/lib/types";

interface PolygonSidebarProps {
  properties: PoligonoProperties | null;
  onClear: () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  expansion_activa: "Expansion activa",
  emergente: "Emergente",
  consolidado: "Consolidado",
  desconocido: "Sin clasificar",
};

export function PolygonSidebar({ properties, onClear }: PolygonSidebarProps) {
  if (!properties) {
    return (
      <aside
        aria-label="Detalle del poligono seleccionado"
        className="card h-full min-h-[360px] flex items-center justify-center text-center"
      >
        <div>
          <p className="text-sm text-neutral-muted">
            Seleccione un poligono en el mapa para ver su informacion.
          </p>
        </div>
      </aside>
    );
  }

  const crecimiento =
    properties.edificios_2026 > 0 && properties.edificios_2018 > 0
      ? (
          ((properties.edificios_2026 - properties.edificios_2018) /
            properties.edificios_2018) *
          100
        ).toFixed(1)
      : null;

  return (
    <aside
      aria-label={`Detalle del poligono ${properties.nombre}`}
      className="card flex h-full flex-col gap-4"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <span
            className="inline-block rounded-sm px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-white"
            style={{
              backgroundColor:
                CATEGORY_COLORS[properties.categoria] ??
                CATEGORY_COLORS.desconocido,
            }}
          >
            {CATEGORY_LABEL[properties.categoria] ?? "Sin clasificar"}
          </span>
          <h2 className="mt-2 text-xl font-bold text-primary">
            {properties.nombre}
          </h2>
          <p className="text-xs text-neutral-muted">ID: {properties.id}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Limpiar seleccion"
          className="text-xs font-medium text-secondary hover:underline"
        >
          Cerrar
        </button>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Metric label="Score expansion" value={properties.score_expansion.toFixed(2)} />
        <Metric
          label="Superficie"
          value={`${properties.superficie_km2.toFixed(1)} km2`}
        />
        <Metric
          label="Poblacion estimada"
          value={properties.poblacion_estimada.toLocaleString("es-AR")}
        />
        <Metric
          label="Edificios 2026"
          value={properties.edificios_2026.toLocaleString("es-AR")}
        />
        <Metric
          label="Edificios 2018"
          value={properties.edificios_2018.toLocaleString("es-AR")}
        />
        <Metric
          label="Crecimiento"
          value={crecimiento ? `${crecimiento} %` : "s/d"}
        />
      </dl>

      <div className="mt-auto flex flex-wrap gap-2">
        <Link
          href={`/poligono/${properties.id}`}
          className="btn-primary"
          aria-label={`Ver detalle completo de ${properties.nombre}`}
        >
          Ver detalle
        </Link>
        <a
          href={`/api/poligonos/${properties.id}/reporte.pdf`}
          className="btn-outline"
          aria-label={`Descargar reporte PDF de ${properties.nombre}`}
        >
          Reporte PDF
        </a>
      </div>

      {properties._synthetic && (
        <p className="text-xs italic text-neutral-muted">
          Valores sinteticos de prueba.
        </p>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-secondary">
        {label}
      </dt>
      <dd className="mt-1 text-base font-semibold text-primary">{value}</dd>
    </div>
  );
}
