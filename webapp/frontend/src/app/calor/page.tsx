// Página /calor — capa de calor urbano. Server Component que carga
// datasets en paralelo y delega la interactividad al ClientCalor.

import Link from "next/link";
import type { Metadata } from "next";

import { Disclaimer } from "@/components/Disclaimer";
import {
  getCalorMensual,
  getPoligonos,
  getUhiEstacional,
  getUhiMensual,
} from "@/lib/data.server";

import { ClientCalor } from "./ClientCalor";

export const metadata: Metadata = {
  title: "Calor urbano",
  description:
    "Mapa de isla de calor urbana (UHI) en Posadas con Landsat 8/9 (LST, 30 m).",
};

export default async function CalorPage() {
  const [collection, mensuales, uhiRows, estacionales] = await Promise.all([
    getPoligonos(),
    getCalorMensual(),
    getUhiMensual(),
    getUhiEstacional(),
  ]);

  const tieneDatos = uhiRows.length > 0;

  return (
    <>
      <Disclaimer />
      <main className="container-obs py-8">
        <nav aria-label="Migas" className="mb-4 text-sm text-secondary">
          <Link href="/" className="hover:underline">
            Mapa
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span className="text-neutral-muted">Calor urbano</span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary">
            Capa experimental — v0.3
          </p>
          <h1 className="mt-2 text-3xl md:text-4xl font-bold">
            Calor urbano de Posadas
          </h1>
          <p className="mt-3 text-base text-neutral-text">
            Mapa de temperatura de superficie (LST) e intensidad de isla de
            calor urbana (UHI) por barrio, derivado de imágenes Landsat 8 y
            Landsat 9 (Collection 2 Level 2) a 30 m de resolución, con
            composites mensuales desde enero 2018.
          </p>
          <div className="mt-4 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-neutral-text">
            <strong>Aclaración importante:</strong> la LST (temperatura de
            superficie) <em>no</em> es igual a la temperatura del aire
            ambiente. A las 10:30 AM en verano, el asfalto puede estar a 50 °C
            mientras el aire a 1,5 m está a 32 °C. Ver{" "}
            <Link href="/metodologia" className="text-primary underline">
              metodología
            </Link>
            .
          </div>
        </header>

        {!tieneDatos && (
          <div
            role="status"
            className="card border-accent-200 bg-accent-50 text-sm"
          >
            La capa de calor está en preparación. Estamos procesando los
            composites Landsat 2018-2026, puede demorar algunos minutos en la
            primera corrida. Refrescá en un rato.
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

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-muted">
          <h2 className="text-lg font-semibold text-primary">
            Sobre estos datos
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Fuente primaria</strong>: Landsat 8/9 Collection 2 Level
              2, banda térmica ST_B10 (USGS, dominio público).
            </li>
            <li>
              <strong>Resolución</strong>: 30 m (resampleo nativo Collection 2).
            </li>
            <li>
              <strong>Hora de pasada</strong>: ~10:30 AM hora solar local; la
              UHI nocturna es un fenómeno distinto y más intenso.
            </li>
            <li>
              <strong>Baseline rural</strong>: promedio de cuatro polígonos
              vegetados o de pasturas dentro de 20 km de Posadas.
            </li>
            <li>
              <strong>Cobertura nubosa</strong>: meses con menos de dos escenas
              útiles se declaran sin dato, no se interpolan.
            </li>
            <li>
              <strong>Limitación comunicacional</strong>: la capa no debe
              usarse para alertas individuales de salud ni decisiones
              inmobiliarias automáticas.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
