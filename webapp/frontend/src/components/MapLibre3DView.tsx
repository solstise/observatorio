"use client";

// Vista 3D de Posadas con maplibre-gl + react-map-gl/maplibre.
//
// Componente separado del page.tsx para que el dynamic import (`ssr: false`)
// pueda excluirlo del bundle del server. Maplibre depende de window y rompe
// si se ejecuta en SSR.
//
// Behavior:
//
// - Style JSON: un objeto in-memory en lugar de URL externa. Eso nos da
//   control fino sobre las layers (basemap raster, terrain opcional, polígonos
//   extruidos) y evita una dependencia adicional con MapTiler styles.
// - Terrain: solo si maptilerKey != "". Si la key existe, agregamos `terrain`
//   apuntando al source `terrainSource` y exageramos 1.5x.
// - 3D extrusion de polígonos: FillExtrusion con altura proporcional al score.
//   El barrio seleccionado sube a 200m y se pinta naranja.
// - Click handling: usamos onClick del Map para hit-test el layer "polys-3d"
//   y reportar al padre.

import { useCallback, useMemo, useRef } from "react";
import Map from "react-map-gl/maplibre";
import type { MapRef } from "react-map-gl/maplibre";
import type { LngLatLike, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { useTheme } from "@/hooks/useTheme";
import type { PoligonosCollection } from "@/lib/types";

interface MapLibre3DViewProps {
  collection: PoligonosCollection | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Si está vacío, no se monta terrain — el mapa sigue 3D pero plano.
  maptilerKey: string;
}

// Centro de Posadas y altura de cámara default.
const POSADAS_CENTER: LngLatLike = [-55.9, -27.4];

export default function MapLibre3DView({
  collection,
  selectedId,
  onSelect,
  maptilerKey,
}: MapLibre3DViewProps) {
  const { resolved } = useTheme();
  const isDark = resolved === "dark";
  const mapRef = useRef<MapRef | null>(null);

  // Style JSON dinámico — depende del tema (light/dark) y de si tenemos
  // MapTiler key.
  const mapStyle = useMemo(() => {
    const tilesBase = isDark
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
      : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
    const tilesExpanded = ["a", "b", "c", "d"].map((s) =>
      tilesBase.replace("{s}", s),
    );

    const sources: Record<string, unknown> = {
      "carto-raster": {
        type: "raster",
        tiles: tilesExpanded,
        tileSize: 256,
        attribution:
          '&copy; <a href="https://carto.com/attributions">CARTO</a> &middot; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    };
    const layers: Record<string, unknown>[] = [
      {
        id: "carto-base",
        type: "raster",
        source: "carto-raster",
        minzoom: 0,
        maxzoom: 19,
      },
    ];

    // Terrain opcional. Solo si tenemos key. Maplibre necesita un source
    // tipo `raster-dem` para interpretar PNG como DEM.
    if (maptilerKey) {
      sources["maptiler-terrain"] = {
        type: "raster-dem",
        tiles: [
          `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${maptilerKey}`,
        ],
        tileSize: 256,
        maxzoom: 12,
        attribution:
          '&copy; <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">MapTiler</a>',
      };
    }

    // Capa con los polígonos del observatorio.
    if (collection) {
      sources["poligonos"] = {
        type: "geojson",
        data: collection as unknown as object,
      };
      layers.push({
        id: "polys-3d",
        type: "fill-extrusion",
        source: "poligonos",
        paint: {
          // Color por score_expansion (0..1). Mismo gradient que el resto del
          // proyecto: crema → naranja oscuro. La función `interpolate` permite
          // gradient linear sin tener que precomputar.
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "score_expansion"], 0],
            0,
            isDark ? "#1c2540" : "#eef2f7",
            0.5,
            isDark ? "#7faed8" : "#5a7a9c",
            1,
            isDark ? "#e0945c" : "#c97d3c",
          ],
          // Altura: si está seleccionado, 200m; si no, escala 30..120 según
          // score (más score → más alto).
          "fill-extrusion-height": [
            "case",
            ["==", ["get", "id"], selectedId ?? ""],
            200,
            [
              "+",
              30,
              ["*", 90, ["coalesce", ["get", "score_expansion"], 0]],
            ],
          ],
          "fill-extrusion-opacity": 0.78,
          "fill-extrusion-base": 0,
        },
      } as Record<string, unknown>);
    }

    const style: Record<string, unknown> = {
      version: 8,
      sources,
      layers,
      sky: {
        "sky-color": isDark ? "#0e1320" : "#cad5e6",
        "sky-horizon-blend": 0.6,
        "horizon-color": isDark ? "#1c2540" : "#9eb1cb",
        "horizon-fog-blend": 0.5,
        "fog-color": isDark ? "#0e1320" : "#e6ebf2",
        "fog-ground-blend": 0.5,
      },
    };
    if (maptilerKey) {
      style.terrain = {
        source: "maptiler-terrain",
        exaggeration: 1.5,
      };
    }
    return style;
  }, [isDark, maptilerKey, collection, selectedId]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const features = e.features;
      if (!features || features.length === 0) {
        // Click fuera de cualquier polígono: deseleccionar.
        onSelect(null);
        return;
      }
      const f = features[0];
      const id = f.properties?.id as string | undefined;
      if (!id) {
        onSelect(null);
        return;
      }
      onSelect(id);
      // FlyTo al centroide del polígono. Usamos el bbox del feature si está
      // disponible, sino caemos al click point.
      mapRef.current?.flyTo({
        center: e.lngLat,
        zoom: 13.5,
        pitch: maptilerKey ? 55 : 35,
        bearing: 0,
        duration: 1500,
      });
    },
    [onSelect, maptilerKey],
  );

  // Initial pitch — más agresivo si tenemos terrain (45°), conservador si no
  // (25°). Sin terrain un pitch alto se ve "raro" porque no hay relieve.
  const initialPitch = maptilerKey ? 45 : 25;

  return (
    <div
      className="overflow-hidden rounded-lg border border-neutral-border dark:border-dk-border"
      style={{ height: 600, width: "100%" }}
    >
      <Map
        ref={(r) => {
          mapRef.current = r;
        }}
        initialViewState={{
          longitude: -55.9,
          latitude: -27.4,
          zoom: 11.2,
          pitch: initialPitch,
          bearing: -10,
        }}
        mapStyle={mapStyle as unknown as string}
        attributionControl
        interactiveLayerIds={collection ? ["polys-3d"] : []}
        onClick={handleClick}
        maxPitch={maptilerKey ? 75 : 45}
        // Terrain layer requiere `maxZoom` razonable; lo limitamos a 16 para
        // no pegarle a tiles que no existen y evitar el flicker en zoom muy
        // alto.
        maxZoom={16}
      />
    </div>
  );
}
