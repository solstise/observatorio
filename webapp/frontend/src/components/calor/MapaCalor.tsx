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

import { useTheme } from "@/hooks/useTheme";
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
  // El mapa térmico cambia de tile claro/oscuro según el tema activo. Las
  // paletas magma/UHI semánticas (LST e isla de calor) NO cambian — están
  // pensadas para que el lector mantenga la convención cromática.
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

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
        // En dark elevamos el contorno seleccionado a un azul claro y el
        // contorno por defecto a un gris-azul, para que se distingan del
        // tile oscuro sin romper la lectura del coropleto interior.
        const strokeSel = isDark ? "#e6ebf2" : "#1a3a5c";
        const strokeDef = isDark ? "#94a0b8" : "#222222";
        return {
          fillColor: colorDe(metrica, val),
          fillOpacity: isSel ? 0.9 : 0.75,
          color: isSel ? strokeSel : strokeDef,
          weight: isSel ? 2.5 : 1,
        };
      },
    [metrica, uhiRows, selectedId, isDark],
  );

  // En desktop respetamos `height` (default 540) para no romper layouts
  // existentes. En mobile tomamos al menos 320 px para que el mapa nunca
  // colapse a una franja inutilizable; el viewport hace de tope superior.
  const heightStyle = `clamp(320px, 55vh, ${height}px)`;

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-neutral-border shadow-sm dark:border-dk-border"
      style={{ height: heightStyle }}
    >
      <MapContainer
        center={POSADAS_CENTER}
        zoom={12}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        {/* CARTO Voyager (claro) y CARTO Dark Matter (oscuro). La key
            fuerza el remount al cambiar el tema, porque react-leaflet no
            sincroniza la prop url internamente sobre el TileLayer. */}
        <TileLayer
          key={isDark ? "dark" : "light"}
          url={
            isDark
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          }
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a> &middot; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          subdomains={["a", "b", "c", "d"]}
          maxZoom={19}
        />
        <GeoJSON
          key={isDark ? "geo-dark" : "geo-light"}
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
  if (m === "lst") return "Temperatura del suelo";
  if (m === "uhi_vs_rural") return "Más caliente que el campo";
  return "Más que el promedio de la ciudad";
}
