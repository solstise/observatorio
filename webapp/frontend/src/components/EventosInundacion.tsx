"use client";

// <EventosInundacion> — timeline vertical de eventos de inundación
// detectados por composite multi-sensor (Sentinel-1 SAR + S2 + CBERS WPM).
//
// Cada evento muestra:
//   - Fecha (chip prominente).
//   - Área inundada en km² + polígonos afectados como chips clicables que
//     llevan a `/poligono/{id}` para más contexto.
//   - Fuente principal (sensor primario que detectó) + fuente de
//     validación (sensor independiente que confirmó).
//   - Confianza (alta/media/baja) con un dot semafórico al lado de la
//     fuente — permite leer "qué tan seguro estamos" sin profundizar.
//
// Datos:
//   - `/data/cbers_inundacion/eventos.csv` (T1).
//   - El CSV puede tener 0 filas: significa "no se detectaron eventos en
//     la última ventana" (válido), no que falte data. Lo distinguimos
//     del caso "T1 no publicó nada" con estado loading vs empty-no-events.
//
// Filosofía: ordenar por fecha desc para que el evento más reciente esté
// arriba (es lo que un funcionario chequea primero). Los polígonos
// afectados son chips porque la pregunta crítica es "¿mi barrio está?".

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getEventosInundacion } from "@/lib/data.client";
import type {
  EventoInundacionRow,
  PoligonoFeature,
  PoligonosCollection,
} from "@/lib/types";

interface EventosInundacionProps {
  /** Filas pre-cargadas. Si omitido, fetcheamos. */
  rows?: EventoInundacionRow[];
  /** Polígonos para resolver ID → nombre. */
  poligonos?: PoligonosCollection | PoligonoFeature[];
  /** Top N más recientes. Default: sin límite. */
  topN?: number;
  /** Hide subtitle for embedded usage. */
  compact?: boolean;
}

const COLOR_DOT_CONFIANZA: Record<
  EventoInundacionRow["confianza"],
  string
> = {
  alta: "bg-emerald-500 dark:bg-emerald-400",
  media: "bg-amber-500 dark:bg-amber-400",
  baja: "bg-rose-500 dark:bg-rose-400",
};

function formatFecha(iso: string): string {
  // CSV trae YYYY-MM-DD. Lo formateamos en es-AR sin hora porque el
  // detector trabaja con composites diarios — no tiene sentido mostrar
  // hora exacta.
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "America/Argentina/Cordoba",
    });
  } catch {
    return iso;
  }
}

