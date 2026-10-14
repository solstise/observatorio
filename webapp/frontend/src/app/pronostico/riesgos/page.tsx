import { ForecastSafety } from '@/components/ForecastSafety';
import { getDatasetFreshness as forecastFreshness } from '@/lib/data-freshness';
export const dynamic = 'force-dynamic';
// Página /pronostico/riesgos — Capa 2: riesgos próximos 14 días.
//
// Compone cuatro vistas que comparten la lógica "qué va a pasar en las
// próximas dos semanas" sobre Posadas:
//   - DengueRiskCard       (heurístico verano + lluvia 14d + UHI nocturna)
//   - CalorSaludCard       (forecast 14d + UHI verano)
//   - AnegamientoCard      (impermeabilidad + lluvia 48h)
//   - SaturacionCard       (capacidad urbana + demanda 2030)
//
// Banner superior con conteos de barrios en categoría alto / muy_alto
// para los tres riesgos climáticos, y abajo una tabla comparativa con un
// score por riesgo y el año de saturación proyectada por barrio.
//
// Server Component — toda la lectura va por data.server.ts (filesystem).

import Link from "next/link";
import type { Metadata } from "next";

import { AnegamientoCard } from "@/components/AnegamientoCard";
import { CalorSaludCard } from "@/components/CalorSaludCard";
import { DataFreshness } from "@/components/DataFreshness";
import { DengueRiskCard } from "@/components/DengueRiskCard";
import { Disclaimer } from "@/components/Disclaimer";
import { RiesgoBadge } from "@/components/RiesgoBadge";
import { SaturacionCard } from "@/components/SaturacionCard";
import { getManyFreshness } from "@/lib/data-freshness";
import {
  getAnegamiento,
  getCalorSalud,
  getDengue,
  getPoligonosBarrios,
  getSaturacion,
} from "@/lib/data.server";
import type {
  AnegamientoRow,
  CalorSaludRow,
  CategoriaRiesgo,
  DengueRow,
  PoligonoFeature,
  SaturacionRow,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Riesgos próximos 14 días",
  description:
    "Visualización de riesgos urbanos proyectados a 14 días para Posadas: dengue, calor extremo, anegamiento y saturación urbana, desagregados por barrio.",
  alternates: { canonical: "/pronostico/riesgos" },
  openGraph: { url: "/pronostico/riesgos" },
};

function esAlto(cat: CategoriaRiesgo | null | undefined): boolean {
  return cat === "alto" || cat === "muy_alto";
}

interface FilaTabla {
  poligono_id: string;
  nombre: string;
  score_dengue: number | null;
  cat_dengue: CategoriaRiesgo | null;
  score_calor: number | null;
  cat_calor: CategoriaRiesgo | null;
  score_anegamiento: number | null;
  cat_anegamiento: CategoriaRiesgo | null;
  anio_saturacion: number | null;
}

function construirTabla(
  features: PoligonoFeature[],
  dengue: DengueRow[],
  calor: CalorSaludRow[],
  anegamiento: AnegamientoRow[],
  saturacion: SaturacionRow[],
): FilaTabla[] {
  const dengById = new Map(dengue.map((r) => [r.poligono_id, r]));
  const calById = new Map(calor.map((r) => [r.poligono_id, r]));
  const anegById = new Map(anegamiento.map((r) => [r.poligono_id, r]));
  const satById = new Map(saturacion.map((r) => [r.poligono_id, r]));

  return features
    .map((f) => {
      const d = dengById.get(f.properties.id);
      const c = calById.get(f.properties.id);
      const a = anegById.get(f.properties.id);
      const s = satById.get(f.properties.id);
      return {
        poligono_id: f.properties.id,
        nombre: f.properties.nombre,
        score_dengue: d?.score_dengue ?? null,
        cat_dengue: d?.categoria ?? null,
        score_calor: c?.score_calor ?? null,
        cat_calor: c?.categoria ?? null,
        score_anegamiento: a?.score_anegamiento ?? null,
        cat_anegamiento: a?.categoria ?? null,
        anio_saturacion: s?.anio_saturacion ?? null,
      };
    })
    .sort((a, b) => {
      // Score combinado: suma de los tres scores climáticos (los null
      // se cuentan como 0). El barrio que aparece arriba es el que
      // acumula peor situación general.
      const sa =
        (a.score_dengue ?? 0) +
        (a.score_calor ?? 0) +
        (a.score_anegamiento ?? 0);
      const sb =
        (b.score_dengue ?? 0) +
        (b.score_calor ?? 0) +
        (b.score_anegamiento ?? 0);
      return sb - sa;
    });
}

