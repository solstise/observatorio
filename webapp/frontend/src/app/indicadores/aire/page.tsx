// Página /indicadores/aire — calidad de aire histórica.
//
// La vieja página /clima mezclaba forecast (futuro) con calidad de aire
// histórica (presente). En la reestructura las separamos:
//   - El forecast 14 días vive en /pronostico/clima.
//   - La calidad de aire histórica (NO₂ + multigas TROPOMI) vive acá.
//
// Server Component que carga los CSVs de aire en paralelo y arma una
// vista city-wide:
//   1. KPI con el NO₂ relativo bbox promedio del último año.
//   2. AireMultigasCard sobre `posadas_completa` (serie histórica anual
//      multi-gas de Sentinel-5P TROPOMI + AQI europeo de CAMS).
//   3. Tabla de barrios ordenados por NO₂ del último año, con badge
//      semafórico (mejor / similar / peor que el promedio).
//
// Todo lo que pinta lo hace AireMultigasCard (toggle histórico/forecast).
// El AireGauge legacy queda para barrios individuales en /poligono/[id].

import Link from "next/link";
import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { TerminoGlosario } from "@/components/TerminoGlosario";
import {
  getAireMultigas,
  getNo2,
  getPoligonosBarrios,
} from "@/lib/data.server";
import { getManyFreshness } from "@/lib/data-freshness";
import type { No2Row } from "@/lib/types";

// AireMultigasCard es client-component (recharts + fetch interno).
// Lo cargamos vía next/dynamic sin SSR para no inflar el bundle del
// server tree con los chart libs.
const AireMultigasCard = dynamic(() =>
  import("@/components/AireMultigasCard").then((m) => ({
    default: m.AireMultigasCard,
  })),
);

export const metadata: Metadata = {
  title: "Aire",
  description:
    "Calidad de aire histórica en Posadas: NO₂ troposférico, multigás Sentinel-5P TROPOMI (SO₂, CO, HCHO, CH₄, O₃) y AQI europeo modelado por CAMS, agregados por barrio.",
  alternates: {
    canonical: "/indicadores/aire",
  },
  openGraph: {
    url: "/indicadores/aire",
    title: "Aire · Observatorio Urbano Posadas",
    description:
      "NO₂ + multigás TROPOMI por barrio. Datos satelitales abiertos de ESA Sentinel-5P.",
  },
};

// ID del polígono "ciudad completa" que ya viene cargado en el geojson.
// Lo usamos como base del AireMultigasCard para mostrar la serie a nivel
// ciudad (el componente ya soporta fallback a no2.csv si multigas vacío).
const POLIGONO_CIUDAD = "posadas_completa";

// Toma la fila más reciente por barrio (filtrando los nulos del NO2 relativo).
function tomarUltimoPorBarrio(rows: No2Row[]): Map<string, No2Row> {
  const out = new Map<string, No2Row>();
  for (const r of rows) {
    if (!Number.isFinite(r.no2_relativo_bbox)) continue;
    const prev = out.get(r.poligono_id);
    if (!prev || r.anio > prev.anio) out.set(r.poligono_id, r);
  }
  return out;
}

function colorPorRatio(ratio: number): string {
  if (ratio < 0.9) return "#10b981";
  if (ratio <= 1.1) return "#eab308";
  return "#c97d3c";
}

function etiquetaPorRatio(ratio: number): string {
  if (ratio < 0.9) return "Mejor";
  if (ratio <= 1.1) return "Similar";
  return "Peor";
}

