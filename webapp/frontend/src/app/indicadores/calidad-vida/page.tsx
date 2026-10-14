// Página /calidad-vida — Capa 3 del Observatorio Urbano Posadas.
//
// Sintetiza seis indicadores compuestos de calidad de vida urbana por
// barrio: habitabilidad (composite), ciudad de los 15 minutos (acceso),
// equidad de áreas verdes (OMS), resiliencia (calor + lluvia), señal de
// gentrificación, y desigualdad inter-barrio (Gini) sobre las métricas
// clave. Todo se calcula offline en `scripts/capas_avanzadas/compute_capas.cjs`
// y se sirve desde `/data/calidad/*.csv`.
//
// Estructura:
//   1. Hero con lead editorial y disclaimer.
//   2. Top 10 mejores barrios para vivir (ranking por score_habitabilidad).
//   3. Grid 2×3 de cards (Habitabilidad, 15-min, Green Equity, Resiliencia,
//      Gentrificación, Gini).
//   4. Tabla comparativa sortable con todos los scores side-by-side.
//
// Es un Server Component: lee los CSVs en build / SSR y pasa los rows ya
// cargados a las cards. Solo dos componentes son client (GreenEquityCard
// por Recharts, CalidadVidaTabla por sort interactivo).

import Link from "next/link";
import type { Metadata } from "next";

import { CalidadVidaTabla } from "@/components/CalidadVidaTabla";
import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { FifteenMinCard } from "@/components/FifteenMinCard";
import { GentrificacionCard } from "@/components/GentrificacionCard";
import { GiniCard } from "@/components/GiniCard";
import { GreenEquityCard } from "@/components/GreenEquityCard";
import { HabitabilidadCard } from "@/components/HabitabilidadCard";
import { ResilienciaCard } from "@/components/ResilienciaCard";
import { TerminoGlosario } from "@/components/TerminoGlosario";
import { getManyFreshness } from "@/lib/data-freshness";
import {
  getGentrificacion,
  getGini,
  getGreenEquity,
  getHabitabilidad,
  getPoligonosBarrios,
  getQuinceMinutos,
  getResiliencia,
} from "@/lib/data.server";
import type {
  GentrificacionRow,
  GreenEquityRow,
  HabitabilidadRow,
  PoligonoFeature,
  QuinceMinutosRow,
  ResilienciaRow,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Calidad de vida",
  description:
    "Indicadores compuestos de calidad de vida en los barrios de Posadas: habitabilidad, ciudad de los 15 minutos, equidad de áreas verdes (OMS), resiliencia urbana, señales de gentrificación y desigualdad inter-barrio (Gini).",
};

const CATEGORIA_HABITABILIDAD_COLOR: Record<
  HabitabilidadRow["categoria"],
  string
> = {
  bajo: "#dc2626",
  medio: "#facc15",
  bueno: "#5a7a9c",
  excelente: "#16a34a",
};

const CATEGORIA_HABITABILIDAD_LABEL: Record<
  HabitabilidadRow["categoria"],
  string
> = {
  bajo: "Bajo",
  medio: "Medio",
  bueno: "Bueno",
  excelente: "Excelente",
};

// Construye las filas para la tabla comparativa cruzando todos los datasets
// por poligono_id. Si un barrio no aparece en un CSV particular, su columna
// queda null (la tabla lo muestra como "s/d").
interface FilaCalidad {
  poligono_id: string;
  nombre: string;
  score_habitabilidad: number | null;
  score_15min: number | null;
  m2_per_capita: number | null;
  score_resiliencia: number | null;
  score_gentrificacion: number | null;
}

function buildFilasComparativa(
  features: PoligonoFeature[],
  habitabilidad: HabitabilidadRow[],
  quinceMin: QuinceMinutosRow[],
  greenEquity: GreenEquityRow[],
  resiliencia: ResilienciaRow[],
  gentrificacion: GentrificacionRow[],
): FilaCalidad[] {
  const habById = new Map(habitabilidad.map((r) => [r.poligono_id, r]));
  const qmById = new Map(quinceMin.map((r) => [r.poligono_id, r]));
  const geById = new Map(greenEquity.map((r) => [r.poligono_id, r]));
  const resById = new Map(resiliencia.map((r) => [r.poligono_id, r]));
  const gentById = new Map(
    gentrificacion.map((r) => [r.poligono_id, r] as const),
  );

  return features.map((f) => ({
    poligono_id: f.properties.id,
    nombre: f.properties.nombre,
    score_habitabilidad:
      habById.get(f.properties.id)?.score_habitabilidad ?? null,
    score_15min: qmById.get(f.properties.id)?.score_15min ?? null,
    m2_per_capita: geById.get(f.properties.id)?.m2_per_capita ?? null,
    score_resiliencia: resById.get(f.properties.id)?.score_resiliencia ?? null,
    score_gentrificacion:
      gentById.get(f.properties.id)?.score_gentrificacion ?? null,
  }));
}

