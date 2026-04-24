"use client";

// Overlay de edificios detectados (Google Open Buildings + Microsoft Building
// Footprints, mergeados por scripts/42_ms_buildings_merge.py).
//
// - Lazy load: el fetch del GeoJSON solo dispara cuando el cluster se agrega
//   efectivamente al mapa (cuando el usuario activa la capa desde el
//   LayersControl). El componente se monta siempre porque react-leaflet 4
//   no desmonta hijos al togglear el checkbox; en cambio escuchamos el evento
//   'add' del propio cluster.
// - Clustering con leaflet.markercluster (chunkedLoading) para que el render
//   de 217k puntos no congele el thread principal.
// - Diferenciación visual por fuente: g=Google, m=Microsoft, b=Both.
// - Render como L.circleMarker (mucho más liviano que L.marker con icon HTML
//   para multiplicarlo por 217k features).
// - Integración con LayersControl: registramos el cluster contra el
//   layerContainer del context (provisto por <LayersControl.Overlay>) en lugar
//   de map.addLayer directo. Así el checkbox de Leaflet maneja el toggle.
//
// Convención: el GeoJSON liviano usa properties cortas { s, a } para minimizar
// peso on-the-wire. La traducción a etiquetas legibles ocurre acá.

import { useEffect, useRef, useState } from "react";
import { useLeafletContext } from "@react-leaflet/core";

import L from "leaflet";
import "leaflet.markercluster";

// El path del GeoJSON liviano generado por scripts/48_buildings_centroids.py.
// Sirve estático desde public/data/, gzipeado por nginx en producción.
const BUILDINGS_URL = "/data/buildings_centroids.geojson";

// Colores por fuente (alineados con la paleta del proyecto).
const COLOR_BY_SOURCE: Record<string, string> = {
  g: "#1a3a5c", // Google: azul institucional.
  m: "#c97d3c", // Microsoft: naranja accent.
  b: "#5a7a9c", // Both: azul medio (overlap).
};

// Etiquetas humanas usadas en el popup.
const SOURCE_LABEL: Record<string, string> = {
  g: "Google Open Buildings",
  m: "Microsoft Buildings",
  b: "Detectado por ambas fuentes",
};

// Properties tal como vienen serializadas en el GeoJSON liviano.
interface BuildingProps {
  s: "g" | "m" | "b";
  a: number;
}

interface BuildingFeature {
  type: "Feature";
  properties: BuildingProps;
  geometry: { type: "Point"; coordinates: [number, number] };
}

interface BuildingFC {
  type: "FeatureCollection";
  features: BuildingFeature[];
}

export default function BuildingsLayer() {
  const context = useLeafletContext();
  const [loadError, setLoadError] = useState<string | null>(null);
  const dataRef = useRef<BuildingFC | null>(null);
  const populatedRef = useRef(false);

  useEffect(() => {
    if (!context?.map) return;
    const container = context.layerContainer ?? context.map;

    // Creamos el cluster vacío y lo registramos con el layerContainer del
    // <LayersControl.Overlay>. Si el overlay arranca con checked=false, el
    // cluster queda registrado en la control pero no se agrega al mapa hasta
    // que el usuario marque el checkbox.
    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 80,
      disableClusteringAtZoom: 18,
      showCoverageOnHover: false,
    });

    // Helper: arma la geo-layer una vez tenemos los datos. Idempotente: solo
    // popula la primera vez (evita reparsear si el usuario togglea on/off).
    const ensurePopulated = (fc: BuildingFC) => {
      if (populatedRef.current) return;
      const geoJsonLayer = L.geoJSON(fc as unknown as GeoJSON.GeoJsonObject, {
        pointToLayer: (feature, latlng) => {
          const props = feature.properties as BuildingProps;
          const fill = COLOR_BY_SOURCE[props.s] ?? "#888";
          return L.circleMarker(latlng, {
            radius: 3,
            fillColor: fill,
            color: "#1a2540",
            weight: 0.5,
            fillOpacity: 0.85,
          });
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties as BuildingProps;
          const label = SOURCE_LABEL[props.s] ?? "Edificio detectado";
          const area = Number.isFinite(props.a) ? props.a : 0;
          layer.bindPopup(
            `<strong>${label}</strong><br/>Área: ${area.toLocaleString("es-AR")} m²`,
          );
        },
      });
      cluster.addLayer(geoJsonLayer);
      populatedRef.current = true;
    };

    // Lazy fetch: solo cuando el cluster se agrega efectivamente al mapa.
    const controller = new AbortController();
    const handleAdd = () => {
      if (dataRef.current) {
        ensurePopulated(dataRef.current);
        return;
      }
      fetch(BUILDINGS_URL, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<BuildingFC>;
        })
        .then((fc) => {
          dataRef.current = fc;
          // Solo poblamos si el cluster sigue en el mapa (puede que el usuario
          // ya haya destildado mientras descargaba).
          if (context.map.hasLayer(cluster)) {
            ensurePopulated(fc);
          }
        })
        .catch((err: Error) => {
          if (err.name === "AbortError") return;
          // eslint-disable-next-line no-console
          console.error("BuildingsLayer: fallo cargando GeoJSON", err);
          setLoadError(err.message);
        });
    };

    cluster.on("add", handleAdd);

    // Registramos el cluster con la LayersControl. addLayer del layerContainer
    // sólo lo agrega al mapa si checked=true en el Overlay; si no, queda como
    // entrada en el panel del control.
    container.addLayer(cluster);

    return () => {
      controller.abort();
      cluster.off("add", handleAdd);
      // Nos sacamos tanto del control como del mapa.
      context.layerContainer?.removeLayer(cluster);
      context.map.removeLayer(cluster);
    };
  }, [context]);

  // No renderizamos JSX: la capa vive en el mapa Leaflet, no en el DOM React.
  // Si hubo error de carga lo mostramos como banner mínimo, no bloqueante.
  if (loadError) {
    return (
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          zIndex: 1000,
          background: "rgba(255,255,255,0.92)",
          border: "1px solid #c97d3c",
          padding: "4px 8px",
          fontSize: 12,
          borderRadius: 4,
          color: "#444",
        }}
      >
        No se pudo cargar la capa de edificios ({loadError}).
      </div>
    );
  }
  return null;
}
