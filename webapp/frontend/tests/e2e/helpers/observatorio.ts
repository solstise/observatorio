// Helpers compartidos entre los specs E2E del Observatorio.
//
// Filosofía:
// - Selectores semánticos primero (role, label, text). Si hace falta CSS,
//   preferimos contenedores estables (.leaflet-container es API pública de
//   Leaflet, no clase aleatoria del proyecto).
// - Cada helper es chico, hace una cosa, y devuelve algo que el caller
//   puede componer (ej. un Locator, no un screenshot).
//
// Si un test necesita un selector "frágil" (CSS class generada), preferí
// pedir al equipo agregar un data-testid en el componente — el README
// documenta esa decisión.

import { expect, Page } from "@playwright/test";

/**
 * Seleccionar un polígono desde la lista tabular de la home.
 * La lista es accesible (`aria-label="Lista de polígonos"`) y cada barrio
 * aparece como `<th scope="row">{nombre}</th>` con un botón "Seleccionar".
 *
 * @param page    Página de Playwright
 * @param nombre  Nombre exacto o parcial del barrio (ej. "Itaembé Guazú")
 */
export async function seleccionarPoligono(
  page: Page,
  nombre: string,
): Promise<void> {
  // Aseguramos que la tabla terminó de hidratar (el selectionar lo hace
  // un useState client-side, así que esperamos a que aparezca).
  const tabla = page.getByRole("table", { name: /Lista de polígonos/i });
  await expect(tabla).toBeVisible({ timeout: 10_000 });

  // Encontramos la fila por su rowheader (scope=row) que contiene el nombre.
  // Usamos `:scope` y filtros de rol para no acoplarnos al markup interno.
  const fila = tabla
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: nombre }) });

  await expect(fila).toBeVisible({ timeout: 10_000 });

  // En cada fila hay dos acciones: "Seleccionar" (re-pinta el sidebar)
  // y "Ver ficha" (navega). Para flujos de selección preferimos
  // "Seleccionar"; los tests que esperan navegación llaman `clickFichaPoligono`.
  const boton = fila.getByRole("button", {
    name: new RegExp(`Seleccionar ${escapeRegex(nombre)}`, "i"),
  });
  await boton.click();
}

/**
 * Click en el link "Ver ficha" de un polígono — navega a /poligono/{id}.
 * Útil para tests que verifican la página de detalle.
 */
export async function clickFichaPoligono(
  page: Page,
  nombre: string,
): Promise<void> {
  const tabla = page.getByRole("table", { name: /Lista de polígonos/i });
  await expect(tabla).toBeVisible({ timeout: 10_000 });

  const link = tabla.getByRole("link", {
    name: new RegExp(`Abrir ficha completa de ${escapeRegex(nombre)}`, "i"),
  });
  await link.click();
}

/**
 * Esperar a que el contenedor Leaflet esté presente en el DOM.
 * `.leaflet-container` es un selector estable: es la clase que pone Leaflet
 * cuando inicializa un mapa, no una clase del proyecto. No filtra cuántos
 * tiles ya pintó — sólo confirma que el mapa montó.
 */
export async function esperarMapaLeaflet(page: Page): Promise<void> {
  const map = page.locator(".leaflet-container").first();
  await expect(map).toBeVisible({ timeout: 15_000 });
}

/**
 * Esperar a que un canvas WebGL esté presente. Cubre tanto maplibre-gl
 * (página /3d, /clima usa también) como deck.gl (/densidad). Ambos
 * renderizan en `<canvas>` dentro del DOM.
 */
export async function esperarMapaWebGL(page: Page): Promise<void> {
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 15_000 });
}

/**
 * Cerrar disclaimer si aparece. El componente `<Disclaimer>` muestra un
 * banner persistente arriba con un botón aria-label="Cerrar aviso". Los
 * tests que interactúan con el header (ej. dark mode toggle) lo cierran
 * primero para que no intercepte clicks. No falla si no existe (puede
 * estar ya descartado en sessionStorage).
 */
export async function cerrarDisclaimerSiAparece(page: Page): Promise<void> {
  const cerrar = page
    .getByRole("button", { name: /Cerrar aviso/i })
    .first();
  if (await cerrar.isVisible().catch(() => false)) {
    await cerrar.click().catch(() => {
      /* idempotente */
    });
  }
}

/**
 * Escapar caracteres regex en un nombre de barrio para que sirva como
 * patrón. Los nombres con tildes y guiones llegan al regex tal cual.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
