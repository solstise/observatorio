# Changelog

Todos los cambios notables a este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado cumple [SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Added — 2026-04-25 capa de engagement web (D1+D2+D4+D5)

#### D1 · PWA instalable
- `webapp/frontend/package.json` ← devDependency `next-pwa@^5.6.0`.
- `webapp/frontend/next.config.mjs` envuelto con `nextPwa({...})` con
  runtimeCaching para tiles Leaflet (CacheFirst), `/api/*` (NetworkFirst,
  timeout 5 s), `/data/*.csv|.json|.geojson` (StaleWhileRevalidate),
  multimedia y fuentes Google.
- `webapp/frontend/public/manifest.json` con name, short_name, icons
  192/512 (any + maskable), theme/background colors institucionales,
  shortcuts a Mapa/Calor/Prioridades, categories productivity+education.
- `webapp/frontend/public/icons/` con PNG 192×192, 512×512,
  apple-touch-icon, favicon-32 + SVGs fuente. Generador en
  `scripts/_gen_icons.py` (Pillow + Inter).
- `webapp/frontend/worker/index.js` se concatena al SW generado por
  next-pwa: handlers `push` + `notificationclick` + `message`.
- `webapp/frontend/src/components/InstallPrompt.tsx`: banner sticky con
  CTA "Instalar app", dismiss persistente 30 días en localStorage,
  fallback iOS (instrucciones Compartir → Añadir a inicio).
- `webapp/frontend/src/app/layout.tsx`: meta `manifest`, viewport
  `themeColor` con media queries dark/light, apple-web-app capable,
  alternates RSS+Atom, montaje del `InstallPrompt`.

#### D2 · Web Push notifications
- `webapp/backend/requirements.txt` ← `pywebpush==2.0.0`,
  `email-validator==2.2.0`.
- `webapp/backend/push.py`: SQLite `data/push_subscriptions.db`,
  helpers `save_subscription`, `delete_subscription`, `broadcast`,
  con auto-disable de endpoints muertos (404/410).
- `webapp/backend/engagement_routes.py`: endpoints
  `POST /api/push/{subscribe,unsubscribe,notify,send_alert}`. Los
  endpoints admin requieren `X-Admin-Token` (env var `PUSH_ADMIN_TOKEN`).
- `webapp/backend/main.py`: CORS abre `POST` y header `X-Admin-Token`,
  registra rutas vía `engagement_routes.register(app, limiter)`.
- `webapp/frontend/src/hooks/usePushSubscription.ts`: detección de
  soporte, `subscribe(barrioId?)`, `unsubscribe()`, manejo de permission
  states (denied/default/granted/unsupported).
- `webapp/frontend/src/components/SuscripcionPushButton.tsx`: vive en
  ficha de barrio.

#### D4 · Email digest semanal
- `webapp/backend/requirements.txt` ← `resend==2.5.1`.
- `webapp/backend/email_subs.py`: SQLite `data/email_subscriptions.db`
  con doble opt-in (tokens separados confirm/optout).
- Endpoints `POST /api/email/subscribe`, `GET /api/email/confirm/{token}`,
  `GET /api/email/unsubscribe/{token}` con páginas HTML simples.
- `templates/email_digest.html`: plantilla CSS-inline gmail-friendly con
  header gradient, tarjetas por barrio (cambios + alertas + forecast),
  footer con unsubscribe y atribuciones.
- `scripts/_email_digest.py`: CLI con `--enviar` / `--preview` /
  `--frecuencia`. Lee suscriptores activos, arma top 3 cambios desde
  serie_temporal/UHI/FIRMS, manda vía Resend o cae a stdout sin clave.
- `webapp/frontend/src/components/SuscripcionEmailForm.tsx`: form en
  ficha de barrio con email + frecuencia + ToS.

#### D5 · RSS / Atom feeds
- `webapp/frontend/src/lib/feed.ts`: agrega items de alertas
  (`data/alertas.json`), cambios significativos en serie_temporal, UHI
  estacional ≥ 4 °C, focos FIRMS ≥ 5/año.
- `webapp/frontend/src/app/feed.xml/route.ts`: RSS 2.0 global, top 50
  ordenados por pubDate desc, revalidate 5 min.
- `webapp/frontend/src/app/feed.atom/route.ts`: Atom 1.0 global.
- `webapp/frontend/src/app/poligono/[id]/feed.xml/route.ts`: feed RSS
  por barrio.
- `webapp/frontend/src/components/Footer.tsx`: links RSS + Atom.
- `layout.tsx > metadata.alternates`: discovery automática.

#### Documentación y deploy
- `docs/push_setup.md`: guía completa de activación (generar VAPID, env
  vars backend/frontend, deploy FastAPI, test e2e, hookear cron de
  alertas, troubleshooting).
- `webapp/backend/.env.example.engagement` y
  `webapp/frontend/.env.example.engagement`: placeholders documentados
  para mergear con los `.env.example` reales.
- `webapp/backend/.gitignore`: ignora `data/*.db` (PII de suscriptores).
- Build verificado verde con `next-pwa` activo, `public/sw.js` y
  `worker-*.js` generados, 59/59 páginas estáticas.

### Fixed — 2026-04-25 fix overlap (release crítica de calidad de datos)

#### Solapamientos eliminados de poligonos.geojson
Audit `_audit_overlaps.py` reportaba 18 pares solapados (7 con >50%, ej.
`villa_sarita` 92% dentro de `bajada_vieja`). Causa raíz: 7 de los 14 polígonos
originales eran *bbox manuales 2x2 km* y los polígonos OSM `admin_level=10`
expansión iteración 2 caían dentro. Riesgo: doble-conteo en sumas agregadas
y rankings entre barrios incomparables.
- `scripts/get_radios_censales.py`: descarga radios censales INDEC 2022
  (`geonode:radios_censales2`) vía WFS — fuente autoritativa, mutuamente
  exclusiva por construcción. 525 radios del depto Capital de Misiones.
- `scripts/build_polygons_from_radios.py`: reasigna cada radio al polígono
  legacy más chico que contiene su centroide (chico-primero), construye la
  geometría final como `unary_union(radios) ∩ legacy_geom_buffered_200m` y
  hace salvamento clip-difference para polígonos sin radios INDEC adentro.
- `config/poligonos.geojson` reescrito: **43 polígonos preservados**
  (mismos IDs), **0 pares con solapamiento ≥ 0.001 km²**.
- `config/poligonos_baseline_rural.geojson` no tocado.
- `config/settings.yaml > geografia.bbox`: extendido al oeste -56.05 y sur
  -27.51 para incluir `nemesio_parma` e `itaembe_guazu` (ya excedían el
  bbox legacy sin que el test lo detectara).
- `data/raw/indec/radios_censales_capital_misiones.geojson`: nuevo dataset
  bruto (525 radios) cacheado.
- `data/processed/_overlap_audit.csv`: vacío (solo header).
- Tests `tests/test_geometrias.py`: 6/6 PASSED.

### Added — Entrega final (iteraciones 2-3, 2026-04-25)

#### Cobertura territorial: 14 → 43 polígonos
- `config/poligonos.geojson` extendido con 29 barrios nuevos vía OSM
  Overpass `admin_level=10`. Cobertura 67.54 km² (rango objetivo
  70-100 km² urbanizados). Geometrías reales de OSM, no buffers. Atribución
  ODbL preservada.
- `config/poligonos_changelog.md`: documentación de cada nuevo barrio
  con OSM relation/way ID, área, fecha, fuente.
- `scripts/get_barrios_osm.py`: script reproducible que regenera la
  lista vía Overpass (auto-documentación del repo).
- `scripts/_build_polygons_step.py` y `scripts/_extend_polygons.py`:
  helpers para ensamble Shapely + selección con desambiguación de
  nombres duplicados (Néstor Kirchner, San Martín, Fátima).
- Distribución por categoría: 24 consolidado_crecimiento, 14
  asentamiento_crecimiento_rapido, 3 zona_sensible, 2 control_consolidado.

#### Validación de campo (sección 15 metodología)
- `scripts/52_validacion_smn.py`: cruce LST mensual vs temperatura del
  aire ERA5-Land Monthly (`ECMWF/ERA5_LAND/MONTHLY_AGGR`). Investigado
  primero SMN/NOAA GHCN — datos insuficientes (no estandarizados).
- Resultados (n=85 meses, 2018-02 a 2026-01): Pearson r=0.896, RMSE
  10.55°C, sesgo +9.47°C diurno. Coherente con literatura para LST
  Landsat 10:30 AM sobre superficie urbana.
- `data/processed/calor/validacion_smn.csv`,
  `validacion_smn_metricas.json`, scatter+serie temporal PNG DPI 200 en
  `data/outputs/calor/`.
- `docs/metodologia_calor.md`: nueva sección 15 (motivación, fuente,
  método, resultados, limitaciones, reproducibilidad).

#### Tests automatizados pipeline calor
- `tests/test_calor.py`: 49 tests sobre `scripts/49_calor_pipeline.py`
  cubriendo fórmula LST, máscara QA_PIXEL, baseline rural (área,
  validez geométrica, distancia haversine), `_calcular_uhi`,
  agregación estacional hemisferio sur, schema CSV, rangos.
- `tests/test_calor_mapas.py`: 18 tests sobre
  `scripts/49b_mapas_calor.py` (CLI, naming convention, TwoSlopeNorm,
  validación outputs reales).
- 95/97 suite completa pasa (2 fallos preexistentes en
  `tests/test_geometrias.py` por solapamiento de polígonos en config,
  no relacionados a calor).

#### UX/UI responsive + copy "qué hace cada capa"
- `Header` reescrito con menú hamburguesa accesible (aria-expanded,
  focus, Escape para cerrar, sticky con backdrop-blur, `aria-current`).
- `Disclaimer` convertido a client component dismissible con
  `sessionStorage`.
- Escala fluida (`--fs-h1/h2/lead`), touch targets ≥44 px, prefers-
  reduced-motion respetado.
- Mapa principal con altura fluida `clamp`, controles Leaflet 36 px en
  táctil, atribución con wrap.
- Recharts: márgenes ajustados para mobile, `width: 100%` explícito.
- Copy de capas reescrito: 15+ componentes con patrón "qué hace +
  Datos: [tech]" (AireGauge, DynamicWorldGauge, SarDeltaBadge,
  IslaCalorBadge, FirmsBadge, AreaProtegidaNotice, ClimaChart,
  HistoriaLargaChart, página /calor, /metodologia, polígono detalle).
