"use client";

// <CBERSHistoricoTimeline> — slider temporal 1999-2026 que muestra una
// imagen pansharpen de Posadas por año. Al mover el slider cambia la
// imagen y el badge de calidad indica si ese año usa CBERS-1/2/2B
// (calibración preliminar) o CBERS-4/4A (calidad estándar).
//
// Filosofía:
//   - Una sola imagen grande por año, no comparación lado a lado: el
//     valor es ver la ciudad evolucionar a lo largo de 27 años usando la
//     misma fuente cuando es posible (CBERS) y degrading honestamente
//     cuando hay que cambiar de plataforma.
//   - El badge de calidad evita que el lector vea una imagen de 2003
//     (CBERS-2B HRC, 2.7 m discontinuo) y crea que es comparable píxel
//     a píxel con una de 2024 (CBERS-4A WPM 8 m).
//
// Datos:
//   - `serie` rows del CSV `/data/cbers_historico/serie.csv` (T1).
//   - PNGs en `/data/media/cbers_historico/{anio}_posadas_pansharpen.png`.
//
// Estados:
//   - sin serie: card "Datos en preparación".
//   - año sin imagen: skeleton + texto "Sin imagen para {anio}".
//   - normal: imagen + badges + slider activo.

import { useEffect, useMemo, useState } from "react";

import { TerminoGlosario } from "@/components/TerminoGlosario";
import { getCbersHistorico } from "@/lib/data.client";
import type { CbersHistoricoRow } from "@/lib/types";

interface CBERSHistoricoTimelineProps {
  /** Filas pre-cargadas. Si omitido, fetcheamos del CSV. */
  serie?: CbersHistoricoRow[];
  /** Año inicial mostrado. Si no está en la serie, cae al más reciente. */
  initialAnio?: number;
}

// El slider va de 1999 a 2026 sea cual sea el subset disponible. Si T1
// publicó solamente 2014+ por ejemplo, los años pre-2014 muestran skeleton
// "Sin imagen para X" — es el comportamiento honesto que pidió el brief.
const ANIO_MIN = 1999;
const ANIO_MAX = 2026;

