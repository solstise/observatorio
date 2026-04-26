"use client";

// Página /densidad — heatmap WebGL con deck.gl + maplibre.
//
// Permite alternar entre:
//
// 1. Densidad de viviendas detectadas (Open Buildings + MS Footprints) —
//    sample 1:5 con peso 5x para mantener performance.
// 2. Densidad de UHI verano por barrio — pesa cada centroide con uhi_verano
//    de social/ranking.csv.
//
// Toggle modo: heatmap vs hexagonal binning. Hexagonal es más útil para
// auditoría visual; heatmap es más estético.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Disclaimer } from "@/components/Disclaimer";
import { LottieAnimation } from "@/components/LottieAnimation";
import {
  COLOR_RANGE_BUILDINGS,
  COLOR_RANGE_UHI,
  type HeatmapMode,
  type HeatmapPoint,
} from "@/components/HeatmapLayer";
import {
  fetchBuildingPoints,
  fetchUhiPoints,
} from "@/lib/heatmapData";
import { getPoligonosBarrios } from "@/lib/data.client";
import type { PoligonosCollection } from "@/lib/types";

// El propio HeatmapLayer ya es "use client", pero usa imports de maplibre y
// @deck.gl que esperan window. Cargarlo con dynamic ssr:false desactiva el
// render del server por completo en este árbol.
const HeatmapLayer = dynamic(
  () =>
    import("@/components/HeatmapLayer").then(
      (mod) => mod.ObservatorioHeatmapLayer,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[540px] items-center justify-center rounded-lg border border-neutral-border bg-primary-50 dark:border-dk-border dark:bg-dk-elevated">
        <LottieAnimation
          src="/animations/loading-map.json"
          ariaLabel="Cargando mapa"
          width={120}
          height={120}
          fallback={
            <span className="text-sm text-neutral-muted dark:text-dk-muted">
              Cargando mapa…
            </span>
          }
        />
      </div>
    ),
  },
);

type DataMode = "buildings" | "uhi";

