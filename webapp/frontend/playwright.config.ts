// Playwright configuration for Observatorio Urbano Posadas E2E tests.
//
// Decisiones:
// - baseURL configurable por env (PLAYWRIGHT_BASE_URL). Default localhost:3000
//   para correr local; en CI/prod se setea explícitamente. Con esto el mismo
//   archivo de tests sirve para "smoke contra prod" y "regression contra dev".
// - Tres motores: chromium (default), firefox y webkit. Webkit nos da una
//   prueba indirecta de Safari/iOS sin tener Mac. Cada navegador corre las
//   mismas specs salvo los proyectos `mobile-*` que usan viewport real de
//   dispositivo (iPhone 13 / Pixel 5) para detectar layouts rotos en mobile.
// - Retries: 2 en CI (la red a la VPS puede flaquear, los mapas tardan en
//   pintar), 0 local (queremos que el dev vea el fallo directo).
// - Reporter: html (artefacto explorable post-corrida) + list (output legible
//   en terminal mientras corre).
// - workers: undefined => auto, paraleliza por defecto. Si una página rompe
//   por sobrecarga de WebGL en CI, bajamos manualmente.
// - timeout: 30s por test (mapas Leaflet/maplibre/deck.gl pueden tardar 5-10s
//   en pintar tiles), 5s por assertion (suficiente para esperas de UI sin
//   hacer la suite lenta innecesariamente).
//
// NO arrancamos webServer automáticamente: si el usuario quiere tests
// locales contra `next dev`, los corre en otra terminal. Esto evita que
// la suite contra prod intente levantar un dev server.
import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  // Ignoramos archivos que no sean specs (helpers, README).
  testMatch: ["**/*.spec.ts"],
  // Output de artefactos (screenshots, videos, traces) — se ignora con
  // .gitignore (ver tests/e2e/README.md).
  outputDir: "./test-results/",

  // Tiempos. Conservadores porque los mapas WebGL/Leaflet pueden tardar
  // varios segundos en pintar contra una conexión normal.
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },

  // Paralelismo por archivo (default Playwright). En CI seguimos paralelos
  // pero con retries para tolerar flakiness puntual.
  fullyParallel: true,
  forbidOnly: IS_CI, // bloquea `test.only` colado en CI
  retries: IS_CI ? 2 : 0,
  workers: undefined, // auto: usa los cores disponibles

  // Reporters: HTML para ver el detalle (capturas, pasos) post-corrida +
  // list para feedback en terminal en tiempo real.
  reporter: IS_CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    // Trace solo en re-tries (ahorra disco en runs verdes, da info útil
    // cuando algo falla).
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Mapas Leaflet/maplibre disparan muchas requests a tiles externos —
    // ignoramos errores HTTPS de tiles que a veces saltan en CI.
    ignoreHTTPSErrors: true,
    // Locale es-AR: la app usa formateo de números en español (1.234,56).
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    // Mobile simulado: iPhone 13 (Safari iOS) y Pixel 5 (Chrome Android).
    // Estos proyectos usan viewport + userAgent de un dispositivo real,
    // así vemos mobile responsive sin un device físico.
    {
      name: "mobile-iphone-13",
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "mobile-pixel-5",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
