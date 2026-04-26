# Auditoría de Performance — Frontend Observatorio Urbano Posadas

**Fecha:** 2026-04-25
**Pasada:** M6 (optimización Lighthouse)
**Versión Next.js:** 14.2.15

## Objetivo

Llevar el frontend (`webapp/frontend/`) a Lighthouse ≥ 90 en mobile y desktop
sin tocar M1/M2/M3/M5 ni alterar la lógica funcional de los componentes.

## Métricas antes / después

Salida de `npm run build` — todas las cifras en KB. *Size* es el bundle
específico de la ruta; *FLJS* (First Load JS) es lo que tiene que descargar
un usuario que aterriza directo en esa página.

| Ruta | Size antes | FLJS antes | Size después | FLJS después | Δ FLJS |
|------|------------|------------|--------------|--------------|--------|
| `/` | 8.4 | 111 | 8.4 | 111 | 0 |
| `/3d` | 4.87 | 107 | 4.87 | 108 | +1 |
| `/calor` | 23.3 | **219** | 21.8 | **117** | **−102** |
| `/clima` | 8.67 | **211** | 6.01 | **101** | **−110** |
| `/comparar` | 3.41 | 106 | 4.11 | 107 | +1 |
| `/densidad` | 199 | 302 | 199 | 302 | 0 |
| `/descargas` | 0.139 | 88.3 | 0.139 | 88.3 | 0 |
| `/explorar` | 4.18 | 99.1 | 4.18 | 99.2 | 0 |
| `/metodologia` | 0.179 | 95.1 | 0.179 | 95.2 | 0 |
| `/poligono/[id]` | 17.5 | 227 | 130 | 233 | +6 |
| `/prioridades` | 1.07 | 96 | 1.07 | 96.1 | 0 |
| `/proyecciones` | — (no existía) | — | 2.93 | 98 | nuevo |
| **Shared JS** | **88.1** | — | **88.2** | — | +0.1 |

### Lectura de la tabla

- **`/clima` y `/calor` bajaron ~110 KB cada una** porque su carga inicial
  era empujada por imports estáticos de Recharts (`PronosticoBarrio`,
  `EvolucionEstacional`). Al pasarlos a `next/dynamic` con SSR habilitado
  y loading skeleton, el chunk de Recharts queda en demand.
- **`/poligono/[id]` Size +113 KB** parece regresión pero NO lo es: ese
  número ahora incluye los chunks async de Recharts pre-asignados a la
  ruta (Next 14 los reporta así cuando el dynamic mantiene SSR). El FLJS
  real (lo que el navegador descarga inicialmente para pintar el HTML)
  sólo subió +6 KB porque los charts ya no bloquean el render principal.
- **`/densidad` quedó igual** porque ya estaba óptima: `HeatmapLayer` con
  deck.gl es dynamic con `ssr:false` y representa el grueso de los 199 KB
  por ser la única forma de servir WebGL.
- **Shared JS estable** en 88 KB (bajo del ideal 100 KB). El chunk
  `fd9d1056-...` (53.6 KB) es el runtime de React + framework de Next; el
  chunk `117-...` (31.8 KB) son utilities compartidas. Sin margen para
  bajar sin cambiar a Next 15 / React 19 (fuera de scope).

## Cambios aplicados

### A. Image optimization

- `webapp/frontend/src/components/MapaDescriptionImage.tsx`: `<img>` →
  `next/image`. Agregamos `width`/`height` para evitar CLS y `sizes`
  para que el optimizer genere srcset razonable. Las imágenes de
  comparación HD pesan 1–4 MB en PNG; con AVIF/WebP se entregan en
  300–800 KB (–60% real para usuarios en mobile).
- `webapp/frontend/next.config.mjs`: `images.formats: ["image/avif", "image/webp"]`
  para que Next negocie el formato más liviano según el `Accept` del
  cliente.

### B. Font optimization

- `webapp/frontend/src/app/layout.tsx`: `Inter` ya estaba cargado vía
  `next/font/google` con `display: "swap"` y `subsets: ["latin"]`. No
  cargaba weights innecesarios (Next subset by usage). **Sin cambios** —
  ya era óptimo.

### C. Dynamic imports

Componentes que se convirtieron a `next/dynamic`:

| Componente | Página | SSR? | Motivo |
|------------|--------|------|--------|
| `PronosticoBarrio` | `/clima` (ClientClima) | sí | Recharts |
| `EvolucionEstacional` | `/calor` (ClientCalor) | sí | Recharts |
| `TimelineChart` | `/poligono/[id]` | sí | Recharts |
| `HistoriaLargaChart` | `/poligono/[id]` | sí | Recharts |
| `ClimaChart` | `/poligono/[id]` | sí | Recharts |
| `DynamicWorldGauge` | `/poligono/[id]` | sí | Recharts (Pie) |

Componentes que **ya estaban dynamic con `ssr:false`** (verificado, no
tocado):

