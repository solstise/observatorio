# Exposición hídrica: revisión del DEM

14/10/2026, Argentina. Rama `codex/completar-exposicion-dem`. Comparación contra `main` en `f937d8c`.

Se completaron los 37 barrios pendientes: los 63 tienen clasificación de exposición completa, sin centroides `a_verificar`. Esto expresa cobertura del cálculo, no validación de inundación ni precisión de alturas. Cinco estimaciones de población permanecen a verificar por nodata de WorldPop.

## Diagnóstico comprobado

El raster anterior `posadas_dem.tif` cubría aproximadamente oeste −56,00017, sur −27,50004, este −55,79993 y norte −27,29980. Los barrios con margen de 600 m necesitan oeste −56,02610 y sur −27,51546: faltaban sectores al oeste y sur. El raster anterior no tenía nodata interno; el problema principal era su extensión.

Los 655 centroides pendientes de los 37 barrios se descomponen sin duplicación en:

| Causa anterior | Centroides |
| --- | ---: |
| Solo falta de cota del edificio | 390 |
| Solo falta de muestra válida del drenaje | 169 |
| Ambas | 96 |
| Total | 655 |

En total, 486 no tenían cota del terreno y 265 no tenían muestra válida del drenaje; ambos grupos se superponen en 96. El diagnóstico reproduce el algoritmo previo, incluyendo su regla de exposición demostrada por distancia menor de 100 m. Ver `data/outputs/diagnostico_dem_nino.json`.

Una línea a 299,9 m puede no tener ningún punto muestreado cada 30 m dentro de 300 m. Se agregó el punto geométrico más cercano sobre el curso OSM real, además de las muestras regulares, sin ampliar el radio. Se lee su píxel del DEM sin interpolación. Si falta la cota necesaria, se mantiene desconocida; no se reemplaza por cero ni por un mínimo calculado descartando muestras nodata.

## Datos utilizados

