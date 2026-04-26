"use client";

// Banner sticky con la alerta climática activa más severa. Si hay
// varias alertas, se muestra la de mayor severidad y se ofrece un
// botón "ver más" que abre un modal con la lista completa.
//
// Severidades y colores:
//   - roja:     fondo rojo oscuro / borde rojo
//   - naranja:  fondo ámbar / borde ámbar
//   - amarilla: fondo amarillo claro / borde amarillo
//
// Las severidades NO usan rojos puros del sistema porque la paleta del
// observatorio evita rojos institucionales — usamos un rojo cálido
// (#b91c1c) reservado solo para alertas críticas.

import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { AlertaActiva, AlertasPayload } from "@/lib/types";

interface Props {
  payload: AlertasPayload | null;
  // Si true, ocultamos el banner cuando no hay alertas activas (default).
  // En la página /clima preferimos mostrar siempre algo, así que pasamos
  // false para forzar el render del estado "todo en orden".
  hideWhenEmpty?: boolean;
}

const SEV_RANK: Record<AlertaActiva["severidad"], number> = {
  roja: 3,
  naranja: 2,
  amarilla: 1,
};

const SEV_LABEL: Record<AlertaActiva["severidad"], string> = {
  roja: "Alerta roja",
  naranja: "Alerta naranja",
  amarilla: "Aviso amarillo",
};

// Estilos por severidad: fondo, borde, texto, ícono. Mantenemos las
// variantes dark explícitas en cada clase porque algunas combinan
// utilities y custom hex que Tailwind no compone automáticamente.
const SEV_STYLE: Record<
  AlertaActiva["severidad"],
  { bg: string; border: string; text: string; chip: string; icon: string }
> = {
  roja: {
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-300 dark:border-red-800",
    text: "text-red-900 dark:text-red-100",
    chip: "bg-red-700 text-white dark:bg-red-700",
    icon: "🚨",
  },
  naranja: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-300 dark:border-amber-800",
    text: "text-amber-900 dark:text-amber-100",
    chip: "bg-amber-600 text-white dark:bg-amber-600",
    icon: "⚠️",
  },
  amarilla: {
    bg: "bg-yellow-50 dark:bg-yellow-950/40",
    border: "border-yellow-300 dark:border-yellow-800",
    text: "text-yellow-900 dark:text-yellow-100",
    chip: "bg-yellow-500 text-yellow-950 dark:bg-yellow-500 dark:text-yellow-950",
    icon: "ℹ️",
  },
};

const TIPO_LABEL: Record<AlertaActiva["tipo"], string> = {
  frio_extremo: "Frío extremo",
  frio_severo: "Frío severo",
  calor_extremo: "Calor extremo",
  lluvia_intensa: "Lluvia intensa",
  aqi_malo: "Calidad de aire desfavorable",
};

