# Modo El Niño — reporte

Actualización posterior: [revisión del DEM y exposición completa](REPORT_DEM_EXPOSICION.md). Las cifras de 26 barrios completos y 37 pendientes que siguen en este documento describen el estado histórico anterior a esa revisión.

Trabajo del 14/10/2026, zona horaria Argentina. Rama `feature/modo-nino`.

## Resultado por fase

0. Reconocimiento y plan en `PLAN_MODO_NINO.md`. Se preservó la reorganización previa del frontend en un commit separado (`9c4d91a`), necesaria para las rutas solicitadas. Los cambios ajenos de scripts, otros workflows, lock y archivos auxiliares permanecen sin incorporar. No se modificaron ni rotaron secretos.
1. Corregido el flujo de pronóstico y la frescura. Se ejecutaron 57/58 y sincronización local. Snapshot utilizado: `2026-10-14T03:36:52+00:00`, 882 filas diarias, 63 barrios y 72 horas futuras. Las temperaturas y la poca lluvia recibidas son datos reales de la API, no se alteraron por su parecido con un pronóstico invernal. La API devuelve mínimas próximas a 11 °C hacia el fin de semana y máximas de aproximadamente 20–26 °C. La home sigue identificando como antiguos los datos satelitales de mayo: no se cambiaron sus fechas para aparentar frescura.
2. Lluvia máxima 1 h/3 h y máximos móviles 24 h/48 h dentro de 72 h, banda P10–P90 y probabilidades por superación de al menos un umbral en cada miembro. Se excluyen miembros incompletos, sin convertir faltantes a cero. Los valores de atención/alto/muy alto son editables en YAML y están marcados como calibración inicial. El estado actual puede ser “sin umbral superado”; no se crea una alerta por el nombre de la sala.
3. Calculada exposición para 63 polígonos, usando footprints combinados Google/Microsoft, WorldPop 2020 y DEM Copernicus GLO-30 existente. Descargados y cacheados 605 cursos OSM. Aproximación de altura relativa con cota mínima de drenaje muestreado cada 30 m en radio de 300 m; no es HAND hidrológico. Se eligió el método simple previsto por el prompt, evitando presentar direcciones de flujo o alcantarillado no modelados. JSON agregado, GeoJSON de grilla 60 m disuelta y KML con anillos interiores. Sin edificios individuales en las exportaciones.
4. Cinco eventos registrados, sin inferir fechas ni chacras. Verificación HTTP independiente: publicaciones de enero 2026 (09/01), 40 mm/h (30/09/2025), 126 mm (10/10/2018) y chacras numeradas (03/11/2012). Estas fechas son de publicación; se mantiene `a_verificar` para el día del evento cuando no quedó establecido. Canal 12 respondió 403: la fila de octubre 2026 queda explícitamente pendiente de verificación. No se confundieron viviendas inundadas con familias.
5. `/nino`: encabezado y frescura, lluvia horaria, mapa Leaflet, tabla ordenable con desplazamiento en celular, equipamientos, eventos enlazados, recuadro fijo 103/SMN y descargas. Hay 674 equipamientos públicos OSM. No se publican contactos personales; solo nombre público, tipo y enlace OSM. Todos se presentan como equipamiento cercano, sin atribuir carácter de refugio oficial. OG dinámica PNG con nivel y tres barrios con exposición completa; degradación explícita con pronóstico vencido. Enlace en menú Pronóstico y banner de home solo para nivel alto/muy alto vigente. Metodología nueva con fórmulas y límites.
6. Eliminado “creció ~X%” del glosario VIIRS. Las otras observaciones de credibilidad se listan abajo; no se reescribieron sus afirmaciones.
7. Tests, build, lint y pruebas de navegador completados. Se corrigieron errores de hooks previos que impedían lint y la diferencia de espacios/horario entre ICU y Chrome que causaba hidratación incorrecta. `sharp` permite renderizar OG en Windows y producción; se incluye fuente DejaVu en Docker.
8. Merge normal a `main`, despliegue local y corrida completa desde GitHub Actions aprobados. Smoke público posterior aprobado; no fue necesario rollback. Ver cierre con hora, imagen y resultados.

