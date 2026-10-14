// Hub /indicadores — landing del eje "cómo está Posadas hoy".
//
// Server Component. Agrupa las cinco dimensiones cuantitativas que mide
// el observatorio sobre el presente urbano: tipología, calor, aire,
// población y un composite de calidad de vida.
//
// Cada card muestra un KPI real computado server-side desde los CSVs
// para que el funcionario que aterriza acá ya se lleve "el dato rápido"
// sin tener que entrar a cada sub-página.
//
// Después de los 5 cards, una tabla con los barrios destacados por
// dimensión (top 5 mejores en habitabilidad, top 5 en calor extremo,
// top 5 en m² verde por habitante) sirve como gancho a las fichas
// individuales.

import Link from "next/link";
import type { Metadata } from "next";

import { HubOverviewCard } from "@/components/HubOverviewCard";
import {
  getAireMultigas,
  getCanopy,
  getHabitabilidad,
  getNo2,
  getPoblacion,
  getPoligonosBarrios,
  getUhiEstacional,
} from "@/lib/data.server";
import type {
  CanopyRow,
  HabitabilidadRow,
  PoligonoFeature,
  UhiEstacionalRow,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Indicadores · cómo está Posadas hoy",
  description:
    "Cinco dimensiones cuantitativas medidas con datos satelitales abiertos sobre Posadas: tipología urbana, temperatura, calidad del aire, población/densidad y un composite de calidad de vida.",
  alternates: { canonical: "/indicadores" },
  openGraph: {
    url: "/indicadores",
    title: "Indicadores · Observatorio Urbano Posadas",
    description:
      "Cinco dimensiones cuantitativas del presente urbano de Posadas, medidas con datos satelitales abiertos.",
  },
};

