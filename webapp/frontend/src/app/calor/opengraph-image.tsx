// OG image específica de /calor — calor urbano y UHI.

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Calor urbano e isla de calor — Observatorio Urbano Posadas";
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
            "linear-gradient(135deg, #7c2d12 0%, #c2410c 50%, #ea580c 100%)",
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
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Calor urbano
          </div>
          <div style={{ fontSize: 36, fontWeight: 400, opacity: 0.95 }}>
            Isla de calor por barrio · Landsat LST · MODIS
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 22,
            opacity: 0.9,
          }}
        >
          <div>Temperatura superficial · 2014–2026</div>
          <div style={{ fontWeight: 600 }}>
            observatorio.sistemaswinter.com/calor
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
