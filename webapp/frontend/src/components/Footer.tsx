// Footer global del Observatorio Urbano Posadas.
// Contiene disclaimers permanentes: fuentes, version, fecha de actualizacion y licencias.

import Link from "next/link";

import { LICENSES, SOURCES, UPDATED_AT_FALLBACK, VERSION } from "@/lib/version";

interface FooterProps {
  updatedAt?: string;
}

export function Footer({ updatedAt }: FooterProps) {
  const fecha = updatedAt || UPDATED_AT_FALLBACK;

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
