# Cron workflows — Observatorio Urbano Posadas

Este documento describe los **cuatro workflows automáticos** de GitHub Actions
que mantienen los datos del observatorio actualizados sin intervención humana.

Cada workflow corresponde a una **frecuencia natural distinta** del dataset
que refresca, y todos siguen el mismo patrón final: si hubo cambios en los
CSVs derivados, commitean a la rama `data` y disparan deploy al VPS.

## Resumen

| Workflow | Cron (UTC) | Cron (Posadas, UTC-3) | Tiempo aprox. | Datasets que refresca |
|----------|------------|------------------------|---------------|------------------------|
| `refresh-forecast.yml` | `0 */6 * * *` | 21:00 / 03:00 / 09:00 / 15:00 | 5–10 min | Forecast clima + alertas (Open-Meteo) |
| `refresh-firms-daily.yml` | `0 6 * * *` | 03:00 | 5–10 min | FIRMS focos de incendio activos (VIIRS/MODIS) |
| `refresh-monthly.yml` | `0 6 1 * *` | día 1, 03:00 | 30–60 min | Dynamic World, Sentinel-1 SAR, CHIRPS, NO2, LST, FIRMS, WDPA, Landsat UHI, mapas estacionales |
| `refresh-yearly.yml` | `0 6 1 1 *` | 1 enero, 03:00 | 60–120 min | Open Buildings, MS Buildings merge, MapBiomas, GHSL, VIIRS, Sentinel-2 RGBs, re-conteo techos, re-estimación poblacional, validación SMN, proyecciones, PDFs |

> **Concurrency**: los 4 comparten el grupo `concurrency: data-branch`. Eso
> garantiza que **solo un workflow a la vez puede empujar a la rama `data`**,
> evitando race conditions cuando dos crons coinciden (p.ej. el de 6 h y el
> mensual el día 1 a las 06:00 UTC).

## Workflow A: `refresh-forecast.yml` (cada 6 h)

### Qué actualiza
- `webapp/frontend/public/data/forecast/` — pronóstico diario por polígono
  (Open-Meteo + downscaling).
- `webapp/frontend/public/data/alertas/` — alertas climáticas derivadas
  (umbrales de calor, lluvia, viento).
- Publica al cache **Upstash Redis** (TTL 6 h) para que el frontend SSE pueda
  hacer poll cada 30 s sin pegarle al filesystem.

### Por qué cada 6 h
- Open-Meteo refresca su modelo cada 6 h.
- Las alertas tienen vida útil corta (hasta 24 h) y conviene tenerlas frescas
  en cada turno operativo.

### Si falla
- El step "Abrir issue si falló" crea un issue automático con label `cron`.
- El frontend cae a fallback: lee directamente `/public/data/forecast/` (la
  última versión commiteada en `data`).

## Workflow B: `refresh-firms-daily.yml` (diario 06:00 UTC)

### Qué actualiza
- `data/processed/ambiental/firms_anual.csv` — nº de focos y % área afectada
  por polígono y por año.
- `webapp/frontend/public/data/firms.csv` — pass-through al frontend.

### Por qué diario
- FIRMS (VIIRS/MODIS) detecta focos de incendio activos con latencia < 3 h
  desde la pasada del satélite.
- Posadas está en zona Paraná con alta incidencia de incendios estacionales
  (sept–feb). Información de prioridad operativa para Defensa Civil.
- Hora 06:00 UTC = 03:00 Posadas: las pasadas nocturnas ya están procesadas
  y los datos quedan listos antes de la jornada operativa de la mañana.

### Si falla
- Se abre issue automático.
- El frontend muestra los datos del último run exitoso (pueden ser de hace
  hasta 30 días si hay racha de fallos hasta que corra el mensual).
- **Causa común**: cuota Earth Engine — verificar que `EE_SERVICE_ACCOUNT_JSON`
  está vigente.

## Workflow C: `refresh-monthly.yml` (día 1 de cada mes 06:00 UTC)

