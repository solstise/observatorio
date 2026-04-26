"use client";

// <GlosarioCompleto /> — sección completa del glosario en /metodologia.
//
// Estructura:
//   1. Input de búsqueda con filtro en tiempo real sobre `termino`,
//      `resumen_corto`, `descripcion_larga` y `alias`.
//   2. Contador "Mostrando X de N términos" cuando hay filtro activo.
//   3. Lista agrupada por categoría con <h3 id="categoria-{key}">.
//   4. Cada término en <article id="glosario-{id}"> con scroll-mt para que
//      el header sticky no tape el ancla al saltar desde un tooltip.
//   5. Botón "Volver arriba" sticky cuando se scrollea más de ~600px.
//   6. Mensaje "Sin resultados" cuando el filtro no matchea nada.
//
// Markdown mini-parser:
//   - **bold**, *italic*, `code` y \n\n para párrafos. Implementado en
//     `renderMarkdown` con regex; no instalamos `marked` ni `react-markdown`.
//   - Sanitización: no procesamos HTML; los caracteres < > & del texto
//     llegan como nodos React (no innerHTML), por lo que el riesgo XSS
//     es nulo. Las URLs externas usan target="_blank" + rel.
//
// Tolerancia:
//   - Si GLOSARIO está vacío (P1 todavía no terminó), mostramos una nota
//     amistosa en lugar de crashear.

import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { GLOSARIO } from "@/lib/glosario";
import {
  CATEGORIA_LABELS,
  type CategoriaGlosario,
  type TerminoGlosario as TerminoGlosarioData,
} from "@/lib/glosario-types";

// Orden visual de las categorías. Si CATEGORIA_LABELS crece, agregar acá.
const CATEGORIA_ORDER: CategoriaGlosario[] = [
  "satelital",
  "calor",
  "estadistica",
  "social",
  "datos_publicos",
  "infraestructura",
];

// ---- Markdown mini-parser ------------------------------------------------
// Procesa **bold**, *italic*, `code`. NO linkifica automáticamente. NO
// soporta listas, headings, blockquotes ni links markdown. El texto de
// `descripcion_larga` se separa primero en párrafos por \n\n, luego cada
// párrafo se tokeniza inline.
//
// Ej: "Texto con **negrita** y `código`." → un <p> con tres tokens.

interface InlineToken {
  type: "text" | "bold" | "italic" | "code";
  value: string;
  key: string;
}

// Regex única que captura los tres tipos en un solo pass para que el
// orden de los tokens en el output respete el orden de aparición.
//   `code`  : backticks
//   **bold**: dos asteriscos
//   *ital*  : un asterisco (cuidado: NO debe matchear * dentro de **bold**)
const INLINE_RE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function tokenizeInline(input: string, baseKey: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let i = 0;
  for (const m of input.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    if (start > lastIndex) {
      tokens.push({
        type: "text",
        value: input.slice(lastIndex, start),
        key: `${baseKey}-t${i++}`,
      });
    }
    if (m[1] !== undefined) {
      tokens.push({ type: "code", value: m[1], key: `${baseKey}-t${i++}` });
    } else if (m[2] !== undefined) {
      tokens.push({ type: "bold", value: m[2], key: `${baseKey}-t${i++}` });
    } else if (m[3] !== undefined) {
      tokens.push({ type: "italic", value: m[3], key: `${baseKey}-t${i++}` });
    }
    lastIndex = start + m[0].length;
  }
  if (lastIndex < input.length) {
    tokens.push({
      type: "text",
      value: input.slice(lastIndex),
      key: `${baseKey}-t${i++}`,
    });
  }
  return tokens;
}

function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.map((t) => {
    if (t.type === "bold")
      return (
        <strong key={t.key} className="font-semibold">
          {t.value}
        </strong>
      );
    if (t.type === "italic")
      return (
        <em key={t.key} className="italic">
          {t.value}
        </em>
      );
    if (t.type === "code")
      return (
        <code
          key={t.key}
          className="rounded bg-primary-50 px-1 py-0.5 font-mono text-[0.85em] text-primary dark:bg-dk-elevated dark:text-dk-primary"
        >
          {t.value}
        </code>
      );
    return <span key={t.key}>{t.value}</span>;
  });
}

function renderMarkdown(input: string, baseKey: string): ReactNode {
  // Normalizamos newlines de \r\n a \n y partimos por bloque (\n\n).
  const paragraphs = input
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paragraphs.map((p, idx) => (
    <p key={`${baseKey}-p${idx}`} className="mt-2 first:mt-0">
      {renderInline(tokenizeInline(p, `${baseKey}-p${idx}`))}
    </p>
  ));
}

