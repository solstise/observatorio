import { ForecastSafety } from '@/components/ForecastSafety';
import { getDatasetFreshness as forecastFreshness } from '@/lib/data-freshness';
export const dynamic = 'force-dynamic';
// Home (/) — dashboard del Observatorio Urbano Posadas.
//
// Refactor a "layout dashboard": en lugar de "mapa + sidebar" puro,
// ahora es server-component que arma:
//   1. Banner de alertas (dengue / calor / anegamiento / gentrificación)
//   2. KPIs city-wide (6 cards)
//   3. Mapa + sidebar (interactivo, en cliente)
//   4. Atajos por perfil (decisor, periodista, vecino) via <HubOverviewCard>
//   5. Tabla de barrios (ya extraída a <PolygonList>)
//
// La parte interactiva vive en <HomeDashboardClient>; este page sigue
// siendo server-component para SSR/SEO. Toda la data de KPIs se computa
// en el server en una sola pasada.

import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { HomeDashboardClient } from "@/components/HomeDashboardClient";
import { HubOverviewCard } from "@/components/HubOverviewCard";
import { PolygonList } from "@/components/PolygonList";
import { UpdateIndicator } from "@/components/UpdateIndicator";
import {
  getAnegamiento,
  getCalorSalud,
  getDengue,
  getEdificiosReales,
  getGentrificacion,
  getGini,
  getGreenEquity,
  getHabitabilidad,
  getPoligonoFeature,
  getPoligonosBarrios,
  getUhiEstacional,
  getUpdatedAt,
} from "@/lib/data.server";

function fechaRelativa(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ahora = Date.now();
  const diffMs = ahora - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "hace instantes";
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const dias = Math.floor(hr / 24);
  return `hace ${dias} d`;
}

