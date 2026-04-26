// Vista "totales de ciudad" para el polígono `posadas_completa`.
//
// La página /poligono/[id]/page.tsx hace branching cuando el id es
// `posadas_completa` y delega aquí en lugar de mostrar la ficha barrio
// por barrio (mezclar urbano + rural rompe la lectura de UHI / clima).
//
// Esta vista agrega los 43 barrios y muestra:
//   - Header diferenciado con badge "Total ciudad"
//   - KPIs sumados: viviendas, población estimada, UHI promedio, etc.
//   - Top 3 por categoría: más calientes (UHI), más críticos (índice
//     prioridad), con más viviendas, con menos servicios cercanos.
//   - NO se muestran gráficos UHI / clima individuales del polígono ciudad.

import Link from "next/link";

import { Disclaimer } from "@/components/Disclaimer";
import { formatIndice } from "@/lib/format";
import type {
  PoblacionRow,
  PoligonoFeature,
  PoligonoProperties,
  RankingPoliticoRow,
  SerieTemporalRow,
  SocialDistanciasRow,
  VulnerabilidadRow,
} from "@/lib/types";

interface Props {
  properties: PoligonoProperties;
  barrios: PoligonoFeature[];
  ranking: RankingPoliticoRow[];
  distancias: SocialDistanciasRow[];
  poblacion: PoblacionRow[];
  serieTemporal: SerieTemporalRow[];
  vulnerabilidad: VulnerabilidadRow[];
}

interface TopItem {
  id: string;
  nombre: string;
  detalle?: string;
}

function nombrePorId(barrios: PoligonoFeature[]): Map<string, string> {
  return new Map(barrios.map((f) => [f.properties.id, f.properties.nombre]));
}

// Suma de viviendas detectadas en el último año disponible por barrio.
// Si un barrio no tiene serie, se omite (cobertura < 100%).
function sumarViviendasUltimoAnio(
  serieTemporal: SerieTemporalRow[],
  barrios: PoligonoFeature[],
): { total: number; anio: number | null; cobertura: number } {
  const ids = new Set(barrios.map((b) => b.properties.id));
  const ultimosPorBarrio = new Map<string, SerieTemporalRow>();
  for (const r of serieTemporal) {
    if (!ids.has(r.poligono_id)) continue;
    const prev = ultimosPorBarrio.get(r.poligono_id);
    if (!prev || r.anio > prev.anio) {
      ultimosPorBarrio.set(r.poligono_id, r);
    }
  }
  if (!ultimosPorBarrio.size) {
    return { total: 0, anio: null, cobertura: 0 };
  }
  let total = 0;
  let maxAnio = 0;
  for (const r of ultimosPorBarrio.values()) {
    total += r.edificios_total ?? 0;
    if (r.anio > maxAnio) maxAnio = r.anio;
  }
  return {
    total,
    anio: maxAnio || null,
    cobertura: ultimosPorBarrio.size / barrios.length,
  };
}

function sumarPoblacion(
  poblacion: PoblacionRow[],
  barrios: PoligonoFeature[],
): { total: number; anio: number | null; cobertura: number } {
  const ids = new Set(barrios.map((b) => b.properties.id));
  const ultimosPorBarrio = new Map<string, PoblacionRow>();
  for (const r of poblacion) {
    if (!ids.has(r.poligono_id)) continue;
    const prev = ultimosPorBarrio.get(r.poligono_id);
    if (!prev || r.anio > prev.anio) {
      ultimosPorBarrio.set(r.poligono_id, r);
    }
  }
  if (!ultimosPorBarrio.size) {
    return { total: 0, anio: null, cobertura: 0 };
  }
  let total = 0;
  let maxAnio = 0;
  for (const r of ultimosPorBarrio.values()) {
    total += r.poblacion_estimada ?? 0;
    if (r.anio > maxAnio) maxAnio = r.anio;
  }
  return {
    total,
    anio: maxAnio || null,
    cobertura: ultimosPorBarrio.size / barrios.length,
  };
}

