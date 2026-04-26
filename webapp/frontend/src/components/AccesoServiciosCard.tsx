// Card de acceso a servicios públicos (capa social, fase 3).
//
// Qué hace: para un polígono dado, muestra la distancia mínima desde su
// centroide al servicio más cercano de cada una de cuatro categorías clave
// (CAPS, escuela, hospital y transporte público), con un semáforo de
// proximidad (verde <500 m, amarillo <1500 m, rojo ≥1500 m).
//
// Datos: scripts/53_servicios_distancias.py — combina CAPS y hospitales
// oficiales del Ministerio de Salud de Misiones (sig.misiones.gob.ar) con
// datos OSM (escuelas, transporte y complemento sanitario).
//
// El semáforo es semántico (acceso bueno/medio/malo) y aplica también para
// el dark mode. Los íconos son SVG inline para evitar dependencias.

import type { SocialDistanciasRow } from "@/lib/types";

interface AccesoServiciosCardProps {
  row: SocialDistanciasRow | null;
}

interface Categoria {
  key: keyof Pick<
    SocialDistanciasRow,
    "dist_caps_m" | "dist_escuela_m" | "dist_hospital_m" | "dist_transporte_m"
  >;
  label: string;
  descripcion: string;
  Icon: () => JSX.Element;
}

const CATEGORIAS: Categoria[] = [
  {
    key: "dist_caps_m",
    label: "CAPS",
    descripcion: "Centro de Atención Primaria de la Salud más cercano",
    Icon: IconCaps,
  },
  {
    key: "dist_escuela_m",
    label: "Escuela",
    descripcion: "Escuela primaria, secundaria o jardín más cercano",
    Icon: IconEscuela,
  },
  {
    key: "dist_hospital_m",
    label: "Hospital",
    descripcion: "Hospital público más cercano",
    Icon: IconHospital,
  },
  {
    key: "dist_transporte_m",
    label: "Transporte",
    descripcion: "Parada de colectivo más cercana",
    Icon: IconTransporte,
  },
];

// Semáforo de proximidad. Convención política: < 500 m caminable y rápido,
// 500-1500 m razonable a pie u ómnibus, ≥ 1500 m problemático. Se mantiene
// el mismo umbral en ambos temas para no cambiar la lectura clínica.
function semaforoColor(distM: number | null): {
  cls: string;
  textCls: string;
  label: string;
} {
  if (distM === null || distM === undefined || Number.isNaN(distM)) {
    return {
      cls: "bg-neutral-200 dark:bg-dk-border",
      textCls: "text-neutral-muted dark:text-dk-muted",
      label: "Sin datos",
    };
  }
  if (distM < 500) {
    return {
      cls: "bg-emerald-500 dark:bg-emerald-400",
      textCls: "text-emerald-700 dark:text-emerald-300",
      label: "Cerca",
    };
  }
  if (distM < 1500) {
    return {
      cls: "bg-amber-500 dark:bg-amber-400",
      textCls: "text-amber-700 dark:text-amber-300",
      label: "Lejos razonable",
    };
  }
  return {
    cls: "bg-rose-500 dark:bg-rose-400",
    textCls: "text-rose-700 dark:text-rose-300",
    label: "Muy lejos",
  };
}

function formatoDistancia(distM: number | null): string {
  if (distM === null || distM === undefined || Number.isNaN(distM)) {
    return "s/d";
  }
  if (distM < 1000) {
    return `${Math.round(distM)} m`;
  }
  return `${(distM / 1000).toFixed(2)} km`;
}

export function AccesoServiciosCard({ row }: AccesoServiciosCardProps) {
  if (!row) {
    return (
      <div className="rounded-md border border-neutral-border bg-white p-4 dark:border-dk-border dark:bg-dk-surface">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Acceso a servicios públicos
        </h3>
        <p className="mt-2 text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos de distancias para este polígono todavía.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-neutral-border bg-white p-4 dark:border-dk-border dark:bg-dk-surface">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Acceso a servicios públicos
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          Distancia desde el centro del polígono al servicio más cercano de
          cada categoría. Verde menor a 500 m, amarillo de 500 a 1500 m,
          rojo desde 1500 m.{" "}
          <em>
            Datos: Ministerio de Salud Misiones (CAPS, hospitales) + OSM
            (escuelas, transporte).
          </em>
        </p>
      </header>

      <ul
        className="grid gap-2 grid-cols-1 sm:grid-cols-2"
        aria-label="Distancias a servicios públicos"
      >
        {CATEGORIAS.map((cat) => {
          const dist = row[cat.key];
          const { cls, textCls, label } = semaforoColor(dist);
          const tooltip = `${cat.descripcion}. ${
            dist === null || dist === undefined
              ? "Sin datos."
              : `Distancia: ${formatoDistancia(dist)} (${label}).`
          }`;
          return (
            <li
              key={cat.key}
              className="flex items-center gap-3 rounded border border-neutral-border bg-neutral-50 p-2 dark:border-dk-border dark:bg-dk-elevated"
              title={tooltip}
              aria-label={tooltip}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary dark:text-dk-primary"
                aria-hidden="true"
              >
                <cat.Icon />
              </span>
              <div className="flex flex-1 flex-col">
                <span className="text-xs font-semibold uppercase tracking-wider text-secondary dark:text-dk-muted">
                  {cat.label}
                </span>
                <span className="text-base font-bold text-primary dark:text-dk-primary">
                  {formatoDistancia(dist)}
                </span>
              </div>
              <span
                className="flex flex-col items-end gap-1"
                aria-hidden="true"
              >
                <span
                  className={`h-3 w-3 rounded-full ${cls}`}
                  title={label}
                />
                <span className={`text-[10px] font-medium ${textCls}`}>
                  {label}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <footer className="mt-3 border-t border-neutral-border pt-2 text-[11px] text-neutral-muted dark:border-dk-border dark:text-dk-muted">
        Densidad por km²: {row.densidad_caps_km2.toFixed(2)} CAPS,{" "}
        {row.densidad_escuela_km2.toFixed(2)} escuelas,{" "}
        {row.densidad_transporte_km2.toFixed(2)} paradas.{" "}
        <em>
          Fuentes: {row.fuente_caps} (salud), {row.fuente_escuela} (educación),{" "}
          {row.fuente_transporte} (transporte).
        </em>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Iconos SVG inline (24x24, currentColor stroke)
// ---------------------------------------------------------------------------

function IconCaps() {
  // Cruz médica simple en círculo.
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
      <line x1="12" y1="7" x2="12" y2="17" />
      <line x1="7" y1="12" x2="17" y2="12" />
    </svg>
  );
}

function IconEscuela() {
  // Birrete de graduación.
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
      <path d="M2 10l10-5 10 5-10 5L2 10z" />
      <path d="M6 12v4c2 1 4 1.5 6 1.5s4-.5 6-1.5v-4" />
      <line x1="22" y1="10" x2="22" y2="16" />
    </svg>
  );
}

function IconHospital() {
  // Edificio hospitalario con cruz.
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
      <rect x="4" y="4" width="16" height="17" rx="1" />
      <line x1="12" y1="9" x2="12" y2="15" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="4" y1="21" x2="20" y2="21" />
    </svg>
  );
}

function IconTransporte() {
  // Bus con dos ruedas.
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
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="7" y1="9" x2="9" y2="9" />
      <line x1="15" y1="9" x2="17" y2="9" />
      <circle cx="7" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </svg>
  );
}
