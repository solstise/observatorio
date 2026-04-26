"use client";

// Wrapper de lottie-react con dos garantías:
//
// 1. Respeto a `prefers-reduced-motion`: si el usuario lo indica en el SO,
//    no instanciamos el player (que dispara requestAnimationFrame en loop)
//    y mostramos un fallback estático — un emoji o un alt label en una caja
//    con el mismo bounding box. Esto cumple WCAG 2.3.3 (Animation from
//    Interactions) y la pauta general de accesibilidad de no quemar CPU
//    en tickers innecesarios para users que pidieron motion reducido.
//
// 2. Carga diferida del JSON desde /public/animations/. Importar JSON inline
//    inflaría el bundle JS de cada página que use cualquier animación; en
//    cambio hacemos fetch en client y cacheamos en memoria por path. Eso
//    mantiene el bundle inicial chico (~25KB lottie-react comprimido).
//
// La librería lottie-react se monta solo cuando los datos están disponibles,
// usando dynamic import para que el wrapper SSR no rompa (lottie-react
// requiere window).
//
// API:
//   <LottieAnimation src="/animations/loading-map.json" loop fallback="🌐" />
//
// Comparado con framer-motion: lottie-react ~25KB gzip vs framer-motion
// ~50KB gzip. Para nuestras animaciones declarativas (no interactivas), es
// mucho más liviano.

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

// Cache global de animaciones JSON ya descargadas. Lottie tolera reusar el
// mismo objeto entre instancias (lo lee como inmutable), así evitamos pegarle
// al filesystem para cada renderizado.
const animationCache = new Map<string, unknown>();

// Lottie player: dynamic import con ssr:false. Es el patrón que evita el
// crash "ReferenceError: window is not defined" en el render del server.
const LottiePlayer = dynamic(() => import("lottie-react"), {
  ssr: false,
  loading: () => null,
});

interface LottieAnimationProps {
  src: string;
  loop?: boolean;
  autoplay?: boolean;
  className?: string;
  // Fallback estático (texto, emoji, o cualquier ReactNode) que se muestra
  // si el usuario tiene prefers-reduced-motion: reduce, o si la carga falla.
  fallback?: React.ReactNode;
  // ARIA label para describir la animación al lector de pantalla. Si la
  // animación es decorativa, pasar undefined deja el wrapper aria-hidden.
  ariaLabel?: string;
  // Tamaño explícito (preserva el bounding box incluso con fallback). Con
  // estos valores el layout no salta cuando el JSON aún no llegó.
  width?: number | string;
  height?: number | string;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // addEventListener es lo moderno; el fallback addListener cubre Safari < 14.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

export function LottieAnimation({
  src,
  loop = true,
  autoplay = true,
  className,
  fallback,
  ariaLabel,
  width,
  height,
}: LottieAnimationProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [animation, setAnimation] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aborted = useRef(false);

  useEffect(() => {
    aborted.current = false;
    // Si el usuario quiere motion reducido, no descargamos siquiera el JSON.
    if (prefersReducedMotion) {
      setAnimation(null);
      return () => {
        aborted.current = true;
      };
    }
    const cached = animationCache.get(src);
    if (cached) {
      setAnimation(cached);
      return () => {
        aborted.current = true;
      };
    }
    fetch(src)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} loading ${src}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (aborted.current) return;
        animationCache.set(src, data);
        setAnimation(data);
      })
      .catch((e: unknown) => {
        if (aborted.current) return;
        setError(e instanceof Error ? e.message : "Error cargando animación");
      });
    return () => {
      aborted.current = true;
    };
  }, [src, prefersReducedMotion]);

  const sizeStyle = useMemo<React.CSSProperties>(
    () => ({
      width: typeof width === "number" ? `${width}px` : width,
      height: typeof height === "number" ? `${height}px` : height,
    }),
    [width, height],
  );

  // Caso 1: prefers-reduced-motion → fallback estático.
  if (prefersReducedMotion) {
    return (
      <div
        className={className}
        style={sizeStyle}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
        role={ariaLabel ? "img" : undefined}
      >
        {fallback ?? null}
      </div>
    );
  }

  // Caso 2: error de fetch → fallback estático con role="img" silencioso.
  if (error) {
    return (
      <div
        className={className}
        style={sizeStyle}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
      >
        {fallback ?? null}
      </div>
    );
  }

  // Caso 3: aún cargando — mostramos el fallback como placeholder. Cuando
  // llegue el JSON re-renderiza con el player.
  if (!animation) {
    return (
      <div
        className={className}
        style={sizeStyle}
        aria-hidden="true"
      >
        {fallback ?? null}
      </div>
    );
  }

  // Caso 4: animación lista — montamos lottie-react.
  // animationData espera el objeto JSON tal cual. loop y autoplay son props
  // estándar del player.
  return (
    <div
      className={className}
      style={sizeStyle}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
      aria-hidden={ariaLabel ? undefined : true}
    >
      <LottiePlayer
        animationData={animation as object}
        loop={loop}
        autoplay={autoplay}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

export default LottieAnimation;
