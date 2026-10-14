// Card de coeficientes de Gini — capa 3.
//
// Tabla compacta de N métricas (m² verde, habitabilidad, distancias…) y su
// coeficiente de Gini sobre la población de barrios de Posadas. El color
// del badge codifica el nivel de desigualdad por convención editorial:
// verde <0.25, amarillo 0.25-0.40, naranja 0.40-0.60, rojo >0.60.

import { TerminoGlosario } from "@/components/TerminoGlosario";
import type { GiniRow } from "@/lib/types";

interface Props {
  rows: GiniRow[];
}

// Etiquetas en castellano para las métricas técnicas que vienen del script.
// Es un mapping suave: si llega una métrica nueva no listada acá, mostramos
// el slug original capitalizado para no romper.
const METRICA_LABEL: Record<string, string> = {
  m2_per_capita: "m² verde por habitante",
  verde_m2_per_capita: "m² verde por habitante",
  score_habitabilidad: "Habitabilidad",
  habitabilidad: "Habitabilidad",
  score_15min: "Acceso 15 min",
  acceso_15min: "Acceso 15 min",
  score_resiliencia: "Resiliencia urbana",
  resiliencia: "Resiliencia urbana",
  score_gentrificacion: "Gentrificación",
  gentrificacion: "Gentrificación",
  dist_caps_m: "Distancia a CAPS",
  dist_escuela_m: "Distancia a escuela",
  dist_hospital_m: "Distancia a hospital",
  dist_transporte_m: "Distancia a transporte",
  vulnerabilidad: "Vulnerabilidad",
  uhi_verano: "Isla de calor verano",
  lst_verano_dia: "Temperatura superficie día (verano)",
  poblacion_estimada: "Población estimada",
  densidad_hab_km2: "Densidad poblacional",
};

interface NivelGini {
  cls: string;
  textCls: string;
  label: string;
}

function nivelGini(g: number | null): NivelGini {
  if (g === null || !Number.isFinite(g)) {
    return {
      cls: "bg-neutral-200 dark:bg-dk-border",
      textCls: "text-neutral-muted dark:text-dk-muted",
      label: "s/d",
    };
  }
  if (g < 0.25)
    return {
      cls: "bg-emerald-500 dark:bg-emerald-400",
      textCls: "text-emerald-700 dark:text-emerald-300",
      label: "Igualitario",
    };
  if (g < 0.4)
    return {
      cls: "bg-amber-400 dark:bg-amber-300",
      textCls: "text-amber-700 dark:text-amber-200",
      label: "Moderado",
    };
  if (g < 0.6)
    return {
      cls: "bg-orange-500 dark:bg-orange-400",
      textCls: "text-orange-700 dark:text-orange-300",
      label: "Alto",
    };
  return {
    cls: "bg-rose-600 dark:bg-rose-500",
    textCls: "text-rose-700 dark:text-rose-300",
    label: "Extremo",
  };
}

function labelMetrica(slug: string): string {
  return METRICA_LABEL[slug] ?? slug.replace(/_/g, " ");
}

export function GiniCard({ rows }: Props) {
  const valid = rows.filter(
    (r): r is GiniRow & { gini_index: number } =>
      r.gini_index !== null && Number.isFinite(r.gini_index),
  );

  // Métrica más desigual (peor) y más igualitaria, para el texto editorial.
  const ordenado = [...valid].sort(
    (a, b) => (b.gini_index ?? 0) - (a.gini_index ?? 0),
  );
  const peor = ordenado[0];
  const mejor = ordenado[ordenado.length - 1];

  return (
    <article className="card flex h-full flex-col">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-primary dark:text-dk-primary">
          Desigualdad entre barrios —{" "}
          <TerminoGlosario id="gini">Gini</TerminoGlosario>
        </h3>
        <p className="mt-1 text-xs text-neutral-text dark:text-dk-text">
          0 = todos los barrios iguales · 1 = un solo barrio concentra todo.
          La medida revela qué dimensiones de la ciudad son más equitativas.
        </p>
      </header>

      {valid.length === 0 ? (
        <p className="text-sm italic text-neutral-muted dark:text-dk-muted">
          Sin datos de Gini disponibles todavía.
        </p>
      ) : (
        <>
          <div className="-mx-2 flex-1 overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">
                Coeficiente de Gini por métrica urbana en Posadas
              </caption>
              <thead>
                <tr className="border-b border-neutral-border text-left text-[10px] uppercase tracking-wider text-secondary dark:border-dk-border dark:text-dk-muted">
                  <th scope="col" className="px-2 py-1.5">
                    Métrica
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right">
                    Gini
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right">
                    Nivel
                  </th>
                </tr>
              </thead>
              <tbody>
                {valid.map((r) => {
                  const nivel = nivelGini(r.gini_index);
                  return (
                    <tr
                      key={r.metrica}
                      className="border-b border-neutral-border/60 last:border-0 dark:border-dk-border/60"
                    >
                      <th
                        scope="row"
                        className="px-2 py-1.5 text-left font-medium text-neutral-text dark:text-dk-text"
                      >
                        {labelMetrica(r.metrica)}
                        <p className="text-[9px] font-normal text-neutral-muted dark:text-dk-muted">
                          n={r.n_barrios}
                        </p>
                      </th>
                      <td className="px-2 py-1.5 text-right font-bold tabular-nums text-primary dark:text-dk-primary">
                        {r.gini_index?.toFixed(3) ?? "s/d"}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="flex items-center justify-end gap-1.5">
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 rounded-full ${nivel.cls}`}
                          />
                          <span
                            className={`text-[10px] font-medium ${nivel.textCls}`}
                          >
                            {nivel.label}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {peor && mejor && peor !== mejor && (
            <p className="mt-3 rounded-md border border-neutral-border bg-neutral-50 p-2 text-[11px] leading-relaxed text-neutral-text dark:border-dk-border dark:bg-dk-elevated dark:text-dk-text">
              <strong>Lectura editorial.</strong> La dimensión más desigual
              entre barrios es{" "}
              <em>&ldquo;{labelMetrica(peor.metrica)}&rdquo;</em> (Gini{" "}
              {peor.gini_index?.toFixed(2)}), y la más equitativa es{" "}
              <em>&ldquo;{labelMetrica(mejor.metrica)}&rdquo;</em> (Gini{" "}
              {mejor.gini_index?.toFixed(2)}). Como referencia, el Gini de
              ingresos en Argentina ronda 0.42 (INDEC).
            </p>
          )}
        </>
      )}

      <footer className="mt-3 pt-3 text-[10px] text-neutral-muted dark:text-dk-muted">
        Corrado Gini (1912). Cálculo: integral sobre la curva de Lorenz de
        los valores por barrio.
      </footer>
    </article>
  );
}

export default GiniCard;
