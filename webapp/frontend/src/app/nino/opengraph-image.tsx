import sharp from "sharp";
import { getNinoSnapshot } from "@/lib/nino.server";
import { RAIN_COPY } from "@/lib/nino-presentation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Sala de situación El Niño — Posadas: lluvia y exposición hídrica";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

export default async function Image() {
  const snapshot = await getNinoSnapshot();
  const age = Date.now() - Date.parse(snapshot?.generated_at ?? "");
  const fresh = Number.isFinite(age) && age >= -300_000 && age < 86_400_000;
  const top = [...(snapshot?.barrios ?? [])].filter(r => r.pct_viviendas_expuestas != null).sort((a, b) => b.viviendas_expuestas - a.viviendas_expuestas).slice(0, 3);
  const level = fresh && snapshot ? RAIN_COPY[snapshot.lluvia.nivel].title : "Pronóstico desactualizado";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#103a42"/><g font-family="DejaVu Sans,sans-serif" fill="white"><text x="65" y="90" font-size="24">OBSERVATORIO URBANO · POSADAS</text><text x="65" y="200" font-size="56" font-weight="bold">Sala de situación El Niño</text><text x="65" y="275" font-size="34">${esc(level)}</text><text x="65" y="350" font-size="23">Edificios en zonas expuestas · no indica inundación actual</text>${top.map((r, i) => `<text x="65" y="${395 + i * 43}" font-size="26">${esc(r.nombre)}: ${r.viviendas_expuestas}</text>`).join("")}<text x="65" y="580" font-size="20">No emite alertas oficiales · Emergencias: 103 · sateliteposadas.com/nino</text></g></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
