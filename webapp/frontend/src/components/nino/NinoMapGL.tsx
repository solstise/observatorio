"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, { AttributionControl, Layer, NavigationControl, Source } from "react-map-gl/maplibre";
import type { MapLayerMouseEvent, MapRef } from "react-map-gl/maplibre";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { useTheme } from "@/hooks/useTheme";
import { LIGHTNING_COLORS } from "@/lib/nino-presentation";

export type MapLayerKey = "agua" | "anegamientos" | "escurrimiento" | "rayos" | "lugares";

const STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const WATER = { light: "#bfd9e8", dark: "#1b3550" };
// Caminos del agua según el terreno (script 68) y obras de desagüe del municipio;
// la leyenda usa los mismos colores (--nino-path y --nino-works).
const WATER_PATH = { light: "#0f766e", dark: "#5eead4" };
const DRAIN_WORKS = { light: "#475569", dark: "#cbd5e1" };
const POSADAS: [number, number] = [-55.8967, -27.3667];
// Secuencia de guiones que avanza: así se ve el agua corriendo en el sentido del arroyo.
const DASHES: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];

// Círculo aproximado en lon/lat para los anillos de distancia.
function ring(km: number): Feature<Polygon> {
  const coords: number[][] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
    coords.push([POSADAS[0] + (km / (111.32 * Math.cos((POSADAS[1] * Math.PI) / 180))) * Math.sin(a), POSADAS[1] + (km / 110.57) * Math.cos(a)]);
  }
  return { type: "Feature", properties: { km }, geometry: { type: "Polygon", coordinates: [coords] } };
}

