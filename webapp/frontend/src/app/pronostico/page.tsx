// Página /pronostico — Hub overview de "qué viene en Posadas".
//
// Server Component que combina los tres horizontes temporales:
//   1. Alertas próximas 48-72h (dengue, calor, anegamiento, transformación)
//   2. Forecast 14 días por barrio
//   3. Proyecciones 2027 / 2030 / 2035
//
// El banner superior muestra conteos crudos de barrios en categoría
// alto/muy_alto por cada riesgo. Si no hay nada caliente, cae a variante
// verde "sin alertas críticas". Debajo, un grid 2-cols con tres
// HubOverviewCard que muestran un KPI consumible por sub-tema.
//
// Toda la lectura es server-side: getDengue/getCalorSalud/getAnegamiento
// + getGentrificacion (transformación urbana) + getForecastDiario (Tmax
// máxima 14d) + getPoblacion + getProyecciones (% crecimiento 2026→2030).

import Link from "next/link";
import type { Metadata } from "next";

import { Disclaimer } from "@/components/Disclaimer";
import { HubOverviewCard } from "@/components/HubOverviewCard";
import {
  getAnegamiento,
  getCalorSalud,
  getDengue,
  getForecastDiario,
  getGentrificacion,
  getPoblacion,
  getProyecciones,
} from "@/lib/data.server";
import type { CategoriaRiesgo } from "@/lib/types";

export const metadata: Metadata = {
  title: "Pronóstico — qué viene en Posadas",
  description:
    "Hub de pronóstico para Posadas: alertas próximas 48-72 h (dengue, calor, anegamiento, transformación urbana), forecast climático 14 días por barrio y proyecciones de viviendas, población y UHI a 2027 / 2030 / 2035.",
  alternates: { canonical: "/pronostico" },
  openGraph: { url: "/pronostico" },
};

function esAlto(cat: CategoriaRiesgo | null | undefined): boolean {
  return cat === "alto" || cat === "muy_alto";
}

// Íconos inline (24x24) — heroicons-like, sin dependencias extra.
const IconWarning = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const IconCloud = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.25a7 7 0 1 0-12.25 5.5" />
    <path d="M3 15h2" />
    <path d="M8 19v2" />
    <path d="M12 19v2" />
  </svg>
);

const IconChart = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 3 3 5-6" />
  </svg>
);

