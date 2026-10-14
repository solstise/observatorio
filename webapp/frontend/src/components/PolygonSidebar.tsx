// Sidebar con metricas resumidas + link a PDF para el poligono seleccionado.
// Se muestra en la home al costado del mapa.

import Link from "next/link";

import { CATEGORY_COLORS } from "@/lib/colors";
import type {
  CategoriaHabitabilidad,
  CategoriaRiesgo,
  DengueRow,
  DynamicWorldRow,
  HabitabilidadRow,
  PoligonoProperties,
} from "@/lib/types";

interface PolygonSidebarProps {
  properties: PoligonoProperties | null;
  // Filas de Dynamic World YA filtradas por el poligono seleccionado.
  // Se pasan opcionales para degradar si el CSV no esta disponible.
  dynamicWorldRows?: DynamicWorldRow[];
  // Habitabilidad (Capa 3) y Dengue (Capa 2) ya filtrados para el
  // polígono seleccionado. Ambos opcionales: si el CSV todavía no
  // existe, el sidebar simplemente no muestra el badge.
  habitabilidad?: HabitabilidadRow | null;
  dengue?: DengueRow | null;
  onClear: () => void;
}

const HABITAB_COLORS: Record<CategoriaHabitabilidad, string> = {
  bajo: "#dc2626",
  medio: "#facc15",
  bueno: "#5a7a9c",
  excelente: "#16a34a",
};

const HABITAB_LABEL: Record<CategoriaHabitabilidad, string> = {
  bajo: "Bajo",
  medio: "Medio",
  bueno: "Bueno",
  excelente: "Excelente",
};

const RIESGO_COLORS: Record<CategoriaRiesgo, string> = {
  bajo: "#16a34a",
  medio: "#facc15",
  alto: "#ea580c",
  muy_alto: "#dc2626",
};

const RIESGO_LABEL: Record<CategoriaRiesgo, string> = {
  bajo: "Bajo",
  medio: "Medio",
  alto: "Alto",
  muy_alto: "Muy alto",
};

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
  habitabilidad,
  dengue,
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
  // Filtramos filas placeholder de meses futuros (n_imagenes=0 / valores
  // null) que el pipeline crea cuando reserva el slot anual antes de que
  // GEE publique el composite. Si lo dejamos pasar, se ve "0.0% (2026-07)"
  // cuando todavía estamos en abril.
  const dwUltima = dynamicWorldRows && dynamicWorldRows.length
    ? [...dynamicWorldRows]
        .filter(
          (r) =>
            Number.isFinite(r.dw_built_pct_ge_50) &&
            r.dw_built_pct_ge_50 != null &&
            (r.n_imagenes ?? 0) > 0,
        )
        .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] ?? null
    : null;
  const dwPct = dwUltima ? normalizarPct(dwUltima.dw_built_pct_ge_50 ?? 0) : null;

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

      {(habitabilidad || dengue) && (
        <div
          className="flex flex-wrap gap-2"
          aria-label="Indicadores rápidos de capas 2 y 3"
        >
          {habitabilidad && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
              style={{
                borderColor: HABITAB_COLORS[habitabilidad.categoria],
                color: HABITAB_COLORS[habitabilidad.categoria],
              }}
              title={`Habitabilidad ${HABITAB_LABEL[habitabilidad.categoria]} — Capa 3`}
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: HABITAB_COLORS[habitabilidad.categoria],
                }}
              />
              Habitabilidad:{" "}
              <strong>{habitabilidad.score_habitabilidad.toFixed(0)}/100</strong>
            </span>
          )}
          {dengue && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
              style={{ backgroundColor: RIESGO_COLORS[dengue.categoria] }}
              title={`Riesgo de dengue (Capa 2): score ${dengue.score_dengue.toFixed(0)}/100`}
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full bg-white/80"
              />
              Riesgo dengue: {RIESGO_LABEL[dengue.categoria]}
            </span>
          )}
        </div>
      )}

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
