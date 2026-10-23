import type { Metadata } from "next";
import type { FeatureCollection } from "geojson";
import { NinoDashboard } from "@/components/nino/NinoDashboard";
import { getNinoConfig, getNinoEvents, getNinoGeometry, getNinoSnapshot, getObservedRecord } from "@/lib/nino.server";
import { getNinoAhora } from "@/lib/nino-live/sources.server";
import { getPoligonosBarrios } from "@/lib/data.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sala de situación El Niño", description: "Lluvia y tormentas en Posadas, en vivo: alertas del SMN, lluvia medida, rayos, río Paraná y pronóstico. Buscá tu barrio y consultá las zonas expuestas.", alternates: { canonical: "/nino" }, openGraph: { url: "/nino" } };

export default async function NinoPage() {
  const config = await getNinoConfig();
  // Datos en vivo con tope de espera: si una fuente tarda, la completa el navegador.
  const [snapshot, barrios, zones, facilities, events, record, live] = await Promise.all([getNinoSnapshot(), getPoligonosBarrios(), getNinoGeometry("exposicion_hidrica.geojson"), getNinoGeometry("equipamientos_nino.geojson"), getNinoEvents(), getObservedRecord(), getNinoAhora(2500, config.rayos_cerca_km)]);
  return <main className="container-obs py-6 sm:py-8"><NinoDashboard snapshot={snapshot} barrios={barrios as unknown as FeatureCollection} zones={zones} facilities={facilities} events={events} record={record} config={config} initialLive={live} /></main>;
}
