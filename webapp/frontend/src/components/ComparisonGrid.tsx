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
      <p className="text-sm italic text-neutral-muted">
        Seleccione al menos dos poligonos para comparar.
      </p>
    );
  }

  const cols = Math.min(items.length, 4);

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {items.map(({ properties, serie, poblacion, servicios }) => {
        const ultimoAnio = [...serie].sort((a, b) => b.anio - a.anio)[0];
        const primerAnio = [...serie].sort((a, b) => a.anio - b.anio)[0];
        const poblacionUltima = [...poblacion].sort(
          (a, b) => b.anio - a.anio,
        )[0];

        const serviciosPromedio =
          servicios.length > 0
            ? servicios.reduce((acc, s) => acc + s.cobertura_pct, 0) /
              servicios.length
            : 0;

        return (
          <article key={properties.id} className="card flex flex-col gap-3">
            <header>
              <div
                className="h-1.5 w-full rounded-full"
                style={{ backgroundColor: colorFromScore(properties.score_expansion) }}
                aria-hidden
              />
              <h3 className="mt-2 text-lg font-bold text-primary">
                {properties.nombre}
              </h3>
              <p className="text-xs uppercase tracking-wider text-secondary">
                {properties.categoria.replace("_", " ")}
              </p>
            </header>

            <dl className="space-y-1.5 text-sm">
              <Row label="Score expansion" value={properties.score_expansion.toFixed(2)} />
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
                value={`${serviciosPromedio.toFixed(0)}%`}
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
    <div className="flex items-center justify-between border-b border-neutral-border/60 py-1">
      <dt className="text-xs uppercase tracking-wide text-secondary">
        {label}
      </dt>
      <dd className="font-medium text-primary">{value}</dd>
    </div>
  );
}
