"use client";

// Home: mapa interactivo con sidebar de poligono.
// El MapView se importa dinamicamente con ssr:false porque Leaflet depende de window.

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { Disclaimer } from "@/components/Disclaimer";
import { PolygonSidebar } from "@/components/PolygonSidebar";
import { getDynamicWorld, getPoligonos } from "@/lib/data.client";
import type {
  DynamicWorldRow,
  PoligonoProperties,
  PoligonosCollection,
} from "@/lib/types";

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
  const [dynamicWorld, setDynamicWorld] = useState<DynamicWorldRow[]>([]);

  useEffect(() => {
    getPoligonos()
      .then(setCollection)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Error desconocido"),
      );
    // Dynamic World se carga en paralelo. Si el CSV falta, getDynamicWorld
    // devuelve [] (no crashea), y el sidebar simplemente no muestra la fila.
    getDynamicWorld()
      .then(setDynamicWorld)
      .catch(() => setDynamicWorld([]));
  }, []);

  const selected = useMemo<PoligonoProperties | null>(() => {
    if (!collection || !selectedId) return null;
    return (
      collection.features.find((f) => f.properties.id === selectedId)
        ?.properties ?? null
    );
  }, [collection, selectedId]);

  const dwRowsForSelected = useMemo<DynamicWorldRow[]>(() => {
    if (!selectedId) return [];
    return dynamicWorld.filter((r) => r.poligono_id === selectedId);
  }, [dynamicWorld, selectedId]);

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
              dynamicWorldRows={dwRowsForSelected}
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
      <h2 className="mb-2 text-lg font-semibold text-primary">
        Polígonos de análisis
      </h2>
      <p className="mb-3 text-sm text-neutral-muted">
        Hacé clic en un polígono del mapa, tocá &quot;Seleccionar&quot; para
        enfocarlo, o abrí directamente la ficha completa con todos los
        indicadores, gráficos de historia larga y descargas.
      </p>
      <div className="overflow-x-auto">
        <table className="data-table" aria-label="Lista de polígonos">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Categoría</th>
              <th scope="col">Score expansión</th>
              <th scope="col">Superficie</th>
              <th scope="col">Población</th>
              <th scope="col">Acciones</th>
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
                  <td>{p.superficie_km2.toFixed(1)} km²</td>
                  <td>{p.poblacion_estimada.toLocaleString("es-AR")}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onSelect(p.id)}
                        className="text-sm font-medium text-secondary underline-offset-2 hover:underline"
                        aria-label={`Seleccionar ${p.nombre} en el mapa`}
                      >
                        Seleccionar
                      </button>
                      <Link
                        href={`/poligono/${p.id}`}
                        className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
                        aria-label={`Abrir ficha completa de ${p.nombre}`}
                      >
                        Ver ficha →
                      </Link>
                    </div>
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