- `MetricaCalor` con labels en lenguaje claro: "Temperatura del suelo
  (°C)", "Cuánto más caliente que el campo".

#### Pipeline / sync / data
- 9 PDFs nuevos v0.3.0 con sección de calor (miguel_lanus,
  villa_sarita, nemesio_parma, itaembe_pora, villa_urquiza,
  aguas_corrientes, centro, bajada_vieja, villa_bonita).
- Re-cómputo calor 43 polígonos: 4042 filas stats, 3444 UHI mensual,
  1386 estacional, 104 mapas PNG + 1 GIF actualizados.
- `scripts/49b_mapas_calor.py`: alta calidad coroplética DPI 200/120,
  paletas `magma` y `RdBu_r` con `TwoSlopeNorm` centrado en 0.
- `scripts/80_sync_webapp.py`: fix bug del alias PDF (regex versionado
  en lugar de `split("_v")` que rompía slugs con `_v` como
  `bajada_vieja`).

## [0.3.0] - 2026-04-24

### Added — Capa de calor urbano

- `scripts/49_calor_pipeline.py`: pipeline completo Landsat LST mensual
  con tres subcomandos (`descargar-landsat`, `stats-por-poligono`,
  `calcular-uhi`) más un `todo`. Asset: `LANDSAT/LC08/C02/T1_L2` +
  `LANDSAT/LC09/C02/T1_L2` merged, banda `ST_B10`, 30 m de resolución.
