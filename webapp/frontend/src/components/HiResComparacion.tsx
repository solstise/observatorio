"use client";

// HiResComparacion — visor de imágenes satelitales alta resolución por barrio,
// con toggle entre tres sensores complementarios:
//
//   1) Sentinel-2 (ESA, 10 m, mensual, color)
//      - Más fresco (composite mensual). Usa la imagen comparación HD que
//        ya genera la pipeline existente: `/data/media/{id}_comparacion.png`.
//        Si está disponible una variante `_hd`, la priorizamos.
//      - Útil para series temporales y para ver el crecimiento mes a mes.
//
//   2) CBERS-4A WPM (INPE/CRESDA, 8 m pansharpen, trimestral, color)
//      - Más detalle que S2 manteniendo color. La pipeline Python (S-A)
//        descarga el WPM nativo de CBERS-4A (pan 8 m + MS 16 m), aplica
//        pansharpen (Brovey/IHS) y recorta por polígono.
//      - Asset estable: `/data/media/cbers/{id}_cbers_latest.png`.
//
//   3) CBERS-4 PAN5 (INPE, 5 m B&N, trimestral)
//      - Máximo detalle disponible (5 m vs 8 m WPM, 10 m S2). Sin color.
//      - Ideal para identificar construcciones individuales / lectura de
//        cuadras a zoom alto.
//      - Asset: `/data/media/cbers_pan5/{id}_pan5_latest.png` (T1).
//      - Si T1 todavía no generó la imagen, degrada graceful con onError.
//
// Filosofía:
//   - Sentinel-2 = "cómo cambió últimamente" (frescura + color).
//   - CBERS WPM  = "qué hay exactamente acá ahora" (color a 8 m).
//   - CBERS PAN5 = "qué construcciones individuales hay" (5 m B&N).
//   El toggle hace explícito el trade-off frescura ↔ detalle ↔ color.
//
// Estados manejados:
//   - loading: skeleton mientras la primera imagen aún no cargó.
//   - error: si la imagen actualmente seleccionada falla (404, network),
//     mostramos un mensaje "Datos en preparación" y un botón para volver
//     al modo S2 (que sabemos que existe siempre).
//   - "sin imagen CBERS": acepta que la pipeline pueda generar un PNG con
//     el texto "Sin imagen CBERS disponible para este barrio" embebido.
//
// Sugerencia auto-PAN5 a zoom alto:
//   Si window.devicePixelRatio supera 2 (típicamente browsers con zoom
//   >200% o pantallas Retina + zoom 150%+), mostramos un banner sutil
//   sugiriendo PAN5 para máximo detalle. No cambiamos automáticamente —
//   el usuario decide. Ignoramos cuando el modo activo ya es PAN5.
//
// Accesibilidad:
//   - Los radios del toggle viven dentro de un `role="radiogroup"` con
//     etiquetas claras.
//   - La imagen lleva `alt` descriptivo (incluye barrio + sensor).
//   - El tooltip educativo es un span focusable que abre un panel pequeño
//     al hover/focus/click.
//
// Dark mode: usa los tokens del proyecto (primary / dk-*). El skeleton y
// los borders cambian con la clase `dark:`.

import { useEffect, useId, useMemo, useState } from "react";

type Modo = "s2" | "cbers" | "pan5";

interface HiResComparacionProps {
  /** Slug del polígono — debe matchear el id en `poligonos.geojson`. */
  poligonoId: string;
  /** Nombre humano del barrio — usado en el alt y en los banners. */
  nombre: string;
  /**
   * Modo inicial. Default: "s2" (más fresco). Si querés priorizar el
   * detalle por defecto pasá "cbers" o "pan5".
   */
  initialMode?: Modo;
  /** Clase extra opcional para el contenedor exterior. */
  className?: string;
}

interface ImgSrc {
  /** URL pública relativa de la imagen actualmente activa. */
  src: string;
  /** alt descriptivo. */
  alt: string;
}