export function CBERSHistoricoTimeline({
  serie: propSerie,
  initialAnio,
}: CBERSHistoricoTimelineProps) {
  const [serie, setSerie] = useState<CbersHistoricoRow[] | null>(
    propSerie ?? null,
  );
  const [loadingSerie, setLoadingSerie] = useState(propSerie === undefined);
  const [imgError, setImgError] = useState(false);
  const [imgLoading, setImgLoading] = useState(true);

  // Slider: arranca en initialAnio si fue dado, si no en el más reciente
  // disponible, si no en ANIO_MAX. Lo manejamos como número para que el
  // <input type="range"> funcione de manera natural.
  const [anio, setAnio] = useState<number>(() => initialAnio ?? ANIO_MAX);

  useEffect(() => {
    if (propSerie !== undefined) {
      setSerie(propSerie);
      setLoadingSerie(false);
      return;
    }
    let cancelled = false;
    setLoadingSerie(true);
    getCbersHistorico()
      .then((r) => {
        if (!cancelled) {
          setSerie(r);
          setLoadingSerie(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSerie([]);
          setLoadingSerie(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [propSerie]);

  // Cuando llega la serie por primera vez, si initialAnio no está
  // disponible, anclamos al año más reciente publicado.
  useEffect(() => {
    if (!serie || serie.length === 0) return;
    if (initialAnio !== undefined) return;
    const anios = serie.map((r) => r.anio).filter(Number.isFinite);
    if (!anios.length) return;
    const max = Math.max(...anios);
    setAnio(max);
  }, [serie, initialAnio]);

  // Dado un año, encontrá la fila de la serie (si existe). Múltiples
  // filas para el mismo año son posibles si T1 publicó varios composites
  // en distintas fechas — agarramos la más reciente.
  const filaActiva = useMemo<CbersHistoricoRow | null>(() => {
    if (!serie) return null;
    const matches = serie.filter((r) => r.anio === anio);
    if (!matches.length) return null;
    return [...matches].sort((a, b) =>
      a.fecha_imagen < b.fecha_imagen ? 1 : -1,
    )[0];
  }, [serie, anio]);

  // URL convencional. Si el PNG no existe (T1 aún no lo procesó), el
  // <img> dispara onError y mostramos el placeholder. No probamos
  // variantes porque el contrato dice un solo path por año.
  const imgSrc = `/data/media/cbers_historico/${anio}_posadas_pansharpen.png`;

  // Reset error/loading al cambiar el año.
  useEffect(() => {
    setImgError(false);
    setImgLoading(true);
  }, [anio]);

  // Calidad del año: 1999-2013 → preliminar, 2014+ → estándar.
  // Lo derivamos del año (no de filaActiva) para que muestre algo aún
  // cuando la serie no tiene fila para ese año exacto.
  const calidad: "preliminar" | "estandar" =
    anio >= 2014 ? "estandar" : "preliminar";

  if (loadingSerie) {
    return (
      <div
        aria-hidden
        className="h-[420px] w-full animate-pulse rounded-md bg-gradient-to-br from-primary-50 via-white to-primary-50 dark:from-dk-elevated dark:via-dk-surface dark:to-dk-elevated"
      />
    );
  }

  // Si la serie está totalmente vacía, mostramos el placeholder claro:
  // T1 no publicó NADA todavía. El slider sigue funcionando porque el
  // contrato dice "los PNG son independientes del CSV" — pero sin serie
  // no podemos prometer fechas reales, así que dejamos el placeholder.
  const serieVacia = !serie || serie.length === 0;

  return (
    <div className="w-full">
      {/* Header con anio + badge de calidad */}
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="text-3xl font-bold tabular-nums text-primary dark:text-dk-primary sm:text-4xl">
            {anio}
          </h3>
          <p className="text-xs text-neutral-muted dark:text-dk-muted">
            Posadas pansharpen anual ·{" "}
            <TerminoGlosario id="inpe">INPE</TerminoGlosario>{" "}
            <TerminoGlosario id="cbers">CBERS</TerminoGlosario>
          </p>
        </div>
        <BadgeCalidad calidad={calidad} fila={filaActiva} />
      </div>

      {/* Imagen grande / esqueleto */}
      <div className="relative w-full overflow-hidden rounded-lg border border-neutral-border bg-primary-50 shadow-sm dark:border-dk-border dark:bg-dk-elevated">
        {(imgLoading && !imgError) || serieVacia ? (
          <div
            aria-hidden
            className="flex h-[320px] w-full items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-50 dark:from-dk-elevated dark:via-dk-surface dark:to-dk-elevated sm:h-[440px]"
          >
            {serieVacia ? (
              <div className="px-6 text-center text-sm text-neutral-muted dark:text-dk-muted">
                <p className="font-medium text-primary dark:text-dk-primary">
                  Datos en preparación
                </p>
                <p className="mt-1 max-w-md">
                  El primer cron mensual publicará la serie histórica
                  CBERS 1999-2026.
                </p>
              </div>
            ) : (
              <span className="text-xs italic text-neutral-muted dark:text-dk-muted">
                Cargando imagen de {anio}…
              </span>
            )}
          </div>
        ) : null}

        {!serieVacia && !imgError && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={imgSrc}
            src={imgSrc}
            alt={`Imagen pansharpen ${anio} de Posadas (Misiones, AR) — ${
              filaActiva?.fuente_satelite ?? "CBERS"
            }`}
            className={`block w-full max-h-[500px] object-cover transition-opacity duration-200 ${
              imgLoading ? "opacity-0" : "opacity-100"
            }`}
            onLoad={() => setImgLoading(false)}
            onError={() => {
              setImgLoading(false);
              setImgError(true);
            }}
            loading="lazy"
            decoding="async"
          />
        )}

        {!serieVacia && imgError && (
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-neutral-muted dark:text-dk-muted">
            <p className="max-w-md">Sin imagen para {anio}.</p>
            <p className="text-xs">
              El composite de ese año todavía no se publicó. Movés el slider
              para ver años con imagen disponible.
            </p>
          </div>
        )}
      </div>

      {/* Slider temporal */}
      <div className="mt-4">
        <label
          htmlFor="cbers-historico-slider"
          className="block text-xs font-medium text-secondary dark:text-dk-muted"
        >
          Año seleccionado
        </label>
        <input
          id="cbers-historico-slider"
          type="range"
          min={ANIO_MIN}
          max={ANIO_MAX}
          step={1}
          value={anio}
          onChange={(e) => setAnio(parseInt(e.target.value, 10))}
          aria-valuemin={ANIO_MIN}
          aria-valuemax={ANIO_MAX}
          aria-valuenow={anio}
          aria-label={`Año del composite (${ANIO_MIN} a ${ANIO_MAX})`}
          className="mt-1 w-full accent-primary dark:accent-dk-primary"
        />
        <div className="mt-1 flex flex-wrap items-center justify-between text-[11px] text-neutral-muted dark:text-dk-muted">
          <span>{ANIO_MIN}</span>
          <span className="hidden sm:inline">2007</span>
          <span className="hidden sm:inline">2014</span>
          <span className="hidden sm:inline">2020</span>
          <span>{ANIO_MAX}</span>
        </div>
      </div>

      {/* Pies de imagen: fuente + fecha exacta cuando la serie la trae */}
      {filaActiva ? (
        <p className="mt-3 text-xs italic text-neutral-muted dark:text-dk-muted">
          Fuente: <strong>{filaActiva.fuente_satelite}</strong>
          {filaActiva.fecha_imagen ? ` · ${filaActiva.fecha_imagen}` : null}
          {Number.isFinite(filaActiva.n_poligonos_cubiertos)
            ? ` · ${filaActiva.n_poligonos_cubiertos} polígonos cubiertos`
            : null}
          .
        </p>
      ) : (
        !serieVacia && (
          <p className="mt-3 text-xs italic text-neutral-muted dark:text-dk-muted">
            Sin metadata específica para {anio}.
          </p>
        )
      )}
    </div>
  );
}

function BadgeCalidad({
  calidad,
  fila,
}: {
  calidad: "preliminar" | "estandar";
  fila: CbersHistoricoRow | null;
}) {
  // Prefer la calidad declarada por la fila si existe — el agente de
  // datos puede saber mejor que la heurística "1999-2013 = preliminar"
  // para casos puntuales (ej. una imagen 2010 reprocesada con calibración
  // moderna). Fallback a la inferida por año.
  const efectiva: "preliminar" | "estandar" = fila?.calidad ?? calidad;
  if (efectiva === "preliminar") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-900 dark:border-amber-600/60 dark:bg-amber-900/30 dark:text-amber-100"
        title="Imágenes pre-2014 usan CBERS-1/2/2B/HRC, con calibración menos estable que la flota actual. Sirven para tendencias, no para mediciones absolutas."
      >
        <span aria-hidden>{"🟡"}</span>
        Calibración preliminar (CBERS-1/2)
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/60 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-900 dark:border-emerald-600/60 dark:bg-emerald-900/30 dark:text-emerald-100"
      title="CBERS-4 (lanzado 2014) y CBERS-4A (2019) tienen calibración radiométrica estable comparable a Sentinel-2."
    >
      <span aria-hidden>{"🟢"}</span>
      Calidad estándar (CBERS-4/4A)
    </span>
  );
}

export default CBERSHistoricoTimeline;