function centroid(feature: Feature): [number, number] | null {
  const g = feature.geometry;
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map(p => p[0]) : [];
  const pts = rings.flat();
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

interface Props {
  barrios: FeatureCollection;
  zones: FeatureCollection;
  facilities: FeatureCollection;
  lightning: Array<[number, number, number]>;
  // Porcentaje de lluvia que escurre (extremo alto) por barrio, según el simulador.
  runoff: Record<string, number>;
  layers: Record<MapLayerKey, boolean>;
  selectedId: string;
  userLocation: [number, number] | null;
  onSelect: (id: string) => void;
}

function NinoMapGL({ barrios, zones, facilities, lightning, runoff, layers, selectedId, userLocation, onSelect }: Props) {
  const mapRef = useRef<MapRef>(null);
  const { resolved } = useTheme();
  const theme = resolved === "dark" ? "dark" : "light";
  const [arroyos, setArroyos] = useState<FeatureCollection | null>(null);
  const [paths, setPaths] = useState<FeatureCollection | null>(null);
  const [works, setWorks] = useState<FeatureCollection | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/data/nino/arroyos_nino.geojson").then(r => (r.ok ? r.json() : null)).then(setArroyos).catch(() => setArroyos(null));
  }, []);

  // Se bajan recién cuando se prende el filtro.
  useEffect(() => {
    if (!layers.anegamientos || paths) return;
    const get = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    get("/data/nino/anegamientos_terreno.geojson").then(setPaths);
    get("/data/nino/obras_pluviales.geojson").then(setWorks);
  }, [layers.anegamientos, paths]);

  const barriosData = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: barrios.features.map(f => ({ ...f, properties: { ...f.properties, escurre: runoff[String(f.properties?.id)] ?? null } })),
  }), [barrios, runoff]);
  const labels = useMemo<FeatureCollection<Point>>(() => ({
    type: "FeatureCollection",
    features: barrios.features.flatMap(f => {
      const c = centroid(f);
      return c ? [{ type: "Feature" as const, properties: { nombre: f.properties?.nombre, id: f.properties?.id }, geometry: { type: "Point" as const, coordinates: c } }] : [];
    }),
  }), [barrios]);
  const lightningData = useMemo<FeatureCollection<Point>>(() => ({
    type: "FeatureCollection",
    features: lightning.map(([lat, lon, min]) => ({ type: "Feature" as const, properties: { min }, geometry: { type: "Point" as const, coordinates: [lon, lat] } })),
  }), [lightning]);
  const rings = useMemo<FeatureCollection>(() => ({ type: "FeatureCollection", features: [ring(15), ring(30)] }), []);

  const recolorBase = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (map.getLayer("water")) map.setPaintProperty("water", "fill-color", WATER[theme]);
    // En el celular la atribución arranca desplegada y tapa el mapa: se deja el botón (i).
    map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    setLoaded(true);
  }, [theme]);

  // Agua corriendo por los arroyos (se detiene con "reducir movimiento" o capa oculta).
  useEffect(() => {
    if (!loaded || !layers.agua || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let step = 0;
    const timer = window.setInterval(() => {
      // El mapa se vuelve a montar al cambiar de tema: se busca el vigente en cada paso.
      const map = mapRef.current?.getMap();
      if (document.hidden || !map || !map.isStyleLoaded() || !map.getLayer("arroyos-flujo")) return;
      step = (step + 1) % DASHES.length;
      map.setPaintProperty("arroyos-flujo", "line-dasharray", DASHES[step]);
    }, 90);
    return () => window.clearInterval(timer);
  }, [loaded, layers.agua, arroyos]);

  // Nuevo tema = mapa nuevo: esperar a que cargue antes de animar o mover.
  useEffect(() => () => setLoaded(false), [theme]);

  // Al prender los rayos, alejar para ver los anillos de 15 y 30 km.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map && loaded && layers.rayos) map.flyTo({ center: POSADAS, zoom: window.innerWidth < 640 ? 8.6 : 9.2, duration: 900 });
  }, [layers.rayos, loaded]);

  // Acercar al barrio elegido.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !selectedId) return;
    const feature = barrios.features.find(f => f.properties?.id === selectedId);
    const c = feature && centroid(feature);
    if (c) map.flyTo({ center: c, zoom: 14, duration: 900 });
  }, [selectedId, barrios]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (map && userLocation) map.flyTo({ center: [userLocation[1], userLocation[0]], zoom: 14.5, duration: 900 });
  }, [userLocation]);

  const onClick = (event: MapLayerMouseEvent) => {
    const id = event.features?.find(f => f.layer.id === "barrios-hit")?.properties?.id;
    if (id) onSelect(String(id));
  };

  return <Map
    ref={mapRef}
    key={theme}
    initialViewState={{ longitude: -55.93, latitude: -27.405, zoom: typeof window !== "undefined" && window.innerWidth < 640 ? 11 : 11.6 }}
    mapStyle={STYLE[theme]}
    style={{ width: "100%", height: "var(--nino-map-height)" }}
    cooperativeGestures
    interactiveLayerIds={["barrios-hit"]}
    onClick={onClick}
    onLoad={recolorBase}
    attributionControl={false}
    locale={{ "CooperativeGesturesHandler.WindowsHelpText": "Usá Ctrl + rueda para acercar el mapa", "CooperativeGesturesHandler.MacHelpText": "Usá ⌘ + rueda para acercar el mapa", "CooperativeGesturesHandler.MobileHelpText": "Usá dos dedos para mover el mapa" }}
  >
    <NavigationControl position="top-right" showCompass={false} />
    <AttributionControl compact />
    {layers.escurrimiento && <Source id="barrios-escurre" type="geojson" data={barriosData}>
      <Layer id="barrios-escurre-fill" type="fill" paint={{ "fill-color": ["interpolate", ["linear"], ["coalesce", ["get", "escurre"], 0], 0, "#e3f0f7", 25, "#9fcbe3", 50, "#4f97c4", 75, "#1f5f94", 100, "#0b2f57"], "fill-opacity": 0.72 }} />
    </Source>}
    {layers.agua && zones.features.length > 0 && <Source id="zonas" type="geojson" data={zones}>
      <Layer id="zonas-fill" type="fill" paint={{ "fill-color": "#3a9bd1", "fill-opacity": theme === "dark" ? 0.35 : 0.28 }} />
    </Source>}
    <Source id="barrios" type="geojson" data={barriosData}>
      <Layer id="barrios-hit" type="fill" paint={{ "fill-color": "#000", "fill-opacity": 0 }} />
      <Layer id="barrios-line" type="line" paint={{ "line-color": theme === "dark" ? "#8aa0bf" : "#5b6b82", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 15, 1.2], "line-opacity": 0.6 }} />
      <Layer id="barrios-selected" type="line" filter={["==", ["get", "id"], selectedId || "__none__"]} paint={{ "line-color": theme === "dark" ? "#ffd166" : "#0b2f57", "line-width": 3 }} />
    </Source>
    {layers.agua && arroyos && <Source id="arroyos" type="geojson" data={arroyos}>
      <Layer id="arroyos-base" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": "#2f86c0", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 3.5], "line-opacity": 0.55 }} />
      <Layer id="arroyos-flujo" type="line" layout={{ "line-cap": "butt", "line-join": "round" }} paint={{ "line-color": theme === "dark" ? "#bfe6ff" : "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.8, 15, 2.2], "line-dasharray": DASHES[0] }} />
      <Layer id="arroyos-nombre" type="symbol" minzoom={13} layout={{ "symbol-placement": "line", "text-field": ["get", "nombre"], "text-font": ["Noto Sans Italic"], "text-size": 12 }} paint={{ "text-color": "#1f6fa3", "text-halo-color": theme === "dark" ? "#0e1320" : "#ffffff", "text-halo-width": 1.5 }} />
    </Source>}
    {layers.anegamientos && paths && <Source id="caminos" type="geojson" data={paths}>
      <Layer id="caminos-line" type="line" filter={["==", ["get", "sobre_arroyo"], false]} layout={{ "line-cap": "round", "line-join": "round" }} paint={{
        "line-color": WATER_PATH[theme],
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, ["match", ["get", "clase"], "grande", 2.6, "medio", 1.8, 1], 15, ["match", ["get", "clase"], "grande", 6, "medio", 4.5, 3]],
        "line-opacity": 0.9,
      }} />
    </Source>}
    {layers.anegamientos && works && <Source id="obras" type="geojson" data={works}>
      <Layer id="obras-line" type="line" filter={["==", ["geometry-type"], "LineString"]} paint={{ "line-color": DRAIN_WORKS[theme], "line-width": 2, "line-dasharray": [1, 1] }} />
      <Layer id="obras-punto" type="circle" filter={["==", ["geometry-type"], "Point"]} paint={{ "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2, 15, 4.5], "circle-color": DRAIN_WORKS[theme], "circle-stroke-color": theme === "dark" ? "#0e1320" : "#ffffff", "circle-stroke-width": 1 }} />
    </Source>}
    {layers.lugares && <Source id="lugares" type="geojson" data={facilities}>
      <Layer id="lugares-punto" type="circle" minzoom={12} paint={{ "circle-radius": 4, "circle-color": "#6d4c9f", "circle-stroke-color": "#fff", "circle-stroke-width": 1 }} />
      <Layer id="lugares-nombre" type="symbol" minzoom={14.5} layout={{ "text-field": ["get", "nombre"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1], "text-anchor": "top" }} paint={{ "text-color": "#4a3270", "text-halo-color": "#fff", "text-halo-width": 1.2 }} />
    </Source>}
    {layers.rayos && <>
      <Source id="anillos" type="geojson" data={rings}>
        <Layer id="anillos-line" type="line" paint={{ "line-color": "#c2410c", "line-width": 1, "line-dasharray": [2, 3], "line-opacity": 0.6 }} />
      </Source>
      <Source id="rayos" type="geojson" data={lightningData}>
        <Layer id="rayos-punto" type="circle" paint={{
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 13, 5],
          "circle-color": ["step", ["get", "min"], LIGHTNING_COLORS[0][1], LIGHTNING_COLORS[0][0] + 0.5, LIGHTNING_COLORS[1][1], LIGHTNING_COLORS[1][0] + 0.5, LIGHTNING_COLORS[2][1]],
          "circle-stroke-color": "#ffffff", "circle-stroke-width": 1, "circle-opacity": 0.9,
        }} />
      </Source>
    </>}
    <Source id="etiquetas" type="geojson" data={labels}>
      <Layer id="barrios-nombre" type="symbol" minzoom={12.4} layout={{ "text-field": ["get", "nombre"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 12.4, 10, 15, 13], "text-max-width": 8, "text-allow-overlap": false }} paint={{ "text-color": theme === "dark" ? "#dfe7f2" : "#26364d", "text-halo-color": theme === "dark" ? "#0e1320" : "#ffffff", "text-halo-width": 1.6 }} />
    </Source>
    {userLocation && <Source id="yo" type="geojson" data={{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [userLocation[1], userLocation[0]] } }}>
      <Layer id="yo-halo" type="circle" paint={{ "circle-radius": 14, "circle-color": "#2563eb", "circle-opacity": 0.18 }} />
      <Layer id="yo-punto" type="circle" paint={{ "circle-radius": 6, "circle-color": "#2563eb", "circle-stroke-color": "#fff", "circle-stroke-width": 2 }} />
    </Source>}
  </Map>;
}

export default memo(NinoMapGL);
