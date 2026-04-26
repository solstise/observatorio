# Tests E2E - Observatorio Urbano Posadas

Suite Playwright que cubre el "golden path" del usuario tipo (un funcionario
público o un investigador) navegando el dashboard.

## Cómo correr

### Local contra `next dev`

```bash
# Terminal 1: levantar la app
cd webapp/frontend
npm run dev

# Terminal 2: correr tests
cd webapp/frontend
npm run test:e2e
```

Por default `PLAYWRIGHT_BASE_URL` apunta a `http://localhost:3000`.

### Smoke contra producción

Útil para verificar rápido que `https://observatorio.sistemaswinter.com`
sigue sano después de un deploy:

```bash
PLAYWRIGHT_BASE_URL=https://observatorio.sistemaswinter.com \
  npm run test:e2e:smoke
```

`test:e2e:smoke` filtra por `golden-path` (10 tests principales + suite
secundaria de status codes). Tarda ~2-3 min contra prod.

### Modo UI (debugging interactivo)

```bash
npm run test:e2e:ui
```

Abre la GUI de Playwright: re-ejecutá tests, mirá el DOM en cada paso,
inspeccioná la red. Ideal cuando un test falla y querés entender por qué.

### Modo headed (ver el navegador)

```bash
npm run test:e2e:headed
```

Corre con el navegador visible. Útil para debuggear timing de animaciones
o capas que tardan en pintar.

### Filtrar por test específico

```bash
npx playwright test -g "Dark mode"
npx playwright test golden-path.spec.ts:120  # línea
```

### Filtrar por proyecto (navegador / device)

```bash
npx playwright test --project=chromium
npx playwright test --project=mobile-iphone-13
```

## Estructura

```
tests/e2e/
├── README.md                    (este archivo)
├── golden-path.spec.ts          (10 tests + smoke de status codes)
└── helpers/
    └── observatorio.ts          (selectores compartidos)
```

## Qué cubre cada test

| # | Test                         | Ruta                           | Lo que valida                                                            |
| - | ---------------------------- | ------------------------------ | ------------------------------------------------------------------------ |
| 1 | Home renderea                | `/`                            | Título, mapa Leaflet, lista con "Posadas (toda la ciudad)" como primera fila |
| 2 | Navegación a barrio          | `/` → `/poligono/itaembe_guazu`| Click en "Ver ficha" navega y carga chart "Cómo creció la edificación"   |
| 3 | Página de calor              | `/calor`                       | Hero, mapa coroplético, selector de estación/año, ranking top/bottom    |
| 4 | Página de clima              | `/clima`                       | Mapa, "Pronóstico", banda p10–p90, disclaimer de incertidumbre           |
| 5 | Página de prioridades        | `/prioridades`                 | Tabla con ~44 polígonos, "Federal" en top 1, click navega a ficha        |
| 6 | Visualización 3D             | `/3d`                          | Canvas maplibre carga; banner "MapTiler key" si NEXT_PUBLIC_MAPTILER_KEY vacío |
| 7 | Densidad heatmap             | `/densidad`                    | Canvas deck.gl, toggle viviendas/UHI cambia aria-pressed                 |
| 8 | Mobile responsive            | `/` (390x844)                  | Hamburguesa visible, panel mobile abre, mapa ocupa ancho completo        |
| 9 | Dark mode toggle             | `/`                            | Toggle agrega clase `dark` a `<html>`, background cambia                 |
| 10| Comparar polígonos           | `/comparar`                    | Seleccionar 2 polígonos rinde grilla con métricas                       |

Además, suite secundaria de "smoke status codes" valida que las 9 rutas
principales devuelven < 500.

## Cobertura por feature

| Feature                  | Test  | Browsers cubiertos                  |
| ------------------------ | ----- | ----------------------------------- |
| Mapa Leaflet (home)      | 1, 2  | chromium, firefox, webkit, mobile  |
| Mapa coroplético calor   | 3     | chromium, firefox, webkit, mobile  |
| Mapa Leaflet clima       | 4     | chromium, firefox, webkit, mobile  |
| Tabla ranking            | 5     | chromium, firefox, webkit, mobile  |
| Maplibre 3D + WebGL      | 6     | chromium, firefox, webkit, mobile  |
| Deck.gl heatmap          | 7     | chromium, firefox, webkit, mobile  |
| Mobile (hamburguesa)     | 8     | chromium con viewport iPhone 13     |
| Dark mode + persistencia | 9     | chromium, firefox, webkit, mobile  |
| Comparador interactivo   | 10    | chromium, firefox, webkit, mobile  |