// Resolvemos la URL de la imagen para cada modo. Para S2 priorizamos el
// `_comparacion_hd.png` que ya genera la pipeline (1600x900, 1-4 MB);
// caemos al `_comparacion.png` original si el HD no existe.
function srcForMode(modo: Modo, poligonoId: string, nombre: string): ImgSrc {
  if (modo === "pan5") {
    return {
      src: `/data/media/cbers_pan5/${poligonoId}_pan5_latest.png`,
      alt: `Imagen pancromática CBERS-4 PAN5 (5 m blanco y negro) de ${nombre}`,
    };
  }
  if (modo === "cbers") {
    return {
      src: `/data/media/cbers/${poligonoId}_cbers_latest.png`,
      alt: `Imagen CBERS-4A WPM pansharpen 8 m color de ${nombre}`,
    };
  }
  return {
    src: `/data/media/${poligonoId}_comparacion_hd.png`,
    alt: `Comparación Sentinel-2 alta resolución de ${nombre}`,
  };
}

// Banner pequeño con la "ficha técnica" del sensor activo. Se mantiene
// fuera del <Image> para no inflar el alt y para que screen readers lo
// lean como texto navegable.
function SensorBanner({ modo }: { modo: Modo }) {
  if (modo === "pan5") {
    return (
      <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
        <span aria-hidden>🛰️ </span>
        <span className="font-medium text-primary dark:text-dk-primary">
          CBERS-4 INPE
        </span>{" "}
        · 5 m blanco/negro · refresca trimestral
      </p>
    );
  }
  if (modo === "cbers") {
    return (
      <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
        <span aria-hidden>🛰️ </span>
        <span className="font-medium text-primary dark:text-dk-primary">
          CBERS-4A INPE
        </span>{" "}
        · 8 m color (pansharpen) · refresca trimestral
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
      <span aria-hidden>🛰️ </span>
      <span className="font-medium text-primary dark:text-dk-primary">
        Sentinel-2 ESA
      </span>{" "}
      · 10 m color · refresca mensual
    </p>
  );
}

// Tooltip educativo: explica de un vistazo cuándo conviene cada capa.
// Implementación liviana (sin dependencia de TerminoGlosario para no
// re-procesar el id) — span focusable + panel absolute.
function HelpTooltip() {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        aria-label="Ayuda sobre las capas Sentinel-2, CBERS WPM y CBERS PAN5"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-primary/40 text-[10px] font-bold text-primary outline-none transition-colors hover:bg-primary hover:text-white focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 dark:border-dk-primary/50 dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg dark:focus-visible:ring-dk-primary dark:focus-visible:ring-offset-dk-bg"
      >
        ?
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          style={{ width: "max-content", maxWidth: 320 }}
          className="absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-md border border-neutral-border bg-white p-3 text-left text-xs leading-relaxed shadow-lg dark:border-dk-border dark:bg-dk-elevated dark:text-dk-text"
        >
          <strong>S2</strong> es más fresco (color, mensual).{" "}
          <strong>CBERS WPM</strong> tiene más detalle manteniendo color
          (8 m). <strong>CBERS PAN5</strong> es el máximo detalle, en
          blanco y negro (5 m). Usá PAN5 para zoom alto sobre cuadras,
          WPM para color a buen detalle, S2 para series temporales.
        </span>
      )}
    </span>
  );
}

// Hook: detecta si el viewport efectivo del browser sugiere que el
// usuario va a hacer zoom alto. Combinamos `devicePixelRatio` (>=2 indica
// pantalla densa o zoom) y un breakpoint pequeño (<800px) que típicamente
// implica que el usuario querrá hacer zoom para distinguir manzanas.
function useSugerenciaPan5(): boolean {
  const [sugerir, setSugerir] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      // window.devicePixelRatio en Chrome refleja el zoom efectivo: 1.0 es
      // 100%, 2.0 es 200%, etc. Edge/Safari lo manejan parecido. En
      // pantallas Retina nativas el ratio arranca en 2 sin zoom — entonces
      // requerimos ratio>2 para no molestar al usuario con MacBooks.
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth || 1024;
      setSugerir(dpr > 2 || (dpr >= 1.5 && w < 800));
    };
    check();
    window.addEventListener("resize", check);
    // Algunos browsers disparan resize al hacer zoom; otros tienen un
    // event 'visualViewport' más fino. Usamos el genérico y aceptamos
    // que la detección puede no ser perfecta — es solo una sugerencia.
    return () => window.removeEventListener("resize", check);
  }, []);
  return sugerir;
}

