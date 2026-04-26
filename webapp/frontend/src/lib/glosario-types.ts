// Tipo compartido del glosario de términos técnicos del observatorio.
// Implementación de los datos vive en `lib/glosario.ts`. La página
// /metodologia#glosario y el componente <TerminoGlosario> consumen este
// shape.

export interface TerminoGlosario {
  /**
   * Slug ASCII en minúsculas, único. Se usa como `id="..."` para anchors
   * (#uhi, #ndvi) y como key del componente <TerminoGlosario id="...">.
   */
  id: string;
  /**
   * Forma de mostrar el término en el tooltip y como heading del glosario.
   * Puede tener mayúsculas, acentos, paréntesis. Ej: "UHI (Isla de Calor Urbana)".
   */
  termino: string;
  /**
   * Una sola línea, máx 140 chars, lenguaje claro sin tecnicismos. Es lo
   * que muestra el tooltip al hover/tap. Ej: "Diferencia de temperatura
   * entre la ciudad y el campo cercano. Las ciudades retienen más calor."
   */
  resumen_corto: string;
  /**
   * 3-6 oraciones para la página /metodologia#glosario. Puede usar más
   * tecnicismo y dar contexto, fórmulas si aplica, rangos típicos para
   * Posadas, ejemplo concreto. Markdown simple permitido (no HTML).
   */
  descripcion_larga: string;
  /**
   * Categoría para agrupar en el glosario. Una de: "satelital", "estadistica",
   * "calor", "social", "datos_publicos", "infraestructura".
   */
  categoria:
    | "satelital"
    | "estadistica"
    | "calor"
    | "social"
    | "datos_publicos"
    | "infraestructura";
  /**
   * Sinónimos / alias que debería matchear la búsqueda del glosario.
   * Ej: para "UHI" agregamos ["isla de calor", "urban heat island"].
   */
  alias?: string[];
  /**
   * URL externa con la fuente autoritativa (paper, NASA, ESA, etc).
   */
  fuente_url?: string;
  /**
   * Texto corto de la fuente. Ej: "USGS Landsat C2 L2 docs", "Voogt & Oke
   * 2003, Remote Sensing of Urban Climates".
   */
  fuente_label?: string;
  /**
   * IDs de otros términos relacionados, para el "Ver también" del glosario.
   */
  relacionados?: string[];
}

export type CategoriaGlosario = TerminoGlosario["categoria"];

export const CATEGORIA_LABELS: Record<CategoriaGlosario, string> = {
  satelital: "Sensores satelitales",
  estadistica: "Estadística y modelos",
  calor: "Calor urbano",
  social: "Indicadores sociales",
  datos_publicos: "Datos públicos / fuentes",
  infraestructura: "Infraestructura del observatorio",
};
