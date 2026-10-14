// OG image específica de /pronostico/riesgos — dengue, calor, anegamiento, gentrificación.

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt =
  "Riesgos urbanos: dengue, calor, anegamiento — Observatorio Urbano Posadas";
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
            "linear-gradient(135deg, #7a2e1a 0%, #a64a2c 50%, #c97d3c 100%)",
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
            Riesgos urbanos
          </div>
          <div style={{ fontSize: 34, fontWeight: 400, opacity: 0.92 }}>
            Dengue, calor extremo, anegamiento y gentrificación por barrio
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
          <div>Sentinel-1 SAR · LST · CHIRPS · Open Buildings</div>
          <div style={{ fontWeight: 600 }}>sateliteposadas.com/pronostico/riesgos</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
