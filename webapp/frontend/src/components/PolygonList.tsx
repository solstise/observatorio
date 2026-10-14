"use client";

// <PolygonList> — tabla compacta de todos los polígonos, debajo del mapa.
//
// Extraída de `app/page.tsx` para que el server-component pueda renderizar
// la página sin tener que ser Client Component completo. La tabla en sí
// mantiene state (sortKey / sortDir) y por eso queda en cliente.
//
// `ciudadFeature` es la capa de referencia "Posadas completa" — se renderiza
// arriba como totales de ciudad antes del listado de barrios.

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PoligonoFeature, PoligonosCollection } from "@/lib/types";

type SortKey =
  | "nombre"
  | "categoria"
  | "score_expansion"
  | "superficie_km2"
  | "poblacion_estimada";
type SortDir = "asc" | "desc";

interface PolygonListProps {
  collection: PoligonosCollection;
  ciudadFeature: PoligonoFeature | null;
}

export function PolygonList({ collection, ciudadFeature }: PolygonListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("poblacion_estimada");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const ordered = useMemo(() => {
    const arr = [...collection.features];
    arr.sort((a, b) => {
      const va = a.properties[sortKey];
      const vb = b.properties[sortKey];
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc"
          ? va.localeCompare(vb)
          : vb.localeCompare(va);
      }
      const na = Number(va) || 0;
      const nb = Number(vb) || 0;
      return sortDir === "asc" ? na - nb : nb - na;
    });
    return arr;
  }, [collection, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Por defecto numérico descendente (mayor a menor), texto ascendente.
      setSortDir(key === "nombre" || key === "categoria" ? "asc" : "desc");
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  return (
    <div id="tabla-barrios" className="mt-8 scroll-mt-24">
      <h2 className="mb-2 text-lg font-semibold text-primary dark:text-dk-primary">
        Barrios
      </h2>
      <p className="mb-3 text-sm text-neutral-muted dark:text-dk-muted">
        Hacé click en los encabezados para ordenar por esa columna. En mobile,
        deslizá la tabla hacia los costados para ver todas las columnas.
      </p>
      <div className="overflow-x-auto rounded-lg border border-neutral-border dark:border-dk-border">
        <table className="data-table" aria-label="Lista de barrios">
          <thead>
            <tr>
              <SortableTh
                active={sortKey === "nombre"}
                onClick={() => toggleSort("nombre")}
              >
                Nombre{sortIndicator("nombre")}
              </SortableTh>
              <SortableTh
                active={sortKey === "categoria"}
                onClick={() => toggleSort("categoria")}
              >
                Categoría{sortIndicator("categoria")}
              </SortableTh>
              <SortableTh
                active={sortKey === "score_expansion"}
                onClick={() => toggleSort("score_expansion")}
              >
                Score expansión{sortIndicator("score_expansion")}
              </SortableTh>
              <SortableTh
                active={sortKey === "superficie_km2"}
                onClick={() => toggleSort("superficie_km2")}
              >
                Superficie{sortIndicator("superficie_km2")}
              </SortableTh>
              <SortableTh
                active={sortKey === "poblacion_estimada"}
                onClick={() => toggleSort("poblacion_estimada")}
              >
                Población{sortIndicator("poblacion_estimada")}
              </SortableTh>
              <th scope="col">Ficha</th>
            </tr>
          </thead>
          <tbody>
            {ciudadFeature ? (
              <tr
                key={ciudadFeature.properties.id}
                className="border-b-2 border-accent-200 bg-accent-50/40 dark:border-dk-accent/40 dark:bg-dk-elevated"
              >
                <th
                  scope="row"
                  className="font-bold text-accent dark:text-dk-accent"
                >
                  {ciudadFeature.properties.nombre}
                  <span className="ml-2 rounded-full bg-accent-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent dark:bg-dk-accent/30 dark:text-dk-accent">
                    Total ciudad
                  </span>
                </th>
                <td className="text-sm italic text-neutral-muted dark:text-dk-muted">
                  Capa de referencia
                </td>
                <td>—</td>
                <td>
                  {ciudadFeature.properties.superficie_km2.toFixed(1)} km²
                </td>
                <td>—</td>
                <td>
                  <Link
                    href={`/poligono/${ciudadFeature.properties.id}`}
                    className="text-sm font-semibold text-accent underline-offset-2 hover:underline dark:text-dk-accent"
                    aria-label="Ver totales de toda Posadas"
                  >
                    Ver totales →
                  </Link>
                </td>
              </tr>
            ) : null}
            {ordered.map((f) => {
              const p = f.properties;
              return (
                <tr key={p.id}>
                  <th
                    scope="row"
                    className="font-medium text-primary dark:text-dk-primary"
                  >
                    <Link
                      href={`/poligono/${p.id}`}
                      className="text-left underline-offset-2 hover:underline focus:underline focus:outline-none"
                      aria-label={`Abrir ficha de ${p.nombre}`}
                    >
                      {p.nombre}
                    </Link>
                  </th>
                  <td className="text-sm text-neutral-muted dark:text-dk-muted">
                    {p.categoria}
                  </td>
                  <td>{p.score_expansion.toFixed(2)}</td>
                  <td>{p.superficie_km2.toFixed(1)} km²</td>
                  <td>{p.poblacion_estimada.toLocaleString("es-AR")}</td>
                  <td>
                    <Link
                      href={`/poligono/${p.id}`}
                      className="text-sm font-semibold text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                      aria-label={`Abrir ficha completa de ${p.nombre}`}
                    >
                      Ver ficha →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortableTh({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th scope="col" aria-sort={active ? "other" : "none"}>
      <button
        type="button"
        onClick={onClick}
        className={
          "flex w-full items-center gap-1 text-left font-semibold uppercase tracking-wider focus:outline-none " +
          (active ? "text-primary dark:text-dk-primary" : "")
        }
      >
        {children}
      </button>
    </th>
  );
}
