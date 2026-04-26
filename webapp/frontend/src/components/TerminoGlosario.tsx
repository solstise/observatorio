"use client";

// <TerminoGlosario id="uhi">UHI</TerminoGlosario>
//
// Span inline con borde inferior punteado que, al hover/tap/focus, muestra
// un tooltip flotante con el `resumen_corto` del término en el glosario y
// un link "→ ver más" al ancla en /metodologia#glosario-{id}.
//
// Triggers soportados:
//   - Hover (mouse enter/leave) — desktop.
//   - Tap/click (toggleable) — mobile y desktop. Tap fuera cierra.
//   - Focus por tabulación (Enter/Space abren, Escape cierra) — keyboard.
//
// Accesibilidad:
//   - Span focusable (tabIndex=0) con role="button" semántico ligero
//     mediante aria-describedby cuando el tooltip está abierto.
//   - El tooltip lleva role="tooltip" e id derivado de useId() para que el
//     screen reader anuncie el contenido como descripción del término.
//   - Cierre con Escape devuelve foco al span (no se pierde el contexto de
//     navegación por teclado).
//
// Anti-overflow:
//   - El componente mide su posición y el ancho del tooltip al abrir y
//     decide placement vertical (top/bottom) y un offset horizontal para
//     que el tooltip nunca se salga del viewport (con un margen de 8px).
//
// Tolerancia a fallos:
//   - Si el `id` no existe en el glosario (típicamente porque P1 todavía no
//     lo agregó), renderizamos plain text sin decoración + console.warn en
//     dev. El padre NUNCA crashea.
//   - Si el módulo `lib/glosario` aún no existe o exporta `GLOSARIO = []`,
//     lo manejamos con un import resiliente (try/catch en runtime no aplica
//     a ESM, pero guard con default `[]` cubre el caso del array vacío y
//     el arreglo a nivel de módulo se resuelve en build-time).
//
// Uso:
//   <TerminoGlosario id="uhi">UHI</TerminoGlosario>
//   <TerminoGlosario id="ndvi" />              // sin children → usa `termino`
//   <TerminoGlosario id="no-existe">x</TerminoGlosario> // → plain text + warn

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { GLOSARIO } from "@/lib/glosario";
import type { TerminoGlosario as TerminoGlosarioData } from "@/lib/glosario-types";

interface Props {
  /** Slug ASCII en minúsculas, debe matchear `id` de algún término en GLOSARIO. */
  id: string;
  /** Texto a mostrar. Si se omite, usamos el `termino` del glosario. */
  children?: ReactNode;
  /** Clase extra opcional para el span. */
  className?: string;
}

// Index para lookup O(1). Como GLOSARIO es estático (data en módulo), lo
// computamos una vez por carga de módulo. Si GLOSARIO crece a >100 entries
// esto evita un .find() en cada render.
const INDEX: Map<string, TerminoGlosarioData> = (() => {
  const m = new Map<string, TerminoGlosarioData>();
  if (Array.isArray(GLOSARIO)) {
    for (const t of GLOSARIO) m.set(t.id, t);
  }
  return m;
})();

// Set para no spamear console.warn por el mismo id en cada re-render.
const WARNED = new Set<string>();

// SSR-safe: en server no hay window. useLayoutEffect emite warning durante
// SSR; usamos un alias condicional para que se comporte como useEffect en
// SSR y como useLayoutEffect en cliente (evita flash de placement).
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type Placement = "top" | "bottom";

interface PositionState {
  placement: Placement;
  /** offset horizontal del tooltip respecto al span (px). */
  offsetX: number;
}

const TOOLTIP_MAX_WIDTH = 280;
const TOOLTIP_GAP = 8; // separación trigger ↔ tooltip
const VIEWPORT_MARGIN = 8; // margen mínimo respecto al borde del viewport

