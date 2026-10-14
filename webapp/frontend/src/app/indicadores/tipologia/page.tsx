// Página /tipologia — Capa 1 del Observatorio Urbano Posadas.
//
// Pregunta que responde: "¿Qué hay hoy en cada barrio?"
//   - Verde urbano (Dynamic World V1 / Sentinel-2 + WorldPop)
//   - Tipología de techos (HEURÍSTICA — pendiente clasificador CV)
//   - Densidad volumétrica (Open Buildings + Sentinel-1 SAR)
//   - Anomalías estructurales (Sentinel-1 SAR — z-score vs baseline 12m)
//
// Todas las métricas (excepto techos) son DATOS REALES derivados de
// sensores satelitales y datasets abiertos. La asignación de mix de
// techos es la única estimación cualitativa de la capa y se marca como
// tal con disclaimer prominente.
//
// Arquitectura: Server Component que carga los 4 CSVs de Capa 1 en
// paralelo + features de barrios. Las cards y la tabla son
// presentacionales puros; la tabla comparativa es "use client" solo para
// el sort interactivo (el render inicial ordena por nombre y funciona
// sin JS).

import Link from "next/link";
import type { Metadata } from "next";

import { AnomaliaCard } from "@/components/AnomaliaCard";
import { CanopyCard } from "@/components/CanopyCard";
import { DataFreshness } from "@/components/DataFreshness";
import { DensidadCard } from "@/components/DensidadCard";
import { Disclaimer } from "@/components/Disclaimer";
import { TechosCard } from "@/components/TechosCard";
import { TipologiaTablaComparativa } from "@/components/TipologiaTablaComparativa";
import {
  getAnomalias,
  getCanopy,
  getDensidadVolumetrica,
  getPoligonosBarrios,
  getTechos,
} from "@/lib/data.server";
import { getManyFreshness } from "@/lib/data-freshness";

export const metadata: Metadata = {
  title: "Tipología urbana",
  description:
    "Capa 1 del Observatorio Urbano Posadas: cobertura vegetal, tipología de techos, densidad volumétrica y anomalías estructurales detectadas por satélite para cada barrio.",
};

