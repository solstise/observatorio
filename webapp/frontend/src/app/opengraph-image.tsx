// OG image dinámica para la home (/).
// Se genera con next/og (ImageResponse) en build/runtime — no requiere
// PNG estático en /public.
//
// Docs: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
//
// Diseño:
// - 1200×630 (estándar OG / Twitter summary_large_image)
// - Fondo gradient institucional #1a3a5c → #2a5780
// - Tipografía Inter del sistema (next/og resuelve fallback automáticamente)
// - Esquina inferior con dominio canónico
//
// Esta imagen se sirve en /opengraph-image y se referencia automáticamente
// como og:image y twitter:image desde el layout.

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Observatorio Urbano Posadas — 43 barrios, datos satelitales, calor urbano";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #1a3a5c 0%, #2a5780 60%, #3a6ea3 100%)",
          color: "#ffffff",
          fontFamily: "Inter, sans-serif",
        }}
      >
        {/* Esquina superior: marca / etiqueta */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            opacity: 0.92,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: "rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              fontWeight: 700,
            }}
          >
            OP
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Observatorio Urbano
          </div>
        </div>

        {/* Centro: título + subtítulo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Cómo crece Posadas
          </div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 400,
              lineHeight: 1.25,
              opacity: 0.9,
              maxWidth: 980,
            }}
          >
            43 barrios · datos satelitales · pronóstico de calor
          </div>
        </div>

        {/* Pie: dominio + fuentes */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            opacity: 0.85,
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 500 }}>
            Sentinel-2 · Open Buildings · WorldPop · CHIRPS
          </div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            observatorio.sistemaswinter.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
