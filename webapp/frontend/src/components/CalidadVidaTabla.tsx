"use client";

// Tabla comparativa side-by-side de todos los scores de Capa 3 por barrio.
// Sortable client-side, sin paginación porque típicamente son ~40 barrios.
// Cada fila linkea a /poligono/{id}.

import Link from "next/link";
import { useMemo, useState } from "react";

interface FilaCalidad {
  poligono_id: string;
  nombre: string;
  score_habitabilidad: number | null;
  score_15min: number | null;
  m2_per_capita: number | null;
  score_resiliencia: number | null;
  score_gentrificacion: number | null;
}

type SortKey =
  | "nombre"
  | "score_habitabilidad"
  | "score_15min"
  | "m2_per_capita"
  | "score_resiliencia"
  | "score_gentrificacion";

type SortDir = "asc" | "desc";

interface Props {
  filas: FilaCalidad[];
}

function fmt(n: number | null, decimals = 0): string {
  if (n === null || !Number.isFinite(n)) return "s/d";
  return n.toFixed(decimals);
}

// Devuelve un comparador. Para la columna "nombre" usamos string compare,
// para el resto comparamos numéricamente y empujamos los nulls al final
// (independiente del sort dir — un null nunca debería robarle el podio a
// un valor real).
function compararFilas(
  a: FilaCalidad,
  b: FilaCalidad,
  key: SortKey,
  dir: SortDir,
): number {
  if (key === "nombre") {
    return dir === "asc"
      ? a.nombre.localeCompare(b.nombre, "es")
      : b.nombre.localeCompare(a.nombre, "es");
  }
  const va = a[key];
  const vb = b[key];
  const aMissing = va === null || !Number.isFinite(va);
  const bMissing = vb === null || !Number.isFinite(vb);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return dir === "asc"
    ? (va as number) - (vb as number)
    : (vb as number) - (va as number);
}

export function CalidadVidaTabla({ filas }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("score_habitabilidad");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const ordenadas = useMemo(() => {
    const copia = [...filas];
    copia.sort((a, b) => compararFilas(a, b, sortKey, sortDir));
    return copia;
  }, [filas, sortKey, sortDir]);

  const toggle = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      // Para la columna nombre arrancamos asc (A-Z), para scores arrancamos
      // desc (mejor arriba). Es lo que el usuario espera al hacer click.
      setSortDir(k === "nombre" ? "asc" : "desc");
    }
  };

  const columnas: { key: SortKey; label: string; align: "left" | "right" }[] = [
    { key: "nombre", label: "Barrio", align: "left" },
    { key: "score_habitabilidad", label: "Habitabilidad", align: "right" },
    { key: "score_15min", label: "15 min", align: "right" },
    { key: "m2_per_capita", label: "m²/cap", align: "right" },
    { key: "score_resiliencia", label: "Resiliencia", align: "right" },
    { key: "score_gentrificacion", label: "Gentrif.", align: "right" },
  ];

  return (
    <div className="overflow-x-auto rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface">
      <table className="w-full text-sm">
        <caption className="sr-only">
          Tabla comparativa de barrios de Posadas con todos los indicadores
          de calidad de vida. Click en los encabezados para ordenar.
        </caption>
        <thead className="border-b border-neutral-border bg-neutral-50 text-left text-xs uppercase tracking-wider text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
          <tr>
            {columnas.map((c) => {
              const active = sortKey === c.key;
              const ariaSort = active
                ? sortDir === "asc"
                  ? "ascending"
                  : "descending"
                : "none";
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={[
                    "px-3 py-2",
                    c.align === "right" ? "text-right" : "text-left",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={[
                      "inline-flex items-center gap-1 outline-none transition-colors",
                      "focus-visible:rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 dark:focus-visible:ring-dk-primary dark:focus-visible:ring-offset-dk-bg",
                      active
                        ? "text-primary dark:text-dk-primary"
                        : "hover:text-primary dark:hover:text-dk-primary",
                    ].join(" ")}
                    aria-label={`Ordenar por ${c.label}`}
                  >
                    <span>{c.label}</span>
                    <span aria-hidden="true" className="text-[9px]">
                      {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((f) => (
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
              </th>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                {fmt(f.score_habitabilidad)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                {fmt(f.score_15min)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                {fmt(f.m2_per_capita, 1)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                {fmt(f.score_resiliencia)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                {fmt(f.score_gentrificacion)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default CalidadVidaTabla;