## Cómo agregar nuevos tests

1. **Spec nueva**: creá `tests/e2e/<feature>.spec.ts` con
   `import { test, expect } from "@playwright/test"`.
2. **Test dentro de spec existente**: agregá un `test(...)` dentro de
   un `test.describe` en `golden-path.spec.ts`.
3. **Helpers compartidos**: si el selector se usa en >1 test, llevalo a
   `helpers/observatorio.ts`.
4. **Datos**: nunca crear datos en el dashboard desde un test E2E. Los
   tests son **read-only** sobre el sitio público — no hay mutaciones.

### Convenciones de selectores

- `getByRole(role, { name })` siempre primero.
- `getByText(/regex/i)` si no hay role claro.
- `getByLabel(/label/i)` para inputs.
- `data-testid` **solo si** el componente no expone semántica accesible
  y el equipo decide agregarlo. Si tu test necesita un testid que aún
  no existe, **no lo agregues al componente sin discutir** — el
  contrato del proyecto es: los tests se adaptan a la UI, no al revés.
- CSS classes solo si son APIs estables externas (`.leaflet-container`,
  `.maplibregl-canvas`).

### Convenciones de timeout

- Default: 5s para asserts, 30s por test.
- Mapas (Leaflet, maplibre, deck.gl): hasta 15s para el primer paint.
- Navegación entre rutas: 10s.
- Si necesitás más, **documentá por qué** en el test.

## CI

El workflow de ejemplo está en `.github/workflows/e2e.yml.example`.
Para activarlo: copiar a `e2e.yml` y commitear. Corre matrix de
chromium/firefox/webkit, sube el HTML report como artifact.

## Notas

- **Primera corrida**: `npx playwright install chromium firefox webkit`
  baja los browser binaries (~500 MB). En Linux puede pedir libs del
  sistema (`--with-deps`).
- **WebKit en WSL Ubuntu**: si corrés tests localmente desde WSL sin
  permisos de sudo, WebKit (y por extensión el proyecto
  `mobile-iphone-13` que lo usa) puede fallar con un mensaje sobre
  libs faltantes (`libGLESv2.so.2`, `libenchant-2.so.2`, etc). Esto
  es un problema de sistema, no del código de los tests. Soluciones:
  (1) en el host con permisos: `sudo npx playwright install-deps webkit`
  o (2) corré sólo `chromium`, `firefox`, `mobile-pixel-5` localmente
  y dejá WebKit para CI (donde el workflow ya usa `--with-deps`).
- **Headless por default**: en CI siempre. Local ajustable con
  `--headed`.
- **No usamos webServer auto**: la config no levanta `next dev` sola
  para que `test:e2e:smoke` contra prod no intente arrancar un dev
  server local.
- **El `posadas_completa` se llama "Posadas (toda la ciudad)"** en
  el sitio (no "Toda Posadas" como decía la spec original). Test 1
  matchea por el texto real del componente, sin inventar fixtures.
- **Test #5 espera entre 40 y 50 polígonos** en la tabla de prioridades.
  El número exacto en prod hoy es 44, pero dejamos rango para tolerar
  cambios del pipeline social (`scripts/54_ranking_politico.py`).
- **Test #9 (dark mode)** mide el cambio de tema leyendo la variable
  CSS `--color-bg` en `<html>` (en vez del `backgroundColor` computado).
  Razón: globals.css define una transición de 200ms en `bg-color`, así
  que `getComputedStyle().backgroundColor` puede devolver un valor
  intermedio durante la animación. La variable CSS no se anima y
  refleja el tema resuelto al instante.

## Decisiones que NO tomamos

- **No agregamos `data-testid` a los componentes de producción**. Los
  selectores semánticos del proyecto son suficientes (la app está bien
  marcada con `aria-label` / `role` / headings). Si en el futuro un
  test pide testid, **levantarlo como discusión** antes de tocar
  componentes M1/M2/M3/M4.
- **No bajamos browser binaries fuera de Playwright**. Todo vía
  `npx playwright install`.
- **No mockeamos el backend**. Los tests pegan al sitio real
  (local o prod). Si Earth Engine cae, los tests de calor/clima
  pueden fallar — eso es información, no un bug del test.