// Parsea el campo `poligonos_afectados` ("id1;id2;id3") a array. Tolerar
// vacío, espacios, comas (por si T1 cambia el separador).
function parsePoligonos(s: string | null | undefined): string[] {
  if (!s || typeof s !== "string") return [];
  return s
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

export function EventosInundacion({
  rows: propRows,
  poligonos,
  topN,
  compact = false,
}: EventosInundacionProps) {
  const [rows, setRows] = useState<EventoInundacionRow[] | null>(
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
    getEventosInundacion()
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

  const eventos = useMemo(() => {
    if (!rows) return [];
    const ord = [...rows].sort((a, b) =>
      a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0,
    );
    return topN ? ord.slice(0, topN) : ord;
  }, [rows, topN]);

  if (loading) {
    return (
      <div
        aria-hidden
        className="space-y-3"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-24 w-full animate-pulse rounded-md bg-gradient-to-br from-primary-50 via-white to-primary-50 dark:from-dk-elevated dark:via-dk-surface dark:to-dk-elevated"
          />
        ))}
      </div>
    );
  }

  // Si no hay filas, distinguimos: si rows es array vacío T1 publicó pero
  // no hay eventos detectados (estado normal); si rows es null T1 no
  // publicó. En ambos casos mostramos algo informativo, pero el texto
  // cambia para no confundir al lector.
  if (!eventos.length) {
    const esEsperaT1 = rows === null;
    return (
      <div className="rounded-md border border-dashed border-neutral-border bg-neutral-50 p-6 text-center text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-elevated/40 dark:text-dk-muted">
        <p className="font-medium text-primary dark:text-dk-primary">
          {esEsperaT1 ? "Datos en preparación" : "Sin eventos detectados"}
        </p>
        <p className="mt-1">
          {esEsperaT1
            ? "El primer cron mensual los publicará."
            : "El detector multi-sensor no encontró eventos de inundación con las observaciones disponibles."}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {!compact && (
        <header className="mb-4">
          <h3 className="text-base font-semibold text-primary dark:text-dk-primary">
            Eventos de inundación detectados
          </h3>
          <p className="mt-1 text-sm text-neutral-text dark:text-dk-text">
            Eventos identificados por un composite multi-sensor combinando
            radar (Sentinel-1) y óptico (Sentinel-2 + CBERS-4A WPM). Cada
            evento es validado por al menos dos sensores independientes
            antes de publicarse.
          </p>
        </header>
      )}

      <ol className="relative space-y-4 border-l border-neutral-border pl-5 dark:border-dk-border">
        {eventos.map((evt, idx) => (
          <EventoItem
            key={`${evt.fecha}-${idx}`}
            evento={evt}
            nombreById={nombreById}
          />
        ))}
      </ol>

      <p className="mt-4 text-xs italic text-neutral-muted dark:text-dk-muted">
        Confianza:{" "}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
          alta
        </span>
        ,{" "}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500 dark:bg-amber-400" />
          media
        </span>
        ,{" "}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500 dark:bg-rose-400" />
          baja
        </span>
        . Se requieren al menos dos sensores que coincidan para publicar
        un evento.
      </p>
    </div>
  );
}

function EventoItem({
  evento,
  nombreById,
}: {
  evento: EventoInundacionRow;
  nombreById: Map<string, string>;
}) {
  const ids = parsePoligonos(evento.poligonos_afectados);
  const dotColor =
    COLOR_DOT_CONFIANZA[evento.confianza] ?? COLOR_DOT_CONFIANZA.media;
  return (
    <li className="relative">
      {/* Dot del marcador de timeline (sobre la línea izquierda) */}
      <span
        aria-hidden="true"
        className="absolute -left-[27px] top-1.5 inline-block h-3 w-3 rounded-full border-2 border-white bg-primary dark:border-dk-bg dark:bg-dk-primary"
      />
      <div className="rounded-md border border-neutral-border bg-white p-4 shadow-sm dark:border-dk-border dark:bg-dk-elevated/40">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-primary dark:text-dk-primary">
            {formatFecha(evento.fecha)}
          </h4>
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-muted dark:text-dk-muted">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${dotColor}`}
            />
            Confianza {evento.confianza}
          </span>
        </div>
        <p className="mt-2 text-sm text-neutral-text dark:text-dk-text">
          <strong>
            {Number.isFinite(evento.area_inundada_km2)
              ? `${evento.area_inundada_km2.toFixed(2)} km²`
              : "—"}
          </strong>{" "}
          inundados
          {ids.length ? (
            <>
              {" "}
              en <strong>{ids.length}</strong>{" "}
              polígono{ids.length === 1 ? "" : "s"}
            </>
          ) : null}
          .
        </p>
        {ids.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ids.map((id) => (
              <Link
                key={id}
                href={`/poligono/${encodeURIComponent(id)}`}
                className="inline-flex items-center rounded-full border border-primary/30 bg-primary-50 px-2.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary/40 dark:bg-dk-elevated dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
                title={`Ver ficha de ${nombreById.get(id) ?? id}`}
              >
                {nombreById.get(id) ?? id}
              </Link>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-neutral-muted dark:text-dk-muted">
          <strong>Fuente principal:</strong>{" "}
          {evento.fuente_principal || "—"}.{" "}
          <strong>Validada con:</strong>{" "}
          {evento.fuente_validacion || "—"}.
        </p>
      </div>
    </li>
  );
}

export default EventosInundacion;
