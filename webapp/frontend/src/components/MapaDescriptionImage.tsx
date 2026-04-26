"use client";

// Wrapper de next/image que enriquece alt + tooltip con la descripción
// auto-generada por scripts/_descripcion_mapas.py (BLIP + NLLB o
// placeholder).
//
// Comportamiento:
//
// - Al montar, busca la descripción en `mapas_descripciones.json` por
//   filename. Si la encuentra, la usa como `alt` y `title`. Eso da:
//     - Mejor accesibilidad (lectores de pantalla anuncian el contenido
//       real de la imagen, no solo "Comparación HD de X").
//     - Tooltip al hover en desktop.
// - Si la descripción no existe, cae al `fallbackAlt` que pasa el padre.
// - El JSON se cachea en memoria entre instancias (cache global en
//   data.client.ts), así múltiples imágenes en la misma página solo hacen
//   un fetch.
//
// Optimización (M6 performance):
// - Usamos next/image con `unoptimized=false` para que Next genere
//   variantes AVIF/WebP servidas según `Accept` del browser. Esto reduce
//   ~60-70% el peso real entregado vs el PNG original (1-4 MB → ~300-800 KB).
// - `loading="lazy"` por defecto: el HD comparison vive bien abajo en el
//   scroll, no pintarlo eager evita bloquear LCP.
// - `sizes` declarado para que el optimizer genere srcset adecuado.

import Image from "next/image";
import { useEffect, useState } from "react";

import { getDescripcionMapa, type MapaDescripcion } from "@/lib/data.client";

interface MapaDescriptionImageProps {
  src: string;
  // Filename para buscar la descripción (sin path). Si no se pasa, derivamos
  // del último segmento de `src`.
  filename?: string;
  fallbackAlt: string;
  className?: string;
  loading?: "eager" | "lazy";
  // Dimensiones reales del PNG. Si no se pasan, asumimos 1600x900 que es
  // el tamaño aprox de los _comparacion_hd.png generados por la pipeline.
  width?: number;
  height?: number;
}

export function MapaDescriptionImage({
  src,
  filename,
  fallbackAlt,
  className,
  loading = "lazy",
  width = 1600,
  height = 900,
}: MapaDescriptionImageProps) {
  const [desc, setDesc] = useState<MapaDescripcion | undefined>(undefined);
  const fname = filename ?? src.split("/").pop() ?? "";

  useEffect(() => {
    if (!fname) return;
    let aborted = false;
    getDescripcionMapa(fname)
      .then((d) => {
        if (!aborted) setDesc(d);
      })
      .catch(() => {
        // El JSON puede no existir todavía (script aún no corrió). Esto no
        // es un error — caemos al fallback silenciosamente.
      });
    return () => {
      aborted = true;
    };
  }, [fname]);

  // alt y title conviven: alt alimenta a screen readers + SEO; title da el
  // tooltip al hover. Si la descripción está disponible, ambos llevan la
  // versión generada en español (más útil para el target del observatorio).
  const altText = desc?.caption_es ?? fallbackAlt;
  const tooltipText = desc?.caption_es ?? fallbackAlt;

  return (
    <Image
      src={src}
      alt={altText}
      title={tooltipText}
      aria-label={altText}
      className={className}
      loading={loading}
      width={width}
      height={height}
      // sizes le dice al optimizer cuál srcset generar: en mobile ocupa el
      // 100% del viewport, en desktop lg/xl entra en el grid principal de
      // ~1024px max. Sin esto Next genera srcset enorme y desperdicia.
      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 90vw, 1024px"
    />
  );
}

export default MapaDescriptionImage;
