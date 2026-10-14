// Footer global del Observatorio Urbano Posadas.
// Contiene disclaimers permanentes: fuentes, version, fecha de actualizacion,
// licencias y una mini tabla de "frescura" de los 5 datasets más críticos
// para que el visitante entienda de un vistazo qué tan vivo está cada dato.

import Image from "next/image";
import Link from "next/link";

import { DataFreshness } from "@/components/DataFreshness";
import {
  DATASET_INFO,
  FOOTER_DATASETS,
  getManyFreshness,
} from "@/lib/data-freshness";
import { LICENSES, SOURCES, UPDATED_AT_FALLBACK, VERSION } from "@/lib/version";

interface FooterProps {
  updatedAt?: string;
}

// Async porque resuelve frescura desde el filesystem. Como vive en el
// layout global, se ejecuta una vez por request — coste mínimo (lee 5
// archivos chicos en paralelo). Mantiene el footer en server-side: no
// hidratamos JS para algo que es estático por request.
export async function Footer({ updatedAt }: FooterProps) {
  const fecha = updatedAt || UPDATED_AT_FALLBACK;
  const freshness = await getManyFreshness(FOOTER_DATASETS);

  return (
    <footer
      className="mt-16 border-t border-neutral-border bg-primary-50 dark:border-dk-border dark:bg-dk-surface"
      role="contentinfo"
    >
      <div className="container-obs py-10">
        {/* Mapa del sitio en 4 columnas alineadas con la arquitectura de
            hubs nueva. Col 1 = identidad + publicación, Col 2 =
            Indicadores (5 capas), Col 3 = Pronóstico (3 vistas), Col 4 =
            Decisión + Historia + Datos fusionadas (3 + 3 entradas).
            Mantenemos 4 columnas en md+ para que en desktop entre todo
            sin que cada columna quede sub-utilizada; en mobile colapsa
            a 1 col por el grid-cols-1 default. */}
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {/* Col 1 — Observatorio: identidad, fuentes resumidas, versión.
              Es el ancla informativa antes de las columnas de navegación. */}
          <section aria-labelledby="footer-observatorio">
            <h2
              id="footer-observatorio"
              className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
            >
              Observatorio
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-text dark:text-dk-text">
              Plataforma abierta de monitoreo urbano de Posadas, Misiones,
              con datos satelitales gratuitos (Sentinel-2/1, Landsat,
              CBERS) y open data (WorldPop, OSM, Google Open Buildings).
              Indicadores ambientales, sociales y de riesgo por barrio.
            </p>
            <dl className="mt-3 space-y-1 text-xs text-neutral-text dark:text-dk-text">
              <div className="flex gap-2">
                <dt className="font-medium">Versión</dt>
                <dd>{VERSION}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Actualizado</dt>
                <dd>
                  <time dateTime={fecha}>{fecha}</time>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Licencias</dt>
                <dd>
                  {LICENSES.datos} · {LICENSES.codigo}
                </dd>
              </div>
            </dl>
            {SOURCES.length > 0 && (
              <p
                className="mt-3 text-xs italic text-neutral-muted dark:text-dk-muted"
                aria-label="Fuentes principales"
              >
                Fuentes: {SOURCES.join(", ")}.
              </p>
            )}
          </section>

          {/* Col 2 — Indicadores: 5 capas analíticas (tipología, calor,
              aire, población, calidad de vida). Coinciden con el hub
              /indicadores y sus 5 sub-rutas. */}
          <section aria-labelledby="footer-indicadores">
            <h2
              id="footer-indicadores"
              className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
            >
              Indicadores
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li>
                <Link
                  href="/indicadores/tipologia"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Tipología urbana
                </Link>
              </li>
              <li>
                <Link
                  href="/indicadores/calor"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Calor &amp; UHI
                </Link>
              </li>
              <li>
                <Link
                  href="/indicadores/aire"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Aire
                </Link>
              </li>
              <li>
                <Link
                  href="/indicadores/poblacion"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Población
                </Link>
              </li>
              <li>
                <Link
                  href="/indicadores/calidad-vida"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Calidad de vida
                </Link>
              </li>
            </ul>
          </section>

          {/* Col 3 — Pronóstico: futuro corto (14 días) + escenarios largos.
              Cubre los 3 sub-routes del hub /pronostico. */}
          <section aria-labelledby="footer-pronostico">
            <h2
              id="footer-pronostico"
              className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
            >
              Pronóstico
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li>
                <Link
                  href="/pronostico/riesgos"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Riesgos 14 días
                </Link>
              </li>
              <li>
                <Link
                  href="/pronostico/clima"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Clima 14 días
                </Link>
              </li>
              <li>
                <Link
                  href="/pronostico/proyecciones"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Proyecciones
                </Link>
              </li>
            </ul>
          </section>

          {/* Col 4 — Fusión de Decisión + Datos (3+3 entradas). Mantenemos
              las dos secciones lógicas legibles con sub-headings <h3>
              para conservar la jerarquía semántica aún fusionando columna. */}
          <section aria-labelledby="footer-decision-datos">
            <h2
              id="footer-decision-datos"
              className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
            >
              Decisión &amp; Datos
            </h2>
            <h3 className="mt-2 text-[0.7rem] font-semibold uppercase tracking-wider text-neutral-muted dark:text-dk-muted">
              Decisión
            </h3>
            <ul className="mt-1 space-y-1 text-sm">
              <li>
                <Link
                  href="/decision/prioridades"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Prioridades
                </Link>
              </li>
              <li>
                <Link
                  href="/decision/comparar"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Comparador
                </Link>
              </li>
            </ul>
            <h3 className="mt-3 text-[0.7rem] font-semibold uppercase tracking-wider text-neutral-muted dark:text-dk-muted">
              Datos
            </h3>
            <ul className="mt-1 space-y-1 text-sm">
              <li>
                <Link
                  href="/datos/historia"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Línea de tiempo 1999-2026
                </Link>
              </li>
              <li>
                <Link
                  href="/datos/metodologia"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Metodología
                </Link>
              </li>
              <li>
                <Link
                  href="/datos/descargas"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Descargas
                </Link>
              </li>
              <li>
                <Link
                  href="/datos/glosario"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Glosario
                </Link>
              </li>
            </ul>
          </section>
        </div>

        {/* Mini tabla de frescura: 5 datasets más críticos para el sitio.
            Le da al visitante un radar de salud del pipeline sin tener
            que entrar a /metodologia. Las filas largas hacen wrap natural
            en mobile gracias al grid responsivo. */}
        <section
          aria-labelledby="footer-frescura"
          className="mt-8 border-t border-neutral-border pt-6 dark:border-dk-border"
        >
          <h2
            id="footer-frescura"
            className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
          >
            Salud del pipeline
          </h2>
          <p className="mt-1 text-xs text-neutral-muted dark:text-dk-muted">
            Frescura de los datasets críticos. Verde = al día, amarillo =
            atrasado, rojo = pipeline detenido.{" "}
            <Link
              href="/metodologia#frescura"
              className="text-primary underline dark:text-dk-primary"
            >
              Ver tabla completa
            </Link>
            .
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {FOOTER_DATASETS.map((slug) => {
              const info = DATASET_INFO[slug];
              const f = freshness[slug];
              if (!info || !f) return null;
              return (
                <li
                  key={slug}
                  className="flex items-center justify-between gap-3 rounded-md border border-neutral-border/70 bg-white/60 px-3 py-2 text-xs dark:border-dk-border/70 dark:bg-dk-elevated/40"
                >
                  <span className="truncate font-medium text-neutral-text dark:text-dk-text">
                    {info.label}
                  </span>
                  <DataFreshness
                    dataset={slug}
                    lastUpdated={f.lastUpdated}
                    frequency={f.frequency}
                    compact
                    showFrequency={false}
                  />
                </li>
              );
            })}
          </ul>
        </section>

        <p className="mt-8 text-xs leading-relaxed text-neutral-muted dark:text-dk-muted">
          Este observatorio usa datos publicos y gratuitos (Sentinel-2 ESA, Google
          Open Buildings, WorldPop, OpenStreetMap). Las cifras reportadas tienen un
          margen de error declarado. Ver{" "}
          <Link
            href="/metodologia"
            className="underline dark:text-dk-primary"
          >
            metodologia
          </Link>{" "}
          para detalles.
        </p>

        {/* Línea final con cross-promotion del ecosistema "*posadas.com" y
            firma del estudio. Replica el patrón del footer de
            mediosposadas.com (Sistemas Winter): "Mis otras apps → ..."
            a la izquierda, "Diseñado por <logo>" a la derecha. La app
            actual es sateliteposadas.com; las "otras" son ahorroposadas
            y mediosposadas (no listamos sateliteposadas a sí misma). */}
        <div className="mt-10 flex flex-col gap-y-4 border-t border-neutral-border pt-6 text-sm text-neutral-muted dark:border-dk-border dark:text-dk-muted sm:flex-row sm:items-center sm:justify-between sm:gap-y-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="opacity-70">Mis otras apps</span>
            <span aria-hidden="true" className="opacity-30">
              →
            </span>
            <a
              href="https://ahorroposadas.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline decoration-transparent decoration-[1.5px] underline-offset-[5px] transition-[color,text-decoration-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:decoration-primary active:opacity-70 dark:text-dk-primary dark:hover:decoration-dk-primary"
            >
              ahorroposadas.com
            </a>
            <span aria-hidden="true" className="opacity-30">
              ·
            </span>
            <a
              href="https://mediosposadas.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline decoration-transparent decoration-[1.5px] underline-offset-[5px] transition-[color,text-decoration-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:decoration-primary active:opacity-70 dark:text-dk-primary dark:hover:decoration-dk-primary"
            >
              mediosposadas.com
            </a>
          </div>
          <a
            href="https://sistemaswinter.com"
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-2.5 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-neutral-text active:opacity-80 dark:hover:text-dk-text"
          >
            <span className="opacity-70 transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-100">
              Diseñado por
            </span>
            {/* El logo original (PNG con texto blanco + azul claro) está
                pensado para fondo oscuro y se pierde en light mode. Servimos
                dos variantes y switcheamos por el dark-mode class de Tailwind:
                  * sistemas-winter-light.png → texto en gris oscuro, igual icono.
                  * sistemas-winter.png       → texto blanco original.
                Ambos comparten dimensiones (225x50), sólo cambian colores. */}
            <Image
              src="/sistemas-winter-light.png"
              alt="Sistemas Winter"
              width={150}
              height={30}
              className="block h-9 w-auto opacity-80 transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-100 dark:hidden"
            />
            <Image
              src="/sistemas-winter.png"
              alt="Sistemas Winter"
              width={150}
              height={30}
              aria-hidden="true"
              className="hidden h-9 w-auto opacity-80 transition-opacity duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-100 dark:block"
            />
          </a>
        </div>
      </div>
    </footer>
  );
}