// Promedio robusto: ignora null/NaN, devuelve null si no quedan valores.
function promedio(nums: Array<number | null | undefined>): number | null {
  const vals = nums.filter(
    (n): n is number => n !== null && n !== undefined && Number.isFinite(n),
  );
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Suma de población más reciente por barrio.
function poblacionTotalUltimoAnio(
  rows: Array<{ poligono_id: string; anio: number; poblacion_estimada: number }>,
): { total: number; anio: number | null } {
  const ultimosPorBarrio = new Map<
    string,
    { anio: number; poblacion_estimada: number }
  >();
  for (const r of rows) {
    const prev = ultimosPorBarrio.get(r.poligono_id);
    if (!prev || r.anio > prev.anio) ultimosPorBarrio.set(r.poligono_id, r);
  }
  let total = 0;
  let maxAnio = 0;
  for (const r of ultimosPorBarrio.values()) {
    total += r.poblacion_estimada ?? 0;
    if (r.anio > maxAnio) maxAnio = r.anio;
  }
  return { total, anio: maxAnio || null };
}

// Top-5 habitabilidad: mejor score primero. Filtra barrios sin score.
function top5Habitabilidad(
  habitabilidad: HabitabilidadRow[],
  nombrePorId: Map<string, string>,
) {
  return [...habitabilidad]
    .filter((r) => Number.isFinite(r.score_habitabilidad))
    .sort((a, b) => b.score_habitabilidad - a.score_habitabilidad)
    .slice(0, 5)
    .map((r) => ({
      poligono_id: r.poligono_id,
      nombre: nombrePorId.get(r.poligono_id) ?? r.poligono_id,
      valor: r.score_habitabilidad,
    }));
}

// Top-5 calor: barrios más calientes (UHI verano más alto) — útil como
// "alerta visual" en el hub para que el usuario vea el extremo doloroso
// antes de entrar a la página de calor.
function top5UhiVerano(
  uhi: UhiEstacionalRow[],
  nombrePorId: Map<string, string>,
) {
  const verano = uhi.filter((r) => r.estacion === "verano");
  // Si hay múltiples años, quedarse con el último por barrio.
  const ultimosPorBarrio = new Map<string, UhiEstacionalRow>();
  for (const r of verano) {
    const prev = ultimosPorBarrio.get(r.poligono_id);
    if (!prev || r.anio > prev.anio) ultimosPorBarrio.set(r.poligono_id, r);
  }
  return Array.from(ultimosPorBarrio.values())
    .filter((r) => Number.isFinite(r.uhi_vs_rural_mean))
    .sort((a, b) => b.uhi_vs_rural_mean - a.uhi_vs_rural_mean)
    .slice(0, 5)
    .map((r) => ({
      poligono_id: r.poligono_id,
      nombre: nombrePorId.get(r.poligono_id) ?? r.poligono_id,
      valor: r.uhi_vs_rural_mean,
    }));
}

// Top-5 verde: barrios con más m²/cap.
function top5Verde(
  canopy: CanopyRow[],
  nombrePorId: Map<string, string>,
) {
  return [...canopy]
    .filter(
      (r) =>
        r.m2_per_capita !== null && Number.isFinite(r.m2_per_capita),
    )
    .sort(
      (a, b) => (b.m2_per_capita as number) - (a.m2_per_capita as number),
    )
    .slice(0, 5)
    .map((r) => ({
      poligono_id: r.poligono_id,
      nombre: nombrePorId.get(r.poligono_id) ?? r.poligono_id,
      valor: r.m2_per_capita as number,
    }));
}

function formatMiles(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

export default async function IndicadoresHub() {
  const [
    canopy,
    uhi,
    no2,
    aireMultigas,
    poblacion,
    habitabilidad,
    collection,
  ] = await Promise.all([
    getCanopy(),
    getUhiEstacional(),
    getNo2(),
    getAireMultigas(),
    getPoblacion(),
    getHabitabilidad(),
    getPoligonosBarrios(),
  ]);

  const features: PoligonoFeature[] = collection.features;
  const nombrePorId = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre] as const),
  );

  // KPI 1 — verde m²/cap promedio ciudad.
  const verdeMedio = promedio(canopy.map((r) => r.m2_per_capita));

  // KPI 2 — UHI verano promedio (vs rural).
  const uhiVerano = uhi.filter((r) => r.estacion === "verano");
  const uhiPromedio = promedio(uhiVerano.map((r) => r.uhi_vs_rural_mean));

  // KPI 3 — NO₂ relativo promedio del último año.
  // Preferimos multigas (más fresco si existe), fallback a no2 legacy.
  let no2RatioPromedio: number | null = null;
  if (aireMultigas.length) {
    const ultimoPorBarrio = new Map<
      string,
      { anio: number; no2_relativo_bbox: number | null }
    >();
    for (const r of aireMultigas) {
      const prev = ultimoPorBarrio.get(r.poligono_id);
      if (!prev || r.anio > prev.anio) {
        ultimoPorBarrio.set(r.poligono_id, {
          anio: r.anio,
          no2_relativo_bbox: r.no2_relativo_bbox,
        });
      }
    }
    no2RatioPromedio = promedio(
      Array.from(ultimoPorBarrio.values()).map((r) => r.no2_relativo_bbox),
    );
  } else if (no2.length) {
    const ultimoPorBarrio = new Map<string, { anio: number; ratio: number }>();
    for (const r of no2) {
      const prev = ultimoPorBarrio.get(r.poligono_id);
      if (!prev || r.anio > prev.anio) {
        ultimoPorBarrio.set(r.poligono_id, {
          anio: r.anio,
          ratio: r.no2_relativo_bbox,
        });
      }
    }
    no2RatioPromedio = promedio(
      Array.from(ultimoPorBarrio.values()).map((r) => r.ratio),
    );
  }

  // KPI 4 — población total ciudad (suma del último año por barrio,
  // excluyendo `posadas_completa` para no doble-contar).
  const poblacionBarrios = poblacion.filter(
    (r) => r.poligono_id !== "posadas_completa",
  );
  const { total: poblacionTotal } = poblacionTotalUltimoAnio(poblacionBarrios);

  // KPI 5 — habitabilidad promedio.
  const habitabilidadPromedio = promedio(
    habitabilidad.map((r) => r.score_habitabilidad),
  );

  // Tablas destacadas.
  const topHab = top5Habitabilidad(habitabilidad, nombrePorId);
  const topCalor = top5UhiVerano(uhi, nombrePorId);
  const topVerde = top5Verde(canopy, nombrePorId);

  return (
    <main className="container-obs py-10">
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
          Indicadores · cómo está Posadas hoy
        </p>
        <h1
          className="mt-2 font-bold text-primary dark:text-dk-primary"
          style={{ fontSize: "var(--fs-h1)" }}
        >
          Indicadores · cómo está Posadas hoy
        </h1>
        <p className="mt-3 lead text-neutral-text dark:text-dk-text">
          5 dimensiones cuantitativas medidas con datos satelitales
          abiertos: tipología urbana, temperatura, aire, población y un
          composite de calidad de vida que combina todas las anteriores.
        </p>
      </header>

      <section aria-labelledby="hub-indicadores-cards" className="mb-12">
        <h2 id="hub-indicadores-cards" className="sr-only">
          Sub-secciones de Indicadores
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <HubOverviewCard
            href="/indicadores/tipologia"
            title="Tipología urbana"
            description="Verde urbano por habitante, mix de techos, densidad volumétrica y anomalías estructurales detectadas por satélite."
            chip="Capa 1"
            tone="success"
            icon={<IconBuilding />}
            kpi={
              verdeMedio !== null
                ? {
                    value: verdeMedio.toFixed(1),
                    unit: "m²/cap",
                    label: "Verde urbano medio ciudad",
                  }
                : {
                    value: "—",
                    label: "Sin datos de canopy todavía",
                  }
            }
          />
          <HubOverviewCard
            href="/indicadores/calor"
            title="Calor & UHI"
            description="Temperatura superficial Landsat 30 m y diferencial de isla de calor urbana contra el campo y entre barrios."
            chip="Térmico"
            tone="danger"
            icon={<IconSun />}
            kpi={
              uhiPromedio !== null
                ? {
                    value: `+${uhiPromedio.toFixed(1)}`,
                    unit: "°C",
                    label: "UHI verano promedio vs rural",
                  }
                : {
                    value: "—",
                    label: "Sin datos UHI todavía",
                  }
            }
          />
          <HubOverviewCard
            href="/indicadores/aire"
            title="Aire"
            description="NO₂ troposférico y multigás Sentinel-5P TROPOMI (SO₂, CO, HCHO) agregados por barrio, más AQI europeo de referencia."
            chip="Atmosférico"
            tone="muted"
            icon={<IconWind />}
            kpi={
              no2RatioPromedio !== null
                ? {
                    value: no2RatioPromedio.toFixed(2),
                    unit: "× bbox",
                    label: "NO₂ promedio relativo a Posadas",
                  }
                : {
                    value: "—",
                    label: "Sin datos NO₂ todavía",
                  }
            }
          />
          <HubOverviewCard
            href="/indicadores/poblacion"
            title="Población & densidad"
            description="Distribución de habitantes y tejido construido: heatmap WebGL con 217k edificios y densidad UHI por centroide de barrio."
            chip="Censo"
            tone="primary"
            icon={<IconPeople />}
            kpi={
              poblacionTotal > 0
                ? {
                    value: formatMiles(poblacionTotal),
                    unit: "hab",
                    label: "Población estimada total ciudad",
                  }
                : {
                    value: "—",
                    label: "Sin datos de población todavía",
                  }
            }
          />
          <HubOverviewCard
            href="/indicadores/calidad-vida"
            title="Calidad de vida"
            description="Composite que combina frescor, verde, aire y acceso a servicios. Incluye ciudad de los 15 minutos y equidad OMS."
            chip="Composite"
            tone="accent"
            icon={<IconHeart />}
            kpi={
              habitabilidadPromedio !== null
                ? {
                    value: `${habitabilidadPromedio.toFixed(0)}/100`,
                    label: "Habitabilidad media ciudad",
                  }
                : {
                    value: "—",
                    label: "Composite aún no generado",
                  }
            }
          />
        </div>
      </section>

      {(topHab.length > 0 || topCalor.length > 0 || topVerde.length > 0) && (
        <section
          aria-labelledby="destacados-barrios"
          className="rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface"
        >
          <header className="border-b border-neutral-border p-4 dark:border-dk-border">
            <h2
              id="destacados-barrios"
              className="text-lg font-semibold text-primary dark:text-dk-primary"
            >
              Indicadores destacados por barrio
            </h2>
            <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
              Los 5 mejores barrios en habitabilidad, los 5 más
              calurosos en verano y los 5 con más verde por habitante.
              Hacé click para abrir la ficha completa de cada uno.
            </p>
          </header>
          <div className="grid grid-cols-1 gap-0 md:grid-cols-3 md:divide-x md:divide-neutral-border dark:md:divide-dk-border">
            <TopTabla
              titulo="Top habitabilidad"
              colorTitulo="text-emerald-700 dark:text-emerald-300"
              filas={topHab}
              formatoValor={(v) => `${v.toFixed(0)}/100`}
              etiquetaUnidad="Score 0-100"
            />
            <TopTabla
              titulo="Top calor verano"
              colorTitulo="text-rose-700 dark:text-rose-300"
              filas={topCalor}
              formatoValor={(v) =>
                `${v > 0 ? "+" : ""}${v.toFixed(1)} °C`
              }
              etiquetaUnidad="UHI vs rural"
            />
            <TopTabla
              titulo="Top verde por habitante"
              colorTitulo="text-primary dark:text-dk-primary"
              filas={topVerde}
              formatoValor={(v) => `${v.toFixed(1)} m²`}
              etiquetaUnidad="m²/cap"
            />
          </div>
          <footer className="border-t border-neutral-border p-4 text-xs text-neutral-muted dark:border-dk-border dark:text-dk-muted">
            Estos rankings son insumos a nivel barrio. Para análisis
            cuantitativo barrio-por-barrio, abrí las sub-páginas o las{" "}
            <Link
              href="/poligono"
              className="underline-offset-2 hover:underline dark:text-dk-primary"
            >
              fichas individuales
            </Link>
            .
          </footer>
        </section>
      )}
    </main>
  );
}

