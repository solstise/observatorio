# Metodología — Capa de calor urbano

Versión: v0.3.0 · Fecha: 2026-04-24 · Observatorio Urbano Posadas.

## 1. Qué mide esta capa

Temperatura de superficie terrestre (Land Surface Temperature, **LST**) e
intensidad de isla de calor urbana (**UHI**) por polígono, derivada de
imágenes satelitales Landsat 8 y Landsat 9. El pipeline está definido en
`scripts/49_calor_pipeline.py` del repositorio.

## 2. LST ≠ temperatura del aire (leer primero)

Landsat mide **temperatura de superficie**: la temperatura del techo de
chapa, del asfalto, del césped o del agua que "ve" el satélite desde órbita.
**No es** la temperatura del aire ambiente a 1,5 m del suelo que mide un
termómetro.

A las 10:30 AM en verano, en Posadas:

- Asfalto de una avenida: puede alcanzar **50 °C de LST**.
- Aire a 1,5 m sobre esa avenida: aproximadamente **32 °C**.

Esa diferencia es normal y bien documentada en la literatura (Voogt &
Oke 2003, *Remote Sensing of Urban Climates*). Usar LST como proxy de
temperatura del aire es un **error conceptual serio**.

**Por qué la reportamos igual**: la LST es buena proxy de *dónde* se
concentra el calor urbano. Si un barrio tiene 8 °C más de LST que el
campo, vive con mayor estrés térmico aunque la diferencia de aire sea
menor (tal vez 3-4 °C). El dato sirve para **comparar barrios**, no para
decir "hace X grados en tu casa".

## 3. Hora de pasada del satélite

Landsat 8 y 9 cruzan el ecuador a las **10:00 AM hora solar local**. Para
Posadas eso significa entre 9:50 y 10:30 AM hora local.

Implicancia: medimos **UHI diurna**. La UHI **nocturna** es un fenómeno
relacionado pero distinto, más intenso en general, donde el asfalto y el
concreto liberan el calor acumulado mientras el campo se enfría
rápidamente. La UHI nocturna no se captura con Landsat — para ese aspecto
complementamos con MODIS LST nocturno (1 km, `MODIS/061/MOD11A2`) en
`scripts/47_ambiental.py`.

## 4. Fórmula LST a partir de ST_B10

Landsat Collection 2 Level 2 entrega LST ya calibrada:

```
LST_Celsius = ST_B10 * 0.00341802 + 149.0 - 273.15
```

