"use client";

// Mapa interactivo con react-leaflet. Carga los poligonos GeoJSON
// coloreados por score de expansion. Click para seleccionar.
// Se usa via dynamic import con ssr:false desde page.tsx.
//
// Overlays adicionales (toggleables via LayersControl):
//   - Catastro IDE Posadas (WMS publico del GeoServer municipal).
//   - Relieve Copernicus GLO-30 (hillshade PNG generado por
//     scripts/46_generar_dem_posadas.py).
//   - Poligonos observatorio (capa base siempre visible).
//
// Atribucion: OpenStreetMap, Copernicus DEM y Municipalidad de Posadas
// deben aparecer en el control de atribucion del mapa.

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  FeatureCollection,
  Feature,
  GeoJsonProperties,
  Geometry,
} from "geojson";
import type {
  LatLngBoundsExpression,
  GeoJSON as LeafletGeoJSON,
  Layer,
  PathOptions,
} from "leaflet";
import {
  GeoJSON,
  ImageOverlay,
  LayersControl,
  MapContainer,
  TileLayer,
  WMSTileLayer,
  ZoomControl,
} from "react-leaflet";

import { colorFromScore } from "@/lib/colors";
import type { PoligonoProperties, PoligonosCollection } from "@/lib/types";

import BuildingsLayer from "./BuildingsLayer";

import "@/styles/leaflet.css";
// CSS del clustering de leaflet.markercluster — necesarios para que los iconos
// de cluster (los círculos con el conteo) se rendericen con estilo correcto.
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

interface MapViewProps {
  collection: PoligonosCollection;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  center?: [number, number];
  zoom?: number;
}

// --- Configuracion de overlays externos -------------------------------------

// WMS publico de la IDE Posadas (GeoNode sobre GeoServer).
// Las capas se eligieron cubriendo catastro, trama urbana, red vial y barrios
// de las categorias Catastro, Movilidad y Limites del catalogo oficial.
const IDE_POSADAS_WMS = "https://www.ide.posadas.gob.ar/geoserver/ows";
const IDE_POSADAS_ATTRIBUTION =
  '&copy; <a href="https://www.ide.posadas.gob.ar/" target="_blank" rel="noopener noreferrer">Municipalidad de Posadas / IDE Posadas</a>';

// Identificadores exactos del catalogo GeoNode (alternate names). Verificado
// en https://www.ide.posadas.gob.ar/ (abril 2026).
const IDE_LAYERS = {
  trama_urbana: "geonode:trama_urbana_20260", // manzanas del ejido
  chacras: "geonode:chacras_poligonos0", // chacras (trama damero)
  calles: "geonode:calles_Posadas1", // red vial completa
  delegaciones: "geonode:DELEGACIONES_MUNICIPALES_POSADAS_20250", // barrios / delegaciones
  maestro_publico: "geonode:maestro_publico", // indicadores urbanos publicos (parcelas)
} as const;

// Path al hillshade generado por el pipeline. En dev y en prod lo servimos
// desde public/data/media, por eso la URL empieza con /.
const HILLSHADE_PNG_URL = "/data/media/hillshade_posadas.png";
const HILLSHADE_BOUNDS_URL = "/data/media/hillshade_posadas.json";
const HILLSHADE_ATTRIBUTION =
  '&copy; <a href="https://spacedata.copernicus.eu/" target="_blank" rel="noopener noreferrer">Copernicus DEM GLO-30</a>';

// Bounds fallback del hillshade — coinciden con el bbox de config/settings.yaml
// (norte=-27.30, sur=-27.50, este=-55.80, oeste=-56.00). Se usan si el fetch
// del sidecar falla, para que el overlay igual se posicione aproximadamente.
const HILLSHADE_BOUNDS_FALLBACK: LatLngBoundsExpression = [
  [-27.5, -56.0],
  [-27.3, -55.8],
];

interface HillshadeSidecar {
  bounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
}