// Sub-componente de tabla compacta para las "top 5 por barrio". Server
// component (no estado), recibe filas ya ordenadas y un formateador.
function TopTabla({
  titulo,
  colorTitulo,
  filas,
  formatoValor,
  etiquetaUnidad,
}: {
  titulo: string;
  colorTitulo: string;
  filas: Array<{ poligono_id: string; nombre: string; valor: number }>;
  formatoValor: (v: number) => string;
  etiquetaUnidad: string;
}) {
  return (
    <div className="p-4">
      <h3 className={`mb-3 text-sm font-semibold ${colorTitulo}`}>
        {titulo}
      </h3>
      {filas.length === 0 ? (
        <p className="text-xs italic text-neutral-muted dark:text-dk-muted">
          Sin datos disponibles todavía.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {filas.map((f, i) => (
            <li
              key={f.poligono_id}
              className="flex items-center gap-2 text-sm"
            >
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold tabular-nums text-secondary dark:bg-dk-elevated dark:text-dk-muted"
                aria-hidden
              >
                {i + 1}
              </span>
              <Link
                href={`/poligono/${f.poligono_id}`}
                className="min-w-0 flex-1 truncate text-primary hover:underline dark:text-dk-primary"
              >
                {f.nombre}
              </Link>
              <span
                className="shrink-0 font-semibold tabular-nums text-neutral-text dark:text-dk-text"
                aria-label={`${formatoValor(f.valor)} ${etiquetaUnidad}`}
              >
                {formatoValor(f.valor)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// =====================================================================
// Íconos SVG inline (24×24, currentColor) — uno por card.
// =====================================================================

function IconBuilding() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <path d="M9 9h2M9 13h2M9 17h2" />
      <path d="M13 9h2M13 13h2M13 17h2" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconWind() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 8h11a3 3 0 1 0-3-3" />
      <path d="M3 16h15a3 3 0 1 1-3 3" />
      <path d="M3 12h18" />
    </svg>
  );
}

function IconPeople() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3 2.5-5 6-5s6 2 6 5" />
      <path d="M14 20c0-2 1.5-4 4-4s4 1.5 4 4" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
