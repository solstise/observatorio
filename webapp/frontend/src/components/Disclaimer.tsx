"use client";

// Banner permanente visible en todas las vistas con datos.
// Explica naturaleza pública de los datos y remite a metodología.
//
// El usuario puede descartarlo en su navegador (sessionStorage para que
// reaparezca en la próxima sesión y nunca quede oculto definitivamente).
// El layout queda compacto en mobile (≤640px) para no comerse el viewport
// inicial encima del contenido.
//
// Dark mode: el banner conserva su rol semántico de "advertencia / aviso"
// en ambos temas. En light usa accent-50 (durazno claro) y en dark un
// amber-900/40 con texto amber-100 — el matiz cálido se mantiene para que
// el ojo siga reconociéndolo como "aviso", pero ajustado para legibilidad
// sobre fondo oscuro.

import Link from "next/link";
import { useEffect, useState } from "react";

const STORAGE_KEY = "obs-disclaimer-v2";

export function Disclaimer() {
  const [visible, setVisible] = useState(true);

  // Lectura en mount para evitar FOUC; si está marcado en sessionStorage,
  // ocultamos sin animación.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "dismissed") {
        setVisible(false);
      }
    } catch {
      /* ignorar SSR / quota errors */
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      sessionStorage.setItem(STORAGE_KEY, "dismissed");
    } catch {
      /* ignorar */
    }
  }

  return (
    <div
      role="note"
      aria-label="Aviso sobre el origen de los datos"
      className="border-y border-accent-100 bg-accent-50 dark:border-amber-700/60 dark:bg-amber-900/40"
    >
      <div className="container-obs flex items-start gap-3 py-2.5 text-xs sm:text-sm leading-relaxed text-neutral-text dark:text-amber-100">
        <p className="flex-1">
          Datos públicos y gratuitos (Sentinel-2 ESA, Google Open Buildings,
          WorldPop, OpenStreetMap). Las cifras tienen un margen de error
          declarado.{" "}
          <Link
            href="/metodologia"
            className="font-medium text-primary underline-offset-2 hover:underline dark:text-amber-50 dark:underline"
          >
            Ver metodología
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Cerrar aviso"
          className="-mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-neutral-muted transition-colors hover:bg-accent-100 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:text-amber-200 dark:hover:bg-amber-800/60 dark:hover:text-amber-50 dark:focus-visible:outline-amber-200"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
