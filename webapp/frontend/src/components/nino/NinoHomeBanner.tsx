import Link from "next/link";
import { getNinoSnapshot } from "@/lib/nino.server";
import { NIVEL } from "@/lib/nino-types";

export async function NinoHomeBanner() {
  const s = await getNinoSnapshot();
  if (!s) return null;
  const age = Date.now() - Date.parse(s.generated_at);
  if (!Number.isFinite(age) || age > 86_400_000 || age < -300_000 || !["alto", "muy_alto"].includes(s.lluvia.nivel)) return null;
  return <aside className="container-obs my-4 rounded-lg border-2 border-red-800 bg-red-50 p-4 text-red-950"><strong>Lluvia: nivel {NIVEL[s.lluvia.nivel].toLowerCase()}.</strong> <Link className="underline" href="/nino">Mirá cuándo puede llover y los datos de tu barrio</Link>. Es una estimación: consultá las alertas oficiales del SMN.</aside>;
}
