"use client";

// <NDBINDVICrossVal> — tabla por barrio comparando los índices NDBI/NDVI
// medidos por Sentinel-2 vs CBERS-4A. Cuando dos sensores independientes
// llegan al mismo número, la confianza del indicador sube; cuando
// difieren mucho, hay que mirar con cuidado (probable nube, sombra,
// scaling distinto).
//
// Reglas de color:
//   diferencia_relativa_pct >= 20 → rojo (warning fuerte)
//   diferencia_relativa_pct entre 10 y 20 → amarillo (chequeo)
//   diferencia_relativa_pct < 10 → verde (alta consistencia)
//
// El componente fetchea por sí mismo `/data/cbers_indices/ndbi_ndvi.csv`
// si no recibe `rows`. Degrada a card "Datos en preparación" cuando T1
// aún no publicó.

import { useEffect, useMemo, useState } from "react";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import { getNdbiNdviCrossval } from "@/lib/data.client";
import type {
  NdbiNdviCrossvalRow,
  PoligonoFeature,
  PoligonosCollection,
} from "@/lib/types";

interface NDBINDVICrossValProps {
  /** Filas pre-cargadas. */
  rows?: NdbiNdviCrossvalRow[];
  /** Polígonos para resolver ID → nombre. Opcional. */
  poligonos?: PoligonosCollection | PoligonoFeature[];
  /** Año a mostrar. Si omitido, usa el más reciente disponible. */
  anio?: number;
  /** Limitar filas mostradas (top N por diferencia). Default: sin límite. */
  topN?: number;
}

// Mapea un número (la diferencia relativa) a un trio (color hex, badge,
// label). Lo centralizamos para que el style del badge y del background
// de fila usen la misma fuente de verdad.
function semaforo(diff: number | null | undefined): {
  color: "verde" | "amarillo" | "rojo";
  label: string;
  bgClass: string;
  textClass: string;
} {
  if (diff === null || diff === undefined || !Number.isFinite(diff)) {
    return {
      color: "verde",
      label: "s/d",
      bgClass: "bg-neutral-50 dark:bg-dk-elevated/40",
      textClass: "text-neutral-muted dark:text-dk-muted",
    };
  }
  const abs = Math.abs(diff);
  if (abs >= 20) {
    return {
      color: "rojo",
      label: "discrepancia",
      bgClass: "bg-rose-50 dark:bg-rose-900/30",
      textClass: "text-rose-700 dark:text-rose-300",
    };
  }
  if (abs >= 10) {
    return {
      color: "amarillo",
      label: "chequear",
      bgClass: "bg-amber-50 dark:bg-amber-900/30",
      textClass: "text-amber-800 dark:text-amber-200",
    };
  }
  return {
    color: "verde",
    label: "consistente",
    bgClass: "bg-emerald-50 dark:bg-emerald-900/30",
    textClass: "text-emerald-700 dark:text-emerald-300",
  };
}

function formatIndice(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "s/d";
  return v.toFixed(3);
}

function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "s/d";
  // Mostrar signo + valor para que se vea si CBERS subestima o sobrestima.
  const signo = v > 0 ? "+" : "";
  return `${signo}${v.toFixed(1)}%`;
}