export default function DensidadPage() {
  const [dataMode, setDataMode] = useState<DataMode>("buildings");
  const [vizMode, setVizMode] = useState<HeatmapMode>("heat");
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState<PoligonosCollection | null>(
    null,
  );

  // Cargamos la colección una sola vez al montar — la usamos para "uhi".
  useEffect(() => {
    getPoligonosBarrios()
      .then(setCollection)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Error desconocido"),
      );
  }, []);

  // Cargamos los puntos cada vez que cambia el modo de datos. Usamos un
  // AbortController para cancelar fetches en vuelo si el usuario alterna
  // rápidamente entre modos.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const promise =
      dataMode === "buildings"
        ? fetchBuildingPoints(controller.signal)
        : collection
          ? fetchUhiPoints(collection, controller.signal)
          : Promise.resolve([]);
    promise
      .then((pts) => {
        if (controller.signal.aborted) return;
        setPoints(pts);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error desconocido");
        setLoading(false);
      });
    return () => controller.abort();
  }, [dataMode, collection]);

  const palette = useMemo(
    () => (dataMode === "uhi" ? COLOR_RANGE_UHI : COLOR_RANGE_BUILDINGS),
    [dataMode],
  );

  return (
    <>
      <Disclaimer />
      <main className="container-obs py-8">
        <nav
          aria-label="Migas"
          className="mb-4 text-sm text-secondary dark:text-dk-muted"
        >
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            Densidad WebGL
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Vista experimental — deck.gl
          </p>
          <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
            Densidad de Posadas (heatmap WebGL)
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Mapa de calor renderizado en WebGL con deck.gl, encima del mapa
            base de maplibre. Permite ver dónde se concentran las viviendas
            detectadas por satélite y dónde la isla de calor urbana es más
            intensa, todo a 60 fps con miles de puntos en simultáneo.
          </p>
        </header>

        <section
          aria-label="Controles del heatmap"
          className="mb-4 grid gap-4 rounded-lg border border-neutral-border bg-white p-4 dark:border-dk-border dark:bg-dk-surface md:grid-cols-2"
        >
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-primary dark:text-dk-primary">
              Qué se muestra
            </legend>
            <div className="flex flex-wrap gap-2">
              <ModeButton
                active={dataMode === "buildings"}
                onClick={() => setDataMode("buildings")}
                label="Densidad de viviendas"
              />
              <ModeButton
                active={dataMode === "uhi"}
                onClick={() => setDataMode("uhi")}
                label="Densidad de UHI (verano)"
              />
            </div>
            <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
              {dataMode === "buildings"
                ? "Centroides de edificios (Google Open Buildings + Microsoft Building Footprints), sample 1:5 con peso compensado."
                : "Centroides de barrios pesados por intensidad de isla de calor verano (social/ranking.csv)."}
            </p>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-primary dark:text-dk-primary">
              Estilo
            </legend>
            <div className="flex flex-wrap gap-2">
              <ModeButton
                active={vizMode === "heat"}
                onClick={() => setVizMode("heat")}
                label="Heatmap"
              />
              <ModeButton
                active={vizMode === "hex"}
                onClick={() => setVizMode("hex")}
                label="Hexágonos (200 m)"
              />
            </div>
            <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
              {vizMode === "heat"
                ? "Suavizado gaussiano: estética, bueno para presentaciones."
                : "Bins de 200 m: agregación auditable, bueno para análisis."}
            </p>
          </fieldset>
        </section>

        {error && (
          <div
            role="alert"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
          >
            No fue posible cargar los datos del heatmap: {error}
          </div>
        )}

        <div className="relative">
          <HeatmapLayer
            points={points}
            mode={vizMode}
            colorRange={palette}
            height={580}
          />
          {loading && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="rounded-md bg-white/85 px-3 py-2 text-xs text-primary shadow-md dark:bg-dk-bg/85 dark:text-dk-primary">
                Procesando puntos…
              </div>
            </div>
          )}
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Stat label="Puntos cargados" value={points.length.toLocaleString("es-AR")} />
          <Stat
            label="Modo"
            value={dataMode === "buildings" ? "Viviendas" : "UHI verano"}
          />
          <Stat label="Renderizado" value={vizMode === "hex" ? "Hexágonos" : "Heatmap"} />
        </section>

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se construye este mapa
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Renderizado WebGL</strong>: deck.gl agrega los puntos en
              GPU. El mapa base lo provee maplibre-gl. Esa combinación permite
              mostrar decenas de miles de puntos sin congelar el navegador.
            </li>
            <li>
              <strong>Sampling de viviendas (1:5)</strong>: el GeoJSON completo
              tiene 217 mil edificios. Tomamos uno de cada cinco y compensamos
              con peso 5x — la densidad agregada se preserva, el navegador no
              se ahoga. Para análisis exactos, ver{" "}
              <Link
                href="/"
                className="text-primary underline hover:no-underline dark:text-dk-primary"
              >
                el mapa Leaflet
              </Link>{" "}
              que sí carga las 217k features con clustering.
            </li>
            <li>
              <strong>UHI por barrio</strong>: usamos centroides de polígono
              pesados con uhi_verano de social/ranking.csv. Un valor alto
              (rojo) significa que ese barrio fue varios grados más caluroso
              que el promedio de la ciudad, en verano.
            </li>
            <li>
              <strong>Compatibilidad con el mapa principal</strong>: esta
              vista no reemplaza el Leaflet del home, lo complementa. Esa
              decisión preserva la accesibilidad por teclado, la lista
              tabular, y la integración con el sidebar de polígonos.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}

// Botón de toggle reutilizable. Usa aria-pressed para semántica de toggle
// (mejor que un radio para este caso porque no son opciones lineales).
function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "min-h-[40px] rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-white dark:border-dk-primary dark:bg-dk-primary dark:text-dk-bg"
          : "border-neutral-border bg-white text-primary hover:bg-primary-50 dark:border-dk-border dark:bg-dk-surface dark:text-dk-primary dark:hover:bg-dk-elevated",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-border bg-white p-3 dark:border-dk-border dark:bg-dk-surface">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary dark:text-dk-muted">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-primary dark:text-dk-primary">
        {value}
      </p>
    </div>
  );
}
