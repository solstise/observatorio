// Página /calor — capa de calor urbano. Server Component que carga
// datasets en paralelo y delega la interactividad al ClientCalor.

import Link from "next/link";
import type { Metadata } from "next";

import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { TerminoGlosario } from "@/components/TerminoGlosario";
import {
  getCalorMensual,
  getPoligonosBarrios,
  getUhiEstacional,
  getUhiMensual,
} from "@/lib/data.server";
import { getDatasetFreshness } from "@/lib/data-freshness";

import { ClientCalor } from "./ClientCalor";

export const metadata: Metadata = {
  title: "Calor urbano",
  description:
    "Mapa de calor urbano en Posadas: muestra qué tan caliente está cada barrio comparado con el campo. Datos: Landsat 8/9 (LST, 30 m).",
};

export default async function CalorPage() {
  const [collection, mensuales, uhiRows, estacionales, freshness] =
    await Promise.all([
      getPoligonosBarrios(),
      getCalorMensual(),
      getUhiMensual(),
      getUhiEstacional(),
      getDatasetFreshness("calor_landsat"),
    ]);

  const tieneDatos = uhiRows.length > 0;

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
            Calor urbano
          </span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Capa de calor urbano
          </p>
          <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
            Calor urbano de Posadas
          </h1>
          <div className="mt-3">
            <DataFreshness
              dataset="calor_landsat"
              lastUpdated={freshness.lastUpdated}
              frequency={freshness.frequency}
            />
          </div>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Mapa que muestra <strong>qué tan caliente está cada barrio</strong>{" "}
            comparado con el campo y con el promedio de la ciudad. Ayuda a
            identificar dónde el cemento y la falta de árboles hacen subir la
            temperatura, y dónde aún queda capacidad de enfriamiento.
          </p>
          <div className="mt-4 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-neutral-text dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100">
            <strong>Importante:</strong> esto mide la temperatura del
            <em> suelo y los techos</em> vistos desde un satélite, no la del
            aire que respiramos. A las 10:30 de la mañana en verano, el asfalto
            puede estar a 50 °C mientras el aire a 1,5 m está a 32 °C. Ver{" "}
            <Link
              href="/metodologia"
              className="text-primary underline dark:text-amber-50"
            >
              metodología
            </Link>
            .
          </div>
        </header>

        {!tieneDatos && (
          <div
            role="status"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
          >
            Sin datos de calor disponibles para mostrar en este momento.
            Los composites{" "}
            <TerminoGlosario id="landsat">Landsat</TerminoGlosario>{" "}
            2018-2026 se actualizan periódicamente; volvé en unos minutos
            si acabás de regenerar el pipeline.
          </div>
        )}

        {tieneDatos && (
          <ClientCalor
            collection={collection}
            mensuales={mensuales}
            uhiRows={uhiRows}
            estacionales={estacionales}
          />
        )}

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Qué muestra esta capa
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Mide qué tan caliente está cada barrio comparado
              con el campo</strong>: identifica dónde faltan árboles y sobra
              cemento.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Datos:{" "}
                <TerminoGlosario id="landsat">Landsat 8/9</TerminoGlosario>{" "}
                Collection 2 Level 2 — banda térmica ST_B10, USGS.
              </span>
            </li>
            <li>
              <strong>Resolución de barrio (30 m por píxel)</strong>: cada
              píxel cubre aproximadamente media manzana, suficiente para
              comparar entre barrios pero no para identificar lotes
              individuales.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Datos: Collection 2 Landsat, resampleo nativo.
              </span>
            </li>
            <li>
              <strong>Captura el calor del mediodía</strong>: el satélite pasa
              cerca de las 10:30 de la mañana hora local. El calor nocturno
              suele ser más intenso y se mide con{" "}
              <TerminoGlosario id="modis">MODIS</TerminoGlosario> (ver ficha
              de polígono).{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Hora local de pasada: ~10:30 AM solar.
              </span>
            </li>
            <li>
              <strong>Compara contra el campo de Posadas</strong>: la línea de
              base es el promedio de cuatro polígonos rurales con vegetación o
              pastura dentro de 20 km.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Baseline: 4 polígonos rurales, radio 20 km.
              </span>
            </li>
            <li>
              <strong>No inventamos datos faltantes</strong>: cuando hay menos
              de dos imágenes útiles en el mes (por nubes), se declara &quot;sin
              dato&quot; en vez de interpolar.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Cobertura nubosa: descarte sin imputación.
              </span>
            </li>
            <li>
              <strong>Para qué NO sirve</strong>: no es una alerta de salud
              individual ni una herramienta de decisión inmobiliaria
              automática. Es información agregada por barrio, para política
              pública y planificación.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