// Mediana para no dejarse arrastrar por outliers (verde m²/hab tiene
// extremos cuando barrios chicos tienen mucha vegetación).
function mediana(arr: number[]): number | null {
  const vals = arr.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function media(arr: number[]): number | null {
  const vals = arr.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default async function HomePage() {
  const safety = await forecastFreshness('forecast');
  // Carga en paralelo de TODO lo que necesitamos para el dashboard.
  // Si un CSV falla, el getter degrada a [] y el card respectivo muestra
  // "s/d" — no rompemos la página.
  const [
    collection,
    ciudadFeature,
    edificiosReales,
    greenEquityRows,
    habitabilidadRows,
    uhiEstacional,
    giniRows,
    dengueRows,
    calorRows,
    anegRows,
    gentriRows,
    updatedAt,
  ] = await Promise.all([
    getPoligonosBarrios(),
    getPoligonoFeature("posadas_completa"),
    getEdificiosReales(),
    getGreenEquity(),
    getHabitabilidad(),
    getUhiEstacional(),
    getGini(),
    getDengue(),
    getCalorSalud(),
    getAnegamiento(),
    getGentrificacion(),
    getUpdatedAt(),
  ]);

  // ---------- KPIs ciudad ----------
  const poblacionTotal = collection.features.reduce(
    (acc, f) => acc + (Number(f.properties.poblacion_estimada) || 0),
    0,
  );
  const edificiosRealesTotal = edificiosReales.reduce(
    (acc, r) => acc + (Number(r.n_edificios_real) || 0),
    0,
  );
  const verdeM2PerCapitaMediana = mediana(
    greenEquityRows
      .map((r) => r.m2_per_capita)
      .filter((v): v is number => typeof v === "number"),
  );
  const habitabilidadMedia = media(
    habitabilidadRows.map((r) => r.score_habitabilidad),
  );
  const uhiVerano = (() => {
    // Filtramos estaciones de verano y promediamos.
    const veranos = uhiEstacional.filter((r) => r.estacion === "verano");
    return media(veranos.map((r) => r.uhi_vs_rural_mean));
  })();
  // Gini del Observatorio: tomamos habitabilidad si existe, sino verde.
  const giniHab = giniRows.find((r) => r.metrica === "habitabilidad");
  const giniVerde = giniRows.find((r) => r.metrica === "verde_m2_per_capita");
  const giniRow = giniHab || giniVerde || giniRows[0] || null;

  // ---------- Banner alertas ----------
  // Categorías que disparan alerta. Para gentrificación, el equivalente a
  // "alta" es "en_transformacion".
  const dengueAlertas = dengueRows.filter(
    (r) => r.categoria === "alto" || r.categoria === "muy_alto",
  ).length;
  const calorAlertas = calorRows.filter(
    (r) => r.categoria === "alto" || r.categoria === "muy_alto",
  ).length;
  const anegAlertas = anegRows.filter(
    (r) => r.categoria === "alto" || r.categoria === "muy_alto",
  ).length;
  const gentriAlertas = gentriRows.filter(
    (r) => r.categoria === "en_transformacion",
  ).length;
  const totalAlertas =
    dengueAlertas + calorAlertas + anegAlertas + gentriAlertas;
  const bannerTone = totalAlertas > 0 ? "amber" : "emerald";

  // ---------- Slots ----------
  const kpisSlot = (
    <section
      aria-labelledby="kpis-ciudad"
      className="card grid h-full grid-cols-2 gap-3 sm:grid-cols-3"
    >
      <h2
        id="kpis-ciudad"
        className="col-span-full text-sm font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
      >
        Posadas en números
      </h2>
      <Kpi
        label="Población total"
        value={poblacionTotal.toLocaleString("es-AR")}
        sub={`${collection.features.length} barrios`}
      />
      <Kpi
        label="Edificios reales"
        value={
          edificiosRealesTotal > 0
            ? edificiosRealesTotal.toLocaleString("es-AR")
            : "s/d"
        }
        sub="Microsoft Buildings"
      />
      <Kpi
        label="Verde m² / hab"
        value={
          verdeM2PerCapitaMediana != null
            ? Math.round(verdeM2PerCapitaMediana).toString()
            : "s/d"
        }
        sub="Mediana de barrios"
      />
      <Kpi
        label="Habitabilidad"
        value={
          habitabilidadMedia != null
            ? `${Math.round(habitabilidadMedia)}/100`
            : "s/d"
        }
        sub="Promedio Capa 3"
      />
      <Kpi
        label="UHI verano"
        value={uhiVerano != null ? `+${uhiVerano.toFixed(1)} °C` : "s/d"}
        sub="Urbano vs rural"
      />
      <Kpi
        label={giniRow ? `Gini ${giniRow.metrica}` : "Gini"}
        value={
          giniRow && giniRow.gini_index != null
            ? giniRow.gini_index.toFixed(2)
            : "s/d"
        }
        sub="0 igual · 1 muy desigual"
      />
    </section>
  );

  const tableSlot = (
    <>
      <section aria-labelledby="atajos" className="mt-10">
        <h2
          id="atajos"
          className="mb-3 text-lg font-semibold text-primary dark:text-dk-primary"
        >
          Atajos por perfil
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <HubOverviewCard
            href="/decision"
            title="🏛 Soy decisor"
            description="Ranking político, comparador entre barrios y prioridades de inversión."
            tone="primary"
            chip="Decisión"
            kpi={{
              value: collection.features.length.toString(),
              unit: "barrios",
              label: "ordenados por urgencia",
            }}
          />
          <HubOverviewCard
            href="/pronostico"
            title="📰 Soy periodista"
            description="Pronóstico 14 días: dengue, calor, anegamiento y proyecciones."
            tone="accent"
            chip="Pronóstico"
            kpi={{
              value: totalAlertas.toString(),
              unit: "alertas",
              label: "barrios en riesgo alto/muy alto",
            }}
          />
          <HubOverviewCard
            href="#tabla-barrios"
            title="🏠 Soy vecino"
            description="Buscá tu barrio en el mapa o la tabla y abrí su ficha completa."
            tone="success"
            chip="Vecino"
            kpi={{
              value: "43",
              unit: "fichas",
              label: "datos satelitales 2018-2026",
            }}
          />
        </div>
      </section>

      <PolygonList collection={collection} ciudadFeature={ciudadFeature} />
    </>
  );

  return (
    <>
<ForecastSafety generatedAt={safety.lastUpdated} />
      <Disclaimer />

      <section className="container-obs pb-2 pt-6 sm:pt-8">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
              Observatorio Urbano Posadas
            </p>
            <UpdateIndicator selfFetch variant="compact" />
          </div>
          <h1
            className="mt-2 font-bold"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Estado de Posadas{" "}
            {updatedAt && (
              <span className="text-base font-normal text-secondary dark:text-dk-muted">
                · {fechaRelativa(updatedAt)}
              </span>
            )}
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Datos satelitales actualizados, pronóstico de 14 días, calidad de
            vida barrio por barrio. Empezá por las alertas o explorá los KPIs.
          </p>
        </div>
      </section>

      {/* Banner alertas — sticky-ish, primer scroll después del hero. */}
      <section className="container-obs py-2">
        <div
          role={totalAlertas > 0 ? "alert" : "status"}
          aria-live="polite"
          className={[
            "flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm",
            bannerTone === "amber"
              ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
              : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-100",
          ].join(" ")}
        >
          {totalAlertas === 0 ? (
            <>
              <span className="font-semibold">Sin alertas activas.</span>{" "}
              Todos los barrios en riesgo bajo o medio en las 4 dimensiones.
            </>
          ) : (
            <>
              <span className="font-semibold">
                {totalAlertas} {totalAlertas === 1 ? "alerta" : "alertas"} en curso
              </span>
              <Pill label="🦟 Dengue" count={dengueAlertas} />
              <Pill label="🌡 Calor" count={calorAlertas} />
              <Pill label="💧 Anegamiento" count={anegAlertas} />
              <Pill label="🏗 En transformación" count={gentriAlertas} />
              <Link
                href="/pronostico"
                className="ml-auto text-xs font-semibold underline-offset-2 hover:underline"
              >
                Ver pronóstico completo →
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="container-obs py-4">
        <HomeDashboardClient
          collection={collection}
          kpisSlot={kpisSlot}
          tableSlot={tableSlot}
        />
      </section>
    </>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-md border border-neutral-border/60 bg-primary-50/40 p-3 dark:border-dk-border/60 dark:bg-dk-elevated/50">
      <p className="text-[10px] uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-primary dark:text-dk-primary">
        {value}
      </p>
      <p className="text-[10px] text-neutral-muted dark:text-dk-muted">{sub}</p>
    </div>
  );
}

function Pill({ label, count }: { label: string; count: number }) {
  // Si la categoría no tiene alertas la dejamos en muted para que la
  // jerarquía visual ponga énfasis en lo que realmente está prendido.
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/40 px-2 py-0.5 text-xs text-neutral-muted dark:bg-dk-surface/40 dark:text-dk-muted">
        {label}: 0
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-semibold dark:bg-dk-surface">
      {label}: {count}
    </span>
  );
}
