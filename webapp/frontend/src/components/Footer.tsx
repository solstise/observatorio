// Footer global del Observatorio Urbano Posadas.
// Contiene disclaimers permanentes: fuentes, version, fecha de actualizacion,
// licencias y una mini tabla de "frescura" de los 5 datasets más críticos
// para que el visitante entienda de un vistazo qué tan vivo está cada dato.

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
        <div className="grid gap-8 md:grid-cols-3">
          <section aria-labelledby="footer-fuentes">
            <h2
              id="footer-fuentes"
              className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
            >
              Fuentes
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-neutral-text dark:text-dk-text">
              {SOURCES.map((src) => (
                <li key={src}>{src}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="footer-publicacion">
            <h2
              id="footer-publicacion"
              className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
            >
              Publicacion
            </h2>
            <dl className="mt-2 space-y-1 text-sm text-neutral-text dark:text-dk-text">
              <div className="flex gap-2">
                <dt className="font-medium">Version</dt>
                <dd>{VERSION}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Actualizado</dt>
                <dd>
                  <time dateTime={fecha}>{fecha}</time>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Licencia datos</dt>
                <dd>{LICENSES.datos}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-medium">Licencia codigo</dt>
                <dd>{LICENSES.codigo}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="footer-enlaces">
            <h2
              id="footer-enlaces"
              className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted"
            >
              Enlaces
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li>
                <Link
                  href="/metodologia"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Metodologia
                </Link>
              </li>
              <li>
                <Link
                  href="/metodologia#frescura"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Frescura de datos
                </Link>
              </li>
              <li>
                <Link
                  href="/descargas"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                >
                  Descargas
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/"
                  className="text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Codigo abierto (GitHub)
                </a>
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
      </div>
    </footer>
  );
}
