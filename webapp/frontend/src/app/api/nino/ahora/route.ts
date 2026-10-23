import { getNinoAhora } from "@/lib/nino-live/sources.server";
import { getNinoConfig } from "@/lib/nino.server";

// Fuentes oficiales en vivo para /nino: alertas del SMN, lluvia medida, rayos y río.
// Cada fuente tiene su propio caché en memoria; esta ruta solo arma el resumen.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = await getNinoConfig();
  const data = await getNinoAhora(8000, config.rayos_cerca_km);
  return Response.json(data, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=120" },
  });
}
