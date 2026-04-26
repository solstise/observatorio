"use client";

// Cliente interactivo de /clima:
// - Banner sticky con la alerta más severa.
// - Mapa coroplético con barrios coloreados por la Tmin pronosticada
//   del día seleccionado (paleta diverging frío azul / templado naranja).
// - Selector de día (hoy → +13).
// - Selector de barrio (lista) → muestra PronosticoBarrio para ese.
// - Tarjeta AQI fija para Posadas global (5 días).
//
// El mapa coroplético se importa con ssr:false (Leaflet depende de window).

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { AlertasBanner } from "@/components/AlertasBanner";
import type {
  AlertasPayload,
  AqiDiarioRow,
  ForecastDiarioRow,
  PoligonosCollection,
} from "@/lib/types";

const MapaClima = dynamic(() => import("./MapaClima"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] items-center justify-center rounded-lg border border-neutral-border bg-primary-50 text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
      Cargando mapa…
    </div>
  ),
});

// PronosticoBarrio carga Recharts (~80 KB gzipped). No bloquea el render
// del banner + mapa, así que lo cargamos perezosamente — el chart aparece
// sólo después de que el usuario selecciona un barrio. Mantenemos SSR
// activo para que el HTML inicial se entregue server-side cuando la
// página la pre-rendea Next, pero el JS del chart se separa en su propio
// chunk async.
const PronosticoBarrio = dynamic(
  () =>
    import("@/components/PronosticoBarrio").then((m) => ({
      default: m.PronosticoBarrio,
    })),
  {
    loading: () => (
      <div className="rounded-lg border border-neutral-border bg-primary-50 p-4 text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
        Cargando pronóstico…
      </div>
    ),
  },
);

interface Props {
  collection: PoligonosCollection;
  forecast: ForecastDiarioRow[];
  aqi: AqiDiarioRow[];
  alertas: AlertasPayload;
  fechasDisponibles: string[];
}

