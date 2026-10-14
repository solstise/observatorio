// Chip de categoría de riesgo — "bajo" | "medio" | "alto" | "muy_alto".
//
// Reutilizable en cards de Capa 2 (Dengue, Calor, Anegamiento) y en la
// tabla comparativa de /riesgos. Colores hardcodeados según convención
// del observatorio (ver CLAUDE.md de la capa Riesgos):
//   bajo     → verde  #16a34a
//   medio    → amarillo #facc15 (texto oscuro por contraste)
//   alto     → naranja #ea580c
//   muy_alto → rojo  #dc2626
//
// Pure SSR component. No "use client".

import type { CategoriaRiesgo } from "@/lib/types";

interface Props {
  categoria: CategoriaRiesgo | null | undefined;
  /** Visual size — "sm" para tablas/listas, "md" para titulares de card. */
  size?: "sm" | "md";
  className?: string;
}

const ESTILO: Record<
  CategoriaRiesgo,
  { bg: string; fg: string; label: string }
> = {
  bajo: { bg: "#16a34a", fg: "#ffffff", label: "Bajo" },
  medio: { bg: "#facc15", fg: "#1f2937", label: "Medio" },
  alto: { bg: "#ea580c", fg: "#ffffff", label: "Alto" },
  muy_alto: { bg: "#dc2626", fg: "#ffffff", label: "Muy alto" },
};

export function RiesgoBadge({ categoria, size = "sm", className = "" }: Props) {
  if (!categoria || !(categoria in ESTILO)) {
    return (
      <span
        className={[
          "inline-flex items-center rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-muted dark:bg-dk-elevated dark:text-dk-muted",
          className,
        ].join(" ")}
      >
        s/d
      </span>
    );
  }
  const { bg, fg, label } = ESTILO[categoria];
  const sizeCls =
    size === "md"
      ? "px-2.5 py-1 text-xs"
      : "px-2 py-0.5 text-[10px]";
  return (
    <span
      className={[
        "inline-flex items-center rounded-full font-semibold uppercase tracking-wider",
        sizeCls,
        className,
      ].join(" ")}
      style={{ backgroundColor: bg, color: fg }}
      aria-label={`Categoría de riesgo ${label.toLowerCase()}`}
    >
      {label}
    </span>
  );
}

export default RiesgoBadge;
