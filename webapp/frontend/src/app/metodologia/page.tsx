// Pagina de metodologia.
// Placeholder: deberia sincronizar desde METODOLOGIA.md del repo root,
// idealmente via una pipeline MDX. Hasta entonces, se renderiza un resumen.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Metodologia",
  description:
    "Metodologia del Observatorio Urbano Posadas: fuentes, tratamientos, margen de error.",
};

export default function MetodologiaPage() {
  return (
    <article className="container-obs py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary">
        Metodologia
      </p>
      <h1 className="mt-2 text-3xl md:text-4xl font-bold">
        Como construimos las cifras
      </h1>

      <aside
        role="note"
        className="mt-6 card border-accent-200 bg-accent-50 text-sm"
      >
        Esta pagina debe sincronizarse con <code>METODOLOGIA.md</code> del repo
        raiz. Pendiente: pipeline de sync MDX.
      </aside>

      <section aria-labelledby="fuentes" className="mt-10 space-y-3">
        <h2 id="fuentes" className="text-2xl font-semibold text-primary">
          Fuentes
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-neutral-text">
          <li>
            <strong>Sentinel-2 (ESA)</strong>: imagenes multiespectrales con
            resolucion 10 m. Se usa para detectar cambios de cobertura y
            vegetacion entre 2018 y 2026.
          </li>
          <li>
            <strong>Planet NICFI</strong>: mosaico mensual tropical, usado como
            referencia de cross-check cualitativo.
          </li>
          <li>
            <strong>Google Open Buildings</strong>: footprints de edificios,
            agregado por poligono.
          </li>
          <li>
            <strong>WorldPop</strong>: grilla de poblacion modelada, proyectada
            a los poligonos.
          </li>
          <li>
            <strong>OpenStreetMap</strong>: red vial, amenities, limites
            administrativos.
          </li>
        </ul>
      </section>

      <section aria-labelledby="procesamiento" className="mt-10 space-y-3">
        <h2 id="procesamiento" className="text-2xl font-semibold text-primary">
          Procesamiento
        </h2>
        <p className="text-neutral-text">
          Los datos crudos se descargan mediante <code>scripts/</code> del repo
          raiz. Se recortan por los poligonos del observatorio, se calculan
          agregados (superficies, conteos, porcentajes) y se emiten a
          <code> data/outputs/</code>. El frontend consume esos archivos
          directamente o via el backend FastAPI.
        </p>
      </section>

      <section aria-labelledby="margen" className="mt-10 space-y-3">
        <h2 id="margen" className="text-2xl font-semibold text-primary">
          Margen de error declarado
        </h2>
        <p className="text-neutral-text">
          Cada serie temporal publica una banda de confianza
          (<code>confianza_inferior</code>, <code>confianza_superior</code>) que
          refleja la incertidumbre combinada de la clasificacion Sentinel-2 y
          el footprint de Google Open Buildings. Las estimaciones de poblacion
          heredan el error del modelo WorldPop y suelen estar subestimadas en
          zonas de expansion reciente.
        </p>
      </section>

      <section aria-labelledby="limites" className="mt-10 space-y-3">
        <h2 id="limites" className="text-2xl font-semibold text-primary">
          Limites
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-neutral-text">
          <li>
            El observatorio usa exclusivamente datos publicos. No incluye fuentes
            censales restringidas.
          </li>
          <li>
            Los poligonos son delineados ad hoc para facilitar el analisis y no
            se corresponden con limites administrativos.
          </li>
          <li>
            Las cifras de cobertura de servicios se basan en mapas publicos
            oficiales con fecha de corte declarada.
          </li>
        </ul>
      </section>

      <section aria-labelledby="reproducibilidad" className="mt-10 space-y-3">
        <h2
          id="reproducibilidad"
          className="text-2xl font-semibold text-primary"
        >
          Reproducibilidad
        </h2>
        <p className="text-neutral-text">
          Todo el pipeline es de codigo abierto. Los datos agregados se publican
          bajo CC BY 4.0. El codigo, bajo MIT.
        </p>
      </section>
    </article>
  );
}
