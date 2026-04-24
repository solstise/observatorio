"use client";

// Home: mapa interactivo con sidebar de poligono.
// El MapView se importa dinamicamente con ssr:false porque Leaflet depende de window.

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { Disclaimer } from "@/components/Disclaimer";
import { PolygonSidebar } from "@/components/PolygonSidebar";
import { getPoligonos } from "@/lib/data.client";
import type { PoligonoProperties, PoligonosCollection } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center rounded-lg bg-primary-50 text-sm text-neutral-muted">
      Cargando mapa...
    </div>
  ),
});

export default function HomePage() {
  const [collection, setCollection] = useState<PoligonosCollection | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPoligonos()
      .then(setCollection)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Error desconocido"),
      );
  }, []);

  const selected = useMemo<PoligonoProperties | null>(() => {
    if (!collection || !selectedId) return null;
    return (
      collection.features.find((f) => f.properties.id === selectedId)
        ?.properties ?? null
    );
  }, [collection, selectedId]);

  return (
    <>
      <Disclaimer />

      <section className="container-obs pb-2 pt-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary">
            Fase 2 - Beta interno
          </p>
          <h1 className="mt-2 text-3xl md:text-4xl font-bold">
            Expansion urbana de Posadas, Misiones
          </h1>
          <p className="mt-3 text-base text-neutral-text">
            Analisis cuantitativo por poligono de referencia usando imagenes
            satelitales Sentinel-2, edificios de Google Open Buildings y
            estimaciones de poblacion WorldPop. Seleccione un poligono para ver
            metricas, serie temporal y cobertura de servicios.
          </p>
        </div>
      </section>

      <section className="container-obs py-6">
        {error ? (
          <div
            role="alert"
            className="card border-accent-200 bg-accent-50 text-sm"
          >
            No fue posible cargar los poligonos: {error}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="h-[540px] overflow-hidden rounded-lg border border-neutral-border">
              {collection && (
                <MapView
                  collection={collection}
                  selectedId={selectedId}
                  onSelect={(id) => setSelectedId(id)}
                />
              )}
            </div>

            <PolygonSidebar
              properties={selected}
              onClear={() => setSelectedId(null)}
            />
          </div>
        )}

        {collection && <PolygonList collection={collection} onSelect={setSelectedId} selectedId={selectedId} />}
      </section>
    </>
  );
}

// Tabla compacta de todos los poligonos, debajo del mapa, para navegacion accesible.
function PolygonList({
  collection,
  onSelect,
  selectedId,
}: {
  collection: PoligonosCollection;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-lg font-semibold text-primary">
        Poligonos de analisis
      </h2>
      <div className="overflow-x-auto">
        <table className="data-table" aria-label="Lista de poligonos">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Categoria</th>
              <th scope="col">Score expansion</th>
              <th scope="col">Superficie</th>
              <th scope="col">Poblacion</th>
              <th scope="col">Accion</th>
            </tr>
          </thead>
          <tbody>
            {collection.features.map((f) => {
              const p = f.properties;
              const isSel = p.id === selectedId;
              return (
                <tr
                  key={p.id}
                  className={isSel ? "bg-primary-50" : undefined}
                >
                  <th scope="row" className="font-medium text-primary">
                    {p.nombre}
                  </th>
                  <td className="text-sm text-neutral-muted">{p.categoria}</td>
                  <td>{p.score_expansion.toFixed(2)}</td>
                  <td>{p.superficie_km2.toFixed(1)} km2</td>
                  <td>{p.poblacion_estimada.toLocaleString("es-AR")}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => onSelect(p.id)}
                      className="text-sm font-medium text-primary underline-offset-2 hover:underline"
                      aria-label={`Seleccionar ${p.nombre} en el mapa`}
                    >
                      Seleccionar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