- `config/poligonos_baseline_rural.geojson`: 4 polígonos rurales (Reserva
  Profundidad, sur Garupá, norte Candelaria, Cerro Corá) para baseline.
- Tres definiciones de UHI calculadas y reportadas: absoluta vs rural,
  relativa a promedio ciudad, anomalía histórica estacional.
- Agregación estacional hemisferio sur (DJF, MAM, JJA, SON).
- Página `/calor` con mapa coroplético interactivo (CartoDB Voyager +
  chroma-js), ranking top/bottom 5, selector estación/año/métrica,
  narrativa dinámica por polígono, evolución estacional.
- Link "Calor" en navbar.
- `docs/metodologia_calor.md`: documento metodológico con fuentes,
  fórmulas, limitaciones, uso apropiado.
- Extensión de `lib/types.ts`, `lib/data.{client,server}.ts` con tipos y
  getters `getCalorMensual`, `getUhiMensual`, `getUhiEstacional`.
- Pass-through de CSVs de calor en `80_sync_webapp.py`.
- Smoke test validado: chacra_32 UHI +7.7 °C vs rural (verano 2024),
  nemesio_parma UHI -1.5 °C (hamlet ribereño, enfriamiento natural).

### Changed

- `config/settings.yaml`: bump versión 0.1.0 → 0.3.0.

