import sharp from "sharp";
import { getNinoConfig, getNinoSnapshot } from "@/lib/nino.server";
import { getNinoAhora } from "@/lib/nino-live/sources.server";
import { isActive } from "@/lib/nino-live/parse";
import { RAIN_COPY, alertHeadline, formatRain } from "@/lib/nino-presentation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Sala de situación El Niño — Posadas: alertas, lluvia medida y rayos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const TONE: Record<string, string> = { amarilla: "#f2c94c", naranja: "#f2994a", roja: "#e5484d", informativa: "#9fb3c8" };

export default async function Image() {
  const [snapshot, config] = await Promise.all([getNinoSnapshot(), getNinoConfig()]);
  const live = await getNinoAhora(1500, config.rayos_cerca_km);
  const now = Date.now();
  const age = now - Date.parse(snapshot?.generated_at ?? "");
  const fresh = Number.isFinite(age) && age >= -300_000 && age < 86_400_000;
  const alert = live.alertas.datos?.posadas.find(a => isActive(a, now)) ?? live.alertas.datos?.posadas[0];
  const headline = alert ? `${alertHeadline(alert)} (SMN)` : fresh && snapshot ? RAIN_COPY[snapshot.lluvia.nivel].title : "Pronóstico desactualizado";
  const rain24 = live.lluvia.datos?.totales.find(t => t.horas === 24);
  const lightning = live.rayos.datos;
  const lines = [
    rain24 ? `Lluvia medida en 24 h: ${formatRain(rain24.mm)} mm` : null,
    lightning ? `Rayos a menos de ${lightning.radio_km} km en la última hora: ${lightning.cerca_60min.toLocaleString("es-AR")}` : null,
    live.rio.datos ? `Río Paraná: ${live.rio.datos.altura_m.toFixed(2).replace(".", ",")} m, ${live.rio.datos.tendencia}` : null,
  ].filter((line): line is string => !!line);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#103a42"/>${alert ? `<rect x="65" y="232" width="14" height="56" rx="7" fill="${TONE[alert.color]}"/>` : ""}<g font-family="DejaVu Sans,sans-serif" fill="white"><text x="65" y="90" font-size="24">OBSERVATORIO URBANO · POSADAS</text><text x="65" y="180" font-size="54" font-weight="bold">Lluvia y tormentas, en vivo</text><text x="${alert ? 95 : 65}" y="275" font-size="36" font-weight="bold">${esc(headline)}</text>${lines.map((line, i) => `<text x="65" y="${360 + i * 50}" font-size="28">${esc(line)}</text>`).join("")}<text x="65" y="580" font-size="20">Fuentes oficiales: SMN, NOAA GOES-19, Prefectura · Emergencias: 103 · sateliteposadas.com/nino</text></g></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