export function TerminoGlosario({ id, children, className = "" }: Props) {
  const term = INDEX.get(id);
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PositionState>({
    placement: "top",
    offsetX: 0,
  });

  // Si el id no existe → render plain text. NUNCA crashear el padre.
  if (!term) {
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      if (!WARNED.has(id)) {
        WARNED.add(id);
        // eslint-disable-next-line no-console
        console.warn(
          `[TerminoGlosario] id="${id}" no existe en GLOSARIO. ` +
            `Renderizando como texto plano. Definir el término en lib/glosario.ts ` +
            `o corregir el id usado en el JSX.`,
        );
      }
    }
    return <>{children ?? id}</>;
  }

  const label = children ?? term.termino;

  // Calcula placement y offset para que el tooltip nunca se salga del
  // viewport. Llamado al abrir y en resize/scroll mientras está abierto.
  const recompute = useCallback(() => {
    const trigger = triggerRef.current;
    const tooltip = tooltipRef.current;
    if (!trigger || !tooltip) return;

    const rect = trigger.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // Placement vertical: si no entra arriba pero sí abajo, abrir abajo.
    const fitsTop = rect.top - tipRect.height - TOOLTIP_GAP > VIEWPORT_MARGIN;
    const fitsBottom =
      rect.bottom + tipRect.height + TOOLTIP_GAP < vh - VIEWPORT_MARGIN;
    let placement: Placement = "top";
    if (!fitsTop && fitsBottom) placement = "bottom";
    else if (!fitsTop && !fitsBottom) placement = "bottom"; // mejor ver algo abajo

    // Offset horizontal: centrar el tooltip respecto al span y luego
    // empujarlo si se sale por izq/der.
    const triggerCenterX = rect.left + rect.width / 2;
    const tipHalf = tipRect.width / 2;
    let leftEdge = triggerCenterX - tipHalf;
    if (leftEdge < VIEWPORT_MARGIN) leftEdge = VIEWPORT_MARGIN;
    if (leftEdge + tipRect.width > vw - VIEWPORT_MARGIN) {
      leftEdge = vw - VIEWPORT_MARGIN - tipRect.width;
    }
    // offsetX expresado relativo al borde izquierdo del trigger.
    const offsetX = leftEdge - rect.left;

    setPosition({ placement, offsetX });
  }, []);

  useIsoLayoutEffect(() => {
    if (!open) return;
    recompute();
  }, [open, recompute]);

  // Re-cálculo en resize/scroll mientras esté abierto (mobile zoom, etc).
  useEffect(() => {
    if (!open) return;
    const onChange = () => recompute();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [open, recompute]);

  // Cierre por Escape + click outside (cuando está abierto).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (
        triggerRef.current?.contains(target) ||
        tooltipRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // Hover (mouse) abre / cierra. Para evitar flicker al mover el mouse del
  // trigger al tooltip, usamos un pequeño delay en el cierre y permitimos
  // mantener abierto si el mouse está sobre el tooltip.
  const closeTimerRef = useRef<number | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  useEffect(() => {
    return () => cancelClose();
  }, [cancelClose]);

  const onMouseEnter = () => {
    cancelClose();
    setOpen(true);
  };
  const onMouseLeave = () => scheduleClose();

  const onClick = (e: React.MouseEvent) => {
    // En desktop, el hover ya abre. Pero el click sirve para "anclar" el
    // tooltip y evitar que se cierre al sacar el mouse — útil para copiar
    // el resumen o hacer click en el link "ver más". También es el camino
    // natural en mobile (sin hover).
    e.stopPropagation();
    cancelClose();
    setOpen((v) => !v);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cancelClose();
      setOpen((v) => !v);
    }
  };

  const placementStyles = useMemo<React.CSSProperties>(() => {
    if (position.placement === "top") {
      return {
        bottom: "100%",
        marginBottom: TOOLTIP_GAP,
        left: position.offsetX,
      };
    }
    return {
      top: "100%",
      marginTop: TOOLTIP_GAP,
      left: position.offsetX,
    };
  }, [position]);

  return (
    <span
      ref={triggerRef}
      tabIndex={0}
      role="button"
      aria-describedby={open ? tooltipId : undefined}
      aria-expanded={open}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onMouseEnter}
      onBlur={(e) => {
        // No cerrar si el foco se mueve al tooltip (ej: tab al link "ver más").
        const next = e.relatedTarget as Node | null;
        if (next && tooltipRef.current?.contains(next)) return;
        scheduleClose();
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={[
        "relative inline cursor-help border-b border-dotted border-primary/40 align-baseline",
        "text-primary outline-none",
        "hover:border-primary/70 dark:border-dk-primary/50 dark:text-dk-primary dark:hover:border-dk-primary/80",
        "focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 dark:focus-visible:ring-dk-primary dark:focus-visible:ring-offset-dk-bg",
        className,
      ].join(" ")}
    >
      {label}
      {open && (
        // El tooltip se ancla al span trigger via `position: absolute`. El
        // span trigger tiene `position: relative` (clase `relative`) para
        // ser el containing block. z-50 asegura que aparezca por encima de
        // mapas Leaflet, banners y otros overlays del observatorio.
        <span
          ref={tooltipRef as unknown as React.RefObject<HTMLSpanElement>}
          id={tooltipId}
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{
            ...placementStyles,
            maxWidth: TOOLTIP_MAX_WIDTH,
            width: "max-content",
          }}
          className={[
            "absolute z-50 block rounded-md p-3 text-left text-xs leading-relaxed shadow-lg",
            "border border-neutral-border bg-white text-neutral-text",
            "dark:border-dk-border dark:bg-dk-elevated dark:text-dk-text",
            // Texto normal dentro del tooltip (el padre fuerza `text-primary`
            // para el estilo del término); reset para que el contenido se
            // lea correctamente.
            "font-normal normal-case tracking-normal",
          ].join(" ")}
        >
          <span className="block font-semibold text-primary dark:text-dk-primary">
            {term.termino}
          </span>
          <span className="mt-1 block">{term.resumen_corto}</span>
          <Link
            href={`/metodologia#glosario-${term.id}`}
            onClick={() => setOpen(false)}
            className="mt-2 inline-block text-[11px] font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent dark:text-dk-accent dark:decoration-dk-accent/40 dark:hover:decoration-dk-accent"
          >
            → ver más en glosario
          </Link>
        </span>
      )}
    </span>
  );
}

export default TerminoGlosario;