### Qué actualiza (en orden de ejecución)
1. `41_dynamic_world.py` → Dynamic World mensual (cobertura del suelo).
2. `43_sentinel1_cambios.py` → Sentinel-1 SAR (cambios estructurales).
3. `47_ambiental.py todo` → CHIRPS + NO2 + LST + FIRMS + WDPA (idempotente —
   re-corre FIRMS pero salta las combinaciones ya computadas).
4. `49_calor_pipeline.py` → 3 subcomandos: `descargar-landsat`,
   `stats-por-poligono`, `calcular-uhi` (UHI con Landsat LST).
5. `49b_mapas_calor.py --tipo todo` → mapas estacionales PNG + GIF + ranking.
6. `57_forecast_clima.py` + `58_alertas_clima.py` → forecast con base nueva.
7. `_publish_to_upstash.py` → publicar al cache Redis.
8. `80_sync_webapp.py` → sync a `webapp/frontend/public/data/`.
9. Push a `data` + deploy VPS si hay cambios.

### Por qué día 1
- GEE consolida composites mensuales pasados ~5 días, así que día 1 garantiza
  que tomamos el mes completo M-1 sin huecos.
- Hora 06:00 UTC = 03:00 Posadas, hora valle del runner.

### `timeout-minutes: 90`
- Landsat (descarga + stats) suele tardar 20–30 min.
- Composites mensuales (Dynamic World, S1) otros 15–20 min.
- Margen para reintentos internos de los scripts.

### Si falla
- Se abre issue automático con label `monthly`.
- El frontend sigue funcionando con datos del mes anterior.
- **Causa común**: el bloque Landsat es el más frágil. Existe input
  `skip_landsat=true` en `workflow_dispatch` para reintentar solo el resto.

## Workflow D: `refresh-yearly.yml` (1 de enero 06:00 UTC)

### Qué actualiza (en orden de ejecución)
1. `03_descarga_buildings.py --force` → re-descarga Open Buildings v3.
2. `42_ms_buildings_merge.py` → merge Microsoft + Google.
3. `44_historia_larga.py --todo` → MapBiomas + GHSL + VIIRS.
4. `01_descarga_sentinel.py` → Sentinel-2 RGBs nuevos para timelapses.
5. `20_contar_techos.py` → re-conteo (output a `data/processed/conteos_v43/`).
6. `30_estimar_poblacion.py` → re-estimación poblacional v43.
7. `52_validacion_smn.py todo` → re-validación contra ERA5.
8. `59_proyecciones_futuras.py` → re-proyectar con nueva base.
9. `60_generar_pdf.py --all` → re-generar PDFs anuales por polígono.
10. `80_sync_webapp.py` (apuntando a v43) → sync.
11. Push a `data` + deploy VPS si hay cambios.

### Por qué 1 de enero
- Open Buildings v3 publica refresh anual en Q1.
- MapBiomas Argentina libera Colección N en marzo–abril, pero ejecutamos al
  inicio de año porque los scripts son **idempotentes**: si la fuente upstream
  no cambió, no fuerzan re-descarga (excepto `03 --force`).
- Permite cerrar el "año fiscal" del observatorio con un snapshot consolidado.

### `timeout-minutes: 180`
- Open Buildings re-descarga es la operación más pesada (~30 min para todo el
  bbox de Posadas).
- Re-conteo de techos sobre buildings nuevos puede tardar 30–60 min.
- PDFs (uno por polígono) otros 20–30 min.

### Si falla
- Se abre issue automático con label `yearly`.
- El frontend sigue funcionando con la versión anterior (v42).
- **Causas comunes**:
  - Open Buildings: descarga pesada con timeouts ocasionales.
    Usar `skip_buildings=true` en `workflow_dispatch` para reintentar el resto.
  - PDFs: requieren Cairo/Pango — verificar que los apt deps quedaron
    instalados (el step "System deps" lo cubre).
  - MapBiomas: si cambió el ID del asset GEE, hay que actualizar
    `44_historia_larga.py`.

## Ejecución manual (workflow_dispatch)

Cualquiera de los 4 puede dispararse a mano desde la UI de GitHub Actions:

