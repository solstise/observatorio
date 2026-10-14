"use client";

import { useEffect, useState } from "react";

export function ForecastSafety({ generatedAt }: { generatedAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const ts = Date.parse(generatedAt);
  const expired = !Number.isFinite(ts) || now === null || now - ts > 86_400_000 || ts - now > 300_000;
  if (!expired) return null;
  const date = Number.isFinite(ts) ? new Date(ts).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "a verificar";
  return <div role="alert" className="my-4 rounded-lg border-2 border-red-700 bg-red-50 p-4 font-semibold text-red-900 dark:bg-red-950 dark:text-red-100">
    Datos de pronóstico desactualizados (última actualización: {date}). No usar para decisiones.
  </div>;
}