function fmtNum(n: number, fixed = 1): string {
  if (Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

function fmtPct(n: number): string {
  if (Number.isNaN(n)) return "s/d";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)} %`;
}

export default async function PronosticoHubPage() {
  const [dengue, calor, anegamiento, gentri, forecast, poblacion, proyecciones] =
    await Promise.all([
      getDengue(),
      getCalorSalud(),
      getAnegamiento(),
      getGentrificacion(),
      getForecastDiario(),
      getPoblacion(),
      getProyecciones(),
    ]);

  // Banner de alertas activas — conteos por categoría.
  const nDengueAlto = dengue.filter((r) => esAlto(r.categoria)).length;
  const nCalor3plus = calor.filter((r) => r.dias_riesgo_extremo >= 3).length;
  const nAnegAlto = anegamiento.filter((r) => esAlto(r.categoria)).length;
  const nTransformacion = gentri.filter(
    (r) => r.categoria === "en_transformacion",
  ).length;

  const hayAlertas =
    nDengueAlto + nCalor3plus + nAnegAlto + nTransformacion > 0;

  // KPI 1 — Riesgos: cuántos barrios sobre el total con dengue alto/muy_alto.
  const totalBarriosDengue = dengue.length;
  const riesgosKpiValue = totalBarriosDengue > 0
    ? `${nDengueAlto}/${totalBarriosDengue}`
    : "s/d";
  const riesgosTone = nDengueAlto > 0 ? "danger" : "primary";

  // KPI 2 — Clima: Tmax máxima proyectada en los próximos 14 días sobre
  // cualquier barrio. Es el peak del calor que se viene.
  let tmaxMax = Number.NEGATIVE_INFINITY;
  for (const r of forecast) {
    if (typeof r.tmax_p50 === "number" && !Number.isNaN(r.tmax_p50)) {
      if (r.tmax_p50 > tmaxMax) tmaxMax = r.tmax_p50;
    }
  }
  const climaKpiValue = tmaxMax === Number.NEGATIVE_INFINITY
    ? "s/d"
    : `${fmtNum(tmaxMax, 1)}°`;

  // KPI 3 — Proyecciones: % de crecimiento poblacional 2026 → 2030 (ciudad).
  // Sumamos por año a nivel ciudad: histórico para 2026 (último anio en
  // poblacion.csv, típicamente 2025/2026 estimado) vs proyección 2030.
  // Si no hay población 2026, usamos el último año disponible como base.
  function poblacionPorAnio(anio: number): number {
    return poblacion
      .filter((r) => r.anio === anio)
      .reduce((acc, r) => acc + (r.poblacion_estimada ?? 0), 0);
  }
  const aniosPob = Array.from(new Set(poblacion.map((r) => r.anio))).sort(
    (a, b) => b - a,
  );
  const anioBase = aniosPob[0] ?? null;
  const popBase = anioBase ? poblacionPorAnio(anioBase) : 0;
  const proy2030Pob = proyecciones
    .filter((r) => r.metrica === "poblacion" && r.anio_proyeccion === 2030)
    .reduce((acc, r) => acc + (r.valor_pred ?? 0), 0);
  const crecimientoPct = popBase > 0 && proy2030Pob > 0
    ? ((proy2030Pob - popBase) / popBase) * 100
    : Number.NaN;
  const proyeccionesKpiValue = Number.isNaN(crecimientoPct)
    ? "s/d"
    : fmtPct(crecimientoPct);

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
            Pronóstico
          </span>
        </nav>

        <header className="mb-8 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Hub · qué viene en Posadas
          </p>
          <h1
            className="mt-2 font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Pronóstico · qué viene en Posadas
          </h1>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Tres horizontes temporales combinados: alertas próximas 48-72 horas
            (dengue, calor, anegamiento), forecast climático 14 días por barrio,
            y proyecciones largas a 2030+ basadas en series históricas.
          </p>
        </header>

        {/* Banner de alertas activas. Variante danger si hay alertas, verde si todo limpio. */}
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
              : "Sin alertas críticas en los próximos 14 días"}
          </h2>
          {hayAlertas ? (
            <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="text-base">
                  🦟
                </span>
                <span className="text-red-900 dark:text-red-100">
                  <strong className="tabular-nums">{nDengueAlto}</strong>{" "}
                  barrio{nDengueAlto === 1 ? "" : "s"} con dengue
                  alto/muy alto en 14 días
                </span>
              </li>
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="text-base">
                  🌡
                </span>
                <span className="text-red-900 dark:text-red-100">
                  <strong className="tabular-nums">{nCalor3plus}</strong>{" "}
                  barrio{nCalor3plus === 1 ? "" : "s"} con ≥ 3 días de calor
                  extremo (≥ 35 °C)
                </span>
              </li>
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="text-base">
                  💧
                </span>
                <span className="text-red-900 dark:text-red-100">
                  <strong className="tabular-nums">{nAnegAlto}</strong>{" "}
                  barrio{nAnegAlto === 1 ? "" : "s"} con anegamiento alto
                  previsto en 48 h
                </span>
              </li>
              <li className="flex items-baseline gap-2">
                <span aria-hidden className="text-base">
                  🏗
                </span>
                <span className="text-red-900 dark:text-red-100">
                  <strong className="tabular-nums">{nTransformacion}</strong>{" "}
                  barrio{nTransformacion === 1 ? "" : "s"} en transformación
                  activa
                </span>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-emerald-900 dark:text-emerald-100">
              Ningún barrio cae actualmente en categoría alto o muy alto de
              dengue ni anegamiento, ningún barrio acumula 3 o más días de
              calor extremo en el horizonte de 14 días, y no se detectan
              barrios en transformación urbana activa.
            </p>
          )}
        </section>

        {/* Grid de sub-temas */}
        <section
          aria-label="Sub-temas de Pronóstico"
          className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2"
        >
          <HubOverviewCard
            href="/pronostico/riesgos"
            title="Riesgos 14 días"
            description="Dengue, calor, anegamiento y saturación urbana proyectados a 14 días por barrio. Banner de alertas + tabla comparativa con score combinado."
            chip="14 días"
            icon={IconWarning}
            tone={riesgosTone}
            kpi={{
              value: riesgosKpiValue,
              unit: "barrios",
              label: "Dengue alto / muy alto",
            }}
          />
          <HubOverviewCard
            href="/pronostico/clima"
            title="Clima 14 días"
            description="Forecast de Tmin / Tmax por barrio con banda de confianza p10–p90 (ensemble Open-Meteo), AQI europeo diario y mapa coroplético del día seleccionado."
            chip="Forecast"
            icon={IconCloud}
            tone="primary"
            kpi={{
              value: climaKpiValue,
              unit: "C",
              label: "Tmax máxima proyectada (14 d)",
            }}
          />
          <HubOverviewCard
            href="/pronostico/proyecciones"
            title="Proyecciones 2030+"
            description="Proyecciones a 2027 / 2030 / 2035 por barrio para viviendas, población, cobertura urbana y UHI verano. Modelos OLS lineal/exponencial con IC 95 %."
            chip="Largo plazo"
            icon={IconChart}
            tone="muted"
            kpi={{
              value: proyeccionesKpiValue,
              label: anioBase
                ? `Crecimiento poblacional ${anioBase} → 2030`
                : "Crecimiento poblacional a 2030",
            }}
          />
        </section>

        {/* Nota metodológica corta */}
        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se construye este hub
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Riesgos 14 d</strong> combina forecast ensemble Open-Meteo
              con baseline satelital (UHI Landsat, impermeabilidad Dynamic
              World, vulnerabilidad social) para anticipar barrios bajo
              eventos adversos.
            </li>
            <li>
              <strong>Clima 14 d</strong> es ensamble de 6 modelos
              meteorológicos (ECMWF, GFS, ICON, JMA, GEM, BoM ACCESS) con
              offset térmico por barrio derivado de la isla de calor urbana.
            </li>
            <li>
              <strong>Proyecciones 2030+</strong> son regresiones OLS lineal y
              exponencial sobre la serie histórica (8 años); se elige el modelo
              de mayor R² con bonus por simplicidad para el lineal.
            </li>
            <li>
              <strong>Para qué NO sirve</strong>: ninguno de estos pronósticos
              reemplaza alertas oficiales del Servicio Meteorológico Nacional,
              ni la planificación urbana participativa. Son insumos
              cuantitativos complementarios.{" "}
              <Link
                href="/metodologia"
                className="font-medium text-primary underline-offset-2 hover:underline dark:text-dk-primary"
              >
                Ver metodología completa
              </Link>
              .
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
