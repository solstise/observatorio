# Plan Modo El Niño

Reconocimiento: 14 de octubre de 2026 (Argentina). Rama `feature/modo-nino`.

## Estado inicial y rollback

- `main`: `ddafcb7bca428933f3b80017449c8fe0c61c76f3`.
- El checkout tenía numerosos cambios y rutas nuevas sin commit. Inventario conservado en `.git/modo-nino-baseline-status.txt`. No se deben descartar ni incorporar silenciosamente como trabajo de esta tarea.
- GitHub CLI autenticado. Acceso SSH a `vps2` comprobado. `deploy-vps.sh` sincroniza `webapp/frontend` y construye el servicio Docker `observatorio`. Actualmente ese contenedor no existe; se debe identificar el proceso que sirve producción antes de desplegar y preservar su artefacto.

## Hallazgos

- Cron `refresh-forecast.yml` activo cada 6 h. Run `38506194944` del 14/10 terminó correctamente pero el publicador informó que no encontró JSON. No es una deshabilitación por inactividad.
- Los scripts 57 y 58 escriben `data/processed/forecast`; el workflow publica `webapp/frontend/public/data/forecast` sin ejecutar la sincronización del script 80. La comparación detecta cero cambios y omite el deploy. El frontend local aún contiene metadata del 09/05.
- `DataFreshness.tsx` tiene un temporizador, pero los `useMemo` no dependen del tick: la edad queda congelada. Las páginas estáticas también pueden fijar el HTML inicial al build.
- Score v1: `scripts/capas_avanzadas/compute_capas.cjs`, 50% Dynamic World built + 40% lluvia 48 h normalizada entre barrios + 10% riesgo de vulnerabilidad. Lluvia común a todos los barrios: esa normalización carece de discriminación meteorológica. Fallback built=0,5; investigar repeticiones del 74% en los datos.
- DEM disponible `data/raw/dem/posadas_dem.tif`: el generador 46 usa Copernicus GLO-30, no SRTM. No atribuirle incorrectamente año 2000.
- Footprints combinados: `data/raw/buildings_merge/posadas_merged_buildings.{csv,geojson}`. WorldPop recortado: `data/raw/worldpop/posadas_pop_2020.tif`. Población existente: script 30, incertidumbre ±20%.
- Frontend Next 14, Leaflet, Recharts; API FastAPI separada. Producción lee archivos del frontend. Rutas reorganizadas preexistentes: `/pronostico/riesgos`, `/datos/metodologia`, `/poligono/[id]`.

## Implementación por fase

1. Reparar reloj cliente y timestamp de emisión; banner de datos vencidos; sincronización específica y validada del pronóstico en workflow; correr 57/58 localmente.
2. Módulo puro de lluvia horaria, ventanas móviles completas, percentiles y probabilidades por miembro. Umbrales editables en YAML. Guardar snapshot v2 sin reemplazar v1 hasta tener exposición válida.
3. Script reproducible de exposición: caché Overpass, distancia UTM, aproximación de altura sobre drenaje con DEM existente, clasificación de footprints, agregación WorldPop, exportaciones JSON/GeoJSON/KML sin edificios individuales. Ausencias como null y `a_verificar`.
4. CSV de cinco eventos con fechas verificadas cuando sean accesibles; asociación solo por coincidencia inequívoca.
5. `/nino` con estado, gráfico, mapa, tabla ordenable, equipamiento OSM, eventos, canales oficiales, descargas, OG dinámica y navegación. Conservar diseño sobrio existente. Documentar fórmulas y límites.
6. Corregir placeholders y registrar afirmaciones sin respaldo e inconsistencias sin reescribirlas.
7. Tests de umbrales y exposición, pruebas existentes, build, lint y pruebas de navegador desktop/móvil; reporte y commits por fase.
8. Solo con todas las condiciones verificadas: merge normal, despliegue preservando rollback, smoke en producción y reversión inmediata si falla. Si falta una condición, no desplegar; dejar comando y bloqueo preciso.

Decisión conservadora: el nombre “El Niño” identifica la herramienta; no se afirmará que una fase ENSO está activa sin fuente oficial verificada. No ajustar datos para que parezcan propios de octubre ni forzar concordancia con eventos históricos.
