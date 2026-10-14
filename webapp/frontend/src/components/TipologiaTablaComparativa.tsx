"use client";

// Tabla comparativa de todos los barrios para la página /tipologia (Capa 1).
//
// Columnas: nombre, verde_pct, m²/cap, altura estimada, categoría anomalía.
// El header es sortable (click toggle asc/desc). El componente es client-side
// solo para manejar el estado de orden — el render inicial server-side ya
// muestra la lista ordenada por nombre alfabético para que funcione sin JS.

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  AnomaliaRow,
  CanopyRow,
  CategoriaAnomalia,
  DensidadVolumetricaRow,
  PoligonoFeature,
} from "@/lib/types";

interface TipologiaTablaComparativaProps {
  canopy: CanopyRow[];
  densidad: DensidadVolumetricaRow[];
  anomalias: AnomaliaRow[];
  features: PoligonoFeature[];
}

interface Fila {
  poligono_id: string;
  nombre: string;
  verde_pct: number | null;
  m2_per_capita: number | null;
  altura_m: number | null;
  cat_anomalia: CategoriaAnomalia;
  z_score: number | null;
}

type SortKey =
  | "nombre"
  | "verde_pct"
  | "m2_per_capita"
  | "altura_m"
  | "cat_anomalia";
type SortDir = "asc" | "desc";

const CATEGORIA_BADGE: Record<
  CategoriaAnomalia,
  { label: string; cls: string }
> = {
  crecimiento_fuerte: {
    label: "Crecim. fuerte",
    cls: "bg-accent-100 text-accent-800 dark:bg-amber-900/60 dark:text-amber-100",
  },
  crecimiento_moderado: {
    label: "Crecim. mod.",
    cls: "bg-primary-50 text-primary dark:bg-dk-elevated dark:text-dk-primary",
  },
  estable: {
    label: "Estable",
    cls: "bg-neutral-100 text-neutral-text dark:bg-dk-border dark:text-dk-text",
  },
  "pérdida_moderada": {
    label: "Pérdida mod.",
    cls: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-100",
  },
  "pérdida_fuerte": {
    label: "Pérdida fuerte",
    cls: "bg-rose-200 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100",
  },
  sin_dato: {
    label: "s/d",
    cls: "bg-neutral-100 text-neutral-muted dark:bg-dk-border dark:text-dk-muted",
  },
};

// Orden numérico de las categorías para el sort (de "peor" a "mejor" según
// contexto urbano — pérdida fuerte y crecimiento fuerte son los extremos).
const CATEGORIA_ORDER: Record<CategoriaAnomalia, number> = {
  "pérdida_fuerte": 0,
  "pérdida_moderada": 1,
  estable: 2,
  crecimiento_moderado: 3,
  crecimiento_fuerte: 4,
  sin_dato: 5,
};

function fmtNum(n: number | null, fixed = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "s/d";
  return n.toFixed(fixed);
}

function compare(a: Fila, b: Fila, key: SortKey, dir: SortDir): number {
  const mult = dir === "asc" ? 1 : -1;
  if (key === "nombre") return a.nombre.localeCompare(b.nombre) * mult;
  if (key === "cat_anomalia") {
    return (
      (CATEGORIA_ORDER[a.cat_anomalia] - CATEGORIA_ORDER[b.cat_anomalia]) *
      mult
    );
  }
  const va = a[key];
  const vb = b[key];
  // Null al final independientemente de la dirección.
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  return (va - vb) * mult;
}

