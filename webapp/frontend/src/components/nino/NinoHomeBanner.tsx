import Link from "next/link";
import { getNinoConfig, getNinoSnapshot } from "@/lib/nino.server";
import { getNinoAhora } from "@/lib/nino-live/sources.server";
import { isActive } from "@/lib/nino-live/parse";
import { NIVEL } from "@/lib/nino-types";
import { alertHeadline } from "@/lib/nino-presentation";

// Aviso en la home: primero la alerta oficial del SMN para Posadas; si no hay,
// el nivel alto o muy alto de la estimación propia vigente.
export async function NinoHomeBanner() {
  const [snapshot, config] = await Promise.all([getNinoSnapshot(), getNinoConfig()]);
  const live = await getNinoAhora(800, config.rayos_cerca_km);
  const now = Date.now();
  const official = live.alertas.datos?.posadas.find(alert => isActive(alert, now));
  if (official) {
    return <aside className="container-obs my-4 rounded-lg border-2 border-amber-700 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-50"><strong>{alertHeadline(official)} para Posadas (SMN).</strong> <Link className="underline" href="/nino">Mirá la lluvia medida, los rayos cerca y el pronóstico</Link>.</aside>;
  }
  if (!snapshot) return null;
  const age = now - Date.parse(snapshot.generated_at);
  if (!Number.isFinite(age) || age > 86_400_000 || age < -300_000 || !["alto", "muy_alto"].includes(snapshot.lluvia.nivel)) return null;
  return <aside className="container-obs my-4 rounded-lg border-2 border-red-800 bg-red-50 p-4 text-red-950"><strong>Lluvia: nivel {NIVEL[snapshot.lluvia.nivel].toLowerCase()}.</strong> <Link className="underline" href="/nino">Mirá cuándo puede llover y los datos de tu barrio</Link>. Es una estimación: consultá las alertas oficiales del SMN.</aside>;
}