## [0.1.0] - 2026-04-22

### Added

- Scaffold inicial del repositorio Observatorio Urbano Posadas.
- Estructura de carpetas: `config/`, `scripts/`, `data/`, `docs/`,
  `templates/`, `webapp/`, `notebooks/`, `tests/`, `logs/`, `models/`.
- Archivos de proyecto raíz: `README.md`, `METODOLOGIA.md`, `CHANGELOG.md`,
  `LICENSE` (MIT), `CASOS_DE_USO.md`.
- Configuración inicial: `config/poligonos.geojson` con 5 polígonos piloto
  (Itaembé Miní, Itaembé Guazú, Chacra 32, Villa Cabello, El Brete),
  `config/servicios.geojson` con placeholders, `config/settings.yaml` con
  parámetros globales.
- Dependencias declaradas: `requirements.txt` (runtime), `requirements-dev.txt`
  (desarrollo), `pyproject.toml` (black, ruff, mypy, pytest).
- Plantilla PDF: `templates/reporte_poligono.html` con CSS para WeasyPrint
  (A4, paleta corporativa sobria, tipografía Inter).
- Documentación Fase 1:
  - `docs/poligonos_sugeridos.md` — lista ampliada de candidatos Fase 2.
  - `docs/fuentes_datos.md` — tabla de fuentes con licencias y citas APA.
  - `docs/interpretacion_resultados.md` — guía para funcionarios no técnicos.
  - `docs/faq.md` — preguntas frecuentes.
  - `docs/lecturas.md` — referencias académicas.
  - `docs/politica_publicacion.md` — criterios para polígonos sensibles.
- `.env.example` con variables documentadas.
- `.gitignore` adaptado al stack Python + Node + datos pesados.
- Webapp scaffold (estructura vacía en `webapp/frontend/` y `webapp/backend/`).

### Notes

- Los scripts de Fase 1 (`scripts/01_*` a `scripts/99_*`) se implementan en
  la iteración siguiente.
- Licencia: código MIT, datos derivados CC BY 4.0.