export function TipologiaTablaComparativa({
  canopy,
  densidad,
  anomalias,
  features,
}: TipologiaTablaComparativaProps) {
  const filas = useMemo<Fila[]>(() => {
    const canopyById = new Map(canopy.map((r) => [r.poligono_id, r]));
    const densById = new Map(densidad.map((r) => [r.poligono_id, r]));
    const anomById = new Map(anomalias.map((r) => [r.poligono_id, r]));
    return features.map((f) => {
      const c = canopyById.get(f.properties.id);
      const d = densById.get(f.properties.id);
      const a = anomById.get(f.properties.id);
      return {
        poligono_id: f.properties.id,
        nombre: f.properties.nombre,
        verde_pct: c?.verde_pct ?? null,
        m2_per_capita: c?.m2_per_capita ?? null,
        altura_m: d?.altura_estimada_m ?? null,
        cat_anomalia: a?.categoria ?? "sin_dato",
        z_score: a?.z_score ?? null,
      };
    });
  }, [canopy, densidad, anomalias, features]);

  const [sortKey, setSortKey] = useState<SortKey>("nombre");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(
    () => [...filas].sort((a, b) => compare(a, b, sortKey, sortDir)),
    [filas, sortKey, sortDir],
  );

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Para columnas numéricas el primer click ordena descendente
      // (típicamente queremos "los más altos primero" en métricas urbanas).
      setSortDir(key === "nombre" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey): string {
    if (key !== sortKey) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  return (
    <section
      aria-labelledby="capa1-tabla-titulo"
      className="rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface"
    >
      <header className="border-b border-neutral-border px-4 py-3 dark:border-dk-border">
        <h2
          id="capa1-tabla-titulo"
          className="text-sm font-semibold text-primary dark:text-dk-primary"
        >
          Tabla comparativa por barrio
        </h2>
        <p className="mt-0.5 text-xs text-neutral-muted dark:text-dk-muted">
          {filas.length} barrios — toca un encabezado para reordenar.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Comparativa de métricas de tipología urbana por barrio. Columnas
            ordenables: nombre, verde, m² por habitante, altura estimada y
            categoría de anomalía.
          </caption>
          <thead className="border-b border-neutral-border bg-neutral-50 text-left text-xs uppercase tracking-wider text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
            <tr>
              <SortableTh
                label="Polígono"
                k="nombre"
                active={sortKey}
                indicator={sortIndicator("nombre")}
                onClick={toggle}
                align="left"
              />
              <SortableTh
                label="Verde %"
                k="verde_pct"
                active={sortKey}
                indicator={sortIndicator("verde_pct")}
                onClick={toggle}
                align="right"
              />
              <SortableTh
                label="m² verde / hab"
                k="m2_per_capita"
                active={sortKey}
                indicator={sortIndicator("m2_per_capita")}
                onClick={toggle}
                align="right"
              />
              <SortableTh
                label="Altura est. (m)"
                k="altura_m"
                active={sortKey}
                indicator={sortIndicator("altura_m")}
                onClick={toggle}
                align="right"
              />
              <SortableTh
                label="Anomalía"
                k="cat_anomalia"
                active={sortKey}
                indicator={sortIndicator("cat_anomalia")}
                onClick={toggle}
                align="left"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => {
              const cat = CATEGORIA_BADGE[f.cat_anomalia];
              const bajoOms =
                f.m2_per_capita !== null && f.m2_per_capita < 9;
              return (
                <tr
                  key={f.poligono_id}
                  className="border-b border-neutral-border/60 last:border-0 hover:bg-neutral-50 dark:border-dk-border/60 dark:hover:bg-dk-elevated/60"
                >
                  <th
                    scope="row"
                    className="px-3 py-2 text-left font-medium text-primary dark:text-dk-primary"
                  >
                    <Link
                      href={`/poligono/${f.poligono_id}`}
                      className="hover:underline"
                    >
                      {f.nombre}
                    </Link>
                    <p className="font-mono text-[10px] font-normal text-neutral-muted dark:text-dk-muted">
                      {f.poligono_id}
                    </p>
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                    {fmtNum(f.verde_pct, 1)}
                    {f.verde_pct !== null && (
                      <span className="ml-0.5 text-[10px] text-neutral-muted">
                        %
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                    <span
                      className={
                        bajoOms
                          ? "rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                          : ""
                      }
                      title={
                        bajoOms
                          ? "Por debajo del umbral OMS de 9 m²/hab"
                          : undefined
                      }
                    >
                      {fmtNum(f.m2_per_capita, 1)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                    {fmtNum(f.altura_m, 1)}
                  </td>
                  <td className="px-3 py-2 text-left">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cat.cls}`}
                    >
                      {cat.label}
                      {f.z_score !== null && (
                        <span className="font-mono tabular-nums opacity-75">
                          z={f.z_score > 0 ? "+" : ""}
                          {f.z_score.toFixed(1)}
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface SortableThProps {
  label: string;
  k: SortKey;
  active: SortKey;
  indicator: string;
  onClick: (k: SortKey) => void;
  align: "left" | "right";
}

function SortableTh({
  label,
  k,
  active,
  indicator,
  onClick,
  align,
}: SortableThProps) {
  const isActive = k === active;
  return (
    <th
      scope="col"
      aria-sort={
        isActive
          ? indicator === "↑"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={align === "right" ? "px-3 py-2 text-right" : "px-3 py-2"}
    >
      <button
        type="button"
        onClick={() => onClick(k)}
        className={[
          "inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold uppercase tracking-wider transition-colors",
          isActive
            ? "text-primary dark:text-dk-primary"
            : "text-secondary hover:text-primary dark:text-dk-muted dark:hover:text-dk-primary",
        ].join(" ")}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[10px] opacity-80">
          {indicator}
        </span>
      </button>
    </th>
  );
}
