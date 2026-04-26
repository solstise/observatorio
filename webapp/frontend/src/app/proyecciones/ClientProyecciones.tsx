"use client";

// Cliente interactivo del visor de proyecciones.
//
// Renderiza:
//   - Un selector de métrica (viviendas, población, % urbano, UHI verano).
//   - Un selector de barrio (lista alfabética de barrios disponibles).
//   - El componente ProyeccionChart con las series histórica + proyectada.
//
// Toda la data ya viene cargada del Server Component (`page.tsx`):
//   - `proyecciones`: filas brutas del CSV (todos los polígonos, todas
//     las métricas, todos los años — ~475 filas).
//   - `historicos`: dict {poligono_id → {metrica → [{anio, valor}]}}
//     pre-armado en el server. Evita 4 fetchs adicionales en el cliente.
//   - `features`: GeoJSON features para resolver nombres legibles.
//
// La carga del chart (Recharts ~80 KB) se difiere con next/dynamic para
// no inflar el First Load JS de la página /proyecciones.

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import type {
  PoligonoFeature,
  ProyeccionMetrica,
  ProyeccionRow,
} from "@/lib/types";

const ProyeccionChart = dynamic(
  () =>
    import("@/components/ProyeccionChart").then((m) => ({
      default: m.ProyeccionChart,
    })),
  {
    loading: () => (
      <div className="rounded-lg border border-neutral-border bg-primary-50 p-4 text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
        Cargando gráfico…
      </div>
    ),
  },
);

const METRICAS_LABEL: Record<ProyeccionMetrica, string> = {
  viviendas: "Viviendas detectadas",
  poblacion: "Población estimada",
  urbano: "% cobertura urbana",
  uhi_verano: "UHI verano (°C)",
};

interface Props {
  proyecciones: ProyeccionRow[];
  historicos: Record<
    string,
    Record<ProyeccionMetrica, Array<{ anio: number; valor: number }>>
  >;
  features: PoligonoFeature[];
}

export function ClientProyecciones({
  proyecciones,
  historicos,
  features,
}: Props) {
  // Métricas efectivamente disponibles según el CSV (sirve para
  // ocultar opciones que no tienen datos por la razón que sea).
  const metricasDisponibles = useMemo<ProyeccionMetrica[]>(() => {
    const set = new Set(proyecciones.map((r) => r.metrica));
    return (
      ["viviendas", "poblacion", "urbano", "uhi_verano"] as ProyeccionMetrica[]
    ).filter((m) => set.has(m));
  }, [proyecciones]);

  // Barrios con al menos una proyección — incluso si la métrica
  // seleccionada no aplica a ese barrio, lo dejamos visible para que
  // el usuario pueda explorar (le daremos placeholder en el chart).
  const barriosOpciones = useMemo(() => {
    const set = new Set(proyecciones.map((r) => r.poligono_id));
    return features
      .filter((f) => set.has(f.properties.id))
      .map((f) => ({ id: f.properties.id, nombre: f.properties.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [proyecciones, features]);

  const [metrica, setMetrica] = useState<ProyeccionMetrica>(
    metricasDisponibles[0] ?? "viviendas",
  );
  // Por defecto, el barrio con mayor proyección 2035 para la métrica
  // inicial — engancha al usuario con un caso interesante.
  const [poligonoId, setPoligonoId] = useState<string>(() => {
    const proyMetrica = proyecciones.filter((r) => r.metrica === metrica);
    if (!proyMetrica.length) return barriosOpciones[0]?.id ?? "";
    const top = [...proyMetrica].sort(
      (a, b) => b.valor_pred - a.valor_pred,
    )[0];
    return top?.poligono_id ?? barriosOpciones[0]?.id ?? "";
  });

  // Datos filtrados para el chart actual.
  const filasChart = useMemo(
    () =>
      proyecciones.filter(
        (r) => r.poligono_id === poligonoId && r.metrica === metrica,
      ),
    [proyecciones, poligonoId, metrica],
  );

  const histChart = historicos[poligonoId]?.[metrica] ?? [];
  const nombreBarrio =
    features.find((f) => f.properties.id === poligonoId)?.properties.nombre ??
    poligonoId;

  // Si una métrica no tiene fila para el barrio seleccionado pero sí
  // para otros, lo señalamos con un mensaje breve sobre el chart.
  const sinDatosParaCombinacion = filasChart.length === 0;

  return (
    <div className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-surface">
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-secondary dark:text-dk-muted">
          Métrica
          <select
            value={metrica}
            onChange={(e) => setMetrica(e.target.value as ProyeccionMetrica)}
            className="rounded border border-neutral-border bg-white px-2 py-1.5 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-dk-border dark:bg-dk-surface dark:text-dk-text"
          >
            {metricasDisponibles.map((m) => (
              <option key={m} value={m}>
                {METRICAS_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-secondary dark:text-dk-muted">
          Barrio
          <select
            value={poligonoId}
            onChange={(e) => setPoligonoId(e.target.value)}
            className="rounded border border-neutral-border bg-white px-2 py-1.5 text-sm text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-dk-border dark:bg-dk-surface dark:text-dk-text"
          >
            {barriosOpciones.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      {sinDatosParaCombinacion ? (
        <div className="rounded-md border border-neutral-border bg-primary-50 p-4 text-sm italic text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
          No hay proyección disponible para{" "}
          <strong>{METRICAS_LABEL[metrica]}</strong> en {nombreBarrio}. Probá
          otra métrica u otro barrio.
        </div>
      ) : (
        <ProyeccionChart
          historico={histChart}
          proyecciones={filasChart}
          metrica={metrica}
          nombreBarrio={nombreBarrio}
        />
      )}
    </div>
  );
}
