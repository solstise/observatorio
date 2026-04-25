"use client";

// Mapa coroplético Leaflet para la capa /calor. Alta calidad visual:
// - Tiles CartoDB Voyager retina (no el OSM default pixelado).
// - Choropleth con chroma-js para interpolación suave.
// - Paletas: inferno para LST absoluta, diverging azul-blanco-naranja para UHI.
// - Polígonos rurales con estilo punteado para diferenciarlos.

import { useMemo } from "react";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import chroma from "chroma-js";
import type { Feature, Geometry } from "geojson";

import type {
  PoligonosCollection,
  PoligonoProperties,
  UhiMensualRow,
} from "@/lib/types";

export type MetricaCalor = "lst" | "uhi_vs_rural" | "uhi_vs_ciudad";

interface Props {
  collection: PoligonosCollection;
  uhiRows: UhiMensualRow[];
  metrica: MetricaCalor;
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  height?: number;
}

// Escalas cromáticas. Domain ajustado a rangos típicos Posadas.
const ESCALA_LST = chroma
  .scale(["#000004", "#3b0f70", "#8c2981", "#de4968", "#fd9a6a", "#fcfdbf"])
  .domain([20, 45]);

const ESCALA_UHI = chroma
  .scale(["#1a3a5c", "#ffffff", "#c97d3c"])
  .mode("lab")
  .domain([-5, 0, 8]);

// Centro aproximado de Posadas + bbox de zoom inicial.
const POSADAS_CENTER: [number, number] = [-27.4, -55.9];

function valorPoligono(
  poligonoId: string,
  rows: UhiMensualRow[],
  metrica: MetricaCalor,
): number | null {
  // Usa la fila más reciente disponible.
  const sub = rows
    .filter((r) => r.poligono_id === poligonoId)
    .sort((a, b) => b.anio - a.anio || b.mes - a.mes);
  if (!sub.length) return null;
  const r = sub[0];
  if (metrica === "lst") return Number(r.lst_mean);
  if (metrica === "uhi_vs_rural") return Number(r.uhi_vs_rural);
  return Number(r.uhi_vs_ciudad);
}

function colorDe(metrica: MetricaCalor, valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return "#d1d5db";
  return metrica === "lst" ? ESCALA_LST(valor).hex() : ESCALA_UHI(valor).hex();
}

export default function MapaCalor({
  collection,
  uhiRows,
  metrica,
  onSelect,
  selectedId,
  height = 540,
}: Props) {
  const featureCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: collection.features as unknown as Feature<
        Geometry,
        PoligonoProperties
      >[],
    }),
    [collection],
  );

  const styleFn = useMemo(
    () =>
      (feature?: Feature<Geometry, PoligonoProperties>) => {
        if (!feature) return {};
        const p = feature.properties;
        const isSel = selectedId === p.id;
        const val = valorPoligono(p.id, uhiRows, metrica);
        return {
          fillColor: colorDe(metrica, val),
          fillOpacity: isSel ? 0.9 : 0.75,
          color: isSel ? "#1a3a5c" : "#222222",
          weight: isSel ? 2.5 : 1,
        };
      },
    [metrica, uhiRows, selectedId],
  );

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-neutral-border shadow-sm"
      style={{ height }}
    >
      <MapContainer
        center={POSADAS_CENTER}
        zoom={12}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &middot; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          subdomains={["a", "b", "c", "d"]}
          maxZoom={19}
        />
        <GeoJSON
          data={featureCollection}
          style={styleFn as never}
          onEachFeature={(feature, layer) => {
            const p = feature.properties as PoligonoProperties;
            const val = valorPoligono(p.id, uhiRows, metrica);
            const valStr =
              val !== null && Number.isFinite(val)
                ? `${val.toFixed(1)}${metrica === "lst" ? " °C" : " °C"}`
                : "sin dato";
            layer.bindTooltip(
              `<strong>${p.nombre}</strong><br>${metricaLabel(metrica)}: ${valStr}`,
              { sticky: true },
            );
            layer.on("click", () => onSelect?.(p.id));
          }}
        />
      </MapContainer>
    </div>
  );
}

function metricaLabel(m: MetricaCalor): string {
  if (m === "lst") return "LST";
  if (m === "uhi_vs_rural") return "UHI vs rural";
  return "UHI vs ciudad";
}
