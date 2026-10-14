// Hub /datos — landing del eje "sala de máquinas".
//
// Server Component. Agrupa el acceso técnico al observatorio:
//   - Descargas CSV (47 datasets)
//   - Metodología (cómo se construye cada cifra + glosario en /datos/glosario)
//   - Glosario (página dedicada, suma a la sección en metodología)
//   - Visor 3D (WebGL)
//   - Explorar (sandbox kepler.gl)
//
// Acá NO renderizamos KPIs de coyuntura — el público objetivo es el
// auditor / investigador / data nerd que necesita reproducibilidad y
// crudos. Mantenemos el feeling sobrio y de "documentación".

import type { Metadata } from "next";

import { HubOverviewCard } from "@/components/HubOverviewCard";
import { GLOSARIO } from "@/lib/glosario";

export const metadata: Metadata = {
  title: "Datos · la sala de máquinas",
  description:
    "Acceso técnico al Observatorio Urbano Posadas: descargas crudas en CSV, metodología detallada, glosario, y vistas exploratorias para auditoría e investigación.",
  alternates: { canonical: "/datos" },
};

// Total de entradas del glosario — se calcula en build, no hay costo runtime.
const GLOSARIO_COUNT = GLOSARIO.length;

export default function DatosHubPage() {
  return (
    <main className="container-obs py-10">
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary dark:text-dk-muted">
          Datos · la sala de máquinas
        </p>
        <h1
          className="mt-2 font-bold text-primary dark:text-dk-primary"
          style={{ fontSize: "var(--fs-h1)" }}
        >
          Datos · la sala de máquinas
        </h1>
        <p className="mt-3 lead text-neutral-text dark:text-dk-text">
          Acceso técnico al observatorio: descargas crudas en CSV, metodología
          detallada, glosario, y vistas exploratorias para auditoría e
          investigación.
        </p>
      </header>

      <section aria-labelledby="hub-datos-cards">
        <h2 id="hub-datos-cards" className="sr-only">
          Sub-secciones de Datos
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <HubOverviewCard
            href="/datos/descargas"
            title="Descargas CSV"
            description="Datasets agregados por barrio en CSV + GeoJSON de polígonos + reportes PDF, todo bajo licencia CC BY 4.0."
            chip="Open data"
            tone="primary"
            icon={<IconDownload />}
            kpi={{
              value: "47",
              label: "Datasets disponibles",
            }}
          />
          <HubOverviewCard
            href="/datos/metodologia"
            title="Metodología"
            description="Qué muestra cada capa, cómo se procesan los datos, margen de error declarado y limitaciones honestas."
            chip="Reproducible"
            tone="primary"
            icon={<IconBook />}
            kpi={{
              value: "27",
              label: "Scripts del pipeline",
            }}
          />
          <HubOverviewCard
            href="/datos/glosario"
            title="Glosario"
            description="Definiciones cortas y largas de los términos técnicos del observatorio, con alias, fuentes y referencias cruzadas."
            chip="Términos"
            tone="primary"
            icon={<IconBookOpen />}
            kpi={{
              value: String(GLOSARIO_COUNT),
              label: "Entradas",
            }}
          />
          <HubOverviewCard
            href="/datos/historia"
            title="Línea de tiempo 1999-2026"
            description="27 años de Posadas vista desde el espacio. Landsat-5/7/8 (30 m, 1999-2014) + CBERS-4 (10 m, 2015+). Slider anual con badges de sensor."
            chip="Histórico"
            tone="primary"
            icon={<IconClock />}
            kpi={{
              value: "27",
              unit: "años",
              label: "Cobertura continua",
            }}
          />
          <HubOverviewCard
            href="/datos/validacion"
            title="Validación cruzada"
            description="NDBI y NDVI comparados Sentinel-2 vs CBERS-4A por barrio. Cuando dos sensores independientes coinciden, sube la confianza del indicador."
            chip="Auditoría"
            tone="primary"
            icon={<IconCheck />}
          />
          <HubOverviewCard
            href="/datos/3d"
            title="Visor 3D"
            description="Posadas en tres dimensiones — extrusión por métrica seleccionable y relieve real SRTM cuando MapTiler está activo."
            chip="WebGL"
            tone="muted"
            icon={<IconCube />}
          />
          <HubOverviewCard
            href="/datos/explorar"
            title="Explorar"
            description="Sandbox con kepler.gl pre-cargado con los datasets del observatorio — para visualizaciones ad hoc y análisis libre."
            chip="Sandbox"
            tone="muted"
            icon={<IconCompass />}
          />
        </div>
      </section>

      <section className="mt-12 max-w-3xl space-y-3 border-t border-neutral-border pt-6 text-sm text-neutral-text dark:border-dk-border dark:text-dk-text">
        <h2 className="text-lg font-semibold text-primary dark:text-dk-primary">
          Filosofía
        </h2>
        <p>
          Esta sección existe para que cualquier persona —periodista,
          investigador, vecino curioso— pueda <strong>auditar</strong> cómo
          armamos cada cifra. Todos los datos crudos están disponibles, el
          pipeline es código abierto, y declaramos cuándo se actualiza cada
          dataset.
        </p>
        <p className="text-xs text-neutral-muted dark:text-dk-muted">
          Si algo no cuadra, abrí una issue en el repositorio o contactanos por
          el canal del observatorio. La transparencia es un compromiso, no un
          slogan.
        </p>
      </section>
    </main>
  );
}

// --- íconos inline (heroicons-like outline) -------------------------------

function IconDownload() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function IconBook() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5z" />
      <path d="M4 17h14" />
    </svg>
  );
}

function IconBookOpen() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3V5z" />
      <path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7V5z" />
    </svg>
  );
}

function IconCube() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M4 7.5L12 12l8-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

function IconCompass() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5L13 13l-3.5 1.5L11 11l3.5-1.5z" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
