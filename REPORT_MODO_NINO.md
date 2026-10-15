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
