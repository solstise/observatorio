"use client";

// Aviso de interseccion con area protegida (WDPA, UNEP-WCMC).
//
// Soporta dos modos via la prop `variant`:
//
//   - "banner" (default): banner sutil en la parte superior de la
//     ficha. Renderiza null si el poligono NO intersecta (como en
//     todos los casos urbanos actuales de Posadas).
//   - "card": tarjeta de la grilla ambiental que siempre renderiza
//     algo, mostrando el estado positivo ("Fuera de area protegida")
//     cuando no hay interseccion.
//
// El CSV trae `intersecta_ap` como boolean o como string "True"/"False"
// segun como haya pasado papaparse/dynamicTyping, asi que se normaliza
// aceptando ambas formas.

import type { WdpaRow } from "@/lib/types";

interface AreaProtegidaNoticeProps {
  rows: WdpaRow[];
  variant?: "banner" | "card";
}

// Normaliza el valor que viene del CSV. papaparse con dynamicTyping
// puede devolver true/false nativo, pero si el CSV trae "True"/"False"
// capitalizado de Python los deja como string. Soportamos ambos.
function intersecta(raw: boolean | string | null | undefined): boolean {
  if (raw == null) return false;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  return s === "true" || s === "1" || s === "si" || s === "sí";
}

export function AreaProtegidaNotice({
  rows,
  variant = "banner",
}: AreaProtegidaNoticeProps) {
  const row = rows[0];
  const dentroDeAP = row ? intersecta(row.intersecta_ap) : false;

  // Modo banner: solo renderiza si hay interseccion positiva.
  if (variant === "banner") {
    if (!dentroDeAP) return null;
    const nombre =
      row!.nombre_ap?.trim() || "area protegida sin nombre en WDPA";
    const pct = Number.isFinite(row!.pct_area_protegida)
      ? row!.pct_area_protegida
      : 0;
    return (
      <div
        role="note"
        className="rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-primary"
      >
        <p>
          <span className="font-semibold">Intersecta con {nombre}</span> (
          {pct.toFixed(1)}% del poligono). Fuente: WDPA, UNEP-WCMC.
        </p>
      </div>
    );
  }

  // Modo card: siempre renderiza, con mensaje positivo si no hay AP.
  if (!row) {
    return (
      <div className="flex h-full min-h-[160px] flex-col items-start justify-center">
        <h3 className="text-sm font-semibold text-primary">Area protegida</h3>
        <p className="mt-2 text-sm italic text-neutral-muted">
          WDPA sin datos para este poligono.
        </p>
      </div>
    );
  }

  if (!dentroDeAP) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-primary">Area protegida</h3>
        <div className="flex items-center gap-4 rounded-md border border-neutral-border p-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: "#6b7280" }}
            aria-hidden="true"
          >
            {"AP"}
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold text-primary">
              Fuera de area protegida
            </span>
            <span className="text-[11px] text-neutral-muted">
              El poligono no intersecta ningun registro del WDPA.
            </span>
          </div>
        </div>
      </div>
    );
  }

  const nombre = row.nombre_ap?.trim() || "area protegida sin nombre en WDPA";
  const pct = Number.isFinite(row.pct_area_protegida)
    ? row.pct_area_protegida
    : 0;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-primary">Area protegida</h3>
      <div className="flex items-center gap-4 rounded-md border border-accent-200 bg-accent-50 p-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: "#c97d3c" }}
          aria-hidden="true"
        >
          {"AP"}
        </div>
        <div className="flex flex-col">
          <span className="text-base font-semibold text-primary">
            Intersecta {nombre}
          </span>
          <span className="text-[11px] text-neutral-muted">
            {pct.toFixed(1)}% del poligono dentro de area protegida. Fuente:
            WDPA, UNEP-WCMC.
          </span>
        </div>
      </div>
    </div>
  );
}
