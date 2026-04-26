"use client";

// Home: mapa interactivo con sidebar de poligono.
// El MapView se importa dinamicamente con ssr:false porque Leaflet depende de window.

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { Disclaimer } from "@/components/Disclaimer";
import { LottieAnimation } from "@/components/LottieAnimation";
import { PolygonSidebar } from "@/components/PolygonSidebar";
import { UpdateIndicator } from "@/components/UpdateIndicator";
import {
  getDynamicWorld,
  getPoligonoFeature,
  getPoligonosBarrios,
} from "@/lib/data.client";
import type {
  DynamicWorldRow,
  PoligonoFeature,
  PoligonoProperties,
  PoligonosCollection,
} from "@/lib/types";

// Loading state del mapa: usamos LottieAnimation con shimmer hexagonal
// (paleta institucional). Si el usuario tiene prefers-reduced-motion el
// componente cae al fallback estático ("Cargando mapa…") sin reproducir
// animación. ariaLabel hace que lectores de pantalla anuncien "Cargando
// mapa" en vez de "imagen sin descripción".
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[320px] items-center justify-center rounded-lg bg-primary-50 dark:bg-dk-elevated">
      <LottieAnimation
        src="/animations/loading-map.json"
        ariaLabel="Cargando mapa"
        width={140}
        height={140}
        fallback={
          <span className="text-sm text-neutral-muted dark:text-dk-muted">
            Cargando mapa…
          </span>
        }
      />
    </div>
  ),
});

export default function HomePage() {
  const [collection, setCollection] = useState<PoligonosCollection | null>(null);
  const [posadasTotal, setPosadasTotal] = useState<PoligonoFeature | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dynamicWorld, setDynamicWorld] = useState<DynamicWorldRow[]>([]);

  useEffect(() => {
    // Carga en paralelo: el contorno de Posadas (referencia ciudad) y los
    // barrios disjuntos. El contorno se muestra arriba en la lista para
    // ver totales de ciudad pero no entra al mapa coroplético.
    getPoligonosBarrios()
      .then(setCollection)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Error desconocido"),
      );
    getPoligonoFeature("posadas_completa")
      .then(setPosadasTotal)
      .catch(() => setPosadasTotal(null));
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

      <section className="container-obs pb-2 pt-6 sm:pt-8">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
              Observatorio Urbano · 43 barrios disjuntos
            </p>
            {/* Indicador "vivo": dot pulsando + "actualizado hace X min".
                selfFetch=true le dice al componente que se conecte solo al
                stream SSE — no necesitamos pasarle props desde acá. */}
            <UpdateIndicator selfFetch variant="compact" />
          </div>
          <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
            Expansión urbana de Posadas, Misiones
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Cómo crece la ciudad, dónde aprieta el calor, dónde faltan servicios
            y dónde más urge invertir. Seleccioná un barrio para ver su ficha
            completa con datos satelitales y validación de campo.
          </p>
        </div>
      </section>

      <section className="container-obs py-6">
        {error ? (
          <div
            role="alert"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
          >
            No fue posible cargar los polígonos: {error}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <div className="h-map-main overflow-hidden rounded-lg border border-neutral-border dark:border-dk-border">
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

        {collection && (
          <PolygonList
            collection={collection}
            ciudadFeature={posadasTotal}
            onSelect={setSelectedId}
            selectedId={selectedId}
          />
        )}
      </section>
    </>
  );
}

// Tabla compacta de todos los poligonos, debajo del mapa, para navegacion accesible.
// `ciudadFeature` es la capa de referencia "Posadas completa" — se renderiza
// arriba como totales de ciudad antes del listado de barrios.
function PolygonList({
  collection,
  ciudadFeature,
  onSelect,
  selectedId,
}: {
  collection: PoligonosCollection;
  ciudadFeature: PoligonoFeature | null;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  return (
    <div className="mt-8">
      <h2 className="mb-2 text-lg font-semibold text-primary dark:text-dk-primary">
        Polígonos de análisis
      </h2>
      <p className="mb-3 text-sm text-neutral-muted dark:text-dk-muted">
        Tocá un polígono en el mapa para seleccionarlo, o abrí la ficha
        completa con indicadores, historia larga y descargas. En mobile,
        deslizá la tabla hacia los costados para ver todas las columnas.
      </p>
      <div className="overflow-x-auto rounded-lg border border-neutral-border dark:border-dk-border">
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
            {ciudadFeature ? (
              <tr
                key={ciudadFeature.properties.id}
                className="border-b-2 border-accent-200 bg-accent-50/40 dark:border-dk-accent/40 dark:bg-dk-elevated"
              >
                <th
                  scope="row"
                  className="font-bold text-accent dark:text-dk-accent"
                >
                  {ciudadFeature.properties.nombre}
                  <span className="ml-2 rounded-full bg-accent-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent dark:bg-dk-accent/30 dark:text-dk-accent">
                    Total ciudad
                  </span>
                </th>
                <td className="text-sm italic text-neutral-muted dark:text-dk-muted">
                  Capa de referencia
                </td>
                <td>—</td>
                <td>{ciudadFeature.properties.superficie_km2.toFixed(1)} km²</td>
                <td>—</td>
                <td>
                  <Link
                    href={`/poligono/${ciudadFeature.properties.id}`}
                    className="text-sm font-semibold text-accent underline-offset-2 hover:underline dark:text-dk-accent"
                    aria-label="Ver totales de toda Posadas"
                  >
                    Ver totales →
                  </Link>
                </td>
              </tr>
            ) : null}
            {collection.features.map((f) => {
              const p = f.properties;
              const isSel = p.id === selectedId;
              return (
                <tr
                  key={p.id}
                  className={
                    isSel
                      ? "bg-primary-50 dark:bg-dk-elevated"
                      : undefined
                  }
                >
                  <th
                    scope="row"
                    className="font-medium text-primary dark:text-dk-primary"
                  >
                    {p.nombre}
                  </th>
                  <td className="text-sm text-neutral-muted dark:text-dk-muted">
                    {p.categoria}
                  </td>
                  <td>{p.score_expansion.toFixed(2)}</td>
                  <td>{p.superficie_km2.toFixed(1)} km²</td>
                  <td>{p.poblacion_estimada.toLocaleString("es-AR")}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onSelect(p.id)}
                        className="text-sm font-medium text-secondary underline-offset-2 hover:underline dark:text-dk-muted dark:hover:text-dk-primary"
                        aria-label={`Seleccionar ${p.nombre} en el mapa`}
                      >
                        Seleccionar
                      </button>
                      <Link
                        href={`/poligono/${p.id}`}
                        className="text-sm font-semibold text-primary underline-offset-2 hover:underline dark:text-dk-primary"
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