export default async function CalidadVidaPage() {
  const [
    habitabilidad,
    quinceMin,
    greenEquity,
    resiliencia,
    gentrificacion,
    gini,
    collection,
    freshness,
  ] = await Promise.all([
    getHabitabilidad(),
    getQuinceMinutos(),
    getGreenEquity(),
    getResiliencia(),
    getGentrificacion(),
    getGini(),
    getPoligonosBarrios(),
    // La capa 3 deriva de viviendas (Open Buildings/GHSL), calor (Landsat),
    // dynamic_world (verde) y ranking (acceso). Mostramos los chips
    // relevantes para que el lector vea de qué año son los insumos.
    getManyFreshness([
      "viviendas",
      "calor_landsat",
      "dynamic_world",
      "ranking",
    ]),
  ]);

  const features = collection.features;

  // Top 10 mejores para vivir — orden por score_habitabilidad desc,
  // tie-break por nombre para estabilidad de render.
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre] as const),
  );
  const top10 = [...habitabilidad]
    .filter((r) => Number.isFinite(r.score_habitabilidad))
    .sort((a, b) => {
      if (b.score_habitabilidad !== a.score_habitabilidad) {
        return b.score_habitabilidad - a.score_habitabilidad;
      }
      const na = nombreById.get(a.poligono_id) ?? a.poligono_id;
      const nb = nombreById.get(b.poligono_id) ?? b.poligono_id;
      return na.localeCompare(nb, "es");
    })
    .slice(0, 10);

  const filasTabla = buildFilasComparativa(
    features,
    habitabilidad,
    quinceMin,
    greenEquity,
    resiliencia,
    gentrificacion,
  );

  const sinDatos =
    habitabilidad.length === 0 &&
    quinceMin.length === 0 &&
    greenEquity.length === 0 &&
    resiliencia.length === 0 &&
    gentrificacion.length === 0;

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
          <Link href="/indicadores" className="hover:underline">
            Indicadores
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            Calidad de vida
          </span>
        </nav>

        <header className="mb-8 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Capa 3 — Síntesis editorial
          </p>
          <h1
            className="mt-2 font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Calidad de vida en Posadas
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DataFreshness
              dataset="viviendas"
              lastUpdated={freshness.viviendas.lastUpdated}
              frequency={freshness.viviendas.frequency}
            />
            <DataFreshness
              dataset="calor_landsat"
              lastUpdated={freshness.calor_landsat.lastUpdated}
              frequency={freshness.calor_landsat.frequency}
              compact
            />
            <DataFreshness
              dataset="dynamic_world"
              lastUpdated={freshness.dynamic_world.lastUpdated}
              frequency={freshness.dynamic_world.frequency}
              compact
            />
            <DataFreshness
              dataset="ranking"
              lastUpdated={freshness.ranking.lastUpdated}
              frequency={freshness.ranking.frequency}
              compact
            />
          </div>
          <p className="mt-4 lead text-neutral-text dark:text-dk-text">
            Sintetizamos seis indicadores compuestos sobre los{" "}
            {features.length} barrios monitoreados: cuán{" "}
            <strong>
              <TerminoGlosario id="habitabilidad">habitable</TerminoGlosario>
            </strong>{" "}
            es cada uno, qué tan cerca de la{" "}
            <strong>
              <TerminoGlosario id="ciudad-15-min">
                ciudad de los 15 minutos
              </TerminoGlosario>
            </strong>{" "}
            está, cómo se distribuyen las áreas verdes contra el mínimo OMS,
            qué tan{" "}
            <strong>
              <TerminoGlosario id="resiliencia-urbana">
                resiliente
              </TerminoGlosario>
            </strong>{" "}
            es ante calor y lluvia, qué barrios muestran señales de{" "}
            <strong>
              <TerminoGlosario id="gentrificacion">
                gentrificación
              </TerminoGlosario>
            </strong>{" "}
            y qué tan desigual ({" "}
            <TerminoGlosario id="gini">Gini</TerminoGlosario>) es la ciudad en
            cada dimensión.
          </p>
          <div className="mt-4 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-neutral-text dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100">
            <strong>Recordatorio:</strong> estos índices son{" "}
            <em>insumos a nivel barrio</em> para política pública y
            planificación. No sirven para decisiones sobre viviendas o
            personas individuales.{" "}
            <Link
              href="/datos/metodologia"
              className="font-medium text-primary underline-offset-2 hover:underline dark:text-amber-50 dark:underline"
            >
              Ver metodología
            </Link>
            .
          </div>
        </header>

        {sinDatos ? (
          <div
            role="status"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
          >
            La Capa 3 todavía no se generó. El próximo cron de{" "}
            <code>compute_capas.cjs</code> publicará los CSVs en{" "}
            <code>/data/calidad/</code>.
          </div>
        ) : (
          <>
            {/* Top 10 ranking ---------------------------------------- */}
            <section
              aria-labelledby="top10-mejores"
              className="mb-10 rounded-md border border-accent-200 bg-gradient-to-br from-accent-50 to-white p-5 dark:border-amber-700/60 dark:from-amber-900/30 dark:to-dk-surface"
            >
              <header className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent dark:text-dk-accent">
                  Destacado
                </p>
                <h2
                  id="top10-mejores"
                  className="mt-1 text-2xl font-bold text-primary dark:text-dk-primary"
                >
                  Top 10 mejores barrios para vivir
                </h2>
                <p className="mt-1 text-sm text-neutral-text dark:text-dk-text">
                  Ranking por{" "}
                  <TerminoGlosario id="habitabilidad">
                    habitabilidad
                  </TerminoGlosario>{" "}
                  compuesta — frescor, verde, aire y acceso a servicios.
                </p>
              </header>
              {top10.length === 0 ? (
                <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
                  Sin datos de habitabilidad todavía.
                </p>
              ) : (
                <ol
                  aria-label="Top 10 barrios con mejor habitabilidad"
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                  {top10.map((r, i) => {
                    const nombre =
                      nombreById.get(r.poligono_id) ?? r.poligono_id;
                    const color =
                      CATEGORIA_HABITABILIDAD_COLOR[r.categoria];
                    return (
                      <li
                        key={r.poligono_id}
                        className="flex items-center gap-3 rounded-md border border-neutral-border bg-white px-3 py-2 shadow-sm dark:border-dk-border dark:bg-dk-surface"
                      >
                        <span
                          aria-hidden="true"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white shadow-sm"
                        >
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/poligono/${r.poligono_id}`}
                            className="block truncate font-semibold text-primary hover:underline dark:text-dk-primary"
                          >
                            {nombre}
                          </Link>
                          <p className="font-mono text-[10px] text-neutral-muted dark:text-dk-muted">
                            {r.poligono_id}
                          </p>
                        </div>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                          style={{ backgroundColor: color }}
                          aria-label={`Categoría ${CATEGORIA_HABITABILIDAD_LABEL[r.categoria]}`}
                        >
                          {CATEGORIA_HABITABILIDAD_LABEL[r.categoria]}
                        </span>
                        <div className="text-right">
                          <span className="block text-xl font-bold tabular-nums text-primary dark:text-dk-primary">
                            {r.score_habitabilidad.toFixed(0)}
                          </span>
                          <span className="text-[9px] uppercase tracking-wider text-neutral-muted dark:text-dk-muted">
                            /100
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {/* Grid 2×3 de cards ------------------------------------- */}
            <section
              aria-label="Indicadores de calidad de vida"
              className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
            >
              <HabitabilidadCard
                rows={habitabilidad}
                features={features}
              />
              <FifteenMinCard rows={quinceMin} features={features} />
              <GreenEquityCard rows={greenEquity} features={features} />
              <ResilienciaCard rows={resiliencia} features={features} />
              <GentrificacionCard
                rows={gentrificacion}
                features={features}
              />
              <GiniCard rows={gini} />
            </section>

            {/* Tabla comparativa ------------------------------------- */}
            <section
              aria-labelledby="tabla-comparativa"
              className="mb-10"
            >
              <header className="mb-3">
                <h2
                  id="tabla-comparativa"
                  className="text-xl font-semibold text-primary dark:text-dk-primary"
                >
                  Tabla comparativa por barrio
                </h2>
                <p className="mt-1 text-sm text-neutral-text dark:text-dk-text">
                  Todos los scores side-by-side. Click en los encabezados
                  para ordenar.
                </p>
              </header>
              <CalidadVidaTabla filas={filasTabla} />
            </section>
          </>
        )}

        {/* Nota metodológica ---------------------------------------- */}
        <section className="space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se calculan
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Habitabilidad</strong>: promedio normalizado 0-100 de
              cuatro componentes — UHI verano invertido (frescor), m² verde
              per cápita (escalado), NO2 relativo invertido (aire), score de
              acceso 15-min.
            </li>
            <li>
              <strong>15-min</strong>: distancias mínimas del centroide a
              CAPS, escuela, hospital y transporte, normalizadas a 0-100
              (500 m → 100, 1500 m → 0) y promediadas.
            </li>
            <li>
              <strong>Equidad de áreas verdes</strong>: m² de verde por
              habitante = (superficie verde Dynamic World) / (población GHSL).
              Comparado con el umbral OMS de 9 m²/cap.
            </li>
            <li>
              <strong>Resiliencia</strong>: combina permeabilidad (% no
              construido), canopy (NDVI), drenaje (riesgo de anegamiento
              invertido) y enfriamiento (UHI invertido).
            </li>
            <li>
              <strong>Gentrificación</strong>: derivado del cambio porcentual
              de edificios (2018→2026) y de superficie construida. Es una
              señal de alerta, no una predicción de desplazamiento.
            </li>
            <li>
              <strong>Gini</strong>: integral sobre la curva de Lorenz de los
              valores por barrio para cada métrica. 0 = igualdad perfecta,
              1 = un solo barrio concentra todo.
            </li>
          </ul>
          <p className="text-xs text-neutral-muted dark:text-dk-muted">
            Script generador:{" "}
            <code>scripts/capas_avanzadas/compute_capas.cjs</code>. Salidas en{" "}
            <code>/data/calidad/*.csv</code>.
          </p>
        </section>
      </main>
    </>
  );
}
