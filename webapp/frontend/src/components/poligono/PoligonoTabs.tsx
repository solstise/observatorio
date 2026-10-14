"use client";

// <PoligonoTabs> — tabs deeplinkables para la ficha de barrio.
//
// El page server-component carga TODO en Promise.all y nos pasa cada
// "panel" pre-renderizado como ReactNode. Acá decidimos cuál mostrar
// según `?tab=<key>` en la URL (default = "diagnostico").
//
// Al cambiar de tab:
//   - actualizamos la URL con router.replace (sin entrada en history,
//     pero bookmarkable y back/forward friendly)
//   - hacemos scroll suave al inicio del bloque de tabs para que el
//     usuario no quede a mitad del panel viejo
//
// Accesibilidad:
//   - role="tablist" / role="tab" / role="tabpanel"
//   - aria-selected y aria-controls
//   - flechas izq/der + Home/End para navegar entre tabs (patrón
//     APG, tabs activado automáticamente con focus)
//
// Fallback sin JS: en SSR renderizamos el panel "diagnostico" como
// default (si vino `?tab=` en query lo respetamos) y un <noscript>
// con todos los paneles como <details> stacked.

import { useEffect, useId, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export type PoligonoTabKey =
  | "diagnostico"
  | "pronostico"
  | "calidad"
  | "historia"
  | "datos";

interface PoligonoTabsProps {
  panels: Record<PoligonoTabKey, ReactNode>;
}

const TAB_DEFS: { key: PoligonoTabKey; label: string; shortLabel: string }[] = [
  { key: "diagnostico", label: "Diagnóstico hoy", shortLabel: "Diagnóstico" },
  { key: "pronostico", label: "Pronóstico 14 días", shortLabel: "Pronóstico" },
  { key: "calidad", label: "Calidad de vida", shortLabel: "Calidad" },
  { key: "historia", label: "Historia", shortLabel: "Historia" },
  { key: "datos", label: "Datos", shortLabel: "Datos" },
];

function parseTab(value: string | null | undefined): PoligonoTabKey {
  if (value && TAB_DEFS.some((t) => t.key === value)) {
    return value as PoligonoTabKey;
  }
  return "diagnostico";
}

export function PoligonoTabs({ panels }: PoligonoTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get("tab"));
  const tablistRef = useRef<HTMLDivElement | null>(null);
  // Marker para hacer scroll cuando cambia el tab. No queremos scrollear
  // en el primer render (mount), solo después.
  const isFirstRender = useRef(true);
  const baseId = useId();

  // Cambia el tab: actualiza la URL preservando otros query params.
  const setTab = (key: PoligonoTabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "diagnostico") {
      params.delete("tab"); // default limpio en URL
    } else {
      params.set("tab", key);
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  // Scroll suave al cambiar tab. Saltamos el primer render para no
  // sacudir la página cuando se llega con deeplink.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (typeof window === "undefined") return;
    const el = tablistRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const top = rect.top + window.scrollY - 80; // dejá lugar para el header sticky
    window.scrollTo({ top, behavior: "smooth" });
  }, [activeTab]);

  // Navegación con teclado en el tablist (patrón ARIA APG).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = TAB_DEFS.findIndex((t) => t.key === activeTab);
    if (i < 0) return;
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TAB_DEFS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TAB_DEFS.length) % TAB_DEFS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TAB_DEFS.length - 1;
    else return;
    e.preventDefault();
    setTab(TAB_DEFS[next].key);
    // Pasar foco al nuevo tab para que el patrón sea consistente
    const tabEl = tablistRef.current?.querySelector<HTMLButtonElement>(
      `[data-tab-key="${TAB_DEFS[next].key}"]`,
    );
    tabEl?.focus();
  };

  const visiblePanel = useMemo(() => panels[activeTab], [panels, activeTab]);

  return (
    <div className="mt-6">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Secciones de la ficha del barrio"
        onKeyDown={onKeyDown}
        className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto border-b border-neutral-border bg-white/95 px-4 py-2 backdrop-blur-sm sm:mx-0 sm:rounded-t-lg sm:px-2 dark:border-dk-border dark:bg-dk-bg/95"
      >
        {TAB_DEFS.map((t) => {
          const active = t.key === activeTab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              data-tab-key={t.key}
              id={`${baseId}-tab-${t.key}`}
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              aria-controls={`${baseId}-panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              className={[
                "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 dark:focus-visible:ring-dk-primary dark:focus-visible:ring-offset-dk-bg",
                active
                  ? "bg-primary text-white dark:bg-dk-primary dark:text-dk-bg"
                  : "text-secondary hover:bg-primary-50 hover:text-primary dark:text-dk-muted dark:hover:bg-dk-elevated dark:hover:text-dk-primary",
              ].join(" ")}
            >
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.shortLabel}</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeTab}`}
        aria-labelledby={`${baseId}-tab-${activeTab}`}
        className="pt-4"
      >
        {visiblePanel}
      </div>

      {/* Fallback sin JS: si el script no se hidrata, igual quedó renderizado
          el panel default arriba (server-render). Para clientes sin JS que
          quieran ver todo, dejamos esta nota; los crawlers de buscador
          ejecutan JS modernos, así que no degradamos el SEO. */}
      <noscript>
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100">
          Las pestañas requieren JavaScript. Activalo para ver pronóstico,
          calidad de vida, historia y datos. Por ahora ves el diagnóstico.
        </p>
      </noscript>
    </div>
  );
}