1. Ir a `https://github.com/solstise/observatorio/actions`.
2. Seleccionar el workflow en la barra izquierda.
3. Botón **"Run workflow"** arriba a la derecha → branch `main` → Run.

### Inputs disponibles por workflow

| Workflow | Inputs `workflow_dispatch` |
|----------|----------------------------|
| `refresh-forecast` | `skip_deploy` |
| `refresh-firms-daily` | `skip_deploy` |
| `refresh-monthly` | `skip_deploy`, `skip_landsat` |
| `refresh-yearly` | `skip_deploy`, `skip_buildings`, `skip_pdfs` |

Los inputs `skip_*` son útiles para reruns rápidos cuando un bloque específico
falló y queremos reintentar el resto sin esperar el bloque pesado.

## Race condition entre crons

El **único momento** del año en que dos crons coinciden naturalmente es el
**1 de enero a las 06:00 UTC**: ahí podrían dispararse simultáneamente
`refresh-forecast` (cada 6 h), `refresh-firms-daily` (diario 06:00),
`refresh-monthly` (día 1) y `refresh-yearly` (1 enero).

### Solución implementada
Los 4 workflows declaran:

```yaml
concurrency:
  group: data-branch
  cancel-in-progress: false
```

Eso garantiza que **GitHub Actions encola los runs y los ejecuta uno por uno**.
El forecast (5–10 min) corre primero, luego FIRMS (5–10 min), luego mensual
(30–60 min), luego anual (60–120 min). Total worst case: ~3 hs de cola pero
sin conflictos en `git push origin data`.

`cancel-in-progress: false` es clave: preferimos esperar antes de perder un
run a la mitad.

## Secrets requeridos

Configurar en `Settings → Secrets and variables → Actions` del repo
`solstise/observatorio`:

| Secret | Workflows que lo usan | Para qué |
|--------|------------------------|----------|
| `VPS_SSH_KEY` | los 4 | Clave privada OpenSSH (id_ed25519) con acceso a `root@187.77.54.19` |
| `VPS_KNOWN_HOSTS` | los 4 | Output de `ssh-keyscan 187.77.54.19` (evita prompt) |
| `EE_SERVICE_ACCOUNT_JSON` | firms-daily, monthly, yearly (forecast lo tolera ausente) | JSON del service account de Earth Engine |
| `UPSTASH_REDIS_REST_URL` | forecast, monthly | URL REST del cache Redis |
| `UPSTASH_REDIS_REST_TOKEN` | forecast, monthly | Token REST de Upstash |

Si algún secret no está seteado:
- `forecast` y `firms-daily` salen con warning pero continúan (el deploy se
  saltea solo).
- `monthly` y `yearly` fallan hard porque dependen de Earth Engine.

## Auto-issue al fallar

Cada workflow tiene un step final `Abrir issue si falló` (`if: failure()`)
que usa `actions/github-script@v7` para llamar a `github.rest.issues.create`.

El issue lleva labels:
- `bug`, `automation`, `cron` (todos)
- + `firms` / `monthly` / `yearly` según el workflow

Y en el body incluye:
- Link al run que falló
- Trigger (cron / dispatch)
- Branch
- Pasos sugeridos para diagnosticar

Cerralo manualmente cuando esté resuelto.

## Verificación local de los YAMLs

```bash
wsl -d Ubuntu -- bash -lc 'cd /mnt/c/ProyectosIA/Antigravity/observatorio && \
  python3 -c "import yaml; [yaml.safe_load(open(f)) for f in \
    [\".github/workflows/refresh-firms-daily.yml\", \
     \".github/workflows/refresh-monthly.yml\", \
     \".github/workflows/refresh-yearly.yml\", \
     \".github/workflows/refresh-forecast.yml\"]]; print(\"OK\")"'
```

## Ver también

- [`setup_real_time.md`](./setup_real_time.md) — setup inicial de Upstash + SSH key + repo en GitHub.
- [`fuentes_datos.md`](./fuentes_datos.md) — descripción de cada dataset y su frecuencia upstream.
