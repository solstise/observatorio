import type { Metadata } from "next";
import type { FeatureCollection } from "geojson";
import { NinoDashboard } from "@/components/nino/NinoDashboard";
import { getNinoEvents, getNinoGeometry, getNinoSnapshot } from "@/lib/nino.server";
import { getPoligonosBarrios } from "@/lib/data.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sala de situación El Niño", description: "Qué lluvia se espera en Posadas y cuáles son las zonas más expuestas. Buscá tu barrio, entendé el mapa y consultá las alertas oficiales.", alternates: { canonical: "/nino" }, openGraph: { url: "/nino" } };

export default async function NinoPage() {
  const [snapshot, barrios, zones, facilities, events] = await Promise.all([getNinoSnapshot(), getPoligonosBarrios(), getNinoGeometry("exposicion_hidrica.geojson"), getNinoGeometry("equipamientos_nino.geojson"), getNinoEvents()]);
  return <main className="container-obs py-8"><NinoDashboard snapshot={snapshot} barrios={barrios as unknown as FeatureCollection} zones={zones} facilities={facilities} events={events} /></main>;
}
