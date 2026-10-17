"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, LayersControl, useMap } from "react-leaflet";
import type { FeatureCollection, Point } from "geojson";
import type { NinoRow } from "@/lib/nino-types";
import { IMPACT_LABEL, formatNinoNumber as num } from "@/lib/nino-presentation";
import "leaflet/dist/leaflet.css";

function FocusBarrio({ barrios, selectedId }: { barrios: FeatureCollection; selectedId: string }) {
  const map = useMap();
  useEffect(() => {
    const features = selectedId ? barrios.features.filter(feature => feature.properties?.id === selectedId) : barrios.features;
    if (!features.length) return;
    const collection: FeatureCollection = { type: "FeatureCollection", features };
    const bounds = L.geoJSON(collection).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15, animate: false });
  }, [map, barrios, selectedId]);
  return null;
}

export default function NinoMap({ barrios, zones, facilities, rows, fresh, mode, selectedId }: { barrios: FeatureCollection; zones: FeatureCollection; facilities: FeatureCollection; rows: NinoRow[]; fresh: boolean; mode: "exposicion" | "impacto"; selectedId: string }) {
  const scores = new Map(rows.map(row => [row.poligono_id, row]));
  return <MapContainer center={[-27.40, -55.95]} zoom={12} scrollWheelZoom={false} style={{ height: 420, width: "100%", zIndex: 0 }} aria-label="Mapa de zonas expuestas y barrios de Posadas">
    <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <FocusBarrio barrios={barrios} selectedId={selectedId} />
    <GeoJSON key={`${mode}-${fresh}-${selectedId}`} data={barrios} style={feature => {
      const row = scores.get(String(feature?.properties?.id));
      const color = mode === "exposicion" ? "#64748b" : !fresh || row?.score_anegamiento == null ? "#737373" : row.nivel === "muy_alto" ? "#991b1b" : row.nivel === "alto" ? "#c2410c" : row.nivel === "atencion" ? "#b45309" : "#537e72";
      const selected = feature?.properties?.id === selectedId;
      return { color: selected ? "#172554" : color, fillColor: color, weight: selected ? 3 : 1, fillOpacity: mode === "exposicion" ? 0 : .4 };
    }} onEachFeature={(feature, layer) => {
      const row = scores.get(String(feature.properties?.id));
      const element = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = String(feature.properties?.nombre ?? "Barrio");
      element.append(name);
      const exposure = document.createElement("p");
      exposure.textContent = row?.estado === "calculado" ? `${num(row.viviendas_expuestas)} edificios en zonas expuestas (${num(row.pct_viviendas_expuestas)}%). No indica una inundación en curso.` : "Faltan datos para calcular la exposición.";
      const impact = document.createElement("p");
      impact.textContent = `Impacto con la lluvia prevista: ${fresh && row?.score_anegamiento != null ? IMPACT_LABEL[row.nivel] : "sin datos vigentes o suficientes"}.`;
      element.append(exposure, impact);
      layer.bindPopup(element);
    }} />
    {mode === "exposicion" && <GeoJSON data={zones} interactive={false} style={{ color: "#147caa", fillColor: "#38a3cd", weight: 1, fillOpacity: .48 }} />}
    <LayersControl position="topright"><LayersControl.Overlay name="Escuelas, salud y otros lugares"><>{facilities.features.filter(feature => feature.geometry.type === "Point").map((feature, index) => {
      const [lon, lat] = (feature.geometry as Point).coordinates;
      return <CircleMarker key={index} center={[lat, lon]} radius={4} pathOptions={{ color: "#292524" }}><Popup>{String(feature.properties?.nombre)}<br />Lugar de referencia. No es un refugio oficial.</Popup></CircleMarker>;
    })}</></LayersControl.Overlay></LayersControl>
  </MapContainer>;
}
