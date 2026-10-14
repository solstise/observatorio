// OG image específica de /calidad-vida — composite habitabilidad / ciudad 15 min.

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt =
  "Calidad de vida urbana: habitabilidad, verde y acceso — Observatorio Urbano Posadas";
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
            "linear-gradient(135deg, #1f4d3a 0%, #2f6b54 50%, #3f8a6e 100%)",
          color: "#ffffff",
          fontFamily: "Inter, sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            opacity: 0.92,
          }}
        >
          Observatorio Urbano · Posadas
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              fontSize: 92,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Calidad de vida
          </div>
          <div style={{ fontSize: 34, fontWeight: 400, opacity: 0.92 }}>
            Habitabilidad, ciudad 15 min, equidad verde y resiliencia climática
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 22,
            opacity: 0.85,
          }}
        >
          <div>UHI · canopy · NO₂ · acceso · Gini espacial</div>
          <div style={{ fontWeight: 600 }}>sateliteposadas.com/indicadores/calidad-vida</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
