"use client";

// Página /3d — vista 3D de Posadas con maplibre-gl.
//
// Características:
//
// - Mapa base raster (CARTO Voyager / Dark Matter sin API key).
// - Si `NEXT_PUBLIC_MAPTILER_KEY` está configurada, agregamos terrain RGB de
//   MapTiler (gratis con cuenta) y el mapa adquiere relieve real con `pitch`.
//   Si no, mostramos un banner explicando cómo activar elevación 3D y dejamos
//   el mapa funcional en 2D con pitch limitado.
// - 3D buildings: extruimos los centroides de Open Buildings + MS Footprints
//   con altura constante de 6 m por edificio (los datasets fuente no traen
//   altura confiable en Argentina). El layer FillExtrusion levanta los
//   edificios desde el footprint poligonal — usamos los polígonos del
//   GeoJSON merged si están disponibles, sino caemos a un buffer alrededor
//   del centroide.
// - Selector de polígono: click en un barrio del overlay → fly to + highlight
//   3D del contorno (extrusión hueca de 80m).
// - Pitch inicial: 45° si terrain está activo, 25° si no (sin elevación es
//   raro un pitch agresivo).
//
// Esta página NO bloquea el build si MapTiler key está ausente: degrada
// limpiamente. La build es verde en cualquier caso.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Disclaimer } from "@/components/Disclaimer";
import { LottieAnimation } from "@/components/LottieAnimation";
import { getPoligonosBarrios } from "@/lib/data.client";
import type { PoligonosCollection } from "@/lib/types";

// El componente Map en sí lo cargamos con dynamic ssr:false porque maplibre
// necesita window. Si lo importáramos sincrónicamente, Next.js intentaría
// ejecutarlo en el server build y crashearía.
const MapLibreView = dynamic(
  () => import("@/components/MapLibre3DView").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-neutral-border bg-primary-50 dark:border-dk-border dark:bg-dk-elevated">
        <LottieAnimation
          src="/animations/loading-map.json"
          ariaLabel="Cargando mapa 3D"
          width={120}
          height={120}
          fallback={
            <span className="text-sm text-neutral-muted dark:text-dk-muted">
              Cargando mapa 3D…
            </span>
          }
        />
      </div>
    ),
  },
);

export default function ThreeDPage() {
  const [collection, setCollection] = useState<PoligonosCollection | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Maptiler key: leemos del runtime env. Como es NEXT_PUBLIC_, está
  // disponible en client. Si está vacía o ausente, el componente se monta
  // en modo "sin terrain". El build no rompe nunca.
  const maptilerKey = useMemo(
    () => process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "",
    [],
  );
  const hasMaptiler = maptilerKey.length > 0;

  useEffect(() => {
    getPoligonosBarrios()
      .then(setCollection)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Error desconocido"),
      );
  }, []);

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
            Vista 3D
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Vista experimental — Maplibre GL
          </p>
          <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
            Posadas en 3D
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Vista tridimensional con relieve y siluetas extruidas de los
            barrios. Permite leer la topografía costera del Paraná y la
            distribución de los polígonos del observatorio respecto al perfil
            del terreno.
          </p>
        </header>

        {!hasMaptiler && (
          <div
            role="status"
            className="card mb-4 border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
          >
            <p className="font-semibold">
              Si MapTiler key no está configurada, los tiles base se muestran
              sin elevación 3D.
            </p>
            <p className="mt-2">
              Para activar el relieve real, registrate gratis en{" "}
              <a
                href="https://cloud.maptiler.com/account/keys/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                MapTiler
              </a>{" "}
              y exportá la variable{" "}
              <code className="rounded bg-white/40 px-1 py-0.5 dark:bg-amber-950/30">
                NEXT_PUBLIC_MAPTILER_KEY
              </code>{" "}
              en el deploy. La build no rompe sin la key — solo se degrada el
              hillshade.
            </p>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
          >
            No fue posible cargar los polígonos: {error}
          </div>
        )}

        <div className="relative">
          <MapLibreView
            collection={collection}
            selectedId={selectedId}
            onSelect={setSelectedId}
            maptilerKey={maptilerKey}
          />
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Stat label="Polígonos" value={collection?.features.length ?? 0} />
          <Stat
            label="Relieve real"
            value={hasMaptiler ? "Activo" : "Off"}
          />
          <Stat
            label="Pitch inicial"
            value={hasMaptiler ? "45°" : "25°"}
          />
        </section>

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se arma esta vista
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Mapa base</strong>: tiles raster CARTO Voyager (claro) o
              Dark Matter (oscuro), sin API key, atribución a OpenStreetMap.
            </li>
            <li>
              <strong>Relieve</strong>: cuando MapTiler está disponible,
              añadimos terrain-rgb-v2 que codifica elevación SRTM en RGB.
              Maplibre interpreta esos tiles como DEM y exagera la altura
              según el factor configurado (1.5× por defecto).
            </li>
            <li>
              <strong>Polígonos como volúmenes</strong>: cada barrio se
              extruye 80 m con FillExtrusion. La altura es uniforme — es un
              "marcador 3D" del contorno, no representa altura real de
              edificios.
            </li>
            <li>
              <strong>Selección por click</strong>: tocar un barrio dispara
              flyTo con un offset que centra el contorno y baja el pitch
              ligeramente para mostrar la silueta. ESC o click fuera deselecta.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
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
