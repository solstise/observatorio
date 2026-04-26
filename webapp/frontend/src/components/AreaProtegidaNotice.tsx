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
      row!.nombre_ap?.trim() || "área protegida sin nombre en WDPA";
    const pct = Number.isFinite(row!.pct_area_protegida)
      ? row!.pct_area_protegida
      : 0;
    return (
      <div
        role="note"
        className="rounded-md border border-accent-200 bg-accent-50 p-3 text-sm text-primary dark:border-amber-700/60 dark:bg-amber-900/40 dark:text-amber-100"
      >
        <p>
          <span className="font-semibold">
            Este polígono se solapa con {nombre}
          </span>{" "}
          ({pct.toFixed(1)}% del área).{" "}
          <span className="text-xs text-neutral-muted dark:text-amber-200/80">
            Datos: WDPA (UNEP-WCMC).
          </span>
        </p>
      </div>
    );
  }

  // Modo card: siempre renderiza, con mensaje positivo si no hay AP.
  if (!row) {
    return (
      <div className="flex h-full min-h-[160px] flex-col items-start justify-center">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Área protegida
        </h3>
        <p className="mt-2 text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos sobre áreas protegidas para este polígono.
        </p>
      </div>
    );
  }

  if (!dentroDeAP) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
            Área protegida
          </h3>
          <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
            Indica si el polígono se solapa con un área protegida legalmente
            — crítico para política ambiental.
          </p>
        </div>
        <div className="flex items-center gap-4 rounded-md border border-neutral-border p-4 dark:border-dk-border dark:bg-dk-elevated/40">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ backgroundColor: "#6b7280" }}
            aria-hidden="true"
          >
            {"AP"}
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold text-primary dark:text-dk-primary">
              Fuera de áreas protegidas
            </span>
            <span className="text-[11px] text-neutral-muted dark:text-dk-muted">
              No intersecta ninguna área protegida del registro WDPA.{" "}
              <em>Datos: WDPA, IUCN / UNEP-WCMC.</em>
            </span>
          </div>
        </div>
      </div>
    );
  }

  const nombre = row.nombre_ap?.trim() || "área protegida sin nombre en WDPA";
  const pct = Number.isFinite(row.pct_area_protegida)
    ? row.pct_area_protegida
    : 0;
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Área protegida
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Indica si el polígono se solapa con un área protegida legalmente
          — crítico para política ambiental.
        </p>
      </div>
      <div className="flex items-center gap-4 rounded-md border border-accent-200 bg-accent-50 p-4 dark:border-amber-700/60 dark:bg-amber-900/40">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ backgroundColor: "#c97d3c" }}
          aria-hidden="true"
        >
          {"AP"}
        </div>
        <div className="flex flex-col">
          <span className="text-base font-semibold text-primary dark:text-amber-100">
            Solapa con {nombre}
          </span>
          <span className="text-[11px] text-neutral-muted dark:text-amber-200/80">
            {pct.toFixed(1)}% del polígono dentro del área protegida.{" "}
            <em>Datos: WDPA, IUCN / UNEP-WCMC.</em>
          </span>
        </div>
      </div>
    </div>
  );
}