export default async function AirePage() {
  const [no2Rows, multigas, collection, freshness] = await Promise.all([
    getNo2(),
    getAireMultigas(),
    getPoligonosBarrios(),
    // Solo `aire_no2` está catalogado en data-freshness; multigas y AQI
    // aún no tienen entrada propia, así que pedimos solo NO₂. Cuando se
    // catalogen, sumar los slugs acá.
    getManyFreshness(["aire_no2"]),
  ]);

  const features = collection.features;
  const nombreById = new Map(
    features.map((f) => [f.properties.id, f.properties.nombre] as const),
  );

  // KPI city-wide: ratio NO₂ promedio del último año disponible.
  const ultimoPorBarrio = tomarUltimoPorBarrio(no2Rows);
  const ratios = Array.from(ultimoPorBarrio.values()).map(
    (r) => r.no2_relativo_bbox,
  );
  const ratioPromedio = ratios.length
    ? ratios.reduce((a, b) => a + b, 0) / ratios.length
    : null;
  const anioReferencia = no2Rows.length
    ? Math.max(...no2Rows.map((r) => r.anio))
    : null;

  // Ranking de barrios por NO₂ del último año, ordenado de mejor a peor.
  const ranking = Array.from(ultimoPorBarrio.values())
    .filter((r) => r.poligono_id !== POLIGONO_CIUDAD)
    .sort((a, b) => a.no2_relativo_bbox - b.no2_relativo_bbox)
    .map((r) => ({
      ...r,
      nombre: nombreById.get(r.poligono_id) ?? r.poligono_id,
    }));

  const tieneDatos = no2Rows.length > 0 || multigas.length > 0;

  // Polígono "ciudad completa" para el card multi-gas. Si no existe en el
  // geojson (raro), caemos al primer barrio para no romper la página.
  const poligonoCard =
    features.find((f) => f.properties.id === POLIGONO_CIUDAD) ??
    features[0];

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
          <span className="text-neutral-muted dark:text-dk-muted">Aire</span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Capa atmosférica
          </p>
          <h1
            className="mt-2 font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Calidad del aire en Posadas
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DataFreshness
              dataset="aire_no2"
              lastUpdated={freshness.aire_no2.lastUpdated}
              frequency={freshness.aire_no2.frequency}
            />
          </div>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Medición satelital de los gases atmosféricos sobre Posadas:{" "}
            <TerminoGlosario id="no2">NO₂</TerminoGlosario> troposférico
            (principal contaminante del tránsito), SO₂, CO, formaldehído
            (HCHO), metano (CH₄) y ozono (O₃). Los datos provienen del
            satélite europeo Sentinel-5P TROPOMI y se agregan anualmente
            por barrio. El AQI europeo modelado (CAMS) lo agregamos como
            referencia complementaria, aunque su resolución (~10 km) no
            permite desagregar por barrio.
          </p>
          <div className="mt-4 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-neutral-text dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100">
            <strong>Importante:</strong> esto NO reemplaza una estación
            terrestre de monitoreo. TROPOMI mide la columna troposférica
            total (mol/m²) integrada verticalmente — es una proxy{" "}
            <em>excelente para comparar barrios entre sí</em>, pero no
            equivale a la concentración a 1,5 m de altura que respiramos.
          </div>
        </header>

        {!tieneDatos ? (
          <div
            role="status"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
          >
            Sin datos de aire disponibles todavía. El cron mensual de{" "}
            <code>48_aire_multigas.py</code> publica los CSVs en{" "}
            <code>/data/ambiental/</code>.
          </div>
        ) : (
          <>
            {/* KPI city + AireMultigasCard ciudad ----------------------- */}
            <section
              aria-label="Resumen de calidad del aire a nivel ciudad"
              className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3"
            >
              <div className="card lg:col-span-1">
                <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
                  NO₂ promedio ciudad
                </h3>
                <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
                  Ratio del NO₂ troposférico promedio de los barrios contra
                  el promedio del bbox de Posadas en {anioReferencia ?? "—"}.
                </p>
                <div className="mt-4 flex items-baseline gap-2">
                  <span
                    className="text-4xl font-bold tabular-nums"
                    style={{
                      color:
                        ratioPromedio !== null
                          ? colorPorRatio(ratioPromedio)
                          : "#94a3b8",
                    }}
                  >
                    {ratioPromedio !== null
                      ? ratioPromedio.toFixed(2)
                      : "s/d"}
                  </span>
                  <span className="text-sm text-secondary dark:text-dk-muted">
                    × bbox
                  </span>
                </div>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-secondary dark:text-dk-muted">
                  Sobre {ratios.length} barrios
                </p>
                <p className="mt-4 text-xs text-neutral-muted dark:text-dk-muted">
                  Fuente: Sentinel-5P TROPOMI, ESA. Producto NO2 nivel 3,
                  agregado anual.
                </p>
              </div>

              <div className="lg:col-span-2">
                {poligonoCard ? (
                  <AireMultigasCard
                    poligonoId={poligonoCard.properties.id}
                    poligonoNombre={poligonoCard.properties.nombre}
                  />
                ) : (
                  <div className="card text-sm italic text-neutral-muted dark:text-dk-muted">
                    Sin polígono base disponible.
                  </div>
                )}
              </div>
            </section>

            {/* Ranking de barrios por NO₂ ------------------------------- */}
            {ranking.length > 0 && (
              <section aria-labelledby="ranking-aire" className="mb-10">
                <header className="mb-3">
                  <h2
                    id="ranking-aire"
                    className="text-xl font-semibold text-primary dark:text-dk-primary"
                  >
                    Barrios ordenados por NO₂ ({anioReferencia})
                  </h2>
                  <p className="mt-1 text-sm text-neutral-text dark:text-dk-text">
                    De mejor a peor calidad relativa al promedio de Posadas.
                    Click en un barrio para ver su ficha completa.
                  </p>
                </header>
                <div className="overflow-x-auto rounded-md border border-neutral-border dark:border-dk-border">
                  <table className="data-table w-full text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className="text-left">
                          #
                        </th>
                        <th scope="col" className="text-left">
                          Barrio
                        </th>
                        <th scope="col" className="text-right">
                          NO₂ relativo
                        </th>
                        <th scope="col" className="text-left">
                          Categoría
                        </th>
                        <th scope="col" className="text-right">
                          NO₂ absoluto (mol/m²)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((r, i) => {
                        const color = colorPorRatio(r.no2_relativo_bbox);
                        const etiqueta = etiquetaPorRatio(
                          r.no2_relativo_bbox,
                        );
                        return (
                          <tr key={r.poligono_id}>
                            <td className="text-secondary dark:text-dk-muted tabular-nums">
                              {i + 1}
                            </td>
                            <td>
                              <Link
                                href={`/poligono/${r.poligono_id}`}
                                className="font-medium text-primary hover:underline dark:text-dk-primary"
                              >
                                {r.nombre}
                              </Link>
                            </td>
                            <td className="text-right tabular-nums font-semibold" style={{ color }}>
                              {r.no2_relativo_bbox.toFixed(2)}×
                            </td>
                            <td>
                              <span
                                className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
                                style={{ backgroundColor: color }}
                              >
                                {etiqueta}
                              </span>
                            </td>
                            <td className="text-right tabular-nums text-xs text-neutral-muted dark:text-dk-muted">
                              {r.no2_mean_mol_m2.toExponential(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se mide la calidad del aire
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Sentinel-5P TROPOMI (ESA)</strong>: el sensor más
              avanzado del mundo para química atmosférica. Mide columnas
              troposféricas de NO₂, SO₂, CO, HCHO y O₃ con resolución 5,5 × 3,5
              km. Pasa sobre Posadas todos los días al mediodía.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Fuentes:{" "}
                <code>data/no2.csv</code> + <code>data/ambiental/aire_multigas_anual.csv</code>.
              </span>
            </li>
            <li>
              <strong>Ratio relativo al bbox</strong>: para evitar que el
              clima estacional contamine las comparaciones, dividimos el NO₂
              de cada barrio por el promedio del bounding box de Posadas en el
              mismo año. Valores &gt; 1 indican <em>más contaminación local</em>
              que el promedio de la ciudad; valores &lt; 1, mejor aire
              relativo.
            </li>
            <li>
              <strong>CH₄ y O₃</strong> entran al CSV multigás pero con flag{" "}
              <code>calidad="baja"</code>: el metano de TROPOMI tiene
              resolución espacial pobre (~7 km, no separa barrios) y el ozono
              total es mayormente columna estratosférica (no respirable).
              Se reportan como referencia pero no se grafican.
            </li>
            <li>
              <strong>AQI europeo CAMS</strong>: índice modelado (PM10, PM2.5,
              NO₂, SO₂, ozono) de Open-Meteo Air Quality. Resolución ~10 km
              — Posadas entera entra en una sola celda, así que el AQI no
              se desagrega por barrio. Es modelado, no medido.
            </li>
            <li>
              <strong>Para qué NO sirve</strong>: no equivale a una estación
              de monitoreo terrestre ni a una alerta de salud individual. Es
              una capa agregada para política pública y planificación a
              escala barrio.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
