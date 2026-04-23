"use client";

// Comparador de 2 a 4 poligonos. Cliente-side para permitir seleccion rapida.

import { useEffect, useMemo, useState } from "react";

import { ComparisonGrid } from "@/components/ComparisonGrid";
import { Disclaimer } from "@/components/Disclaimer";
import {
  getPoblacion,
  getPoligonos,
  getSerieTemporal,
  getServicios,
} from "@/lib/data";
import type {
  PoblacionRow,
  PoligonosCollection,
  SerieTemporalRow,
  ServicioRow,
} from "@/lib/types";

const MAX_SELECTION = 4;

interface Datos {
  collection: PoligonosCollection;
  serie: SerieTemporalRow[];
  poblacion: PoblacionRow[];
  servicios: ServicioRow[];
}

export default function CompararPage() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getPoligonos(),
      getSerieTemporal(),
      getPoblacion(),
      getServicios(),
    ])
      .then(([collection, serie, poblacion, servicios]) =>
        setDatos({ collection, serie, poblacion, servicios }),
      )
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Error desconocido"),
      );
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTION) return prev;
      return [...prev, id];
    });
  }

  const items = useMemo(() => {
    if (!datos) return [];
    return selected
      .map((id) => {
        const feature = datos.collection.features.find(
          (f) => f.properties.id === id,
        );
        if (!feature) return null;
        return {
          properties: feature.properties,
          serie: datos.serie.filter((s) => s.poligono_id === id),
          poblacion: datos.poblacion.filter((p) => p.poligono_id === id),
          servicios: datos.servicios.filter((s) => s.poligono_id === id),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [datos, selected]);

  return (
    <>
      <Disclaimer />
      <section className="container-obs py-8">
        <h1 className="text-3xl md:text-4xl font-bold">
          Comparar poligonos
        </h1>
        <p className="mt-2 text-base text-neutral-text">
          Seleccione entre 2 y {MAX_SELECTION} poligonos para comparar sus
          metricas clave.
        </p>

        {error && (
          <p role="alert" className="mt-4 text-sm text-accent-600">
            {error}
          </p>
        )}

        {datos && (
          <fieldset className="mt-6 card">
            <legend className="px-2 text-xs uppercase tracking-wider text-secondary">
              Poligonos disponibles
            </legend>
            <div className="flex flex-wrap gap-2 pt-2">
              {datos.collection.features.map((f) => {
                const id = f.properties.id;
                const isSel = selected.includes(id);
                const disabled = !isSel && selected.length >= MAX_SELECTION;
                return (
                  <label
                    key={id}
                    className={[
                      "inline-flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 text-sm",
                      isSel
                        ? "border-primary bg-primary text-white"
                        : "border-neutral-border bg-white text-primary hover:bg-primary-50",
                      disabled && !isSel ? "cursor-not-allowed opacity-50" : "",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isSel}
                      disabled={disabled}
                      onChange={() => toggle(id)}
                    />
                    {f.properties.nombre}
                  </label>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-neutral-muted">
              Seleccionados: {selected.length} / {MAX_SELECTION}
            </p>
          </fieldset>
        )}

        <div className="mt-6">
          <ComparisonGrid items={items} />
        </div>
      </section>
    </>
  );
}