export default async function TipologiaPage() {
  const [canopy, techos, densidad, anomalias, collection, freshness] =
    await Promise.all([
      getCanopy(),
      getTechos(),
      getDensidadVolumetrica(),
      getAnomalias(),
      getPoligonosBarrios(),
      getManyFreshness(["dynamic_world", "sentinel1", "viviendas"]),
    ]);

  const features = collection.features;
  const totalBarrios = features.length;

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
            Tipología urbana
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Capa 1 · Tipología urbana
          </p>
          <h1
            className="mt-2 font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Tipología urbana
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DataFreshness
              dataset="dynamic_world"
              lastUpdated={freshness.dynamic_world.lastUpdated}
              frequency={freshness.dynamic_world.frequency}
            />
            <DataFreshness
              dataset="sentinel1"
              lastUpdated={freshness.sentinel1.lastUpdated}
              frequency={freshness.sentinel1.frequency}
              compact
            />
            <DataFreshness
              dataset="viviendas"
              lastUpdated={freshness.viviendas.lastUpdated}
              frequency={freshness.viviendas.frequency}
              compact
            />
          </div>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Qué <em>hay hoy</em> en cada uno de los {totalBarrios} barrios
            monitoreados: cuánto verde urbano queda por habitante, qué
            materiales predominan en los techos, qué tan denso está el
            tejido construido y qué cambios estructurales detectaron los
            radares satelitales en el último mes.
          </p>
          <div className="mt-4 rounded-md border border-primary-200 bg-primary-50 p-3 text-sm text-neutral-text dark:border-dk-border dark:bg-dk-elevated dark:text-dk-text">
            <p>
              <strong>Mejoras de mayo 2026.</strong> La{" "}
              <em>tipología de techos</em> ahora se calibra con el{" "}
              <strong>índice ACRI (Asbestos Cement Roof Index)</strong>{" "}
              calculado sobre las bandas SWIR de Sentinel-2 (B11 a 1610 nm y
              B12 a 2190 nm) — el cemento asbestoso tiene firma espectral
              distintiva en SWIR-1. La densidad volumétrica usa el conteo de
              edificios reales de <strong>Microsoft Global ML Building
              Footprints</strong> (~93 mil edificios para Posadas) en lugar
              de estimaciones del pipeline. Las demás capas (verde,
              anomalías) ya usaban datos reales de Sentinel-2 Dynamic World
              y Sentinel-1 SAR.{" "}
              <Link
                href="/datos/metodologia"
                className="font-medium text-primary underline-offset-2 hover:underline dark:text-dk-primary dark:underline"
              >
                Ver metodología
              </Link>
              .
            </p>
          </div>
        </header>

        <section
          aria-label="Indicadores agregados de tipología urbana"
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <CanopyCard rows={canopy} features={features} />
          <TechosCard rows={techos} features={features} />
          <DensidadCard rows={densidad} features={features} />
          <AnomaliaCard rows={anomalias} features={features} />
        </section>

        <div className="mt-8">
          <TipologiaTablaComparativa
            canopy={canopy}
            densidad={densidad}
            anomalias={anomalias}
            features={features}
          />
        </div>

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se calcula cada métrica
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Verde urbano (canopy)</strong>: porcentaje del barrio
              clasificado como no-construido por Google Dynamic World V1
              (Sentinel-2, deep learning). Los m²/cap. se obtienen
              cruzando esa fracción con la población estimada de WorldPop
              y la superficie del polígono. Umbral de referencia: OMS{" "}
              <strong>9 m²/hab</strong> (Urban Green Spaces and Health,
              2016).{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Script: <code>capas_avanzadas/compute_capas.cjs</code> ·
                fuente: <code>dynamic_world.csv</code>.
              </span>
            </li>
            <li>
              <strong>Tipología de techos</strong> (calibrada con ACRI): el
              porcentaje de techos de fibrocemento/chapa vieja se ancla al
              índice ACRI = (B11 − B12) / (B11 + B12) calculado sobre los
              píxeles urbanos de cada barrio en una escena Sentinel-2 L2A
              limpia (19-abr-2026, 0.002% de nubes). El asbesto cemento
              tiene una firma espectral característica con alta reflectancia
              en SWIR-1 por el silicato de magnesio hidratado. El score
              relativo se mapea a un rango realista de 3-25% de asbesto, y
              el resto del mix (losa, teja, chapa nueva, chapa vieja) se
              estima con la categoría urbana y la antigüedad relativa.
              Confianza: <em>media</em> (mejora sobre la versión solo
              heurística — pendiente clasificador CV sobre ortofotos para
              alcanzar <em>alta</em>).{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Método: <code>ndai_swir_v1</code> +{" "}
                <code>heuristico_v1</code> (mix). Script:{" "}
                <code>compute_ndai_asbestos.cjs</code>.
              </span>
            </li>
            <li>
              <strong>Densidad volumétrica</strong>: el conteo de edificios
              proviene de <strong>Microsoft Global ML Building
              Footprints</strong> v6 (febrero 2026) — un dataset abierto que
              detectó ~93 mil edificios reales en Posadas vía ML sobre
              imágenes Bing. La huella media por edificio también es
              empírica (~146 m² en Misiones, contra los 80-90 m² que
              asumía el pipeline previo). La altura se estima cruzando la
              categoría urbana con la retrodispersión Sentinel-1 SAR
              promedio (mayor backscatter VV ≈ mayor volumen edificado).{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Fuentes: <code>microsoft_buildings_v6</code> +{" "}
                <code>sentinel1.csv</code>. Script:{" "}
                <code>compute_real_buildings.cjs</code>.
              </span>
            </li>
            <li>
              <strong>Anomalías estructurales</strong>: para cada barrio se
              compara la retrodispersión Sentinel-1 VV del mes más reciente
              contra una baseline de los 12 meses previos del propio barrio
              (z-score). |z| &gt; 2 marca cambios fuera del ruido normal:
              crecimiento fuerte (nueva edificación) o pérdida fuerte
              (demoliciones, inundaciones, desmonte). El SAR atraviesa nubes
              y opera día y noche, ideal para detección continua mes a mes.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Fuente: <code>sentinel1.csv</code> ·{" "}
                <code>tipologia/anomalias.csv</code>.
              </span>
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
