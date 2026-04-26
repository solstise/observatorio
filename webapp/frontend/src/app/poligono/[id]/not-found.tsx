// Fallback cuando el id del poligono no existe.

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container-obs py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
        Error 404
      </p>
      <h1 className="mt-2 text-3xl font-bold">Poligono no encontrado</h1>
      <p className="mt-3 text-neutral-text dark:text-dk-text">
        El poligono solicitado no existe en el dataset publicado.
      </p>
      <Link href="/" className="btn-primary mt-6">
        Volver al mapa
      </Link>
    </div>
  );
}
