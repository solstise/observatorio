// OG image específica de /clima — pronóstico climático por barrio.

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Pronóstico climático por barrio — Observatorio Urbano Posadas";
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
            "linear-gradient(135deg, #0c4a6e 0%, #0e7490 50%, #06b6d4 100%)",
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
            opacity: 0.9,
          }}
        >
          Observatorio Urbano · Posadas
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Clima por barrio
          </div>
          <div style={{ fontSize: 36, fontWeight: 400, opacity: 0.92 }}>
            Pronóstico de temperatura, lluvia y alertas hasta 7 días
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
          <div>Open-Meteo · CHIRPS · ERA5</div>
          <div style={{ fontWeight: 600 }}>
            observatorio.sistemaswinter.com/clima
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
