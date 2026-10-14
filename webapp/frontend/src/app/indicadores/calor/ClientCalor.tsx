"use client";

// Cliente interactivo de /calor: maneja selectores, estado de barrio
// seleccionado, y conecta todos los componentes con los datos.

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { LottieAnimation } from "@/components/LottieAnimation";
import { LeyendaMapa } from "@/components/calor/LeyendaMapa";
import type { MetricaCalor } from "@/components/calor/MapaCalor";
import { NarrativaUHI } from "@/components/calor/NarrativaUHI";
import { RankingBarrios } from "@/components/calor/RankingBarrios";

// EvolucionEstacional usa Recharts (~80 KB gzipped). Aparece debajo del
// fold y solo se hace útil cuando el usuario interactúa con el mapa, así
// que cargarlo perezosamente acelera el TTI sin afectar el contenido
// principal. Mantenemos SSR para que el card vacío exista en el HTML.
const EvolucionEstacional = dynamic(
  () =>
    import("@/components/calor/EvolucionEstacional").then((m) => ({
      default: m.EvolucionEstacional,
    })),
  {
    loading: () => (
      <div className="text-sm text-neutral-muted dark:text-dk-muted">
        Cargando evolución…
      </div>
    ),
  },
);
import {
  type Estacion,
  SelectorPeriodo,
} from "@/components/calor/SelectorPeriodo";
import type {
  CalorMensualRow,
  PoligonosCollection,
  UhiEstacionalRow,
  UhiMensualRow,
} from "@/lib/types";

// El mapa depende de window (Leaflet) → importar con ssr:false.
const MapaCalor = dynamic(() => import("@/components/calor/MapaCalor"), {
  ssr: false,
  loading: () => (
    <div className="h-map-main flex items-center justify-center rounded-lg border border-neutral-border bg-primary-50 dark:border-dk-border dark:bg-dk-elevated">
      <LottieAnimation
        src="/animations/loading-map.json"
        ariaLabel="Cargando mapa térmico"
        width={120}
        height={120}
        fallback={
          <span className="text-sm text-neutral-muted dark:text-dk-muted">
            Cargando mapa térmico…
          </span>
        }
      />
    </div>
  ),
});

interface Props {
  collection: PoligonosCollection;
  mensuales: CalorMensualRow[];
  uhiRows: UhiMensualRow[];
  estacionales: UhiEstacionalRow[];
}

export function ClientCalor({
  collection,
  mensuales,
  uhiRows,
  estacionales,
}: Props) {
  // Años disponibles según datos (si no hay, al menos el actual).
  const aniosDisponibles = useMemo(() => {
    const ys = new Set<number>();
    uhiRows.forEach((r) => ys.add(r.anio));
    mensuales.forEach((r) => ys.add(r.anio));
    const arr = Array.from(ys).sort((a, b) => b - a);
    return arr.length ? arr : [new Date().getFullYear()];
  }, [uhiRows, mensuales]);

  const [anio, setAnio] = useState<number>(aniosDisponibles[0]);
  const [estacion, setEstacion] = useState<Estacion>("verano");
  const [metrica, setMetrica] = useState<MetricaCalor>("uhi_vs_ciudad");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Estaciones que tienen datos para el año elegido. Sin esto, el dropdown
  // dejaría elegir invierno 2026 en abril 2026 y caía a fallback con datos
  // espurios. Los datos provienen de uhi_estacional (resumen anual + estación)
  // que es la fuente que usa el ranking, mapa y narrativa.
  const estacionesDisponibles = useMemo(() => {
    const out = new Set<Estacion>();
    estacionales.forEach((r) => {
      if (r.anio === anio) out.add(r.estacion as Estacion);
    });
    return out;
  }, [estacionales, anio]);

  // Si la estación seleccionada no existe para este año (caso típico:
  // venía con verano 2026 y el usuario cambia a 2018 que sí tiene los 4),
  // o al revés (invierno 2026 todavía no existe), saltamos a la primera
  // disponible para no mostrar pantalla vacía.
  useEffect(() => {
    if (estacionesDisponibles.size === 0) return;
    if (!estacionesDisponibles.has(estacion)) {
      const orden: Estacion[] = ["verano", "otono", "invierno", "primavera"];
      const fallback = orden.find((e) => estacionesDisponibles.has(e));
      if (fallback) setEstacion(fallback);
    }
  }, [estacionesDisponibles, estacion]);

  // Filtrar UHI a filas que caen dentro de la estacion + año elegidos.
  const rowsEnEstacion = useMemo(() => {
    const mesesDe = (e: Estacion): number[] => {
      if (e === "verano") return [12, 1, 2];
      if (e === "otono") return [3, 4, 5];
      if (e === "invierno") return [6, 7, 8];
      return [9, 10, 11];
    };
    const meses = mesesDe(estacion);
    return uhiRows.filter((r) => {
      const anioBucket = estacion === "verano" && r.mes === 12 ? r.anio + 1 : r.anio;
      return meses.includes(r.mes) && anioBucket === anio;
    });
  }, [uhiRows, estacion, anio]);

  const sinDatos = rowsEnEstacion.length === 0;

  const nombres = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of collection.features) {
      out[f.properties.id] = f.properties.nombre ?? f.properties.id;
    }
    return out;
  }, [collection]);

  const nombreSeleccionado = selectedId ? nombres[selectedId] ?? selectedId : null;

  return (
    <div className="space-y-6">
      <SelectorPeriodo
        aniosDisponibles={aniosDisponibles}
        anio={anio}
        onAnio={setAnio}
        estacion={estacion}
        onEstacion={setEstacion}
        metrica={metrica}
        onMetrica={setMetrica}
        estacionesDisponibles={estacionesDisponibles}
      />

      {sinDatos ? (
        <div className="rounded-md border border-neutral-border bg-primary-50 p-4 text-sm text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
          Todavía no hay composite Landsat publicado para esta estación. El
          pipeline mensual lo genera ~5 días después de que termina el último
          mes de la estación. Probá con la estación anterior.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div>
          <MapaCalor
            collection={collection}
            uhiRows={rowsEnEstacion}
            metrica={metrica}
            onSelect={setSelectedId}
            selectedId={selectedId}
            height={540}
          />
          <LeyendaMapa metrica={metrica} />
          <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
            Los polígonos rurales (baseline) se muestran con borde punteado y
            opacidad reducida.
          </p>
        </div>

        <RankingBarrios
          rows={rowsEnEstacion}
          estacionales={estacionales}
          metrica={metrica}
          nombres={nombres}
          onSelect={setSelectedId}
        />
      </div>

      <NarrativaUHI
        poligonoId={selectedId}
        nombre={nombreSeleccionado}
        rows={rowsEnEstacion}
      />

      <section aria-labelledby="evolucion" className="card">
        <h2
          id="evolucion"
          className="mb-3 text-lg font-semibold text-primary dark:text-dk-primary"
        >
          Evolución estacional
        </h2>
        <EvolucionEstacional
          poligonoId={selectedId}
          mensuales={mensuales}
          estacionales={estacionales}
        />
      </section>
    </div>
  );
}
