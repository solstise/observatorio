// Banner permanente visible en todas las vistas con datos.
// Explica naturaleza publica de los datos y remite a metodologia.

import Link from "next/link";

export function Disclaimer() {
  return (
    <div
      role="note"
      aria-label="Aviso sobre el origen de los datos"
      className="border-y border-accent-100 bg-accent-50"
    >
      <div className="container-obs py-3 text-sm leading-relaxed text-neutral-text">
        Este observatorio usa datos publicos y gratuitos (Sentinel-2 ESA, Google
        Open Buildings, WorldPop, OpenStreetMap). Las cifras reportadas tienen un
        margen de error declarado.{" "}
        <Link
          href="/metodologia"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Ver metodologia
        </Link>
        .
      </div>
    </div>
  );
}
