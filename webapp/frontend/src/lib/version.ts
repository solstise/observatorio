// Constantes de version para el footer.
// En produccion, preferir las variables de entorno NEXT_PUBLIC_VERSION y
// NEXT_PUBLIC_UPDATED_AT inyectadas por el pipeline de build.

export const VERSION = process.env.NEXT_PUBLIC_VERSION || "0.1.0-fase2";
export const UPDATED_AT_FALLBACK =
  process.env.NEXT_PUBLIC_UPDATED_AT || "2026-04-22";

export const SOURCES = [
  "Sentinel-2 (ESA)",
  "Planet NICFI",
  "Google Open Buildings",
  "WorldPop",
  "OpenStreetMap",
] as const;

export const LICENSES = {
  datos: "CC BY 4.0",
  codigo: "MIT",
} as const;
