"use client";

// Heatmap WebGL con deck.gl encima de un mapa base maplibre-gl.
//
// Decisiones de diseño:
//
// - Usamos `HeatmapLayer` para densidad cuando los puntos están bien
//   distribuidos (~50k puntos), y `HexagonLayer` cuando queremos agregación
//   por celda con altura derivada del peso (mejor para auditoría visual).
//   El usuario elige vía la prop `mode`.
// - Mapa base: react-map-gl/maplibre con un style JSON que apunta a tiles
//   raster de CARTO. Ese style no requiere API key y es compatible con dark
//   mode (cambiamos el sources.url según el tema).
// - La descarga del GeoJSON de buildings (217k) la delegamos al consumidor,
//   que pasa los puntos ya samplados como prop `points`. El componente no
//   sabe de dónde vienen los datos.
// - Performance: sin agregación, deck.gl con ~217k puntos ronda 30-45 fps en
//   integradas; con HexagonLayer (agregación nativa GPU) salta a 60 fps. Por
//   eso `mode="hex"` es la opción default cuando hay >50k puntos. El consumidor
//   ya hace sampling adicional si quiere bajar la carga.

import { useMemo } from "react";
import DeckGL from "@deck.gl/react";
import { HeatmapLayer, HexagonLayer } from "@deck.gl/aggregation-layers";
import Map from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { useTheme } from "@/hooks/useTheme";

export interface HeatmapPoint {
  lat: number;
  lon: number;
  weight: number;
}

export type HeatmapMode = "heat" | "hex";

interface HeatmapLayerComponentProps {
  points: HeatmapPoint[];
  mode?: HeatmapMode;
  height?: number | string;
  // Centro inicial: por defecto Posadas centro (-27.4, -55.9).
  initialView?: { latitude: number; longitude: number; zoom: number };
  // Radio del heatmap (px) y de las celdas hex (m).
  heatRadiusPixels?: number;
  hexRadiusMeters?: number;
  // Intensidad del heatmap (default 1). Subirlo aclara los hotspots.
  heatIntensity?: number;
  // Opacidad global de la capa de datos sobre el mapa base.
  opacity?: number;
  // Rampa de color custom (override). Default: paleta institucional.
  colorRange?: [number, number, number][];
}

const POSADAS_VIEW = {
  latitude: -27.4,
  longitude: -55.9,
  zoom: 11.5,
  pitch: 0,
  bearing: 0,
};

// Rampa "viviendas" — azul a naranja a rojo, alineada con paleta institucional.
export const COLOR_RANGE_BUILDINGS: [number, number, number][] = [
  [240, 244, 249],
  [179, 199, 223],
  [141, 171, 207],
  [90, 122, 156],
  [201, 125, 60],
  [169, 99, 40],
  [100, 56, 22],
];

// Rampa "UHI" — azul (frío) a blanco a naranja (caliente).
export const COLOR_RANGE_UHI: [number, number, number][] = [
  [26, 58, 92],
  [90, 122, 156],
  [255, 255, 255],
  [232, 184, 130],
  [201, 125, 60],
  [169, 99, 40],
];

// Style JSON inline de maplibre que apunta a CARTO Voyager o Dark Matter.
// Funciona sin API key. Si querés pasarte a un MVT propio, simplemente
// reemplazá el sources.tiles por tus URLs.
function styleForTheme(isDark: boolean): object {
  const tilesBase = isDark
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
  // Maplibre acepta el patrón {s} si está enumerado en el array `tiles`.
  // Lo expandimos manualmente: el browser cachea cada subdominio en paralelo.
  const tilesExpanded = ["a", "b", "c", "d"].map((s) =>
    tilesBase.replace("{s}", s),
  );
  return {
    version: 8,
    sources: {
      "carto-raster": {
        type: "raster",
        tiles: tilesExpanded,
        tileSize: 256,
        attribution:
          '&copy; <a href="https://carto.com/attributions">CARTO</a> &middot; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [
      {
        id: "carto-base",
        type: "raster",
        source: "carto-raster",
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  };
}

export function ObservatorioHeatmapLayer({
  points,
  mode = "heat",
  height = 540,
  initialView,
  heatRadiusPixels = 30,
  hexRadiusMeters = 200,
  heatIntensity = 1,
  opacity = 0.85,
  colorRange,
}: HeatmapLayerComponentProps) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";

  const view = initialView
    ? { ...POSADAS_VIEW, ...initialView }
    : POSADAS_VIEW;

  const palette = colorRange ?? COLOR_RANGE_BUILDINGS;

  const dataLayer = useMemo(() => {
    if (!points.length) return null;
    if (mode === "hex") {
      return new HexagonLayer({
        id: "hex-density",
        data: points,
        getPosition: (d: HeatmapPoint) => [d.lon, d.lat],
        getElevationWeight: (d: HeatmapPoint) => d.weight,
        getColorWeight: (d: HeatmapPoint) => d.weight,
        radius: hexRadiusMeters,
        elevationScale: 6,
        extruded: false, // 2D para no chocar con el mapa base raster.
        coverage: 0.92,
        opacity,
        pickable: true,
        colorRange: palette,
      });
    }
    return new HeatmapLayer({
      id: "heat-density",
      data: points,
      getPosition: (d: HeatmapPoint) => [d.lon, d.lat],
      getWeight: (d: HeatmapPoint) => d.weight,
      radiusPixels: heatRadiusPixels,
      intensity: heatIntensity,
      threshold: 0.05,
      colorRange: palette,
      opacity,
    });
  }, [
    points,
    mode,
    hexRadiusMeters,
    heatRadiusPixels,
    heatIntensity,
    opacity,
    palette,
  ]);

  // Style JSON memoizado — clave: cuando isDark cambia, el style cambia y
  // maplibre reemplaza la fuente automáticamente.
  const mapStyle = useMemo(() => styleForTheme(isDark), [isDark]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: typeof height === "number" ? `${height}px` : height,
        overflow: "hidden",
        borderRadius: "0.5rem",
      }}
    >
      <DeckGL
        initialViewState={view}
        controller
        layers={dataLayer ? [dataLayer] : []}
        style={{ position: "absolute", inset: "0" }}
      >
        {/* react-map-gl/maplibre dentro de DeckGL — patrón oficial de
            "DeckGL on top of maplibre". Maplibre lleva la cámara y deck.gl
            renderiza encima cada frame, sincronizando viewport. */}
        <Map
          reuseMaps
          mapStyle={mapStyle as unknown as string}
          attributionControl={true}
        />
      </DeckGL>
    </div>
  );
}

export default ObservatorioHeatmapLayer;
