// Grilla de comparacion de 2 a 4 poligonos.
// Muestra metricas clave lado a lado y una linea temporal resumida.

import { colorFromScore } from "@/lib/colors";
import type {
  PoblacionRow,
  PoligonoProperties,
  SerieTemporalRow,
  ServicioRow,
} from "@/lib/types";

interface ComparisonGridProps {
  items: Array<{
    properties: PoligonoProperties;
    serie: SerieTemporalRow[];
    poblacion: PoblacionRow[];
    servicios: ServicioRow[];
  }>;
}

export function ComparisonGrid({ items }: ComparisonGridProps) {
  if (!items.length) {
    return (
      <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
        Seleccione al menos dos poligonos para comparar.
      </p>
    );
  }

  // En mobile apilamos vertical (1 columna). En sm: 2 columnas (legible aún
  // con 4 polígonos). En lg+ usamos cols dinámico para que 2/3/4 polígonos
  // llenen el ancho disponible.
  const cols = Math.min(items.length, 4);

  return (
    <div
      className="comparison-grid grid grid-cols-1 gap-4 sm:grid-cols-2"
      style={
        {
          // CSS variable consumida por la regla @media en globals.css. Evita
          // hacer reflows en JS y respeta SSR (no necesita window).
          "--comparison-cols": cols,
        } as React.CSSProperties
      }
    >
      {items.map(({ properties, serie, poblacion, servicios }) => {
        const ultimoAnio = [...serie].sort((a, b) => b.anio - a.anio)[0];
        const primerAnio = [...serie].sort((a, b) => a.anio - b.anio)[0];
        const poblacionUltima = [...poblacion].sort(
          (a, b) => b.anio - a.anio,
        )[0];

        // Capa "posadas_completa" → marcar visualmente como referencia.
        const esTotalCiudad =
          properties.categoria_original === "ciudad_completa";

        const serviciosPromedio =
          servicios.length > 0
            ? servicios.reduce((acc, s) => acc + s.cobertura_pct, 0) /
              servicios.length
            : null;

        return (
          <article
            key={properties.id}
            className={[
              "card flex flex-col gap-3",
              esTotalCiudad
                ? "border-2 border-accent/50 bg-accent/5 dark:border-dk-accent/50 dark:bg-dk-accent/10"
                : "",
            ].join(" ")}
          >
            <header>
              <div
                className="h-1.5 w-full rounded-full"
                style={{
                  backgroundColor: esTotalCiudad
                    ? "#c97d3c"
                    : colorFromScore(properties.score_expansion),
                }}
                aria-hidden
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <h3 className="text-lg font-bold text-primary dark:text-dk-primary">
                  {properties.nombre}
                </h3>
                {esTotalCiudad && (
                  <span
                    className="inline-flex items-center rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-600 dark:border-dk-accent/50 dark:bg-dk-accent/20 dark:text-dk-accent"
                    title="Capa de referencia: total agregado de los 43 barrios"
                  >
                    Total ciudad
                  </span>
                )}
              </div>
              <p className="text-xs uppercase tracking-wider text-secondary dark:text-dk-muted">
                {esTotalCiudad
                  ? "agregado de toda Posadas"
                  : properties.categoria.replace("_", " ")}
              </p>
            </header>

            <dl className="space-y-1.5 text-sm">
              <Row
                label="Score expansion"
                value={
                  // Para la capa total no aplica un score por polígono.
                  esTotalCiudad || properties.score_expansion === 0
                    ? "s/d"
                    : properties.score_expansion.toFixed(2)
                }
              />
              <Row
                label="Superficie"
                value={`${properties.superficie_km2.toFixed(1)} km2`}
              />
              <Row
                label="Poblacion (ult.)"
                value={
                  poblacionUltima
                    ? poblacionUltima.poblacion_estimada.toLocaleString("es-AR")
                    : "s/d"
                }
              />
              <Row
                label="Construida 2018"
                value={
                  primerAnio
                    ? `${primerAnio.superficie_construida_km2.toFixed(2)} km2`
                    : "s/d"
                }
              />
              <Row
                label="Construida actual"
                value={
                  ultimoAnio
                    ? `${ultimoAnio.superficie_construida_km2.toFixed(2)} km2`
                    : "s/d"
                }
              />
              <Row
                label="Servicios (prom.)"
                value={
                  serviciosPromedio === null
                    ? "s/d"
                    : `${serviciosPromedio.toFixed(0)}%`
                }
              />
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-border/60 py-1 dark:border-dk-border/60">
      <dt className="text-xs uppercase tracking-wide text-secondary dark:text-dk-muted">
        {label}
      </dt>
      <dd className="font-medium text-primary dark:text-dk-primary">
        {value}
      </dd>
    </div>
  );
}