## Diagnóstico del cron y reparación

El workflow estaba activo. Run `38506194944`, 14/10, terminó en verde, pero el publicador informó que no encontró JSON. Los scripts escribían `data/processed/forecast`; el workflow miraba `webapp/frontend/public/data/forecast` sin sincronización. Al no detectar cambios, tampoco desplegaba. El run fallido `38325557437` mostró además HTTP 500 y timeouts de Open-Meteo: incidente distinto del fallo persistente de publicación.

Se agregó sincronización validada con timestamp de zona horaria, CSV y JSON para API/Upstash; las alertas conservan la emisión del pronóstico de origen. Los indicadores recalculan cada minuto y después de hidratar; no se usa mtime para fingir frescura de datasets de 6 h. Home y páginas de pronóstico muestran banner rojo al superar 24 h o faltar fecha. La API dejó de inventar `generated_at=ahora` ante ausencia de timestamp.

El commit de datos se hace en un worktree efímero separado y conserva el checkout de código para el deploy; se dejaron de ignorar conflictos de merge. Los insumos UHI/Dynamic World se recuperan de la rama de datos. Los snapshots estáticos de exposición y v1 quedan versionados, por lo que el cron no descarga edificios ni consulta Overpass cada 6 h.

Comandos exactos (CLI autenticada):

```powershell
gh workflow enable refresh-forecast.yml --repo solstise/observatorio
gh workflow run refresh-forecast.yml --repo solstise/observatorio --ref main -f skip_deploy=true
gh run list --repo solstise/observatorio --workflow refresh-forecast.yml --limit 5
```

No fue necesario reactivar un workflow deshabilitado. La corrida manual debe usar la reparación ya incorporada a main; no aporta disparar la versión rota.

## Exposición: cobertura, contraste y límites

26 barrios tienen exposición completa; 37 quedan `a_verificar` por alturas faltantes en 655 centroides. Se conservan los conteos identificados como expuestos, pero no se informa porcentaje, población o score completo cuando falta clasificación. La interfaz no transforma esos faltantes en riesgo bajo. Los porcentajes completos van de 0 a 56,27%.

- Villa Urquiza: 286 footprints expuestos sobre 2.048 (13,96%); población expuesta aproximada 626 (501–751). Hay señal de exposición, sin validación de daño histórico.
- Santa Rita: 3 identificados, 5 sin clasificación, porcentaje total a verificar. No coincide con la expectativa de exposición media/alta del antecedente.
- Itaembé Miní: 113 identificados y 3 sin clasificación; no se fuerza una categoría.
- Los polígonos DM asociados muestran exposiciones distintas. No son intercambiables con el barrio homónimo. “Zona oeste” no tiene coincidencia unívoca de polígono y no se le asignó uno por intuición.

El conteo usa centroides como aproximación a edificios y un footprint no equivale necesariamente a una vivienda. WorldPop 2020 se distribuye según proporción de footprints: supone ocupación homogénea y no representa un censo actual. La banda ±20% es orientativa. El DEM no permite garantizar cotas de seguridad de 2–4 m; el drenaje OSM puede faltar y no representa la red pluvial completa. No se modela crecida del Paraná.

## Score y el 74% repetido

El script anterior usaba `dw_built_mean`, que es probabilidad media de clase construida, como si fuera porcentaje impermeable. Los CSV muestran valores reales próximos a 0,74; no era un fallback literal del 74%. El fallback en código era 0,5. Se dejó de usar esa probabilidad como impermeabilidad en v2. El campo descriptivo exportado usa la proporción real de píxeles con probabilidad built ≥0,5 por polígono, sin fallback, y sigue siendo un proxy de superficie construida.

V1: 50% built + 40% lluvia 48 h normalizada entre barrios + 10% riesgo de vulnerabilidad. Con lluvia uniforme, la normalización no aporta discriminación. El “riesgo histórico” proviene de vulnerabilidad; el script 35 permite un CSV externo, pero por defecto es un placeholder cero. No constituye una base de eventos históricos validada.

