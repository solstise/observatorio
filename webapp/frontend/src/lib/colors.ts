// Paleta institucional del Observatorio Urbano Posadas.
// Inspirada en ONU/BID/Banco Mundial: sobria, sin rojos, alto contraste.

export const COLORS = {
  primary: "#1a3a5c",
  secondary: "#5a7a9c",
  accent: "#c97d3c",
  background: "#ffffff",
  text: "#222222",
  muted: "#6b7280",
  border: "#e5e7eb",

  // Escala para choropleth de expansion (0 = sin cambio, 1 = alta expansion).
  // Se evita el rojo deliberadamente. Usa azul-a-naranja.
  scale: [
    "#eef2f7",
    "#cbd7e4",
    "#8dabcf",
    "#5a7a9c",
    "#3d5a7d",
    "#c97d3c",
    "#a96328",
  ] as const,
} as const;

// Devuelve un color del scale segun un score 0-1.
export function colorFromScore(score: number): string {
  const clamped = Math.max(0, Math.min(1, score));
  const idx = Math.min(
    COLORS.scale.length - 1,
    Math.floor(clamped * COLORS.scale.length),
  );
  return COLORS.scale[idx];
}

// Colores semanticos por categoria de poligono.
export const CATEGORY_COLORS: Record<string, string> = {
  expansion_activa: "#c97d3c",
  emergente: "#5a7a9c",
  consolidado: "#1a3a5c",
  desconocido: "#9ca3af",
};