Donde `ST_B10` viene en Digital Numbers 16-bit. El factor y el offset son
los oficiales USGS. Ver
[USGS Landsat C2 L2 Surface Temperature Product Guide](https://www.usgs.gov/landsat-missions/landsat-collection-2-surface-temperature).

## 5. Máscara de nubes y sombras

Aplicamos la banda `QA_PIXEL` filtrando los bits 3 (nube) y 4 (sombra):

```python
no_nube = qa.bitwiseAnd(1 << 3).eq(0)
no_sombra = qa.bitwiseAnd(1 << 4).eq(0)
imagen.updateMask(no_nube.And(no_sombra))
```

Pixeles enmascarados se excluyen del cálculo. Si un polígono queda con
menos del 30 % de pixeles válidos tras la máscara, se marca **sin dato**
para ese mes (no interpolamos).

## 6. Composites mensuales

Para cada mes entre 2018-01 y el mes actual:

1. Merge de colecciones `LANDSAT/LC08/C02/T1_L2` y `LANDSAT/LC09/C02/T1_L2`.
2. Filtro por fecha (mes completo) + `CLOUD_COVER < 30`.
3. Si hay menos de **2 escenas válidas** en el mes → se declara "sin dato"
   y se saltea (no interpolamos ni promediamos meses vecinos).
4. Mediana temporal pixel a pixel (robusto frente a nubes residuales).
5. Conversión a °C (fórmula arriba).
6. Exporte como GeoTIFF Float32 a `data/raw/landsat_lst/lst_YYYYMM.tif`.

En Posadas (subtropical húmedo, ~50 % de cobertura nubosa anual) es normal
que algunos meses tengan cero datos, especialmente entre noviembre y
marzo. No es un bug, es realidad climática.

## 7. Tres definiciones de UHI

Reportamos las tres en `uhi_mensual.csv`:

### 7.1 UHI absoluta vs rural

```
UHI_vs_rural(barrio, mes) = LST(barrio, mes) − LST(rural_baseline, mes)
```

Donde `rural_baseline` es el promedio de cuatro polígonos vegetados o de
pasturas dentro de 20 km de Posadas, definidos en
`config/poligonos_baseline_rural.geojson`:

- Reserva Natural Provincial Profundidad (oeste, selva).
- Rural sur de Garupá (pasturas).
- Rural norte de Candelaria (pasturas).
- Selva remanente cerca de Cerro Corá (bosque).

Esta es la **métrica estándar** en literatura de UHI. Valores típicos para
ciudades subtropicales sudamericanas: +2 a +8 °C en verano diurno.

### 7.2 UHI relativa a ciudad

```
UHI_vs_ciudad(barrio, mes) = LST(barrio, mes) − LST(promedio_urbanos, mes)
```

Útil para ranking interno y para comunicar al ciudadano "tu barrio está
X grados más caliente que el promedio de Posadas".

### 7.3 Anomalía estacional

```
UHI_anomalía(barrio, mes, año) = LST(barrio, mes, año) −
                                   promedio(LST(barrio, mes, año_i < año))
```

Detecta si un barrio se está calentando más que su propio histórico. Útil
para detectar tendencias de urbanización reciente.

## 8. Agregación estacional

Usamos las estaciones del hemisferio sur:

- **Verano (DJF)**: diciembre-enero-febrero.
- **Otoño (MAM)**: marzo-abril-mayo.
- **Invierno (JJA)**: junio-julio-agosto.
- **Primavera (SON)**: septiembre-octubre-noviembre.

Por convención, diciembre del año N se cuenta en el verano del año N+1
(para que "verano 2025" sea coherente con el sentido común local).

## 9. Rangos esperados y validación

Para Posadas, los valores típicos son:

| Período | LST urbana esperada | LST rural esperada |
|---|---|---|
| Verano diurno (10:30 AM) | 30–45 °C | 25–35 °C |
| Invierno diurno | 15–28 °C | 12–22 °C |

Valores fuera de 5–60 °C se marcan inválidos (probable problema de
calibración o nube residual no filtrada). Si el cálculo arroja
`|UHI_vs_rural| > 15 °C`, el log lanza un warning — revisar antes de
publicar.

## 10. Banda de confianza

Cada fila UHI incluye:

- `n_observaciones_historico`: cuántos años previos hay del mismo mes.
- `std_historico`: desviación estándar interanual.

Reglas de interpretación usadas por el frontend:

- `n ≥ 12 && std < 1,5 °C` → confianza **alta**.
- `n ≥ 6 && std < 3 °C` → confianza **media**.
- resto → **preliminar**.

## 11. Fuentes y licencias

| Dataset | Asset | Licencia | Cita |
|---|---|---|---|
| Landsat 8 C2 L2 | `LANDSAT/LC08/C02/T1_L2` | Public Domain (USGS) | U.S. Geological Survey (2013). *Landsat 8 Collection 2 Level 2.* |
| Landsat 9 C2 L2 | `LANDSAT/LC09/C02/T1_L2` | Public Domain (USGS) | U.S. Geological Survey (2021). *Landsat 9 Collection 2 Level 2.* |
| MODIS LST (complemento) | `MODIS/061/MOD11A2` | NASA open | Wan, Z. (2021). *MOD11A2 MODIS/Terra Land Surface Temperature 8-Day L3 Global 1km.* NASA LP DAAC. |

Cita sugerida del observatorio:

> Observatorio Urbano Posadas (2026). *Capa de calor urbano — temperatura
> de superficie por barrio, Posadas, Misiones.* Basado en Landsat 8/9 C2 L2
> (USGS). v0.3.0. https://observatorio.sistemaswinter.com/calor

## 12. Uso apropiado vs inapropiado

### Sí se puede

- Priorizar inversión en arbolado urbano en barrios con UHI alta.
- Argumentar políticas de techos blancos, veredas permeables, refugios
  climáticos.
- Comunicar a la ciudadanía *comparativamente* ("tu barrio es más caliente
  que el promedio").
- Investigación académica sobre justicia ambiental.
- Base técnica para discusiones presupuestarias del ministerio.

### No se debe

- Usar para **alertas individuales de salud** ("si vive en tal barrio,
  evacúe"). La LST no captura condiciones a escala de vivienda.
- **Estigmatizar** poblaciones: correlación barrio pobre–barrio caliente
  es un hallazgo de justicia ambiental, no una etiqueta.
- Decisiones **inmobiliarias automáticas** ("este barrio vale menos").
- Sustituir mediciones locales de aire (estaciones meteorológicas) cuando
  se necesita temperatura ambiente real.

## 13. Limitaciones conocidas

1. **Resolución 30 m**: polígonos muy chicos (<0,1 km²) tienen pocos
   pixeles y estadísticas ruidosas.
2. **Cobertura nubosa**: meses enteros pueden faltar, sobre todo en
   verano.
3. **LST diurno únicamente**: no capturamos el pico nocturno de UHI
   (usar MODIS MOD11A2 complementario).
4. **Baseline rural estático**: no detecta si el campo mismo se calienta
   (por deforestación, por ejemplo). Asumimos baseline estable como
   referencia.
5. ~~**Sin validación de campo**: todavía no cruzamos con mediciones de
   estaciones meteorológicas de SMN Argentina (pendiente Fase 3).~~
   **Resuelto** (2026-04-25): cruce con ERA5-Land Monthly Aggregated
   (ECMWF, asimila SMN) sobre 85 meses arroja Pearson r = 0.896 entre
   LST y T_aire mensual. Ver sección 15.

## 14. Referencias

- Voogt J.A., Oke T.R. (2003). *Thermal remote sensing of urban climates*.
  Remote Sensing of Environment 86(3):370-384.
- Peng S. et al. (2012). *Surface urban heat island across 419 global big
  cities*. Environmental Science & Technology 46(2):696-703.
- Zhou D. et al. (2019). *Satellite remote sensing of surface urban heat
  islands: progress, challenges, and perspectives*. Remote Sensing
  11(1):48.
- Tokairin T. et al. (2010). *Study on the urban heat island in Asuncion,
  Paraguay* (ciudad comparable en latitud y clima).

## 15. Validación con datos de campo

*Sección agregada el 2026-04-25 por `scripts/52_validacion_smn.py` v0.1.0. Resuelve el punto 5 de la sección 13.*

### 15.1 Por qué validar

Toda capa derivada de teledetección térmica requiere cruce con una fuente independiente de temperatura del aire para tener credibilidad académica y operativa. Sin este cruce, la LST podría estar correlacionada con cualquier cosa (por ejemplo nubes residuales, sesgo del compositor mediano, deriva del sensor) y no la temperatura real percibida por la ciudadanía.

### 15.2 Fuente utilizada

**ERA5-Land Monthly Aggregated** (ECMWF) — banda `temperature_2m`, asset `ECMWF/ERA5_LAND/MONTHLY_AGGR`. Es un reanálisis con resolución nominal 0.1° (~11 km) que asimila observaciones de estaciones meteorológicas globales (incluyendo SMN Argentina) en un modelo atmosférico de superficie. Cobertura 1950-presente (lag ~2-3 meses).

Comparado con la estación SMN POSADAS AERO directa (NOAA GHCN-Monthly `ARM00087178`), ERA5-Land tiene cobertura completa mientras que la estación pública para 2018-2025 sólo tiene TMIN parcial (~20 meses sobre 84 posibles, sin TAVG ni TMAX consistentes). ERA5-Land es por tanto la fuente más robusta y reproducible.

### 15.3 Método

1. Disolver los polígonos urbanos del observatorio en una huella única (unión de ~14 polígonos).
2. Para cada mes de 2018-01 al presente, calcular la media espacial de `temperature_2m` ERA5-Land sobre esa huella (1 valor mensual por Posadas urbana).
3. Convertir a °C (`K - 273.15`).
4. Promediar la `lst_mean` de los polígonos urbanos para el mismo mes.
5. Cross-join por `(anio, mes)` y calcular Pearson r, Spearman ρ, RMSE, MAE y sesgo medio (LST − T_aire).

Detalle: el grid ERA5-Land (~11 km) es más grueso que los polígonos, por lo cual no tiene sentido comparar polígono por polígono — un valor por mes representativo de Posadas urbana es la unidad de análisis.

### 15.4 Resultados

| Métrica | Valor |
|---|---|
| n meses cruzados | 85 |
| Período | 2018-02 → 2026-01 |
| Pearson **r** | **0.896** (p = 0) |
| Spearman ρ | 0.884 (p = 0) |
| RMSE | 10.55 °C |
| MAE | 9.59 °C |
| Sesgo medio (LST − T_aire) | **+9.47 °C** |
| Regresión LST = a·T_aire + b | a = 1.762, b = -7.50 °C, R² = 0.803 |
| Rango T_aire observado | 14.6 a 30.1 °C |
| Rango LST observada | 13.3 a 45.3 °C |

Plots producidos en `data/outputs/calor/`:

- `validacion_smn_scatter.png` — scatter T_aire vs LST coloreado por mes + recta 1:1 + recta de regresión.
- `validacion_smn_serie.png` — serie temporal de ambas señales superpuestas con la banda de diferencia.

Datos brutos del cruce en `data/processed/calor/validacion_smn.csv` (columnas: `anio, mes, t_aire_mean, lst_promedio, diferencia, n_poligonos, lst_std_inter_pol`).

### 15.5 Interpretación

Correlación alta (r ≥ 0.85) — la LST satelital refleja con fidelidad la variación estacional del aire. RMSE = 10.6 °C; sesgo medio LST−T_aire = +9.5 °C, dentro del rango típico para sensores satelitales en horario diurno (Voogt & Oke 2003). n = 85 meses (2018-02 → 2026-01).

El sesgo medio positivo entre LST y T_aire es **esperado y físicamente consistente**: Landsat pasa a ~10:30 AM hora local, momento en el que techos, asfalto y suelos descubiertos están sustancialmente más calientes que el aire a 1.5-2 m. La literatura típica reporta diferencias diurnas LST−T_aire de +5 a +15 °C en horario de máxima insolación sobre superficie urbana (Voogt & Oke 2003; Hu et al. 2014).

**Lo que importa para la utilidad de la capa**: la *correlación* alta confirma que el ranking mensual y la dinámica estacional de la LST replican fielmente la temperatura del aire. Es decir, los meses más calurosos en LST coinciden con los más calurosos en aire — la capa sí sirve para **comparar barrios y detectar UHI**, aunque el valor absoluto no se debe leer como temperatura ambiente.

### 15.6 Limitaciones de esta validación

1. ERA5-Land es un reanálisis, no observación pura — incorpora un modelo físico que puede tener errores en regiones con baja densidad de estaciones.
2. La resolución 11 km de ERA5-Land suaviza variabilidad intraurbana — no podemos validar UHI por barrio individual con esta fuente, sólo el promedio de Posadas urbana.
3. La validación es a escala mensual; eventos extremos diarios (olas de calor) requieren series diarias horarias, fuera del alcance actual de esta capa.
4. Idealmente cruzaríamos también con TAVG diaria de POSADAS AERO cuando SMN publique series consistentes en datos.gob.ar.

### 15.7 Reproducibilidad

Para regenerar la validación:

```bash
python scripts/52_validacion_smn.py todo --force
```

Esto descarga ERA5-Land vía Earth Engine, cruza con la última versión de `lst_mensual_por_poligono.csv` y reescribe esta sección con las métricas actualizadas.

---

*Documento vivo. Correcciones bienvenidas vía pull request al repo del
observatorio.*