function formatoFechaCorta(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

export function AlertasBanner({ payload, hideWhenEmpty = true }: Props) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();

  const alertas = useMemo<AlertaActiva[]>(
    () => payload?.alertas ?? [],
    [payload],
  );

  const masSevera = useMemo<AlertaActiva | null>(() => {
    if (!alertas.length) return null;
    return [...alertas].sort(
      (a, b) =>
        SEV_RANK[b.severidad] - SEV_RANK[a.severidad] ||
        (a.fecha_inicio < b.fecha_inicio ? -1 : 1),
    )[0];
  }, [alertas]);

  // Cierre por Escape / click fuera.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Foco al abrir el modal.
  useEffect(() => {
    if (open) {
      closeButtonRef.current?.focus();
    }
  }, [open]);

  if (!alertas.length) {
    if (hideWhenEmpty) return null;
    return (
      <div
        role="status"
        className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
      >
        <strong>Sin alertas climáticas activas</strong> en los próximos{" "}
        {payload?.ventana_dias ?? 7} días. El monitoreo se actualiza con cada
        corrida del pipeline (script <code>58_alertas_clima.py</code>).
      </div>
    );
  }

  if (!masSevera) return null;
  const style = SEV_STYLE[masSevera.severidad];

  return (
    <>
      <div
        role="alert"
        aria-live="polite"
        className={[
          "rounded-md border p-3 sm:p-4",
          style.bg,
          style.border,
          style.text,
        ].join(" ")}
      >
        <div className="flex flex-wrap items-start gap-3">
          <span aria-hidden className="text-2xl leading-none">
            {style.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={[
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  style.chip,
                ].join(" ")}
              >
                {SEV_LABEL[masSevera.severidad]}
              </span>
              <span className="text-sm font-semibold">
                {TIPO_LABEL[masSevera.tipo]}
              </span>
              <span className="text-xs opacity-80">
                {formatoFechaCorta(masSevera.fecha_inicio)}
                {masSevera.fecha_fin !== masSevera.fecha_inicio
                  ? ` → ${formatoFechaCorta(masSevera.fecha_fin)}`
                  : ""}
                {masSevera.n_dias > 1 ? ` · ${masSevera.n_dias} días` : ""}
              </span>
            </div>
            <p className="mt-1 text-sm">{masSevera.descripcion}</p>
            {masSevera.barrios_prioritarios.length > 0 && (
              <p className="mt-1 text-xs">
                <strong>Barrios prioritarios afectados:</strong>{" "}
                {masSevera.barrios_prioritarios_nombres.slice(0, 5).join(", ")}
                {masSevera.barrios_prioritarios.length > 5 && " …"}
              </p>
            )}
            {alertas.length > 1 && (
              <p className="mt-1 text-xs opacity-90">
                Hay {alertas.length - 1}{" "}
                {alertas.length - 1 === 1
                  ? "alerta adicional activa"
                  : "alertas adicionales activas"}
                .
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            className={[
              "shrink-0 rounded border px-3 py-1.5 text-xs font-semibold transition-colors",
              "border-current hover:bg-white/40 dark:hover:bg-white/10",
            ].join(" ")}
          >
            Ver detalle
          </button>
        </div>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={(e) => {
            // Click fuera: cerrar.
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-neutral-border bg-white shadow-xl dark:border-dk-border dark:bg-dk-surface">
            <header className="flex items-center justify-between border-b border-neutral-border px-4 py-3 dark:border-dk-border">
              <h2
                id={titleId}
                className="text-lg font-semibold text-primary dark:text-dk-primary"
              >
                Alertas climáticas activas ({alertas.length})
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar detalle de alertas"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-border text-primary transition-colors hover:bg-primary-50 dark:border-dk-border dark:text-dk-primary dark:hover:bg-dk-elevated"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </header>

            <ul className="divide-y divide-neutral-border dark:divide-dk-border">
              {alertas.map((a, idx) => {
                const s = SEV_STYLE[a.severidad];
                return (
                  <li key={`${a.tipo}-${a.fecha_inicio}-${idx}`} className="p-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span
                        className={[
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                          s.chip,
                        ].join(" ")}
                      >
                        {SEV_LABEL[a.severidad]}
                      </span>
                      <span className="text-sm font-semibold text-primary dark:text-dk-primary">
                        {TIPO_LABEL[a.tipo]}
                      </span>
                      <span className="text-xs text-neutral-muted dark:text-dk-muted">
                        {formatoFechaCorta(a.fecha_inicio)}
                        {a.fecha_fin !== a.fecha_inicio
                          ? ` → ${formatoFechaCorta(a.fecha_fin)}`
                          : ""}
                        {a.n_dias > 1 ? ` · ${a.n_dias} días` : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-neutral-text dark:text-dk-text">
                      {a.descripcion}
                    </p>
                    <p className="mt-1 text-xs text-secondary dark:text-dk-muted">
                      <strong>{a.n_barrios_afectados}</strong>{" "}
                      {a.n_barrios_afectados === 1
                        ? "barrio afectado"
                        : "barrios afectados"}
                      {a.barrios_prioritarios.length > 0 && (
                        <>
                          {" · "}
                          <strong>{a.barrios_prioritarios.length}</strong>{" "}
                          prioritarios
                        </>
                      )}
                    </p>
                    {a.barrios_afectados_nombres.length > 0 && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-primary underline-offset-2 hover:underline dark:text-dk-primary">
                          Ver lista completa
                        </summary>
                        <p className="mt-1 text-neutral-text dark:text-dk-text">
                          {a.barrios_afectados_nombres.join(", ")}
                        </p>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>

            <footer className="border-t border-neutral-border px-4 py-3 text-[11px] italic text-neutral-muted dark:border-dk-border dark:text-dk-muted">
              Generado: {payload?.generated_at || "—"} · Reglas configurables en{" "}
              <code>config/alertas.yaml</code>.
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
