// Sidebar con metricas resumidas + link a PDF para el poligono seleccionado.
// Se muestra en la home al costado del mapa.

import Link from "next/link";

import { CATEGORY_COLORS } from "@/lib/colors";
import type { DynamicWorldRow, PoligonoProperties } from "@/lib/types";

interface PolygonSidebarProps {
  properties: PoligonoProperties | null;
  // Filas de Dynamic World YA filtradas por el poligono seleccionado.
  // Se pasan opcionales para degradar si el CSV no esta disponible.
  dynamicWorldRows?: DynamicWorldRow[];
  onClear: () => void;
}

// Normaliza a 0-100 (el CSV viene en fraccion 0-1).
function normalizarPct(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, pct));
}

const CATEGORY_LABEL: Record<string, string> = {
  expansion_activa: "Expansion activa",
  emergente: "Emergente",
  consolidado: "Consolidado",
  desconocido: "Sin clasificar",
};

export function PolygonSidebar({
  properties,
  dynamicWorldRows,
  onClear,
}: PolygonSidebarProps) {
  if (!properties) {
    return (
      <aside
        aria-label="Detalle del poligono seleccionado"
        className="card h-full min-h-[360px] flex items-center justify-center text-center"
      >
        <div>
          <p className="text-sm text-neutral-muted dark:text-dk-muted">
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

  // Dynamic World: fecha mas reciente del array filtrado por este poli.
  const dwUltima = dynamicWorldRows && dynamicWorldRows.length
    ? [...dynamicWorldRows].sort((a, b) => b.fecha.localeCompare(a.fecha))[0]
    : null;
  const dwPct = dwUltima ? normalizarPct(dwUltima.dw_built_pct_ge_50) : null;

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
          <h2 className="mt-2 text-xl font-bold text-primary dark:text-dk-primary">
            {properties.nombre}
          </h2>
          <p className="text-xs text-neutral-muted dark:text-dk-muted">
            ID: {properties.id}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Limpiar seleccion"
          className="text-xs font-medium text-secondary hover:underline dark:text-dk-muted dark:hover:text-dk-primary"
        >
          Cerrar
        </button>
      </header>

      {dwPct != null && dwUltima && (
        <div className="rounded-md border border-neutral-border bg-primary-50 p-3 dark:border-dk-border dark:bg-dk-elevated">
          <p className="text-[11px] uppercase tracking-wider text-secondary dark:text-dk-muted">
            Cuánto del barrio es construcción
          </p>
          <p className="mt-1 text-xl font-bold text-primary dark:text-dk-primary">
            {dwPct.toFixed(1)} %
          </p>
          <p className="text-[11px] text-neutral-muted dark:text-dk-muted">
            Datos: Dynamic World V1, IA de Google sobre Sentinel-2 ({dwUltima.fecha}).
          </p>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Metric label="Score expansión" value={properties.score_expansion.toFixed(2)} />
        <Metric
          label="Superficie"
          value={`${properties.superficie_km2.toFixed(1)} km²`}
        />
        <Metric
          label="Población estimada"
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

      <div className="mt-auto flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link
          href={`/poligono/${properties.id}`}
          className="btn-primary"
          aria-label={`Ver detalle completo de ${properties.nombre}`}
        >
          Ver detalle
        </Link>
        <a
          href={`/data/media/${properties.id}.pdf`}
          className="btn-outline"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Descargar reporte PDF de ${properties.nombre}`}
        >
          Reporte PDF
        </a>
      </div>

      {properties._synthetic && (
        <p className="text-xs italic text-neutral-muted dark:text-dk-muted">
          Valores sintéticos de prueba.
        </p>
      )}
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </dt>
      <dd className="mt-1 text-base font-semibold text-primary dark:text-dk-primary">
        {value}
      </dd>
    </div>
  );
}