export function NDBINDVICrossVal({
  rows: propRows,
  poligonos,
  anio,
  topN,
}: NDBINDVICrossValProps) {
  const [rows, setRows] = useState<NdbiNdviCrossvalRow[] | null>(
    propRows ?? null,
  );
  const [loading, setLoading] = useState(propRows === undefined);

  useEffect(() => {
    if (propRows !== undefined) {
      setRows(propRows);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getNdbiNdviCrossval()
      .then((r) => {
        if (!cancelled) {
          setRows(r);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [propRows]);

  // Mapa id → nombre. Acepta tanto colección como array directo de
  // features para flexibilidad de la página integradora.
  const nombreById = useMemo(() => {
    const m = new Map<string, string>();
    const feats = Array.isArray(poligonos)
      ? poligonos
      : poligonos?.features ?? [];
    for (const f of feats) {
      m.set(f.properties.id, f.properties.nombre);
    }
    return m;
  }, [poligonos]);

  // Filtra por año (último disponible si `anio` no se pasa) y deriva
  // diferencia combinada (promedio de NDBI y NDVI cuando ambos existen).
  const filas = useMemo(() => {
    if (!rows || !rows.length) return [];
    const aniosDisponibles = Array.from(
      new Set(rows.map((r) => r.anio).filter(Number.isFinite)),
    ).sort((a, b) => b - a);
    const anioObjetivo = anio ?? aniosDisponibles[0];
    const filtradas = rows.filter((r) => r.anio === anioObjetivo);

    // Ordenamos por |diferencia_relativa_pct| descendente para que las
    // discrepancias mayores aparezcan primero — son las que requieren
    // atención del lector.
    const ord = [...filtradas].sort((a, b) => {
      const da = Math.abs(a.diferencia_relativa_pct ?? 0);
      const db = Math.abs(b.diferencia_relativa_pct ?? 0);
      return db - da;
    });
    return topN ? ord.slice(0, topN) : ord;
  }, [rows, anio, topN]);

  if (loading) {
    return (
      <div
        aria-hidden
        className="h-[280px] w-full animate-pulse rounded-md bg-gradient-to-br from-primary-50 via-white to-primary-50 dark:from-dk-elevated dark:via-dk-surface dark:to-dk-elevated"
      />
    );
  }

  if (!filas.length) {
    return (
      <div className="rounded-md border border-dashed border-neutral-border bg-neutral-50 p-6 text-center text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-elevated/40 dark:text-dk-muted">
        <p className="font-medium text-primary dark:text-dk-primary">
          Validación cruzada de índices urbanos
        </p>
        <p className="mt-1">
          Datos en preparación, el primer cron mensual los publicará.
        </p>
      </div>
    );
  }

  // Año mostrado (para el header) — derivado de la primera fila ya que
  // todas comparten el mismo después del filter.
  const anioMostrado = filas[0]?.anio;

  return (
    <div className="w-full">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-primary dark:text-dk-primary">
          Validación cruzada de índices urbanos
        </h3>
        <p className="mt-1 text-sm text-neutral-text dark:text-dk-text">
          Cuando dos satélites distintos coinciden en su medición, la
          confianza del indicador es mayor. Comparamos{" "}
          <TerminoGlosario id="ndbi">NDBI</TerminoGlosario> y{" "}
          <TerminoGlosario id="ndvi">NDVI</TerminoGlosario> calculados por{" "}
          <TerminoGlosario id="sentinel-2">Sentinel-2</TerminoGlosario>{" "}
          (10 m) versus <TerminoGlosario id="cbers">CBERS-4A WPM</TerminoGlosario>{" "}
          (16 m).
        </p>
        <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
          Mostrando datos de {anioMostrado ?? "—"}. Diferencias mayores al{" "}
          <strong className="text-rose-700 dark:text-rose-400">
            20 %
          </strong>{" "}
          se marcan en rojo,{" "}
          <strong className="text-amber-700 dark:text-amber-300">
            10–20 %
          </strong>{" "}
          en amarillo,{" "}
          <strong className="text-emerald-700 dark:text-emerald-400">
            menos del 10 %
          </strong>{" "}
          en verde.
        </p>
      </div>

      <div className="overflow-x-auto rounded-md border border-neutral-border bg-white shadow-sm dark:border-dk-border dark:bg-dk-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Validación cruzada NDBI/NDVI: comparación entre Sentinel-2 y
            CBERS por barrio, con diferencia relativa porcentual.
          </caption>
          <thead className="border-b border-neutral-border bg-neutral-50 text-left text-xs uppercase tracking-wider text-secondary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-muted">
            <tr>
              <th scope="col" className="px-3 py-2">
                Barrio
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                NDBI S2
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                NDBI CBERS
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                NDVI S2
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                NDVI CBERS
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Diferencia %
              </th>
              <th scope="col" className="px-3 py-2">
                Estado
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((row) => {
              const sem = semaforo(row.diferencia_relativa_pct);
              const nombre =
                nombreById.get(row.poligono_id) ?? row.poligono_id;
              return (
                <tr
                  key={`${row.poligono_id}-${row.anio}`}
                  className={`border-b border-neutral-border/60 last:border-0 ${sem.bgClass}`}
                >
                  <th
                    scope="row"
                    className="px-3 py-2 text-left font-medium text-primary dark:text-dk-primary"
                  >
                    {nombre}
                    {nombre !== row.poligono_id && (
                      <p className="font-mono text-[10px] font-normal text-neutral-muted dark:text-dk-muted">
                        {row.poligono_id}
                      </p>
                    )}
                  </th>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                    {formatIndice(row.ndbi_s2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                    {formatIndice(row.ndbi_cbers)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                    {formatIndice(row.ndvi_s2)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-text dark:text-dk-text">
                    {formatIndice(row.ndvi_cbers)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-semibold ${sem.textClass}`}
                  >
                    {formatPct(row.diferencia_relativa_pct)}
                  </td>
                  <td className={`px-3 py-2 text-xs ${sem.textClass}`}>
                    {sem.label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs italic text-neutral-muted dark:text-dk-muted">
        La diferencia relativa combina NDBI y NDVI en una sola métrica
        comparable. Diferencias grandes suelen ser nubes residuales en uno
        de los sensores, no errores reales del territorio.
      </p>
    </div>
  );
}

export default NDBINDVICrossVal;