export default function MapView({
  collection,
  selectedId,
  onSelect,
  center = [-27.3935, -55.9388],
  zoom = 12,
}: MapViewProps) {
  const geoJsonRef = useRef<LeafletGeoJSON | null>(null);

  const data = useMemo<FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: collection.features as unknown as Feature<
        Geometry,
        GeoJsonProperties
      >[],
    }),
    [collection],
  );

  // Bounds del hillshade: los leemos del sidecar JSON una vez al montar.
  // Si falla, caemos al fallback hardcodeado.
  const [hillshadeBounds, setHillshadeBounds] = useState<LatLngBoundsExpression>(
    HILLSHADE_BOUNDS_FALLBACK,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(HILLSHADE_BOUNDS_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HillshadeSidecar>;
      })
      .then((sidecar) => {
        if (cancelled) return;
        const b = sidecar.bounds;
        setHillshadeBounds([
          [b.south, b.west],
          [b.north, b.east],
        ]);
      })
      .catch(() => {
        // Usamos el fallback silenciosamente; es aceptable por el bbox fijo.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-stylear cuando cambia la seleccion.
  useEffect(() => {
    if (!geoJsonRef.current) return;
    geoJsonRef.current.eachLayer((layer) => {
      const feature = (layer as unknown as { feature?: Feature }).feature;
      if (!feature) return;
      const props = feature.properties as PoligonoProperties;
      const isSelected = props.id === selectedId;
      // @ts-expect-error - setStyle existe en capas de path Leaflet.
      layer.setStyle(styleFor(props, isSelected));
    });
  }, [selectedId]);

  function onEachFeature(feature: Feature, layer: Layer) {
    const props = feature.properties as PoligonoProperties;
    layer.bindTooltip(props.nombre, { sticky: true });
    layer.on({
      click: () => onSelect(props.id),
      keypress: (e: { originalEvent: KeyboardEvent }) => {
        if (e.originalEvent.key === "Enter") onSelect(props.id);
      },
    });
  }

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      zoomControl={false}
      style={{ height: "100%", width: "100%" }}
      attributionControl
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Edificios: &copy; <a href="https://sites.research.google/open-buildings/" target="_blank" rel="noopener noreferrer">Google Open Buildings</a> &amp; <a href="https://github.com/microsoft/GlobalMLBuildingFootprints" target="_blank" rel="noopener noreferrer">Microsoft Building Footprints</a>'
      />
      <ZoomControl position="topright" />

      <LayersControl position="topleft" collapsed>
        {/* --- Relieve (DEM) --- */}
        <LayersControl.Overlay name="Relieve Copernicus GLO-30" checked={false}>
          <ImageOverlay
            url={HILLSHADE_PNG_URL}
            bounds={hillshadeBounds}
            opacity={0.4}
            attribution={HILLSHADE_ATTRIBUTION}
          />
        </LayersControl.Overlay>

        {/* --- Catastro IDE Posadas (WMS) --- */}
        <LayersControl.Overlay
          name="Trama urbana / manzanas (IDE Posadas)"
          checked
        >
          <WMSTileLayer
            url={IDE_POSADAS_WMS}
            layers={IDE_LAYERS.trama_urbana}
            format="image/png"
            transparent
            version="1.1.1"
            opacity={0.75}
            attribution={IDE_POSADAS_ATTRIBUTION}
          />
        </LayersControl.Overlay>

        <LayersControl.Overlay
          name="Chacras / damero urbano (IDE Posadas)"
          checked={false}
        >
          <WMSTileLayer
            url={IDE_POSADAS_WMS}
            layers={IDE_LAYERS.chacras}
            format="image/png"
            transparent
            version="1.1.1"
            opacity={0.7}
            attribution={IDE_POSADAS_ATTRIBUTION}
          />
        </LayersControl.Overlay>

        <LayersControl.Overlay
          name="Calles y avenidas (IDE Posadas)"
          checked={false}
        >
          <WMSTileLayer
            url={IDE_POSADAS_WMS}
            layers={IDE_LAYERS.calles}
            format="image/png"
            transparent
            version="1.1.1"
            opacity={0.85}
            attribution={IDE_POSADAS_ATTRIBUTION}
          />
        </LayersControl.Overlay>

        <LayersControl.Overlay
          name="Delegaciones municipales / barrios (IDE Posadas)"
          checked={false}
        >
          <WMSTileLayer
            url={IDE_POSADAS_WMS}
            layers={IDE_LAYERS.delegaciones}
            format="image/png"
            transparent
            version="1.1.1"
            opacity={0.6}
            attribution={IDE_POSADAS_ATTRIBUTION}
          />
        </LayersControl.Overlay>

        <LayersControl.Overlay
          name="Parcelas publicas (IDE Posadas)"
          checked={false}
        >
          <WMSTileLayer
            url={IDE_POSADAS_WMS}
            layers={IDE_LAYERS.maestro_publico}
            format="image/png"
            transparent
            version="1.1.1"
            opacity={0.65}
            attribution={IDE_POSADAS_ATTRIBUTION}
          />
        </LayersControl.Overlay>

        {/* --- Edificios detectados (Google Open Buildings + MS Footprints) ---
            Off por default: el GeoJSON pesa ~24 MB (≈2 MB gzip) y son 217k
            puntos. Solo se descarga cuando el usuario activa la capa. */}
        <LayersControl.Overlay
          name="Edificios detectados (217k)"
          checked={false}
        >
          <BuildingsLayer />
        </LayersControl.Overlay>

        {/* --- Poligonos del observatorio (siempre visibles por default) --- */}
        <LayersControl.Overlay name="Poligonos observatorio" checked>
          <GeoJSON
            ref={geoJsonRef}
            data={data}
            style={(feature) =>
              styleFor(
                (feature?.properties as PoligonoProperties) ?? undefined,
                (feature?.properties as PoligonoProperties)?.id === selectedId,
              )
            }
            onEachFeature={onEachFeature}
          />
        </LayersControl.Overlay>
      </LayersControl>
    </MapContainer>
  );
}

function styleFor(
  props: PoligonoProperties | undefined,
  selected: boolean,
): PathOptions {
  const score = props?.score_expansion ?? 0;
  return {
    color: selected ? "#1a3a5c" : "#5a7a9c",
    weight: selected ? 3 : 1.5,
    fillColor: colorFromScore(score),
    fillOpacity: selected ? 0.75 : 0.55,
  };
}