V2: `100 × min(1, max(max_1h/umbral_muy_alto_1h, max_24h/umbral_muy_alto_24h)) × (0,25 + 0,75 × fracción_expuesta)`. Sin lluvia el resultado es cero; sin exposición completa es null. Las páginas existentes consumen solo filas v2 completas; `/nino` muestra todos los barrios y sus faltantes. `anegamiento_v1.csv` conserva el snapshot previo y fecha de vigencia desconocida; no se presenta como pronóstico actual.

## Revisión de credibilidad — pendientes sin reescritura

- `src/lib/glosario.ts`, dengue: afirma validación contra partes epidemiológicos provinciales. No se encontró una comparación implementada contra esos partes: **afirmación sin respaldo en el código**.
- Mismo archivo, calor: afirma calibración mensual contra SMN y dirección municipal de Salud. Existe `scripts/52_validacion_smn.py`, pero no evidencia de ese procedimiento mensual sanitario conjunto: **afirmación sin respaldo en el código** para esa formulación.
- Mismo archivo, anegamiento: afirma validación contra Defensa Civil, built+bare contrastado con NDBI, CHIRPS 48 h, pendientes SRTM y bocas de tormenta OSM. No corresponde a la fórmula v1 encontrada ni demuestra validación con Defensa Civil: **afirmación sin respaldo en el código**. La nueva sección de v2 describe explícitamente lo implementado.
- La metodología anterior también menciona una capa con hidrométricos INA para el Paraná: no se encontró evidencia suficiente para tratarla como un pronóstico operativo validado.
- Metadatos, OG de home y otras páginas dicen “43 barrios”. Configuración y frontend publicado contienen 63 barrios más un polígono de referencia de ciudad (64 features). Texto propuesto, no aplicado: “Cobertura actual: 63 polígonos de análisis barrial y una capa de referencia de ciudad; no equivalen necesariamente a divisiones administrativas oficiales”.
- La suma de población en polígonos publicados es 212.186. No debe presentarse como población censal total de Posadas, ni compararse directamente con el aglomerado/departamento sin igualar área y fecha. Texto propuesto, no aplicado: “Estimación sobre los polígonos cubiertos a partir de WorldPop 2020 y footprints; no es el total censal municipal. Para población oficial, consultar INDEC Censo 2022 con la misma unidad territorial”. No se tomó Britannica como sustituto de INDEC.
- Dengue: 85% del score corresponde a componentes estáticos; 15% a lluvia pronosticada normalizada entre polígonos. Se calcula Tmin promedio, pero no participa de la fórmula. Por eso puede informar muchos barrios altos aun con poco frío/lluvia proyectada; no demuestra transmisión prevista. No se modificó este modelo en esta tarea.

## Validación

- `npm run build`: aprobado.
- `npm run lint`: aprobado, con advertencias previas de comillas y dependencia de memo en glosario.
- `npm run typecheck`: aprobado.
- `python -m pytest -q`: 90 aprobados, 37 omitidos por condiciones opcionales del conjunto existente. Incluye 25 tests nuevos (umbrales inclusivos, ventanas completas, miembros faltantes, score, clases y agregación, snapshot vencido).
- `ruff check scripts tests` y `black --check scripts tests`: aprobados, comandos del CI del repo. El formato del cambio previo de `scripts/54_ranking_politico.py` se normalizó sin incorporar sus cambios funcionales al commit.
- Auditoría adicional `ruff check .`: detectó 13 problemas preexistentes en el backend no desplegado (imports y longitud de línea). No se reescribió ese backend.
- Navegador Chrome: `/`, `/pronostico`, `/pronostico/riesgos`, `/datos/metodologia`, `/poligono/villa_urquiza` y `/nino` responden 200. Desktop 1440×1000 y celular 390×844; sin desborde horizontal ni errores React. Ordenamiento y mapa operativos.
- Vencimiento de 25 h en pestaña abierta: banner rojo y nivel “a verificar”. OG responde PNG 200. Capturas y resultados en `docs/capturas-nino/`. Script reproducible `node scripts/verify_nino_browser.cjs` con servidor local en 3127.
- Equipamientos: no hay nombres de punto con refugio/centro de evacuados; solo el aviso explícito “no es un refugio oficial”. Canal 103 y SMN visibles.

