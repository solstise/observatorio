"use client";

// <PoligonoDatosTab> — tab "Datos" de la ficha de barrio.
//
// Lista los datasets disponibles filtrados a este barrio + un botón
// "Descargar JSON del barrio" que genera un blob client-side con todos
// los rows ya filtrados (no pega al server, son datos ya en memoria).
//
// Cliente: necesitamos un onClick que arme el blob. El padre pasa el
// dataset completo serializable.

import Link from "next/link";
import type { ReactNode } from "react";

interface DatasetEntry {
  // Etiqueta legible para el usuario
  label: string;
  // Path al CSV o JSON crudo en /data
  href?: string;
  // Última fecha conocida si la sabemos (string libre, ej "2026-04-12")
  lastUpdated?: string;
  // Frecuencia de actualización (texto libre, ej "mensual")
  frequency?: string;
  // Cantidad de filas para este barrio (entero o null)
  rowsForBarrio?: number | null;
  // Notas o aclaración
  note?: string;
}

interface PoligonoDatosTabProps {
  poligonoId: string;
  poligonoNombre: string;
  /** Payload completo para descargar como JSON. Lo armamos en el server. */
  jsonPayload: Record<string, unknown>;
  /** Lista de datasets a mostrar en la tabla maestra. */
  datasets: DatasetEntry[];
  /** Bloque opcional con disclaimer / ranking político (lo movimos acá). */
  extra?: ReactNode;
}

export function PoligonoDatosTab({
  poligonoId,
  poligonoNombre,
  jsonPayload,
  datasets,
  extra,
}: PoligonoDatosTabProps) {
  const onDownload = () => {
    if (typeof window === "undefined") return;
    const blob = new Blob([JSON.stringify(jsonPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${poligonoId}_observatorio.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Liberá el blob después de un tick — algunos browsers (Safari)
    // necesitan que el link viva un instante.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section aria-labelledby="datos-tab" className="space-y-6">
      <header>
        <h2
          id="datos-tab"
          className="text-xl font-semibold text-primary dark:text-dk-primary"
        >
          Datos del barrio
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-neutral-muted dark:text-dk-muted">
          Todos los datasets que alimentan esta ficha, con link al CSV crudo.
          Bajalos si querés reusarlos en tu propio análisis — están bajo
          licencia abierta (ver{" "}
          <Link
            href="/datos/metodologia"
            className="text-primary underline dark:text-dk-primary"
          >
            metodología
          </Link>
          ).
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:bg-dk-primary dark:text-dk-bg dark:hover:bg-dk-primary/90"
          aria-label={`Descargar todos los datos de ${poligonoNombre} en JSON`}
        >
          <span aria-hidden>⬇</span>
          Descargar JSON del barrio
        </button>
        <Link
          href="/datos/descargas"
          className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary-50 dark:border-dk-primary/40 dark:bg-dk-surface dark:text-dk-primary dark:hover:bg-dk-elevated"
        >
          Set completo de datos
        </Link>
        <Link
          href="/datos/metodologia"
          className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary-50 dark:border-dk-primary/40 dark:bg-dk-surface dark:text-dk-primary dark:hover:bg-dk-elevated"
        >
          Metodología
        </Link>
        <a
          href={`/data/media/${poligonoId}.pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-white px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary-50 dark:border-dk-primary/40 dark:bg-dk-surface dark:text-dk-primary dark:hover:bg-dk-elevated"
        >
          Reporte PDF
        </a>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-border dark:border-dk-border">
        <table
          className="data-table"
          aria-label={`Datasets disponibles para ${poligonoNombre}`}
        >
          <thead>
            <tr>
              <th scope="col">Dataset</th>
              <th scope="col">Última fecha</th>
              <th scope="col">Frecuencia</th>
              <th scope="col">Filas barrio</th>
              <th scope="col">Archivo</th>
            </tr>
          </thead>
          <tbody>
            {datasets.map((d) => (
              <tr key={d.label}>
                <th
                  scope="row"
                  className="font-medium text-primary dark:text-dk-primary"
                >
                  {d.label}
                  {d.note && (
                    <p className="mt-0.5 text-[11px] font-normal italic text-neutral-muted dark:text-dk-muted">
                      {d.note}
                    </p>
                  )}
                </th>
                <td className="text-sm text-neutral-muted dark:text-dk-muted">
                  {d.lastUpdated || "—"}
                </td>
                <td className="text-sm text-neutral-muted dark:text-dk-muted">
                  {d.frequency || "—"}
                </td>
                <td className="text-sm tabular-nums">
                  {d.rowsForBarrio != null ? d.rowsForBarrio : "—"}
                </td>
                <td>
                  {d.href ? (
                    <a
                      href={d.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                    >
                      Descargar
                    </a>
                  ) : (
                    <span className="text-sm italic text-neutral-muted dark:text-dk-muted">
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {extra}
    </section>
  );
}