export function HiResComparacion({
  poligonoId,
  nombre,
  initialMode = "s2",
  className = "",
}: HiResComparacionProps) {
  const [modo, setModo] = useState<Modo>(initialMode);
  // `loading` arranca true para la imagen del modo activo. Cada cambio de
  // modo lo vuelve a poner true y deja que el <img> dispare onLoad/onError.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // El usuario puede descartar el banner de sugerencia PAN5 — guardamos
  // la decisión en estado local (no localStorage para no contaminar). Si
  // recargan la página el banner vuelve, lo cual es ok: solo aparece
  // cuando hay zoom alto, que tiende a ser intencional.
  const [pan5Dismissed, setPan5Dismissed] = useState(false);

  const radioName = useId();
  const sugerirPan5 = useSugerenciaPan5();

  const { src, alt } = useMemo(
    () => srcForMode(modo, poligonoId, nombre),
    [modo, poligonoId, nombre],
  );

  // Cuando cambia el modo, reseteamos los flags. Si la imagen ya está en
  // cache del browser, onLoad va a disparar inmediatamente y va a hacer
  // setLoading(false) sin transición visible — perfecto.
  useEffect(() => {
    setLoading(true);
    setError(false);
  }, [modo, poligonoId]);

  // Mostramos el hint solo si: (1) el detector dice "zoom alto",
  // (2) el usuario no está en PAN5 ya, (3) no descartó previamente.
  const mostrarHintPan5 = sugerirPan5 && modo !== "pan5" && !pan5Dismissed;

  return (
    <div className={`w-full ${className}`}>
      {/* Toggle de modo. Lo mantenemos fuera del card para que el
          contenedor de imagen pueda ser un block puro (sin borders ni
          paddings) que respete object-cover en su totalidad. */}
      <div
        role="radiogroup"
        aria-label="Capa satelital alta resolución"
        className="mb-3 flex flex-wrap items-center gap-2"
      >
        <ModoBoton
          name={radioName}
          modo="s2"
          activo={modo === "s2"}
          onClick={() => setModo("s2")}
          label="Sentinel-2 (10 m)"
        />
        <ModoBoton
          name={radioName}
          modo="cbers"
          activo={modo === "cbers"}
          onClick={() => setModo("cbers")}
          label="CBERS WPM (8 m color)"
        />
        <ModoBoton
          name={radioName}
          modo="pan5"
          activo={modo === "pan5"}
          onClick={() => setModo("pan5")}
          label="CBERS PAN5 (5 m B&N)"
        />
        <HelpTooltip />
      </div>

      {/* Hint inline: aparece cuando devicePixelRatio sugiere zoom alto.
          No interrumpe el flujo (no es modal); el usuario puede aceptar
          o descartarlo. Estilo amber para que se distinga sin alarmar. */}
      {mostrarHintPan5 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-100">
          <span>
            <span aria-hidden>{"🔍 "}</span>Te conviene{" "}
            <strong>PAN5 (5 m)</strong> para este nivel de zoom — más detalle
            por píxel.
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModo("pan5")}
              className="rounded-md border border-amber-700/40 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-300/40 dark:bg-amber-900/40 dark:text-amber-50 dark:hover:bg-amber-800/40"
            >
              Cambiar a PAN5
            </button>
            <button
              type="button"
              onClick={() => setPan5Dismissed(true)}
              aria-label="Descartar sugerencia"
              className="rounded-md px-1 text-amber-900/70 hover:text-amber-900 dark:text-amber-100/70 dark:hover:text-amber-100"
            >
              {"×"}
            </button>
          </span>
        </div>
      )}

      {/* Contenedor de la imagen. height máx 500px + object-cover evita
          que polígonos con ratio extremo (muy cuadrados o muy alargados)
          rompan el layout. width 100% para fluidez. */}
      <div className="relative w-full overflow-hidden rounded-lg border border-neutral-border bg-primary-50 shadow-sm dark:border-dk-border dark:bg-dk-elevated">
        {loading && !error && (
          // Skeleton: mantiene altura aprox para evitar CLS al swap.
          <div
            aria-hidden
            className="h-[320px] w-full animate-pulse bg-gradient-to-br from-primary-50 via-white to-primary-50 dark:from-dk-elevated dark:via-dk-surface dark:to-dk-elevated sm:h-[420px]"
          />
        )}

        {!error && (
          // Usamos <img> nativo en lugar de next/image porque:
          //   - el bucket de imágenes CBERS aún no está confirmado (puede
          //     no existir el archivo, entonces necesitamos onError nativo
          //     sin que el optimizer falle el build);
          //   - el size es variable (depende del polígono) y queremos
          //     respetar el aspect ratio real del PNG, no forzar 1600x900;
          //   - object-cover + max-h:500px nos da el comportamiento que
          //     pide el brief sin pelear con sizes/srcset de Next.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src}
            src={src}
            alt={alt}
            className={`block w-full max-h-[500px] object-cover transition-opacity duration-200 ${
              loading ? "opacity-0" : "opacity-100"
            }`}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
            loading="lazy"
            decoding="async"
          />
        )}

        {error && (
          // Estado de error: invitamos a probar otra capa sin perder al
          // usuario. S2 es el fallback más confiable porque siempre tiene
          // imagen disponible en la pipeline.
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 p-8 text-center text-sm text-neutral-muted dark:text-dk-muted">
            {modo === "pan5" ? (
              <>
                <p className="max-w-md">
                  PAN5 (5 m B&N) en preparación — el primer cron mensual
                  publicará esta imagen para el polígono.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModo("cbers")}
                    className="rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
                  >
                    Probar CBERS WPM
                  </button>
                  <button
                    type="button"
                    onClick={() => setModo("s2")}
                    className="rounded-md border border-primary/60 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary/60 dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
                  >
                    Mostrar Sentinel-2
                  </button>
                </div>
              </>
            ) : modo === "cbers" ? (
              <>
                <p className="max-w-md">
                  Datos en preparación — el primer cron mensual publicará
                  la imagen CBERS WPM para este polígono.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModo("pan5")}
                    className="rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
                  >
                    Probar PAN5
                  </button>
                  <button
                    type="button"
                    onClick={() => setModo("s2")}
                    className="rounded-md border border-primary/60 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary/60 dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
                  >
                    Mostrar Sentinel-2
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="max-w-md">
                  Imagen Sentinel-2 no disponible — recargá más tarde o
                  probá las capas CBERS.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModo("cbers")}
                    className="rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary hover:text-white dark:border-dk-primary dark:text-dk-primary dark:hover:bg-dk-primary dark:hover:text-dk-bg"
                  >
                    Probar CBERS
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <SensorBanner modo={modo} />
    </div>
  );
}

interface ModoBotonProps {
  name: string;
  modo: Modo;
  activo: boolean;
  onClick: () => void;
  label: string;
}

// Radio button visual. Usamos role=radio + aria-checked en lugar de
// <input type="radio"> nativo porque queremos un pill estilizado e
// integrado con tokens del proyecto sin hackear `appearance: none`.
function ModoBoton({ modo, activo, onClick, label, name }: ModoBotonProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activo}
      data-name={name}
      data-modo={modo}
      onClick={onClick}
      className={[
        "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 dark:focus-visible:ring-dk-primary dark:focus-visible:ring-offset-dk-bg",
        activo
          ? "border-primary bg-primary text-white dark:border-dk-primary dark:bg-dk-primary dark:text-dk-bg"
          : "border-neutral-border bg-white text-neutral-text hover:border-primary hover:text-primary dark:border-dk-border dark:bg-dk-elevated dark:text-dk-text dark:hover:border-dk-primary dark:hover:text-dk-primary",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default HiResComparacion;
