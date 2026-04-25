"use client";

// Cliente interactivo de /calor: maneja selectores, estado de polígono
// seleccionado, y conecta todos los componentes con los datos.

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { EvolucionEstacional } from "@/components/calor/EvolucionEstacional";
import { LeyendaMapa } from "@/components/calor/LeyendaMapa";
import type { MetricaCalor } from "@/components/calor/MapaCalor";
import { NarrativaUHI } from "@/components/calor/NarrativaUHI";
import { RankingBarrios } from "@/components/calor/RankingBarrios";
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
    <div className="flex h-[540px] items-center justify-center rounded-lg border border-neutral-border bg-primary-50 text-sm text-neutral-muted">
      Cargando mapa térmico…
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
      />

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div>
          <MapaCalor
            collection={collection}
            uhiRows={rowsEnEstacion.length ? rowsEnEstacion : uhiRows}
            metrica={metrica}
            onSelect={setSelectedId}
            selectedId={selectedId}
            height={540}
          />
          <LeyendaMapa metrica={metrica} />
          <p className="mt-2 text-xs text-neutral-muted">
            Los polígonos rurales (baseline) se muestran con borde punteado y
            opacidad reducida.
          </p>
        </div>

        <RankingBarrios
          rows={rowsEnEstacion.length ? rowsEnEstacion : uhiRows}
          estacionales={estacionales}
          metrica={metrica}
          nombres={nombres}
          onSelect={setSelectedId}
        />
      </div>

      <NarrativaUHI
        poligonoId={selectedId}
        nombre={nombreSeleccionado}
        rows={rowsEnEstacion.length ? rowsEnEstacion : uhiRows}
      />

      <section aria-labelledby="evolucion" className="card">
        <h2 id="evolucion" className="mb-3 text-lg font-semibold text-primary">
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