function formatoNum(n: number | null | undefined, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

export default async function RiesgosPage() {
  const safety = await forecastFreshness('forecast');
  const [dengue, calor, anegamiento, saturacion, collection, freshness] =
    await Promise.all([
      getDengue(),
      getCalorSalud(),
      getAnegamiento(),
      getSaturacion(),
      getPoligonosBarrios(),
      getManyFreshness(["forecast", "alertas", "calor_landsat"]),
    ]);

  const features = collection.features;

  // Conteos para el banner de alertas activas.
  const nDengueAlto = dengue.filter((r) => esAlto(r.categoria)).length;
  const nCalor3plus = calor.filter((r) => r.dias_riesgo_extremo >= 3).length;
  const nAnegAlto = anegamiento.filter((r) => esAlto(r.categoria)).length;

  const hayAlertas = nDengueAlto + nCalor3plus + nAnegAlto > 0;

  const filas = construirTabla(
    features,
    dengue,
    calor,
    anegamiento,
    saturacion,
  );

  const horizonteCalor = calor[0]?.horizonte_dias ?? 14;

  return (
    <>
      <Disclaimer />
      <main className="container-obs py-8">
<ForecastSafety generatedAt={safety.lastUpdated} />
        <nav
          aria-label="Migas"
          className="mb-4 text-sm text-secondary dark:text-dk-muted"
        >
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <Link href="/pronostico" className="hover:underline">
            Pronóstico
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">Riesgos</span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Capa 2 — Pronóstico
          </p>
          <h1
            className="mt-2 font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Riesgos próximos {horizonteCalor} días
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DataFreshness
              dataset="forecast"
              lastUpdated={freshness.forecast.lastUpdated}
              frequency={freshness.forecast.frequency}
            />
            <DataFreshness
              dataset="alertas"
              lastUpdated={freshness.alertas.lastUpdated}
              frequency={freshness.alertas.frequency}
              compact
            />
            <DataFreshness
              dataset="calor_landsat"
              lastUpdated={freshness.calor_landsat.lastUpdated}
              frequency={freshness.calor_landsat.frequency}
              compact
            />
          </div>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Cuatro vistas que combinan datos satelitales (Landsat, Dynamic
            World, Sentinel) con pronóstico ensemble Open-Meteo para
            anticipar qué barrios necesitan atención en los próximos{" "}
            {horizonteCalor} días. Todas las cifras son modelos heurísticos —
            son <em>proxies de riesgo ambiental</em>, no incidencia
            confirmada.
          </p>
        </header>

        {/* Banner de alertas activas */}
        <section
          aria-labelledby="banner-alertas"
          className={[
            "mb-8 rounded-md border-2 p-4",
            hayAlertas
              ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
              : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
          ].join(" ")}
        >
          <h2
            id="banner-alertas"
            className={[
              "mb-2 text-sm font-bold uppercase tracking-wider",
              hayAlertas
                ? "text-red-900 dark:text-red-100"
                : "text-emerald-900 dark:text-emerald-100",
            ].join(" ")}
          >
            {hayAlertas
              ? "Alertas activas en Posadas"
              : "Sin alertas de riesgo elevado"}
          </h2>
          {hayAlertas ? (
            <ul className="grid gap-2 text-sm sm:grid-cols-3">
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="text-base">
                  🦟
                </span>
                <span className="text-red-900 dark:text-red-100">
                  <strong className="tabular-nums">{nDengueAlto}</strong>{" "}
                  barrio{nDengueAlto === 1 ? "" : "s"} con riesgo dengue
                  alto/muy alto
                </span>
              </li>
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="text-base">
                  🌡
                </span>
                <span className="text-red-900 dark:text-red-100">
                  <strong className="tabular-nums">{nCalor3plus}</strong>{" "}
                  barrio{nCalor3plus === 1 ? "" : "s"} con ≥ 3 días de calor
                  extremo en {horizonteCalor} d
                </span>
              </li>
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="text-base">
                  💧
                </span>
                <span className="text-red-900 dark:text-red-100">
                  <strong className="tabular-nums">{nAnegAlto}</strong>{" "}
                  barrio{nAnegAlto === 1 ? "" : "s"} con riesgo de anegamiento
                  alto en 48 h
                </span>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-emerald-900 dark:text-emerald-100">
              Ningún barrio cae actualmente en categoría alto o muy alto para
              dengue, anegamiento, ni acumula 3 o más días de calor extremo
              en el horizonte de pronóstico.
            </p>
          )}
        </section>

        {/* Grid 2x2 con las 4 cards de riesgo */}
        <section
          aria-label="Cards de riesgo"
          className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2"
        >
          <DengueRiskCard rows={dengue} features={features} />
          <CalorSaludCard rows={calor} features={features} />
          <AnegamientoCard rows={anegamiento} features={features} />
          <SaturacionCard rows={saturacion} features={features} />
        </section>

        {/* Tabla comparativa final */}
        <section
          aria-labelledby="tabla-riesgos"
          className="mt-10 rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface"
        >
          <header className="border-b border-neutral-border p-4 dark:border-dk-border">
            <h2
              id="tabla-riesgos"
              className="text-lg font-bold text-primary dark:text-dk-primary"
            >
              Comparativa por barrio
            </h2>
            <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
              Score de cada riesgo climático (0-100) + año proyectado de
              saturación urbana. Ordenado por suma de scores climáticos
              descendente — el barrio con peor combinación queda arriba.
            </p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Comparativa de los cuatro indicadores de riesgo de Capa 2 por
                barrio.
              </caption>
              <thead className="border-b border-neutral-border bg-neutral-50 text-left text-xs uppercase tracking-wider text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Barrio
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Dengue
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Calor
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Anegamiento
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Saturación
                  </th>
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-xs italic text-neutral-muted dark:text-dk-muted"
                    >
                      Sin datos de riesgos disponibles para mostrar todavía.
                    </td>
                  </tr>
                ) : (
                  filas.map((f) => (
                    <tr
                      key={f.poligono_id}
                      className="border-b border-neutral-border/60 last:border-0 hover:bg-neutral-50 dark:border-dk-border/60 dark:hover:bg-dk-elevated/60"
                    >
                      <th
                        scope="row"
                        className="px-3 py-2 text-left font-medium text-primary dark:text-dk-primary"
                      >
                        <Link
                          href={`/poligono/${f.poligono_id}`}
                          className="hover:underline"
                        >
                          {f.nombre}
                        </Link>
                        <p className="font-mono text-[10px] font-normal text-neutral-muted dark:text-dk-muted">
                          {f.poligono_id}
                        </p>
                      </th>
                      <td className="px-3 py-2 text-right">
                        <CeldaScore
                          score={f.score_dengue}
                          categoria={f.cat_dengue}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CeldaScore
                          score={f.score_calor}
                          categoria={f.cat_calor}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <CeldaScore
                          score={f.score_anegamiento}
                          categoria={f.cat_anegamiento}
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {f.anio_saturacion === null ||
                        f.anio_saturacion === undefined ? (
                          <span className="text-neutral-muted dark:text-dk-muted">
                            sin proyección
                          </span>
                        ) : (
                          <span className="font-semibold text-primary dark:text-dk-primary">
                            {f.anio_saturacion}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se calcula
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Score dengue</strong>: combinación normalizada de
              precipitación de verano, temperatura nocturna media, densidad
              poblacional, vulnerabilidad social, déficit de canopy y lluvia
              proyectada en los próximos 14 días.
            </li>
            <li>
              <strong>Score calor</strong>: días con tmax ≥ 32 °C (alto) y
              tmax ≥ 35 °C (extremo) en {horizonteCalor} días, sumando un
              offset por la isla de calor urbana del barrio (UHI verano).
            </li>
            <li>
              <strong>Score anegamiento v2</strong>: intensidad de lluvia y exposición hídrica.
              Detalle y cobertura en <Link href="/nino" className="underline">Modo El Niño</Link>. Modelo anterior conservado para comparación.
            </li>
            <li>
              <strong>Año de saturación</strong>: estimación de cuándo se
              llena la capacidad construible del barrio (huella 90 m² ×
              coeficiente 0.7) si se mantiene la tasa de crecimiento de
              edificios actual.
            </li>
            <li>
              <strong>Para qué NO sirve</strong>: ninguna de estas métricas
              valida casos epidemiológicos puntuales, ni reemplaza alertas
              meteorológicas oficiales del Servicio Meteorológico Nacional.{" "}
              <Link
                href="/datos/metodologia"
                className="font-medium text-primary underline-offset-2 hover:underline dark:text-dk-primary"
              >
                Ver metodología completa
              </Link>
              .
            </li>
          </ul>
          <p className="mt-4 text-xs text-neutral-muted dark:text-dk-muted">
            Leyenda de categorías:{" "}
            <RiesgoBadge categoria="bajo" /> <RiesgoBadge categoria="medio" />{" "}
            <RiesgoBadge categoria="alto" />{" "}
            <RiesgoBadge categoria="muy_alto" />
          </p>
          <p className="text-[11px] text-neutral-muted dark:text-dk-muted">
            Score visible junto a {formatoNum(0, 0)}-100. Cifras{" "}
            <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[10px] dark:bg-dk-elevated dark:text-dk-text">
              s/d
            </code>{" "}
            = barrio sin datos en la fuente correspondiente.
          </p>
        </section>
      </main>
    </>
  );
}

// Celda de score con badge — usado en la tabla comparativa final.
function CeldaScore({
  score,
  categoria,
}: {
  score: number | null;
  categoria: CategoriaRiesgo | null;
}) {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return (
      <span className="text-xs italic text-neutral-muted dark:text-dk-muted">
        s/d
      </span>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs font-semibold tabular-nums text-primary dark:text-dk-primary">
        {score.toFixed(0)}
      </span>
      <RiesgoBadge categoria={categoria} />
    </div>
  );
}
