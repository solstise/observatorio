// OG image dinámica por polígono (/poligono/[id]).
// Genera una preview personalizada con nombre del barrio + categoría +
// área km² + población estimada cuando alguien comparte el link en
// redes sociales.
//
// Docs: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
//
// IMPORTANTE: usamos runtime nodejs (no edge) porque getPoligonoFeature
// lee del filesystem con node:fs, lo que no está disponible en edge.

import { ImageResponse } from "next/og";

import { getPoligonoFeature } from "@/lib/data.server";

export const runtime = "nodejs";

export const alt = "Ficha del polígono — Observatorio Urbano Posadas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

interface ImageProps {
  params: { id: string };
}

// Mapeo de categorías a etiquetas legibles + colores de acento.
// Mantiene paleta institucional pero diferencia visualmente cada estado.
const CATEGORIA_META: Record<string, { label: string; accent: string }> = {
  expansion_activa: { label: "Expansión activa", accent: "#f59e0b" },
  emergente: { label: "Emergente", accent: "#06b6d4" },
  consolidado: { label: "Consolidado", accent: "#10b981" },
  desconocido: { label: "En estudio", accent: "#94a3b8" },
};

export default async function Image({ params }: ImageProps) {
  const feature = await getPoligonoFeature(params.id);

  const nombre = feature?.properties.nombre ?? "Polígono";
  const categoria = feature?.properties.categoria ?? "desconocido";
  const meta = CATEGORIA_META[categoria] ?? CATEGORIA_META.desconocido;
  const superficie = feature?.properties.superficie_km2 ?? 0;
  const poblacion = feature?.properties.poblacion_estimada ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          background:
            "linear-gradient(135deg, #1a3a5c 0%, #2a5780 60%, #3a6ea3 100%)",
          color: "#ffffff",
          fontFamily: "Inter, sans-serif",
        }}
      >
        {/* Header: marca + categoría chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              opacity: 0.85,
            }}
          >
            Observatorio Urbano · Posadas
          </div>
          <div
            style={{
              padding: "10px 22px",
              background: meta.accent,
              borderRadius: 999,
              fontSize: 22,
              fontWeight: 700,
              color: "#0b1f33",
            }}
          >
            {meta.label}
          </div>
        </div>

        {/* Centro: nombre del polígono */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: nombre.length > 24 ? 76 : 92,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
              maxWidth: 1040,
            }}
          >
            {nombre}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 400,
              opacity: 0.85,
            }}
          >
            Ficha del barrio · datos satelitales 2018–2026
          </div>
        </div>

        {/* Métricas: área + población */}
        <div
          style={{
            display: "flex",
            gap: 64,
            alignItems: "flex-end",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                opacity: 0.7,
              }}
            >
              Superficie
            </div>
            <div style={{ fontSize: 48, fontWeight: 700 }}>
              {superficie.toFixed(1)} km²
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                opacity: 0.7,
              }}
            >
              Población estimada
            </div>
            <div style={{ fontSize: 48, fontWeight: 700 }}>
              {poblacion ? poblacion.toLocaleString("es-AR") : "s/d"}
            </div>
          </div>

          <div
            style={{
              marginLeft: "auto",
              fontSize: 22,
              fontWeight: 600,
              opacity: 0.85,
            }}
          >
            observatorio.sistemaswinter.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
