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
import {
  getPoligonosBarrios,
  getRankingPolitico,
  getUhiEstacional,
} from "@/lib/data.client";
import type { PoligonosCollection } from "@/lib/types";
import type { Metrica3D } from "@/components/MapLibre3DView";

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

// Metadata de cada métrica seleccionable: label corto, descripción
// "qué cuenta esta vista", unidad, y origen ("interna" = property del
// geojson, "externa" = lookup contra CSV cargado).
const METRICAS_3D: Record<
  Metrica3D,
  {
    label: string;
    historia: string;
    unidad: string;
    origen: "interna" | "externa";
  }
> = {
  poblacion_estimada: {
    label: "Población",
    historia: "Más alta = más gente vive ahí.",
    unidad: "habitantes",
    origen: "interna",
  },
  edificios_2026: {
    label: "Viviendas",
    historia: "Más alta = más techos detectados por satélite.",
    unidad: "viviendas",
    origen: "interna",
  },
  score_expansion: {
    label: "Crecimiento",
    historia:
      "Más alta = más expansión (índice 0–1, mayor crece más rápido).",
    unidad: "índice 0–1",
    origen: "interna",
  },
  superficie_km2: {
    label: "Superficie",
    historia: "Más alta = más territorio que cubre el barrio.",
    unidad: "km²",
    origen: "interna",
  },
  uhi_verano: {
    label: "Calor (UHI)",
    historia:
      "Más alta = más calor extra que el campo en verano. Identifica de un vistazo dónde aprieta el calor urbano.",
    unidad: "°C extra vs rural",
    origen: "externa",
  },
  indice_prioridad: {
    label: "Prioridad",
    historia:
      "Más alta = combina pobreza + calor + falta de servicios. El top de la torre marca dónde más urge invertir.",
    unidad: "índice 0–1",
    origen: "externa",
  },
};

const METRICAS_ORDER: Metrica3D[] = [
  "poblacion_estimada",
  "edificios_2026",
  "score_expansion",
  "superficie_km2",
  "uhi_verano",
  "indice_prioridad",
];

export default function ThreeDPage() {
  const [collection, setCollection] = useState<PoligonosCollection | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metrica, setMetrica] = useState<Metrica3D>("poblacion_estimada");
  const [uhiPorBarrio, setUhiPorBarrio] = useState<Record<string, number>>({});
  const [prioridadPorBarrio, setPrioridadPorBarrio] = useState<
    Record<string, number>
  >({});

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
    // UHI por barrio: tomamos el promedio verano del año más reciente
    // disponible. Si no hay datos para un barrio (por ejemplo rurales
    // baseline), queda en 0 y la columna queda al piso.
    getUhiEstacional()
      .then((rows) => {
        const veranoRecientes = new Map<string, { anio: number; valor: number }>();
        for (const r of rows) {
          if (r.estacion !== "verano") continue;
          const prev = veranoRecientes.get(r.poligono_id);
          if (!prev || r.anio > prev.anio) {
            veranoRecientes.set(r.poligono_id, {
              anio: r.anio,
              valor: r.uhi_vs_rural_mean,
            });
          }
        }
        const dict: Record<string, number> = {};
        veranoRecientes.forEach((v, k) => {
          dict[k] = v.valor;
        });
        setUhiPorBarrio(dict);
      })
      .catch(() => setUhiPorBarrio({}));
    // Índice prioridad: directo del ranking político.
    getRankingPolitico()
      .then((rows) => {
        const dict: Record<string, number> = {};
        for (const r of rows) {
          dict[r.poligono_id] = r.indice_prioridad;
        }
        setPrioridadPorBarrio(dict);
      })
      .catch(() => setPrioridadPorBarrio({}));
  }, []);

  const valoresExternos = useMemo(() => {
    if (metrica === "uhi_verano") return uhiPorBarrio;
    if (metrica === "indice_prioridad") return prioridadPorBarrio;
    return undefined;
  }, [metrica, uhiPorBarrio, prioridadPorBarrio]);

  const metricaInfo = METRICAS_3D[metrica];

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
            Posadas en tres dimensiones
          </p>
          <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
            Posadas en 3D
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Cada barrio es una columna; usá los botones de abajo para
            cambiar qué representa la altura. El relieve gris debajo es
            la topografía real (SRTM) que muestra la depresión del Paraná.
            Tocá una columna para enfocarla.
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

        <fieldset
          className="card mb-4"
          aria-label="Seleccionar métrica para la altura de las columnas"
        >
          <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
            Altura por…
          </legend>
          <div className="flex flex-wrap gap-2">
            {METRICAS_ORDER.map((m) => {
              const meta = METRICAS_3D[m];
              const isSel = m === metrica;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetrica(m)}
                  className={[
                    "rounded-md border-2 px-3 py-1.5 text-sm font-medium transition-colors",
                    isSel
                      ? "border-primary bg-primary text-white shadow-sm dark:border-dk-primary dark:bg-dk-primary dark:text-dk-bg"
                      : "border-neutral-border bg-white text-neutral-text hover:border-primary/40 hover:bg-primary-50 dark:border-dk-border dark:bg-dk-surface dark:text-dk-text dark:hover:border-dk-primary/40 dark:hover:bg-dk-elevated",
                  ].join(" ")}
                  aria-pressed={isSel}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-sm text-neutral-text dark:text-dk-text">
            <strong className="text-primary dark:text-dk-primary">
              {metricaInfo.label}:
            </strong>{" "}
            {metricaInfo.historia}{" "}
            <span className="text-xs italic text-neutral-muted dark:text-dk-muted">
              ({metricaInfo.unidad})
            </span>
          </p>
        </fieldset>

        <div className="relative">
          <MapLibreView
            collection={collection}
            selectedId={selectedId}
            onSelect={setSelectedId}
            maptilerKey={maptilerKey}
            metrica={metrica}
            valoresExternos={valoresExternos}
          />
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          <Stat label="Polígonos" value={collection?.features.length ?? 0} />
          <Stat label="Métrica activa" value={metricaInfo.label} />
          <Stat
            label="Relieve real"
            value={hasMaptiler ? "Activo" : "Off"}
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
              <strong>Altura por población</strong>: cada barrio se extruye
              entre 30 m (mínimo) y 400 m (máximo) escalando linealmente
              contra <code>poblacion_estimada</code>. El barrio más poblado
              llega al tope; los más chicos quedan al piso. NO representa
              altura de edificios reales — es una codificación visual de
              cantidad de habitantes.
            </li>
            <li>
              <strong>Color por score de expansión</strong>: gradiente
              crema → naranja según qué tan rápido crece el barrio (0 a 1).
              Naranja intenso = expansión activa, claro = consolidado.
            </li>
            <li>
              <strong>Selección por click</strong>: tocar un barrio dispara
              flyTo y le suma 50% extra de altura para destacarlo. ESC o
              click fuera deselecciona.
            </li>
            <li>
              <strong>Posadas total no se extruye</strong>: el contorno de
              referencia de toda la ciudad queda plano para no tapar la
              vista de los barrios.
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