const DIAS_ES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function fechaCorta(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return `${DIAS_ES[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

function clasificacionAqi(aqi: number): { label: string; color: string } {
  if (aqi <= 20) return { label: "Buena", color: "#22c55e" };
  if (aqi <= 40) return { label: "Aceptable", color: "#84cc16" };
  if (aqi <= 60) return { label: "Moderada", color: "#eab308" };
  if (aqi <= 80) return { label: "Pobre", color: "#f97316" };
  return { label: "Mala", color: "#ef4444" };
}

export function ClientClima({
  collection,
  forecast,
  aqi,
  alertas,
  fechasDisponibles,
}: Props) {
  // Día por defecto: el primero disponible (hoy o el siguiente día con datos).
  // El selector siempre mueve sobre fechasDisponibles, así que es seguro.
  const fechaDefault = fechasDisponibles[1] ?? fechasDisponibles[0] ?? "";
  const [fecha, setFecha] = useState<string>(fechaDefault);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Resincronizar la fecha si cambia el dataset (por ejemplo en hot-reload).
  useEffect(() => {
    if (!fecha && fechasDisponibles[0]) {
      setFecha(fechasDisponibles[1] ?? fechasDisponibles[0]);
    }
  }, [fechasDisponibles, fecha]);

  // Mapa poligono_id → nombre legible.
  const nombres = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of collection.features) {
      out[f.properties.id] = f.properties.nombre ?? f.properties.id;
    }
    return out;
  }, [collection]);

  // Forecast filtrado al día activo (una fila por barrio).
  const forecastDia = useMemo(() => {
    const idx = new Map<string, ForecastDiarioRow>();
    for (const r of forecast) {
      if (r.fecha === fecha) idx.set(r.poligono_id, r);
    }
    return idx;
  }, [forecast, fecha]);

  const filasBarrioSeleccionado = useMemo(() => {
    if (!selectedId) return [];
    return forecast
      .filter((r) => r.poligono_id === selectedId)
      .sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  }, [forecast, selectedId]);

  // Top 3 barrios con Tmin pronosticada más fría (próximos 7 días).
  const top3Frios = useMemo(() => {
    const fechasSel = fechasDisponibles.slice(0, 7);
    const min: Record<string, number> = {};
    for (const r of forecast) {
      if (!fechasSel.includes(r.fecha)) continue;
      const v = r.tmin_p50;
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      if (!(r.poligono_id in min) || v < min[r.poligono_id]) {
        min[r.poligono_id] = v;
      }
    }
    return Object.entries(min)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([pid, t]) => ({ pid, nombre: nombres[pid] ?? pid, tmin: t }));
  }, [forecast, fechasDisponibles, nombres]);

  // Una fila AQI para el día activo (si existe en el array AQI).
  const aqiDia = useMemo(() => {
    return aqi.find((r) => r.fecha === fecha) ?? aqi[0];
  }, [aqi, fecha]);

  return (
    <div className="space-y-6">
      <AlertasBanner payload={alertas} hideWhenEmpty={false} />

      <section
        aria-labelledby="selector-dia"
        className="rounded-md border border-neutral-border bg-white p-3 dark:border-dk-border dark:bg-dk-surface"
      >
        <h2 id="selector-dia" className="sr-only">
          Selector de día
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-secondary dark:text-dk-muted">
            Día del pronóstico:
          </span>
          <div className="flex flex-wrap gap-1">
            {fechasDisponibles.slice(0, 8).map((f) => {
              const active = f === fecha;
              return (
                <button
                  type="button"
                  key={f}
                  onClick={() => setFecha(f)}
                  aria-pressed={active}
                  className={[
                    "rounded border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-white dark:border-dk-primary dark:bg-dk-primary dark:text-dk-bg"
                      : "border-neutral-border text-primary hover:bg-primary-50 dark:border-dk-border dark:text-dk-primary dark:hover:bg-dk-elevated",
                  ].join(" ")}
                >
                  {fechaCorta(f)}
                </button>
              );
            })}
          </div>
          <span className="ml-auto text-[11px] italic text-neutral-muted dark:text-dk-muted">
            Tmin del día seleccionado · paleta diverging
          </span>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <div>
          <MapaClima
            collection={collection}
            forecastDia={forecastDia}
            onSelect={setSelectedId}
            selectedId={selectedId}
            fecha={fecha}
          />
          <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
            Cada barrio se colorea por su <strong>Tmin pronosticada</strong>{" "}
            (mediana del ensamble) para el día seleccionado. Hacé clic para
            ver el detalle 7 días.
          </p>
        </div>

        <div className="space-y-3">
          {/* Tarjeta AQI */}
          {aqiDia && (
            <section
              aria-labelledby="aqi-titulo"
              className="rounded-md border border-neutral-border bg-white p-3 shadow-sm dark:border-dk-border dark:bg-dk-surface"
            >
              <h3
                id="aqi-titulo"
                className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
              >
                Calidad de aire — Posadas
              </h3>
              <div className="mt-2 flex items-baseline gap-3">
                <span
                  className="text-3xl font-bold"
                  style={{ color: clasificacionAqi(aqiDia.european_aqi).color }}
                >
                  {Math.round(aqiDia.european_aqi)}
                </span>
                <span className="text-sm font-medium text-primary dark:text-dk-primary">
                  {clasificacionAqi(aqiDia.european_aqi).label}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-text dark:text-dk-text">
                <div>
                  <dt className="text-neutral-muted dark:text-dk-muted">PM2.5</dt>
                  <dd>{aqiDia.pm2_5.toFixed(1)} µg/m³</dd>
                </div>
                <div>
                  <dt className="text-neutral-muted dark:text-dk-muted">PM10</dt>
                  <dd>{aqiDia.pm10.toFixed(1)} µg/m³</dd>
                </div>
                <div>
                  <dt className="text-neutral-muted dark:text-dk-muted">NO₂</dt>
                  <dd>{aqiDia.no2.toFixed(1)} µg/m³</dd>
                </div>
                <div>
                  <dt className="text-neutral-muted dark:text-dk-muted">O₃</dt>
                  <dd>{aqiDia.ozone.toFixed(1)} µg/m³</dd>
                </div>
              </dl>
              <p className="mt-2 text-[10px] italic text-neutral-muted dark:text-dk-muted">
                Resolución del modelo ≈ 10 km — aplica a Posadas global, no se
                desagrega por barrio.
              </p>
            </section>
          )}

          {/* Top 3 barrios más fríos */}
          {top3Frios.length > 0 && (
            <section
              aria-labelledby="top-frios-titulo"
              className="rounded-md border border-neutral-border bg-white p-3 shadow-sm dark:border-dk-border dark:bg-dk-surface"
            >
              <h3
                id="top-frios-titulo"
                className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
              >
                Top 3 barrios más fríos (próx. 7 d)
              </h3>
              <ol className="mt-2 space-y-1.5">
                {top3Frios.map((b, idx) => (
                  <li key={b.pid} className="flex items-center justify-between gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => setSelectedId(b.pid)}
                      className="flex items-center gap-2 text-primary hover:underline dark:text-dk-primary"
                    >
                      <span className="font-mono text-xs text-neutral-muted dark:text-dk-muted">
                        {idx + 1}.
                      </span>
                      <span className="font-medium">{b.nombre}</span>
                    </button>
                    <span className="font-mono tabular-nums text-[#5a7a9c] dark:text-[#7faed8]">
                      {b.tmin.toFixed(1)}°
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Selector explícito de barrio (alternativa al click en mapa) */}
          <section
            aria-labelledby="selector-barrio-titulo"
            className="rounded-md border border-neutral-border bg-white p-3 shadow-sm dark:border-dk-border dark:bg-dk-surface"
          >
            <h3
              id="selector-barrio-titulo"
              className="text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
            >
              Elegí un barrio
            </h3>
            <select
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value || null)}
              aria-label="Seleccionar barrio"
              className="mt-2 w-full rounded border border-neutral-border bg-white px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-primary"
            >
              <option value="">— elegir —</option>
              {collection.features
                .map((f) => f.properties)
                .sort((a, b) => a.nombre.localeCompare(b.nombre))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
            </select>
          </section>
        </div>
      </div>

      {/* Pronóstico del barrio seleccionado */}
      {selectedId ? (
        <PronosticoBarrio
          rows={filasBarrioSeleccionado}
          nombreBarrio={nombres[selectedId] ?? selectedId}
          dias={7}
        />
      ) : (
        <div
          role="status"
          className="rounded-md border border-dashed border-neutral-border bg-white p-6 text-center text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-surface dark:text-dk-muted"
        >
          Hacé clic en un barrio del mapa o elegí uno del menú para ver el
          pronóstico 7 días con banda de confianza p10–p90.
        </div>
      )}
    </div>
  );
}