// Promedio del UHI verano (uhi_verano del ranking, °C). Filtra nulls.
function promedioUhiVerano(ranking: RankingPoliticoRow[]): number | null {
  const vals = ranking
    .filter((r) => r.poligono_id !== "posadas_completa")
    .filter((r) => r.uhi_verano !== null && Number.isFinite(r.uhi_verano))
    .map((r) => r.uhi_verano as number);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function promedioVulnerabilidad(
  vulnerabilidad: VulnerabilidadRow[],
): number | null {
  if (!vulnerabilidad.length) return null;
  const vals = vulnerabilidad
    .map((r) => r.indice_vulnerabilidad)
    .filter((v) => v !== null && Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Top 3 barrios más calientes (UHI verano más alto).
function topUhi(
  ranking: RankingPoliticoRow[],
  nombres: Map<string, string>,
): TopItem[] {
  return ranking
    .filter((r) => r.poligono_id !== "posadas_completa")
    .filter((r) => r.uhi_verano !== null && Number.isFinite(r.uhi_verano))
    .sort((a, b) => (b.uhi_verano as number) - (a.uhi_verano as number))
    .slice(0, 3)
    .map((r) => ({
      id: r.poligono_id,
      nombre: nombres.get(r.poligono_id) ?? r.poligono_id,
      detalle: `+${(r.uhi_verano as number).toFixed(2)} °C vs rural`,
    }));
}

// Top 3 más prioritarios (índice más alto).
function topPrioridad(
  ranking: RankingPoliticoRow[],
  nombres: Map<string, string>,
): TopItem[] {
  return ranking
    .filter((r) => r.poligono_id !== "posadas_completa")
    .sort((a, b) => b.indice_prioridad - a.indice_prioridad)
    .slice(0, 3)
    .map((r) => ({
      id: r.poligono_id,
      nombre: nombres.get(r.poligono_id) ?? r.poligono_id,
      detalle: `${(r.indice_prioridad * 100).toFixed(0)}/100 (rank ${r.ranking})`,
    }));
}

// Top 3 con más viviendas en el último año.
function topViviendas(
  serieTemporal: SerieTemporalRow[],
  barrios: PoligonoFeature[],
): TopItem[] {
  const ids = new Set(barrios.map((b) => b.properties.id));
  const ultimosPorBarrio = new Map<string, SerieTemporalRow>();
  for (const r of serieTemporal) {
    if (!ids.has(r.poligono_id)) continue;
    const prev = ultimosPorBarrio.get(r.poligono_id);
    if (!prev || r.anio > prev.anio) {
      ultimosPorBarrio.set(r.poligono_id, r);
    }
  }
  const nombres = nombrePorId(barrios);
  return Array.from(ultimosPorBarrio.values())
    .sort((a, b) => (b.edificios_total ?? 0) - (a.edificios_total ?? 0))
    .slice(0, 3)
    .map((r) => ({
      id: r.poligono_id,
      nombre: nombres.get(r.poligono_id) ?? r.poligono_id,
      detalle: `${(r.edificios_total ?? 0).toLocaleString("es-AR")} viviendas (${r.anio})`,
    }));
}

// Top 3 con menos servicios cercanos (mayor distancia promedio).
function topMenosServicios(
  distancias: SocialDistanciasRow[],
  nombres: Map<string, string>,
): TopItem[] {
  const conPromedio = distancias
    .filter((d) => d.poligono_id !== "posadas_completa")
    .map((d) => {
      const xs = [
        d.dist_caps_m,
        d.dist_escuela_m,
        d.dist_hospital_m,
        d.dist_transporte_m,
      ].filter(
        (v): v is number =>
          v !== null && v !== undefined && Number.isFinite(v),
      );
      if (xs.length === 0) return null;
      const promedio = xs.reduce((a, b) => a + b, 0) / xs.length;
      return { id: d.poligono_id, promedio };
    })
    .filter((x): x is { id: string; promedio: number } => x !== null);
  return conPromedio
    .sort((a, b) => b.promedio - a.promedio)
    .slice(0, 3)
    .map((x) => ({
      id: x.id,
      nombre: nombres.get(x.id) ?? x.id,
      detalle:
        x.promedio < 1000
          ? `${Math.round(x.promedio)} m promedio`
          : `${(x.promedio / 1000).toFixed(2)} km promedio`,
    }));
}

export function PoligonoTotalCiudad({
  properties,
  barrios,
  ranking,
  distancias,
  poblacion,
  serieTemporal,
  vulnerabilidad,
}: Props) {
  const nombres = nombrePorId(barrios);

  const viviendas = sumarViviendasUltimoAnio(serieTemporal, barrios);
  const poblacionAgg = sumarPoblacion(poblacion, barrios);
  const uhiPromedio = promedioUhiVerano(ranking);
  const vulnPromedio = promedioVulnerabilidad(vulnerabilidad);

  const topCalor = topUhi(ranking, nombres);
  const topPrior = topPrioridad(ranking, nombres);
  const topViv = topViviendas(serieTemporal, barrios);
  const topServ = topMenosServicios(distancias, nombres);

  return (
    <>
      <Disclaimer />
      <article className="container-obs py-8">
        <nav
          aria-label="Migas"
          className="mb-4 text-sm text-secondary dark:text-dk-muted"
        >
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted dark:text-dk-muted">
            Toda Posadas
          </span>
        </nav>

        <header className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-accent-600 dark:border-dk-accent/50 dark:bg-dk-accent/20 dark:text-dk-accent">
              Total ciudad
            </span>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
              capa de referencia
            </p>
          </div>
          <h1
            className="mt-1 font-bold"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Toda Posadas — agregado de los {barrios.length} barrios
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-neutral-text dark:text-dk-text">
            Esta vista NO es un barrio: agrega los {barrios.length} polígonos
            de barrio analizados por el observatorio. Las series UHI, clima
            y radar del polígono ciudad mezclan zona urbana con zona rural,
            así que en lugar de gráficos individuales mostramos totales
            sumados y rankings por categoría.
          </p>
          <p className="mt-2 text-sm text-neutral-muted dark:text-dk-muted">
            ID:{" "}
            <code className="rounded bg-primary-50 px-1 dark:bg-dk-elevated dark:text-dk-text">
              {properties.id}
            </code>
          </p>
        </header>

        <section
          aria-labelledby="kpis-totales"
          className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
        >
          <h2 id="kpis-totales" className="sr-only">
            KPIs agregados
          </h2>
          <KpiCard
            label="Superficie analizada"
            value={`${properties.superficie_km2.toFixed(1)} km²`}
            hint="contorno municipal (OSM 3082669)"
          />
          <KpiCard
            label="Viviendas detectadas"
            value={
              viviendas.total > 0
                ? viviendas.total.toLocaleString("es-AR")
                : "s/d"
            }
            hint={
              viviendas.anio
                ? `suma ${viviendas.anio} · ${(viviendas.cobertura * 100).toFixed(0)}% de los barrios cubiertos`
                : undefined
            }
          />
          <KpiCard
            label="Población estimada (suma)"
            value={
              poblacionAgg.total > 0
                ? poblacionAgg.total.toLocaleString("es-AR")
                : "s/d"
            }
            hint={
              poblacionAgg.anio
                ? `WorldPop ${poblacionAgg.anio} · ${(poblacionAgg.cobertura * 100).toFixed(0)}% cobertura`
                : undefined
            }
          />
          <KpiCard
            label="UHI verano (promedio)"
            value={
              uhiPromedio !== null
                ? `+${uhiPromedio.toFixed(2)} °C`
                : "s/d"
            }
            hint={
              uhiPromedio !== null
                ? "promedio de los barrios vs baseline rural"
                : undefined
            }
          />
        </section>

        {(vulnPromedio !== null || barrios.length > 0) && (
          <section
            aria-labelledby="kpis-secundarios"
            className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2"
          >
            <h2 id="kpis-secundarios" className="sr-only">
              KPIs secundarios agregados
            </h2>
            <KpiCard
              label="Vulnerabilidad (promedio)"
              value={formatIndice(vulnPromedio)}
              hint="índice 0–1, promedio simple de los barrios con dato"
            />
            <KpiCard
              label="Barrios analizados"
              value={String(barrios.length)}
              hint="polígonos definidos por el observatorio"
            />
          </section>
        )}

        <section
          aria-labelledby="tops"
          className="mt-10 grid gap-4 lg:grid-cols-2"
        >
          <h2 id="tops" className="sr-only">
            Rankings principales por categoría
          </h2>
          <TopList
            titulo="Top 3 más calientes"
            descripcion="UHI verano más alto vs baseline rural — Landsat 8/9."
            items={topCalor}
            tipo="calor"
          />
          <TopList
            titulo="Top 3 más críticos"
            descripcion="Mayor índice de prioridad de inversión política (vulnerabilidad + UHI + acceso)."
            items={topPrior}
            tipo="prioridad"
          />
          <TopList
            titulo="Top 3 con más viviendas"
            descripcion="Mayor cantidad de viviendas detectadas en el último año (Open Buildings + MS Buildings)."
            items={topViv}
            tipo="viviendas"
          />
          <TopList
            titulo="Top 3 con menos servicios cercanos"
            descripcion="Mayor distancia promedio a CAPS, escuela, hospital y transporte."
            items={topServ}
            tipo="servicios"
          />
        </section>

        <section className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link href="/prioridades" className="btn-primary">
            Ver ranking completo de prioridades
          </Link>
          <Link href="/comparar" className="btn-outline">
            Comparar barrios entre sí
          </Link>
          <Link href="/calor" className="btn-outline">
            Mapa de calor urbano
          </Link>
        </section>

        <p className="mt-8 text-xs italic text-neutral-muted dark:text-dk-muted">
          Los gráficos UHI y de clima para el polígono ciudad no se muestran
          porque agregar la zona rural distorsiona la lectura. Para ver una
          serie temporal específica, abrí la ficha de un barrio.
        </p>
      </article>
    </>
  );
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card border-l-4 border-accent/60 dark:border-dk-accent/60">
      <p className="text-xs uppercase tracking-wider text-secondary dark:text-dk-muted">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-primary dark:text-dk-primary">
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

const TIPO_COLORS: Record<string, string> = {
  calor: "text-rose-700 dark:text-rose-300",
  prioridad: "text-amber-700 dark:text-amber-300",
  viviendas: "text-primary dark:text-dk-primary",
  servicios: "text-sky-700 dark:text-sky-300",
};

function TopList({
  titulo,
  descripcion,
  items,
  tipo,
}: {
  titulo: string;
  descripcion: string;
  items: TopItem[];
  tipo: keyof typeof TIPO_COLORS;
}) {
  const valorCls = TIPO_COLORS[tipo] ?? "text-primary dark:text-dk-primary";

  return (
    <article className="card">
      <header className="mb-3">
        <h3 className="text-base font-semibold text-primary dark:text-dk-primary">
          {titulo}
        </h3>
        <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
          {descripcion}
        </p>
      </header>
      {items.length === 0 ? (
        <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos suficientes para esta categoría.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((it, idx) => (
            <li
              key={it.id}
              className="flex items-baseline gap-3 rounded-md border border-neutral-border bg-neutral-50 p-2 dark:border-dk-border dark:bg-dk-elevated"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white font-bold dark:bg-dk-surface ${valorCls}`}
                aria-hidden
              >
                {idx + 1}
              </span>
              <div className="flex flex-1 flex-col">
                <Link
                  href={`/poligono/${it.id}`}
                  className="font-medium text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  {it.nombre}
                </Link>
                {it.detalle && (
                  <span className="text-[11px] text-neutral-muted dark:text-dk-muted">
                    {it.detalle}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export default PoligonoTotalCiudad;
