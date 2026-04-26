"use client";

// Comparador de 2 a 4 poligonos. Cliente-side para permitir seleccion rapida.
//
// Acepta query string `?ids=barrio1,barrio2` (o `?ids=barrio1&ids=barrio2`)
// para abrirse pre-seleccionado desde la página de un polígono. La
// selección incluye opcionalmente `posadas_completa` (total de la
// ciudad) que aparece visualmente diferenciado como capa de referencia.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ComparisonGrid } from "@/components/ComparisonGrid";
import { Disclaimer } from "@/components/Disclaimer";
import {
  getPoblacion,
  getPoligonos,
  getSerieTemporal,
  getServicios,
} from "@/lib/data.client";
import type {
  PoblacionRow,
  PoligonosCollection,
  SerieTemporalRow,
  ServicioRow,
} from "@/lib/types";

const MAX_SELECTION = 4;
// Marcador del polígono "Posadas total" — capa de referencia, no barrio.
// Lo permitimos en el comparador pero lo separamos visualmente.
const POSADAS_COMPLETA_ID = "posadas_completa";

interface Datos {
  collection: PoligonosCollection;
  serie: SerieTemporalRow[];
  poblacion: PoblacionRow[];
  servicios: ServicioRow[];
}

// Wrapper exportado: envuelve la página real en un Suspense boundary
// porque CompararPageInner usa `useSearchParams()`, que en Next 14 con
// pre-rendering necesita un fallback explícito (la query string solo se
// resuelve client-side y Next bloquea la build sin Suspense).
export default function CompararPage() {
  return (
    <Suspense fallback={null}>
      <CompararPageInner />
    </Suspense>
  );
}

function CompararPageInner() {
  const searchParams = useSearchParams();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Trae TODOS los polígonos (incluye `posadas_completa`) — el filtrado de
  // capas de referencia se hace acá con la separación urbana / total.
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

  // Lee `ids` del query string una sola vez cuando se carga el dataset.
  // Soporta ?ids=a,b,c o ?ids=a&ids=b. Filtramos contra el geojson para
  // no agregar IDs inválidos. Limitamos al máximo permitido.
  useEffect(() => {
    if (!datos) return;
    const raw = searchParams.getAll("ids");
    if (raw.length === 0) return;
    const expanded = raw
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    const validIds = new Set(
      datos.collection.features.map((f) => f.properties.id),
    );
    const filtered = Array.from(new Set(expanded))
      .filter((id) => validIds.has(id))
      .slice(0, MAX_SELECTION);
    if (filtered.length > 0) {
      setSelected(filtered);
    }
    // Solo corre cuando datos se carga, no cuando cambia la selección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos]);

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

  // Separamos la lista de barrios de la capa "Posadas total" para que el
  // selector deje claro que esta última es referencia, no barrio.
  const barrios = useMemo(() => {
    if (!datos) return [];
    return datos.collection.features.filter(
      (f) => f.properties.id !== POSADAS_COMPLETA_ID,
    );
  }, [datos]);
  const totalCiudad = useMemo(() => {
    if (!datos) return null;
    return (
      datos.collection.features.find(
        (f) => f.properties.id === POSADAS_COMPLETA_ID,
      ) ?? null
    );
  }, [datos]);

  return (
    <>
      <Disclaimer />
      <section className="container-obs py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
          Análisis comparativo
        </p>
        <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
          Comparar polígonos
        </h1>
        <p className="mt-3 lead text-neutral-text dark:text-dk-text">
          Seleccioná entre 2 y {MAX_SELECTION} polígonos para verlos lado a
          lado: score de expansión, superficie, población, edificación y
          cobertura de servicios.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 text-sm text-accent-600 dark:text-dk-accent"
          >
            {error}
          </p>
        )}

        {datos && (
          <fieldset className="mt-6 card">
            <legend className="px-2 text-xs uppercase tracking-wider text-secondary dark:text-dk-muted">
              Poligonos disponibles
            </legend>

            {/* Capa de referencia "Posadas total" — visualmente separada del
                resto para dejar explícito que NO es un barrio. */}
            {totalCiudad && (
              <div className="mb-3 mt-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent-600 dark:text-dk-accent">
                  Capa de referencia
                </p>
                {(() => {
                  const id = totalCiudad.properties.id;
                  const isSel = selected.includes(id);
                  const disabled = !isSel && selected.length >= MAX_SELECTION;
                  return (
                    <label
                      className={[
                        "inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md border-2 px-3 py-1.5 text-sm transition-colors",
                        isSel
                          ? "border-accent bg-accent text-white shadow-sm dark:border-dk-accent dark:bg-dk-accent dark:text-dk-bg"
                          : "border-accent/40 bg-accent/5 text-accent-600 hover:bg-accent/10 dark:border-dk-accent/40 dark:bg-dk-accent/10 dark:text-dk-accent dark:hover:bg-dk-accent/20",
                        disabled && !isSel ? "cursor-not-allowed opacity-50" : "",
                      ].join(" ")}
                      title="Total agregado de los 43 barrios — capa de referencia, no es un barrio"
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isSel}
                        disabled={disabled}
                        onChange={() => toggle(id)}
                      />
                      <span aria-hidden>{"⊕"}</span>
                      <span className="font-semibold">Total ciudad</span>
                      <span className="text-[11px] opacity-80">
                        ({totalCiudad.properties.nombre})
                      </span>
                    </label>
                  );
                })()}
              </div>
            )}

            <p className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
              Barrios
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {barrios.map((f) => {
                const id = f.properties.id;
                const isSel = selected.includes(id);
                const disabled = !isSel && selected.length >= MAX_SELECTION;
                return (
                  <label
                    key={id}
                    className={[
                      "inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                      isSel
                        ? "border-primary bg-primary text-white shadow-sm dark:border-dk-primary dark:bg-dk-primary dark:text-dk-bg"
                        : "border-neutral-border bg-white text-primary hover:bg-primary-50 dark:border-dk-border dark:bg-dk-surface dark:text-dk-primary dark:hover:bg-dk-elevated",
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
            <p className="mt-3 text-xs text-neutral-muted dark:text-dk-muted">
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
