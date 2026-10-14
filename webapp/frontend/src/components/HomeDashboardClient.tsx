"use client";

// <HomeDashboardClient> — capa cliente del dashboard de la home.
//
// El page server-component arma los KPIs y datos pre-computados y nos
// los pasa por props. Acá nos encargamos solo de la parte interactiva:
//   - el mapa Leaflet (necesita `window`, dynamic ssr:false)
//   - el sidebar con la información del polígono seleccionado
//   - selección/state local
//
// La tabla de barrios y los KPIs son server-rendered y los recibimos
// como `children` para no duplicar el rendering en cliente.

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { LottieAnimation } from "@/components/LottieAnimation";
import { PolygonSidebar } from "@/components/PolygonSidebar";
import {
  getDengue,
  getDynamicWorld,
  getHabitabilidad,
} from "@/lib/data.client";
import type {
  DengueRow,
  DynamicWorldRow,
  HabitabilidadRow,
  PoligonoProperties,
  PoligonosCollection,
} from "@/lib/types";

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

interface HomeDashboardClientProps {
  /** Colección con todos los barrios (excluye `posadas_completa`). */
  collection: PoligonosCollection;
  /** Sección de KPIs ya renderizada en el server. */
  kpisSlot: ReactNode;
  /** Tabla de barrios + atajos de perfil ya renderizados server-side. */
  tableSlot: ReactNode;
}

export function HomeDashboardClient({
  collection,
  kpisSlot,
  tableSlot,
}: HomeDashboardClientProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dynamicWorld, setDynamicWorld] = useState<DynamicWorldRow[]>([]);
  const [habitabilidad, setHabitabilidad] = useState<HabitabilidadRow[]>([]);
  const [dengue, setDengue] = useState<DengueRow[]>([]);

  useEffect(() => {
    // CSV chicos que el sidebar necesita. Si fallan, degradamos a [].
    getDynamicWorld()
      .then(setDynamicWorld)
      .catch(() => setDynamicWorld([]));
    getHabitabilidad()
      .then(setHabitabilidad)
      .catch(() => setHabitabilidad([]));
    getDengue()
      .then(setDengue)
      .catch(() => setDengue([]));
  }, []);

  const selected = useMemo<PoligonoProperties | null>(() => {
    if (!selectedId) return null;
    return (
      collection.features.find((f) => f.properties.id === selectedId)
        ?.properties ?? null
    );
  }, [collection, selectedId]);

  const dwRowsForSelected = useMemo<DynamicWorldRow[]>(() => {
    if (!selectedId) return [];
    return dynamicWorld.filter((r) => r.poligono_id === selectedId);
  }, [dynamicWorld, selectedId]);

  const habitabilidadForSelected = useMemo<HabitabilidadRow | null>(() => {
    if (!selectedId) return null;
    return habitabilidad.find((r) => r.poligono_id === selectedId) ?? null;
  }, [habitabilidad, selectedId]);

  const dengueForSelected = useMemo<DengueRow | null>(() => {
    if (!selectedId) return null;
    return dengue.find((r) => r.poligono_id === selectedId) ?? null;
  }, [dengue, selectedId]);

  return (
    <>
      {/* Grid 2-col: KPIs ciudad a la izquierda, mapa + sidebar a la derecha.
          En mobile apilamos KPIs encima del mapa para no apretar el viewport. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="order-1 lg:order-1">{kpisSlot}</div>
        <div className="order-2 grid gap-4 lg:order-2 lg:grid-cols-[3fr_2fr]">
          <div className="h-map-main overflow-hidden rounded-lg border border-neutral-border dark:border-dk-border">
            <MapView
              collection={collection}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
            />
          </div>
          <PolygonSidebar
            properties={selected}
            dynamicWorldRows={dwRowsForSelected}
            habitabilidad={habitabilidadForSelected}
            dengue={dengueForSelected}
            onClear={() => setSelectedId(null)}
          />
        </div>
      </div>

      {tableSlot}
    </>
  );
}