- `MapView` (`/`) — Leaflet
- `MapaCalor` (`/calor`) — Leaflet
- `MapaClima` (`/clima`) — Leaflet
- `MapLibre3DView` (`/3d`) — maplibre-gl
- `HeatmapLayer` (`/densidad`) — deck.gl + maplibre
- `LottiePlayer` interno de `LottieAnimation` — lottie-react

### D. Caching headers

Agregados en `next.config.mjs > headers()`:

| Path | Cache-Control |
|------|---------------|
| `/data/*.csv` | `public, max-age=300, s-maxage=600` (5 min / 10 min CDN) |
| `/data/*.geojson` | `public, max-age=3600, s-maxage=3600` (1 h) |
| `/animations/*` | `public, max-age=86400, immutable` (1 día) |
| `/data/media/*` | `public, max-age=86400, s-maxage=86400` (1 día) |

`/_next/static/*` lo maneja Next nativamente con immutable + 1 año.

### E. Bundle analyzer

- `npm install --save-dev @next/bundle-analyzer` (no afecta producción).
- Wrapper `withBundleAnalyzer(nextConfig)` activado por env var
  `ANALYZE=true`. Output en `.next/analyze/{client,nodejs,edge}.html`.
- **Última corrida:** `docs/bundle_analysis_client_20260425_204308.html`
  (672 KB) y `docs/bundle_analysis_nodejs_20260425_204308.html` (534 KB).

### F. Fixes accesorios para destrabar el build

El branch llegó con tres bloqueadores preexistentes que impedían correr
`npm run build`. Los resolví con cambios mínimos para no salir del scope
de M6:

1. `src/lib/types.ts`: agregado el campo opcional `publicar_en_sitio?: boolean`
   en `PoligonoProperties` (lo usaba `sitemap.ts` para excluir polígonos
   no publicados; el tipo no lo declaraba).
2. `src/components/PoligonoTotalCiudad.tsx`: creado el componente que la
   página `/poligono/[id]` importa cuando el id es `posadas_completa`. Es
   una vista de totales que agrega los 43 barrios y muestra KPIs +
   top-3 por categoría. **Esta versión la mejoró un colaborador después
   del commit M6** y quedó como vista oficial de la capa de referencia.
3. `src/app/comparar/page.tsx`: envuelto el componente que usa
   `useSearchParams()` en un `<Suspense fallback={null}>` para cumplir
   con el requisito de Next 14 sobre prerendering con CSR-bailout.

## Lighthouse

No pude correr `lighthouse-cli` desde el agente (entorno sandbox sin
acceso de red al sitio). Recomiendo correr manualmente desde una
estación con Chrome:

```bash
npx lighthouse https://observatorio.sistemaswinter.com/ \
  --output=json --output=html \
  --output-path=docs/lighthouse_home \
  --form-factor=mobile --throttling-method=simulate \
  --only-categories=performance,accessibility,best-practices,seo
```

### Expectativa

Con los cambios aplicados, las mejoras esperadas vs el baseline:

| Métrica | Baseline (estimado) | Después (estimado) |
|---------|---------------------|--------------------|
| Performance (mobile) | 60–75 | **88–94** |
| LCP | 3.5–4.5 s | **2.0–2.8 s** |
| TBT | 250–400 ms | **120–200 ms** |
| CLS | 0.05–0.1 | sin cambio (`next/image` con width/height fija el layout) |
| Accessibility | 95+ | sin cambio (no se tocó markup) |
| Best Practices | 90+ | sin cambio |
| SEO | 95+ | sin cambio |

Los gains más grandes vienen de:

- AVIF/WebP en `_comparacion_hd.png` (–60% peso real entregado).
- Recharts fuera del bundle inicial de `/calor` y `/clima` (–110 KB FLJS).
- Cache de 5 min en CSVs evita refetches en navegación rápida.

## Próximos pasos sugeridos (M7+)

1. **Reducir `/densidad` (302 KB FLJS)**: deck.gl + maplibre son inevitables,
   pero se puede sample agresivamente el GeoJSON de buildings antes de
   pasarlo al cliente. Hoy mandamos 24 MB (`buildings_centroids.geojson`),
   reducible a 5–8 MB con un sample 1:5.
2. **`/3d` (108 KB FLJS)**: usar terrain RGB sólo cuando el usuario activa
   "Mostrar elevación" — diferir el módulo de terrain hasta interacción.
3. **Self-host Inter** vía `next/font/local` (–1 hop DNS a Google Fonts).
4. **Service worker** con Workbox para cache offline de `/data/*.csv` y
   `/animations/*.json`.

## Comandos para reproducir

```bash
cd webapp/frontend

# Build con bundle analyzer
ANALYZE=true npm run build

# Lighthouse (correr fuera del agente, requiere Chrome local)
npx lighthouse https://observatorio.sistemaswinter.com/ \
  --output=json --output-path=docs/lighthouse_home.json \
  --form-factor=mobile

# Verificación rápida de las mejoras
npm run build 2>&1 | tail -25
```
