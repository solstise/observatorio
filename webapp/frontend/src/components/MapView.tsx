"use client";

// Mapa interactivo con react-leaflet. Carga los poligonos GeoJSON
// coloreados por score de expansion. Click para seleccionar.
// Se usa via dynamic import con ssr:false desde page.tsx.

import { useEffect, useMemo, useRef } from "react";

import type {
  FeatureCollection,
  Feature,
  GeoJsonProperties,
  Geometry,
} from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, PathOptions } from "leaflet";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  ZoomControl,
} from "react-leaflet";

import { colorFromScore } from "@/lib/colors";
import type { PoligonoProperties, PoligonosCollection } from "@/lib/types";

import "@/styles/leaflet.css";

interface MapViewProps {
  collection: PoligonosCollection;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  center?: [number, number];
  zoom?: number;
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
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <ZoomControl position="topright" />
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
