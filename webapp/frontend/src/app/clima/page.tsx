// Página /clima — pronóstico climático por barrio + alertas trigger.
//
// Server Component que carga los datasets en paralelo y delega la
// interactividad (selector de día, mapa coroplético de Tmin, picker
// de barrio) al ClientClima. Los archivos CSV/JSON los produce
// scripts/57_forecast_clima.py + scripts/58_alertas_clima.py.

import Link from "next/link";
import type { Metadata } from "next";

import { DataFreshness } from "@/components/DataFreshness";
import { Disclaimer } from "@/components/Disclaimer";
import { TerminoGlosario } from "@/components/TerminoGlosario";
import {
  getAlertasActivas,
  getAqiDiario,
  getForecastDiario,
  getPoligonosBarrios,
} from "@/lib/data.server";
import { getDatasetFreshness } from "@/lib/data-freshness";

import { ClientClima } from "./ClientClima";

export const metadata: Metadata = {
  title: "Pronóstico climático por barrio",
  description:
    "Pronóstico de temperatura mínima/máxima por barrio en Posadas con banda de confianza p10–p90 (ensamble de 6 modelos meteorológicos), alertas trigger automáticas y AQI europeo. Datos: Open-Meteo + offset Landsat por barrio.",
};

export default async function ClimaPage() {
  const [collection, forecast, aqi, alertas, freshForecast, freshAlertas] =
    await Promise.all([
      getPoligonosBarrios(),
      getForecastDiario(),
      getAqiDiario(),
      getAlertasActivas(),
      getDatasetFreshness("forecast"),
      getDatasetFreshness("alertas"),
    ]);

  const tieneDatos = forecast.length > 0;
  const fechasDisponibles = Array.from(
    new Set(forecast.map((r) => r.fecha)),
  ).sort();

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
          <span className="text-neutral-muted dark:text-dk-muted">Clima</span>
        </nav>

        <header className="mb-6 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
            Pronóstico climático
          </p>
          <h1
            className="mt-2 font-bold text-primary dark:text-dk-primary"
            style={{ fontSize: "var(--fs-h1)" }}
          >
            Pronóstico climático por barrio
          </h1>
          {/* Doble chip: el forecast y las alertas se refrescan ambos
              cada 6h pero por scripts distintos (57 y 58). Mostramos los
              dos para que el visitante sepa cuándo cayó cada uno. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DataFreshness
              dataset="forecast"
              lastUpdated={freshForecast.lastUpdated}
              frequency={freshForecast.frequency}
            />
            <DataFreshness
              dataset="alertas"
              lastUpdated={freshAlertas.lastUpdated}
              frequency={freshAlertas.frequency}
              compact
            />
          </div>
          <p className="mt-3 lead text-neutral-text dark:text-dk-text">
            Pronóstico de hasta 14 días con <strong>banda de confianza</strong>{" "}
            <TerminoGlosario id="percentil">p10–p90</TerminoGlosario> derivada
            de un ensamble de 6 modelos meteorológicos (ECMWF, GFS, ICON, JMA,
            GEM, BoM ACCESS). El pronóstico base se ajusta por barrio aplicando
            un <strong>offset</strong> derivado de la{" "}
            <TerminoGlosario id="uhi">isla de calor urbana (UHI)</TerminoGlosario>{" "}
            <TerminoGlosario id="landsat">Landsat</TerminoGlosario>: barrios
            con cemento denso retienen más calor nocturno, los barrios con
            vegetación abundante son algo más fríos.
          </p>
          <div className="mt-4 rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-neutral-text dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100">
            <strong>Importante:</strong> el pronóstico operativo lo emite el{" "}
            <a
              href="https://www.smn.gob.ar/"
              className="underline"
              target="_blank"
              rel="noreferrer noopener"
            >
              Servicio Meteorológico Nacional
            </a>
            . Esta herramienta es <em>complementaria</em> y agrega resolución
            barrio por barrio para planificación territorial. No reemplaza
            avisos oficiales.
          </div>
        </header>

        {!tieneDatos && (
          <div
            role="status"
            className="card border-accent-200 bg-accent-50 text-sm dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100"
          >
            Sin datos de pronóstico disponibles para mostrar en este momento.
            El ensamble se actualiza periódicamente; volvé en unos minutos.
          </div>
        )}

        {tieneDatos && (
          <ClientClima
            collection={collection}
            forecast={forecast}
            aqi={aqi}
            alertas={alertas}
            fechasDisponibles={fechasDisponibles}
          />
        )}

        <section className="mt-10 space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
          <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
            Cómo se construye el pronóstico
          </h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong>Ensamble de 6 modelos meteorológicos</strong>{" "}
              (<TerminoGlosario id="open-meteo">Open-Meteo Ensemble</TerminoGlosario>):
              ECMWF IFS04, GFS Seamless, ICON Global, JMA GSM, GEM Global, BoM
              ACCESS Global. La banda <strong>p10–p90</strong> representa el
              rango entre los miembros del ensemble — cuanto más ancha, más
              incertidumbre.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Fuente: ensemble-api.open-meteo.com.
              </span>
            </li>
            <li>
              <strong>Offset por barrio</strong> derivado de UHI Landsat: la
              diferencia de temperatura de superficie entre barrio y baseline
              rural se traduce a diferencial de temperatura del aire con un
              factor 0.33 (diurno) y 0.20 (nocturno).{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Script: <code>49_calor_pipeline.py</code>, fuente Landsat 8/9
                C2L2.
              </span>
            </li>
            <li>
              <strong>Alertas trigger automáticas</strong>: las reglas viven en{" "}
              <code>config/alertas.yaml</code> y se aplican sobre el forecast
              diario. Las alertas se cruzan con el ranking político (script
              54) para destacar barrios prioritarios bajo evento adverso.
            </li>
            <li>
              <strong>AQI europeo</strong> (PM10, PM2.5,{" "}
              <TerminoGlosario id="no2">NO₂</TerminoGlosario>, SO₂, ozono):
              fuente Open-Meteo Air Quality. La resolución del modelo es ~10
              km — Posadas entera entra en una sola celda, así que el AQI no
              se desagrega por barrio. Mostrar variación falsa entre barrios
              sería deshonesto.{" "}
              <span className="text-xs text-neutral-muted dark:text-dk-muted">
                Fuente: air-quality-api.open-meteo.com.
              </span>
            </li>
            <li>
              <strong>Para qué NO sirve</strong>: no es una alerta personal a
              un domicilio ni un sustituto del SMN. Es una capa agregada para
              identificar barrios prioritarios bajo eventos climáticos
              adversos en la ventana de pronóstico.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
