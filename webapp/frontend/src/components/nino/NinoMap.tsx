"use client";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, LayersControl } from "react-leaflet";
import type { FeatureCollection, Point } from "geojson";
import type { NinoRow } from "@/lib/nino-types";
import "leaflet/dist/leaflet.css";

export default function NinoMap({ barrios, zones, facilities, rows, fresh }: { barrios: FeatureCollection; zones: FeatureCollection; facilities: FeatureCollection; rows: NinoRow[]; fresh: boolean }) {
  const scores = new Map(rows.map(r => [r.poligono_id, r]));
  return <MapContainer center={[-27.40, -55.95]} zoom={12} scrollWheelZoom={false} style={{ height: 440, width: "100%", zIndex: 0 }} aria-label="Exposición hídrica y barrios de Posadas">
    <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <LayersControl position="topright">
      <LayersControl.Overlay checked name="Impacto esperado por barrio"><GeoJSON key={String(fresh)} data={barrios} style={f => {
        const r = scores.get(String(f?.properties?.id));
        const color = !fresh || r?.score_anegamiento == null ? "#737373" : r.nivel === "muy_alto" ? "#991b1b" : r.nivel === "alto" ? "#c2410c" : r.nivel === "atencion" ? "#b45309" : "#537e72";
        return { color, fillColor: color, weight: 1, fillOpacity: .25 };
      }} onEachFeature={(f, layer) => {
        const r = scores.get(String(f.properties?.id));
        const el = document.createElement("div");
        el.textContent = `${f.properties?.nombre ?? "Barrio"} · Impacto: ${fresh && r?.score_anegamiento != null ? r.score_anegamiento + "/100" : "a verificar"}`;
        layer.bindPopup(el);
      }} /></LayersControl.Overlay>
      <LayersControl.Overlay checked name="Exposición estática estimada"><GeoJSON data={zones} style={{ color: "#0369a1", fillColor: "#38bdf8", weight: 1, fillOpacity: .5 }} /></LayersControl.Overlay>
      <LayersControl.Overlay name="Equipamiento cercano"><>{facilities.features.filter(f => f.geometry.type === "Point").map((f, i) => {
        const [lon, lat] = (f.geometry as Point).coordinates;
        return <CircleMarker key={i} center={[lat, lon]} radius={4} pathOptions={{ color: "#292524" }}><Popup>{String(f.properties?.nombre)}<br />Equipamiento cercano — no es un refugio oficial</Popup></CircleMarker>;
      })}</></LayersControl.Overlay>
    </LayersControl>
  </MapContainer>;
}