## Producción y rollback

Main inicial local y remoto: `ddafcb7bca428933f3b80017449c8fe0c61c76f3`.
Imagen de producción registrada antes de modificar nada: `sha256:36483f5a79f3a0ee9af12589b2d535e05b919b6f397d8f47c747bdd72165530a`.
Contenedor creado el 13/06/2026; imagen del 12/05/2026. No hay un identificador de deploy más preciso comprobado.

Se conservó como `apps-observatorio:rollback-modo-nino-20261014`. Backup del código remoto previo: `/opt/apps/observatorio-pre-nino-20261014.tar.gz` (los datos originales siguen dentro de la imagen anterior). Producción está en `187.77.54.19`; el alias local `vps` usa IPv6 y puede fallar intermitentemente, por lo que se verificó acceso directo IPv4. El contenedor usa `/opt/apps/migrated-vps2.yml`, con imagen sin sección build; se corrigió el script para construir esa imagen explícitamente y recrear solo este servicio.

Despliegue desde la raíz, con SSH existente:

```bash
bash deploy-vps.sh
```

Rollback sin force push:

```bash
ssh root@187.77.54.19 'docker tag apps-observatorio:rollback-modo-nino-20261014 apps-observatorio:latest && docker compose -f /opt/apps/migrated-vps2.yml up -d --no-deps --force-recreate --no-build observatorio'
```

### Cierre del despliegue