Se descargaron únicamente ventanas regionales de dos COG públicos de Copernicus DEM GLO-30 Public, release 2021, mosaico en grilla nativa. [Registro oficial del conjunto público](https://registry.opendata.aws/copernicus-dem/). No se cambió silenciosamente a la edición 2024 ni se usó SRTM. Copernicus es un modelo de superficie: incluye efectos de vegetación y construcciones; [catálogo de Earth Engine del conjunto anterior](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30).

- Teselas `S28_00_W057_00` y `S28_00_W056_00`; URLs exactas en `dem_procedencia` del JSON publicado.
- Cobertura: todos los polígonos más 600 m; matriz de 634 × 780 píxeles, cero nodata.
- Descarga: `2026-10-14T13:26:48.189537+00:00`.
- SHA-256 del mosaico: `25c2dab5bc76063f3fce56cb174450a866b004da9b3259b959d55b7ee5b94628`.
- Se preservó el DEM anterior. Los rasters de esta revisión ocupan unos 2,7 MB; no se descargaron teselas globales completas.

La grilla nativa difiere de la grilla remuestreada anterior. En 193.176 centroides cubiertos por ambos: diferencia mediana 0 m, percentil 95 de diferencia absoluta 2,263 m y máximo absoluto 17,160 m. Por eso también pueden cambiar resultados de barrios que antes ya tenían cobertura completa. Los cortes de 2 y 4 m no deben interpretarse como cotas de seguridad. La red OSM puede ser incompleta y no se modelan flujo, alcantarillado, obstrucciones ni crecidas del Paraná.

## Población y resultados que se conservaron inciertos

El recorte local WorldPop anterior tampoco cubría todos los polígonos. Se usó por ventanas el raster nacional `arg_ppp_2020.tif` ya existente, sin volver a descargarlo ni copiarlo. La suma requiere cobertura del polígono y datos válidos en todas las celdas interiores seleccionadas por centro de píxel. Una suma parcial no se presenta como población total; cero válido y nodata se distinguen.

Quedan sin población estimada: **Villa Mola, El Laurel, Bajada Vieja, Puerto Canela y CIT Riberas del Paraná (oeste)**. El raster nacional tiene nodata dentro de esos polígonos. Sus conteos y porcentajes de footprints sí pueden calcularse; la interfaz muestra “WorldPop incompleto: a verificar”. No se rellenaron esos píxeles ni se asignaron habitantes de barrios vecinos.

| Barrio | Footprints expuestos / total | Porcentaje | Población expuesta aproximada |
| --- | ---: | ---: | ---: |
| Santa Rita | 3 / 1.739 | 0,17% | 4 (3–5) |
| Itaembé Miní | 122 / 2.071 | 5,89% | 216 (173–259) |
| Villa Urquiza | 283 / 2.048 | 13,82% | 618 (494–742) |
| Itaembé Guazú | 873 / 9.193 | 9,50% | 306 (245–367) |

No se forzó exposición media/alta en Santa Rita para coincidir con el antecedente histórico. La diferencia sigue siendo una limitación del modelo que requiere relevamiento. Los footprints son proxy de viviendas; la banda poblacional ±20% es orientativa, no un intervalo estadístico validado. Los denominadores de edificios se conservaron respecto del baseline. La comparación de los 63 barrios, incluidos los 37 completados, está en `data/outputs/comparacion_exposicion_dem.json`.

## Reproducción y validación

Desde la raíz, con los insumos de edificios, OSM y WorldPop existentes:

```powershell
python scripts/diagnostico_dem_nino.py
python scripts/descargar_dem_nino.py
python scripts/61_exposicion_hidrica.py
python scripts/comparar_exposicion_dem.py
python scripts/62_nino_snapshot.py
python -m pytest -q
python -m ruff check scripts tests
python -m black --check scripts tests
```

El pronóstico de origen se renueva mediante 57 → 58 → `sync_forecast.py` antes de 62; la fecha del pronóstico nunca se sustituye por la fecha del DEM. El cron consume los agregados versionados y no descarga DEM ni edificios en cada ejecución.

Pruebas locales: **97 aprobadas, 37 omitidas** según condiciones de la suite; ruff y black aprobados. [Tests en GitHub](https://github.com/solstise/observatorio/actions/runs/38573590717) y [lint](https://github.com/solstise/observatorio/actions/runs/38573590544) aprobados; el job Python 3.11 de CI informa **130 aprobadas y 8 omitidas**. Siete pruebas geoespaciales nuevas cubren borde 299,9/300,1 m, cotas faltantes, nodata parcial del drenaje, cero válido y cobertura/nodata poblacional. Build y lint de frontend aprobados; lint conserva advertencias previas. Chrome verificó seis rutas, mapa, 103, tabla ordenable, móvil de 390 px sin desborde, vencimiento del pronóstico tras 25 h y OG PNG, sin errores de JavaScript. Evidencias en `docs/capturas-dem/`.

Las descargas siguen siendo agregadas por barrio o grilla de 60 m disuelta; no se publican centroides de edificios ni se afirma daño observado.

## Despliegue

Integrado con merge normal `efd064d` en `main`, sin force push. [Corrida de actualización y despliegue 38573593113](https://github.com/solstise/observatorio/actions/runs/38573593113) aprobada. El contenedor se inició el **14/10/2026 a las 10:46:35 ART** (`13:46:35 UTC`), imagen `sha256:4c5ea9a01cb05f24cab61897c31339a73fc7e186c5484562e2799825d2aee6bf`.

URL: [Sala de situación El Niño](https://sateliteposadas.com/nino). Smoke público a las 10:47 ART aprobado: home, `/nino`, `/pronostico/riesgos`, `/datos/metodologia` y ficha Villa Urquiza respondieron 200; OG PNG válida. Pronóstico emitido `2026-10-14T13:41:02+00:00`, unos seis minutos de antigüedad. Chrome en producción aprobó también `/pronostico`, mapa, 103, ordenamiento, móvil sin desborde y degradación con datos vencidos, sin errores JavaScript.

Se verificó directamente el JSON público: **63 barrios calculados, cero centroides pendientes y las cinco poblaciones nulas esperadas**. JSON, GeoJSON y KML publicados coinciden con los agregados locales validados al normalizar los saltos de línea CRLF/LF de Windows/Linux. Evidencias y hashes publicados en `docs/capturas-dem/produccion-datos.json`; smoke en `produccion-smoke.json` y pruebas visuales en `docs/capturas-dem/produccion/`. No fue necesario rollback.

Se guardó la imagen previa como `apps-observatorio:rollback-dem-20261014`, digest `sha256:0669577974d84862657c14b6223d7a51ea91e99db2ffcbf3354dfc8161f9cee0`, en el VPS de producción. El código anterior corresponde a `f937d8c`. No se modificaron los cambios ajenos presentes al iniciar. El servidor de prueba local quedó detenido.

Rollback inmediato, si fuera necesario:

```powershell
ssh root@187.77.54.19 'docker tag apps-observatorio:rollback-dem-20261014 apps-observatorio:latest && docker compose -f /opt/apps/migrated-vps2.yml up -d --no-deps --force-recreate --no-build observatorio'
python scripts/smoke_nino.py
```
