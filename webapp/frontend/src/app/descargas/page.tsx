// Pagina de descargas: lista PDFs y CSVs publicos.
// Los reportes PDF son servidos por el backend FastAPI; los CSVs estan en /data.

import type { Metadata } from "next";

import { getPoligonos } from "@/lib/data.server";

export const metadata: Metadata = {
  title: "Descargas",
  description: "Descargas de datos y reportes del Observatorio Urbano Posadas.",
};

const CSV_FILES = [
  { file: "serie_temporal.csv", label: "Serie temporal (superficie, vegetacion)" },
  { file: "poblacion.csv", label: "Poblacion estimada (WorldPop)" },
  { file: "servicios.csv", label: "Cobertura de servicios publicos" },
  { file: "vulnerabilidad.csv", label: "Indices de vulnerabilidad" },
];

export default async function DescargasPage() {
  let poligonos: { id: string; nombre: string }[] = [];
  try {
    const collection = await getPoligonos();
    poligonos = collection.features.map((f) => ({
      id: f.properties.id,
      nombre: f.properties.nombre,
    }));
  } catch {
    poligonos = [];
  }

  return (
    <article className="container-obs py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
        Datos abiertos
      </p>
      <h1 className="mt-2 font-bold" style={{ fontSize: "var(--fs-h1)" }}>
        Descargas
      </h1>
      <p className="mt-3 lead text-neutral-text dark:text-dk-text">
        Datasets agregados y reportes listos para descargar. Distribuidos bajo
        licencia CC BY 4.0 — libre uso citando la fuente.
      </p>

      <section aria-labelledby="datasets" className="mt-10">
        <h2
          id="datasets"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Datasets agregados
        </h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          <li className="card">
            <p className="text-sm font-semibold text-primary dark:text-dk-primary">
              Poligonos (GeoJSON)
            </p>
            <p className="text-xs text-neutral-muted dark:text-dk-muted">
              FeatureCollection con propiedades agregadas.
            </p>
            <a
              href="/data/poligonos.geojson"
              className="mt-3 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline dark:text-dk-primary"
              download
            >
              Descargar poligonos.geojson
            </a>
          </li>
          {CSV_FILES.map((c) => (
            <li key={c.file} className="card">
              <p className="text-sm font-semibold text-primary dark:text-dk-primary">
                {c.label}
              </p>
              <p className="text-xs text-neutral-muted dark:text-dk-muted">
                {c.file}
              </p>
              <a
                href={`/data/${c.file}`}
                className="mt-3 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                download
              >
                Descargar {c.file}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="reportes" className="mt-10">
        <h2
          id="reportes"
          className="text-2xl font-semibold text-primary dark:text-dk-primary"
        >
          Reportes por poligono (PDF)
        </h2>
        {poligonos.length === 0 ? (
          <p className="mt-2 text-sm italic text-neutral-muted dark:text-dk-muted">
            No hay poligonos cargados.
          </p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {poligonos.map((p) => (
              <li key={p.id} className="card flex items-center justify-between gap-3">
                <span className="font-medium text-primary dark:text-dk-primary">
                  {p.nombre}
                </span>
                <a
                  href={`/data/media/${p.id}.pdf`}
                  className="inline-flex min-h-[36px] items-center rounded px-2 text-sm font-medium text-primary underline-offset-2 hover:underline dark:text-dk-primary"
                  download
                  aria-label={`Descargar PDF de ${p.nombre}`}
                >
                  PDF
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 text-xs text-neutral-muted dark:text-dk-muted">
        Los datos publicados son agregados por poligono. No se distribuyen datos
        personales. Ver{" "}
        <a href="/metodologia" className="underline dark:text-dk-primary">
          metodologia
        </a>{" "}
        para detalles de margen de error.
      </p>
    </article>
  );
}