// ---- Filtro de búsqueda --------------------------------------------------
// Normaliza eliminando acentos para que "isla" matchee "Isla de Calor"
// y "tropomi" matchee "TROPOMI". Lower-case.

function normalize(s: string): string {
  // U+0300 a U+036F = bloque Combining Diacritical Marks. Tras NFD,
  // los acentos viven ahí como caracteres separados que removemos.
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function matchesQuery(t: TerminoGlosarioData, qNorm: string): boolean {
  if (!qNorm) return true;
  if (normalize(t.termino).includes(qNorm)) return true;
  if (normalize(t.resumen_corto).includes(qNorm)) return true;
  if (normalize(t.descripcion_larga).includes(qNorm)) return true;
  if (t.alias?.some((a) => normalize(a).includes(qNorm))) return true;
  return false;
}

// ---- Componente ----------------------------------------------------------

export function GlosarioCompleto() {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [showTopBtn, setShowTopBtn] = useState(false);

  // Toggleamos el botón "Volver arriba" cuando se scrollea más allá del
  // umbral. listener pasivo para no bloquear el scroll en mobile.
  useEffect(() => {
    const onScroll = () => setShowTopBtn(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // GLOSARIO puede ser undefined en build muy temprano si P1 todavía no
  // creó el módulo, o un array vacío si lo creó pero está stub. Toleramos
  // ambos casos.
  const safeGlosario: TerminoGlosarioData[] = Array.isArray(GLOSARIO)
    ? GLOSARIO
    : [];
  const total = safeGlosario.length;

  const qNorm = useMemo(() => normalize(query.trim()), [query]);

  const filtered = useMemo(() => {
    if (!qNorm) return safeGlosario;
    return safeGlosario.filter((t) => matchesQuery(t, qNorm));
  }, [safeGlosario, qNorm]);

  // Agrupa por categoría preservando el orden visual definido.
  const byCategoria = useMemo(() => {
    const map = new Map<CategoriaGlosario, TerminoGlosarioData[]>();
    for (const cat of CATEGORIA_ORDER) map.set(cat, []);
    for (const t of filtered) {
      const arr = map.get(t.categoria);
      if (arr) arr.push(t);
    }
    // Dentro de cada categoría, ordenar alfabéticamente por término para
    // facilitar la lectura.
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        normalize(a.termino).localeCompare(normalize(b.termino), "es"),
      );
    }
    return map;
  }, [filtered]);

  const matched = filtered.length;
  const isFiltered = qNorm.length > 0;

  // Caso edge: glosario vacío (P1 no terminó). Mostramos un mensaje
  // amistoso en vez de una página en blanco.
  if (total === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-border bg-primary-50/50 p-4 text-sm text-neutral-muted dark:border-dk-border dark:bg-dk-elevated/50 dark:text-dk-muted">
        El glosario está siendo poblado. Volvé en breve para ver las
        definiciones de los términos técnicos del observatorio.
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* Buscador */}
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          Buscar término en el glosario
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar término, sinónimo o concepto…"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-neutral-border bg-white px-3 py-2.5 pr-10 text-sm text-neutral-text shadow-sm outline-none transition-colors placeholder:text-neutral-muted focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-dk-border dark:bg-dk-surface dark:text-dk-text dark:placeholder:text-dk-muted dark:focus-visible:border-dk-primary dark:focus-visible:ring-dk-primary/30"
          aria-describedby={`${inputId}-count`}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-neutral-muted hover:bg-primary-50 hover:text-primary dark:text-dk-muted dark:hover:bg-dk-elevated dark:hover:text-dk-primary"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
      </div>

      <p
        id={`${inputId}-count`}
        className="mt-2 text-xs text-neutral-muted dark:text-dk-muted"
        aria-live="polite"
      >
        {isFiltered ? (
          <>
            Mostrando <strong className="text-neutral-text dark:text-dk-text">{matched}</strong>{" "}
            de <strong className="text-neutral-text dark:text-dk-text">{total}</strong>{" "}
            términos
          </>
        ) : (
          <>
            <strong className="text-neutral-text dark:text-dk-text">{total}</strong>{" "}
            términos en el glosario, agrupados por categoría
          </>
        )}
      </p>

      {/* Atajos a categorías (chips) — solo cuando no hay filtro activo. */}
      {!isFiltered && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {CATEGORIA_ORDER.filter(
            (cat) => (byCategoria.get(cat)?.length ?? 0) > 0,
          ).map((cat) => (
            <li key={cat}>
              <a
                href={`#categoria-${cat}`}
                className="inline-flex items-center rounded-full border border-neutral-border bg-white px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary-50 dark:border-dk-border dark:bg-dk-surface dark:text-dk-primary dark:hover:bg-dk-elevated"
              >
                {CATEGORIA_LABELS[cat]}
                <span className="ml-1 text-neutral-muted dark:text-dk-muted">
                  ({byCategoria.get(cat)?.length ?? 0})
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* Cuerpo: agrupado por categoría o mensaje sin resultados. */}
      {matched === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-neutral-border bg-primary-50/40 p-4 text-sm text-neutral-text dark:border-dk-border dark:bg-dk-elevated/40 dark:text-dk-text">
          <p className="font-medium">Sin resultados</p>
          <p className="mt-1 text-neutral-muted dark:text-dk-muted">
            Probá con otro término o sinónimo. Por ejemplo: <em>NDVI</em>,{" "}
            <em>isla de calor</em>, <em>Sentinel</em>, <em>NO₂</em>.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          {CATEGORIA_ORDER.map((cat) => {
            const items = byCategoria.get(cat) ?? [];
            if (items.length === 0) return null;
            return (
              <section
                key={cat}
                aria-labelledby={`categoria-${cat}`}
                className="scroll-mt-20"
              >
                <h3
                  id={`categoria-${cat}`}
                  className="text-base font-semibold uppercase tracking-[0.12em] text-secondary dark:text-dk-muted"
                >
                  {CATEGORIA_LABELS[cat]}
                </h3>
                <ul className="mt-3 space-y-4">
                  {items.map((t) => (
                    <li key={t.id}>
                      <TerminoArticle term={t} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Botón "Volver arriba" — sticky, solo cuando se scrollea suficiente.
          Animación de fade para no aparecer abruptamente. */}
      {showTopBtn && (
        <button
          type="button"
          onClick={() =>
            window.scrollTo({ top: 0, behavior: "smooth" })
          }
          aria-label="Volver al inicio de la página"
          className="fixed bottom-6 right-6 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-neutral-border bg-white text-primary shadow-lg transition-all hover:bg-primary-50 hover:shadow-xl dark:border-dk-border dark:bg-dk-elevated dark:text-dk-primary dark:hover:bg-dk-surface"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// Sub-componente para cada término. Encapsula la card con anchor +
// markdown + fuente + relacionados.
function TerminoArticle({ term }: { term: TerminoGlosarioData }) {
  const baseKey = `glosario-${term.id}`;
  return (
    <article
      id={`glosario-${term.id}`}
      className="card scroll-mt-20"
      aria-labelledby={`${baseKey}-title`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4
          id={`${baseKey}-title`}
          className="text-base font-semibold text-primary dark:text-dk-primary"
        >
          {term.termino}
        </h4>
        <a
          href={`#glosario-${term.id}`}
          aria-label={`Enlace permanente a ${term.termino}`}
          title="Copiar enlace al término"
          className="text-[11px] font-medium text-neutral-muted underline-offset-2 hover:text-primary hover:underline dark:text-dk-muted dark:hover:text-dk-primary"
        >
          #{term.id}
        </a>
      </div>

      <div className="mt-1 text-sm text-neutral-text dark:text-dk-text">
        {renderMarkdown(term.descripcion_larga, baseKey)}
      </div>

      {term.fuente_url && (
        <p className="mt-3 text-xs text-neutral-muted dark:text-dk-muted">
          Fuente:{" "}
          <a
            href={term.fuente_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary dark:text-dk-primary dark:decoration-dk-primary/40 dark:hover:decoration-dk-primary"
          >
            {term.fuente_label || "fuente"}
          </a>
        </p>
      )}

      {term.relacionados && term.relacionados.length > 0 && (
        <p className="mt-2 text-xs text-neutral-muted dark:text-dk-muted">
          Ver también:{" "}
          {term.relacionados.map((relId, idx) => (
            <span key={relId}>
              <Link
                href={`#glosario-${relId}`}
                className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary dark:text-dk-primary dark:decoration-dk-primary/40 dark:hover:decoration-dk-primary"
              >
                {relId}
              </Link>
              {idx < term.relacionados!.length - 1 ? ", " : ""}
            </span>
          ))}
        </p>
      )}

      {term.alias && term.alias.length > 0 && (
        <p className="mt-1 text-[11px] italic text-neutral-muted dark:text-dk-muted">
          También conocido como: {term.alias.join(", ")}
        </p>
      )}
    </article>
  );
}

export default GlosarioCompleto;
