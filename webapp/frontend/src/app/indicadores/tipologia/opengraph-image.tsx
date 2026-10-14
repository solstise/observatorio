// OG image específica de /tipologia — tipología edificatoria heurística.

import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt =
  "Tipología edificatoria heurística — Observatorio Urbano Posadas";
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
            "linear-gradient(135deg, #1a3a5c 0%, #2c4f78 50%, #3d6699 100%)",
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
            Tipología edificatoria
          </div>
          <div style={{ fontSize: 34, fontWeight: 400, opacity: 0.92 }}>
            Materiales de techo y densidad volumétrica — heurística satelital
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
          <div>Chapa · teja · losa · m³ por km²</div>
          <div style={{ fontWeight: 600 }}>sateliteposadas.com/indicadores/tipologia</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
