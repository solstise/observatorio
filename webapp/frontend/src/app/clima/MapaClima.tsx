"use client";

// Mapa coroplético Leaflet para /clima. Cada barrio se colorea por su
// Tmin pronosticada del día activo (mediana p50 del ensamble), usando
// una paleta diverging frío azul / templado naranja con punto neutro
// alrededor de 12 °C (típico para otoño/invierno en Posadas).
//
// La paleta NO es la misma que MapaCalor (que usa magma/UHI): en
// pronóstico clima queremos comunicar la temperatura absoluta, no el
// contraste con el campo. Diverging azul-naranja calza con la
// convención meteorológica clásica.

import { useMemo } from "react";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import chroma from "chroma-js";
import type { Feature, Geometry } from "geojson";

import { useTheme } from "@/hooks/useTheme";
import type {
  ForecastDiarioRow,
  PoligonoProperties,
  PoligonosCollection,
} from "@/lib/types";

interface Props {
  collection: PoligonosCollection;
  forecastDia: Map<string, ForecastDiarioRow>;
  fecha: string;
  onSelect?: (id: string | null) => void;
  selectedId?: string | null;
  height?: number;
}

// Paleta diverging:
// Frío extremo (-5 °C) → azul oscuro
// Frío suave (5 °C) → azul claro
// Templado (15 °C) → blanco neutral
// Cálido (25 °C) → naranja
// Caluroso (35 °C) → rojo cálido
const PALETA_TMIN = chroma
  .scale(["#1e3a8a", "#3b82f6", "#bfdbfe", "#fef3c7", "#f59e0b", "#b91c1c"])
  .mode("lab")
  .domain([-5, 5, 12, 18, 25, 35]);

const POSADAS_CENTER: [number, number] = [-27.4, -55.9];

function colorTmin(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "#d1d5db";
  return PALETA_TMIN(v).hex();
}

export default function MapaClima({
  collection,
  forecastDia,
  fecha,
  onSelect,
  selectedId,
  height = 460,
}: Props) {
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
        const row = forecastDia.get(p.id);
        const tmin = row?.tmin_p50 ?? null;
        const strokeSel = isDark ? "#e6ebf2" : "#1a3a5c";
        const strokeDef = isDark ? "#94a0b8" : "#222222";
        return {
          fillColor: colorTmin(tmin),
          fillOpacity: isSel ? 0.92 : 0.78,
          color: isSel ? strokeSel : strokeDef,
          weight: isSel ? 2.5 : 1,
        };
      },
    [forecastDia, selectedId, isDark],
  );

  const heightStyle = `clamp(320px, 50vh, ${height}px)`;

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
          key={`${fecha}-${isDark ? "d" : "l"}`}
          data={featureCollection}
          style={styleFn as never}
          onEachFeature={(feature, layer) => {
            const p = feature.properties as PoligonoProperties;
            const row = forecastDia.get(p.id);
            const tminLabel =
              row && Number.isFinite(row.tmin_p50)
                ? `${row.tmin_p50.toFixed(1)} °C (p10 ${row.tmin_p10.toFixed(1)}–p90 ${row.tmin_p90.toFixed(1)})`
                : "sin dato";
            const tmaxLabel =
              row && Number.isFinite(row.tmax_p50)
                ? `${row.tmax_p50.toFixed(1)} °C`
                : "sin dato";
            layer.bindTooltip(
              `<strong>${p.nombre}</strong><br>Tmin: ${tminLabel}<br>Tmax: ${tmaxLabel}`,
              { sticky: true },
            );
            layer.on("click", () => onSelect?.(p.id));
          }}
        />
      </MapContainer>
    </div>
  );
}
