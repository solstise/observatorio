"use client";

// Hook que expone el tema activo (light/dark) y permite cambiarlo.
//
// Diseño:
// - El estado autoritativo NO es React: vive en `localStorage.theme` (con
//   tres valores posibles: "light", "dark", "system") y en la clase
//   `dark` del <html>. React es solo un espejo reactivo.
// - Antes de la hidratación, el script inline en layout.tsx ya pintó la
//   clase correcta sobre <html>, así que en el primer render del cliente
//   leemos `document.documentElement.classList.contains("dark")` para
//   inicializar el estado sin mismatch.
// - Se escuchan dos fuentes de cambio:
//     1) Cambios en la clase del <html> (vía MutationObserver) — clave
//        para que los componentes que dependen del tema (Leaflet,
//        Recharts) reaccionen cuando el toggle del Header lo modifica.
//     2) Cambios en `prefers-color-scheme` cuando el modo es "system" —
//        si el usuario cambia el tema del SO con la página abierta.
//
// Exportamos también `applyTheme(mode)` para que el toggle pueda forzar
// un valor sin pasar por React (más rápido) y luego la observación se
// encarga de actualizar a quien lo necesite.

import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";

// Resuelve "system" al valor real ("light" / "dark") consultando el SO.
// En SSR (sin window) defaulteamos a light para que el HTML no pinte una
// hoja oscura cuando el navegador del usuario no preferirá oscuro.
function resolveSystem(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Escribe la clase `dark` en <html> y persiste el modo elegido.
// Si modo es "system", borramos la key de localStorage para que la próxima
// vez la inicialización vuelva a delegar al SO.
export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved: ResolvedTheme = mode === "system" ? resolveSystem() : mode;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  try {
    if (mode === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    /* localStorage puede tirar en private mode / quota; ignoramos. */
  }
}

// Lee el modo persistido. Si no hay nada, devolvemos "system" para que
// la UI muestre el ícono apropiado y respete el SO.
function readMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignorar */
  }
  return "system";
}

// Lee el tema realmente aplicado en el DOM (la clase `dark` en <html>).
// Es la fuente verdadera porque el script inline del head ya la setea
// antes de hidratar — usar esto evita el mismatch SSR/CSR.
function readResolved(): ResolvedTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

interface UseThemeResult {
  /** El modo elegido por el usuario: light / dark / system. */
  mode: ThemeMode;
  /** El tema realmente aplicado: light o dark (resuelve "system"). */
  resolved: ResolvedTheme;
  /** Cambia el modo y persiste. */
  setMode: (m: ThemeMode) => void;
  /** Atajo: alterna entre light y dark (ignora "system"). */
  toggle: () => void;
}

export function useTheme(): UseThemeResult {
  // Inicializamos desde el DOM (no desde localStorage) para mantener la
  // verdad sincronizada con lo que el script inline ya pintó.
  const [resolved, setResolved] = useState<ResolvedTheme>(() => readResolved());
  const [mode, setModeState] = useState<ThemeMode>(() => readMode());

  // 1. Observar cambios en la clase del <html> — disparado por cualquier
  //    componente que llame a `applyTheme` o por un toggle en otra pestaña.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const obs = new MutationObserver(() => {
      setResolved(readResolved());
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // 2. Si el usuario eligió "system", reaccionar a cambios del SO.
  //    Si eligió light/dark explícito, ignoramos cambios del SO (el toggle
  //    manual gana).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [mode]);

  // 3. Si cambia localStorage en otra pestaña (sincronización entre tabs).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readMode();
      setModeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    applyTheme(m);
  }, []);

  const toggle = useCallback(() => {
    // Toggle simple: si estamos resolviendo a dark, vamos a light, y
    // viceversa. Esto convierte "system" en una elección explícita la
    // primera vez que se toca el botón, lo cual es la convención más usada
    // (Vercel, Linear, Tailwind docs).
    const next: ThemeMode = readResolved() === "dark" ? "light" : "dark";
    setModeState(next);
    applyTheme(next);
  }, []);

  return { mode, resolved, setMode, toggle };
}