- URL final: https://sateliteposadas.com/nino.
- Código desplegado: `aabeb11bfa726f6c0a8329a3256e37ad03a34c75`, con merges normales desde `feature/modo-nino`; sin force push.
- Primer deploy operativo: 14/10/2026 a las 01:10:36 ART. Se había cancelado un build anterior antes del reemplazo del contenedor para incluir la aclaración de cobertura parcial; el reintento concluyó correctamente. La versión anterior permaneció en servicio durante esa compilación.
- Verificación inicial del cron sin deploy: [run 38509103069](https://github.com/solstise/observatorio/actions/runs/38509103069), aprobado. Generó, sincronizó, publicó en Upstash y guardó los snapshots en `data`.
- Verificación completa del cron desde `main`, con deploy: [run 38510103171](https://github.com/solstise/observatorio/actions/runs/38510103171), aprobado. Quedó comprobado también el acceso SSH de GitHub Actions al destino real.
- Deploy automático final: 14/10/2026, 01:17:33 ART. Imagen activa: `sha256:ae5b7eec86a15e325c8b18c4ee93ae3a27c62c467565c643c0c1bdcfb9556d2e`.
- Smoke final: 01:17:52 ART. Home, `/nino`, `/pronostico/riesgos`, `/datos/metodologia` y `/poligono/villa_urquiza`: **200**. OG de `/nino`: **200, PNG válido**.
- Forecast y estado de `/nino` emitidos a las `2026-10-14T04:12:43+00:00` (01:12:43 ART), con edad 0,086 h al verificar: menos de 24 h.
- Comprobación visual adicional en producción a 390×844: sin desborde horizontal ni errores React; 103 visible. Evidencias finales en `docs/capturas-nino/produccion*.json` y `produccion-mobile.png`.
- CI de los merges: tests y lint aprobados; [tests finales](https://github.com/solstise/observatorio/actions/runs/38509674323), [lint final](https://github.com/solstise/observatorio/actions/runs/38509674311).
- Se preservó la imagen original y el backup del código para el rollback indicado arriba. No se borraron imágenes ni contenedores de otras aplicaciones. El servidor local de prueba se detuvo al terminar.

Las limitaciones de exposición, fuentes históricas pendientes e inconsistencias heredadas listadas arriba siguen vigentes. No se publicaron como validadas ni se rellenaron datos para completar barrios.

## Revisión de comprensión — 16/10/2026

Solicitud: hacer `/nino` más entendible para usuarios sin formación técnica, tanto gráficos como texto. Rama `codex/nino-mas-claro`, base `5bf272b`. Se conservan los datos, los umbrales y las cinco poblaciones sin estimación. La exposición completa de los 63 barrios describe cobertura del cálculo, no certeza de inundación.

- Resumen del pronóstico en lenguaje cotidiano, emisión y hora de Posadas visibles. La estimación central se distingue de los demás escenarios. Los datos vencidos conservan el aviso y no informan un nivel actual.
- Gráfico con escala adaptativa para no esconder cantidades pequeñas; vista independiente para comparar con los límites de atención, alto y muy alto. Leyenda explícita, ayuda al tocar una hora y explicación de milímetros. Se aclara que los períodos de 1/3/24/48 horas se superponen y no deben sumarse. Percentiles, escenarios y calibración quedan en una explicación desplegable.
- Buscador de barrios que acepta nombres sin tildes, ordenamiento y lista que funciona en celular sin desplazar una tabla hacia los costados. Se muestran edificios expuestos sobre el total y su proporción mediante una barra, población aproximada con banda orientativa y el impacto estimado en palabras. El índice interno de 0 a 100 no se presenta como probabilidad de inundación.
- Dos vistas separadas del mapa: zonas expuestas y efecto combinado con la lluvia prevista. Selector de barrio y enlace desde cada resultado para acercarse. Las zonas azules no representan agua observada. Equipamientos sin atribución de refugio oficial.
- Antecedentes con fechas legibles, sin inventar días; incertidumbre visible y notas de verificación disponibles al desplegar. Descargas con explicación de formatos; imagen para compartir y enlace de home con texto actualizado. Canales oficiales fijos con 103 visible, sin ocupar un recuadro tan alto en celular.

Validación local: build, typecheck y lint aprobados (lint conserva advertencias ajenas en explorar/aire/glosario). `node scripts/verify_nino_clarity.cjs` prueba búsqueda, mostrar más, orden, enlace al mapa, separación de capas, escala, población faltante y recuperación de búsquedas vacías; verifica 320, 390, 768 y 1440 px sin desborde y tema oscuro. Sus fixtures **solo locales** comprueban lluvia fuerte, falta de serie, pronóstico vencido y snapshot ausente, y restauran el archivo original en `finally`. No se publican fixtures. `scripts/verify_nino_browser.cjs` verifica seis rutas, mapa, 103, móvil, vencimiento a las 25 h y OG PNG. Sin errores JavaScript. Capturas y resultados: `docs/capturas-nino-claro/`.

Para probar en producción sin mutar archivos ni usar fixtures:

```powershell
$env:NINO_BASE_URL='https://sateliteposadas.com'
$env:NINO_READ_ONLY='1'
$env:NINO_OUTPUT_DIR='docs/capturas-nino-claro/produccion'
node scripts/verify_nino_clarity.cjs
python scripts/smoke_nino.py
```

CI del merge `c93c440`: [tests aprobados](https://github.com/solstise/observatorio/actions/runs/38964950003), 130 aprobados y 8 omitidos tanto en Python 3.11 como en 3.12; [lint aprobado](https://github.com/solstise/observatorio/actions/runs/38964950021). Se inició la [corrida de actualización y despliegue](https://github.com/solstise/observatorio/actions/runs/38965265992) después de esa validación.

Despliegue aprobado: contenedor iniciado el **16/10/2026 a las 18:01:16 ART** (`21:01:16 UTC`), código `c93c440`, imagen `sha256:749d5548d4db48f816c73e8f1129eea433b8df4f30bf79c100669927535717d7`. URL: [Sala de situación El Niño](https://sateliteposadas.com/nino).

Smoke público aprobado a las 18:01 ART: home, `/nino`, riesgos, metodología y Villa Urquiza respondieron 200; OG PNG válida. Pronóstico emitido `2026-10-16T20:53:25+00:00`, con unos ocho minutos de antigüedad. Chrome en producción aprobó también `/pronostico`, búsqueda sin tildes, ordenamiento, mostrar más, selección de barrio, modos del mapa, ambas escalas, población faltante explícita, 320/390/768/1440 px sin desborde y tema oscuro. Se probó además el vencimiento a las 25 h en el reloj del navegador: no se presenta un nivel vigente. Sin errores JavaScript.

Las cinco descargas (CSV de barrios, GeoJSON, KML, antecedentes y cálculo v1) respondieron 200 y sus contenidos se pudieron parsear. El CSV actual contiene 63 filas. Se verificó directamente el estado publicado: los 63 barrios siguen calculados, cinco poblaciones siguen sin estimación y los totales, edificios expuestos, porcentajes y estimaciones poblacionales coinciden con los agregados anteriores. Evidencias en `docs/capturas-nino-claro/produccion/`, `produccion-smoke.json` y `produccion-descargas.json`.

No fue necesario rollback. Quedó preparada la etiqueta `apps-observatorio:rollback-nino-claro-20261016`, imagen `sha256:4024526d20cfbd3353237432a0c122cb70e00ffa49e7e97d0738bcbca3cf3bf7`; se conserva el procedimiento por imagen indicado arriba, sustituyendo la etiqueta. El servidor local quedó detenido y los cambios ajenos al trabajo permanecen sin incorporar.

## Datos oficiales en vivo y rediseño mobile-first — 22 y 23/10/2026

Solicitud: después de varios días de lluvia y caída de granizo, revisar si faltaban datos. Luego: incorporar todas las fuentes oficiales posibles, todo automático (sin reportes de vecinos), mobile first y una interfaz más amable. Rama `feature/nino-tiempo-real`, base `ef2c0c1`.

### Diagnóstico

- La sala solo mostraba un pronóstico a 72 h. Durante el temporal del 21–22/10 publicó "Sin señal de lluvia intensa" en las 12 actualizaciones desde el 20/10 (historial de la rama `data`), mientras la estación SMN Posadas Aero midió 75 mm en las 24 h hasta las 9 del 22/10 y unos 91 mm en 72 h. Su propio umbral de atención es 50 mm en 24 h.
- El SMN tenía alerta amarilla por tormentas para Posadas (40–70 mm, granizo, ráfagas de hasta 90 km/h) y avisos a muy corto plazo por granizo en Misiones y Corrientes. La página no consultaba ninguna alerta.
- Error de método: se tomaba el máximo de la mediana hora por hora. Como cada miembro del ensamble ubica la tormenta a otra hora, la mediana aplanaba los picos. Con el ensamble del 22/10: 24 h 20,6 mm (método anterior) contra 38,9 mm (mediana de los picos de cada miembro; P90 61,5 mm); 1 h 2,4 contra 6,4 mm.
- Las fallas del cron del 20/10 y 22/10 fueron timeouts SSH al VPS por IPv4; los datos se guardaron igual.
- Las probabilidades de tormenta y ráfagas de los modelos globales resultaron muy bajas (3 %) con alerta oficial vigente: se calculan y exportan, pero no se muestran como titular. Para tormentas manda el SMN.

### Fuentes incorporadas (todas automáticas)

| Dato | Fuente | Acceso | Frecuencia |
|---|---|---|---|
| Alertas por zona y avisos a muy corto plazo | SMN, CAP (CC BY 4.0) | `ssl.smn.gob.ar/CAP/AR.php` y un XML por alerta; Posadas se evalúa por polígono | 3 min, en el servidor |
| Estado del tiempo | SMN datos abiertos (`tiepre`) | ZIP con texto | 10 min |
| Tormenta y granizo en el aeropuerto | METAR SARP vía NOAA Aviation Weather | JSON | 5 min |
| Lluvia medida | SYNOP 87178 (SMN) vía Ogimet | bloques de 6 h; día de 9 a 9 h | 15 min en vivo; registro diario cada 6 h |
| Rayos | NOAA GOES-19 GLM | archivos de 20 s en S3, leídos con `h5wasm` | 3 min, incremental |
| Río Paraná | Prefectura Naval (actual) e INA serie 14 (30 días) | HTML y API a5 | 60 min y 6 h |
| Modelo de alta resolución | SMN WRF 4 km (AWS Open Data) | lectura por rangos HTTP solo de `PP` | cada 6 h en el cron |

No se encontró acceso automático a radar: las imágenes del SMN están detrás de un desafío anti-bots. El espejo CAP de la OMM tenía alertas del SMN viejas (7/9) y se descartó. La estimación satelital de lluvia (GSMaP vía Earth Engine) queda como siguiente paso: no se pudo probar localmente sin credenciales de Earth Engine.

### Cambios

- `scripts/nino_model.py`: mediana de los picos por miembro y percentil 90; totales por día local (P10/P50/P90, probabilidad de superar 20 mm y el nivel de atención); probabilidad de tormenta y ráfagas con su propio número de miembros (`None` si faltan, nunca cero). Umbrales nuevos en `config/alertas.yaml` (`nino_tiempo_real`).
- `scripts/63_lluvia_observada.py`: registro diario acumulativo en `nino/lluvia_observada_diaria.csv`, recuperado de la rama `data` en cada corrida; la primera vez se completa desde el 1/1/2026 (296 días, 16 con 30 mm o más). Un día sin reporte de 24 h queda vacío.
- `scripts/64_wrf_smn.py`: última corrida completa, caja de 7 × 7 celdas alrededor de Posadas, valor del centro y máximo de la zona. Si no hay corrida completa publica `no_disponible`.
- `webapp/frontend/src/lib/nino-live/`: parsers puros (CAP, SYNOP, METAR, SMN, Prefectura, rayos), caché en memoria con último dato bueno y hora real, y `/api/nino/ahora`. El SMN limita los XML a 200 pedidos cada 10 minutos por IP: se leen una sola vez por emisión, se omiten las regiones Patagonia y Cordillera, y ante un 429 se pausa 10 minutos. Si quedan archivos sin leer o las alertas están desactualizadas, la página no afirma "Sin alertas".
- `/nino` rediseñado mobile-first: estado principal con la alerta oficial y sus recomendaciones, "Ahora en Posadas", lluvia medida con barras por día y registro, pronóstico por día con rango, mediana y WRF, mapa con rayos de la última hora, río con medidor y 30 días, y "De dónde salen los datos". Se actualiza solo cada 3 minutos. La estimación propia aparece en tono neutro y subordinada a la alerta del SMN. OG e inicio priorizan la alerta oficial.
- Rendimiento: los 674 lugares del mapa estaban sueltos dentro del control de capas de Leaflet y cada actualización era cuadrática. Con los datos en vivo eso bloqueaba el navegador unos 100 s. Ahora van en un `LayerGroup`, los marcadores en canvas y el mapa memoizado: la página responde en segundos.
- CI: job `frontend-unit` (Node 24) y SSH del deploy con tiempo de espera corto y tres reintentos.

### Validación local

- `pytest tests/test_nino.py tests/test_nino_tiempo_real.py`: 37 aprobados (el test geoespacial requiere rasterio, presente en CI). `ruff` y `black --check` aprobados en los archivos tocados.
- `node --test tests/unit/nino-live.test.mjs`: 11 aprobados, con muestras reales del 22/10 (los totales de 63 mm en 24 h y 91 mm en 72 h coinciden con el cálculo manual).
- `tsc --noEmit`, `next lint` sobre lo nuevo y `npm run build` aprobados; `h5wasm` queda incluido en el paquete standalone y la API respondió con las seis fuentes en modo producción.
- `scripts/verify_nino_clarity.cjs` actualizado y aprobado sin errores de JavaScript: búsqueda, mapa, escalas, datos en vivo y API, 320/390/768/1440 px sin desborde, y fixtures de lluvia fuerte, serie vacía, vencimiento y snapshot ausente. Evidencias en `docs/capturas-nino-tiempo-real/local/`. El modo oscuro real se comprobó con el botón de tema del sitio; la captura `mobile-dark.png` del script agrega la clase a mano y conserva el fondo claro, igual que en la verificación anterior.
