# Imágenes alta resolución: CBERS-4A pansharpen

## Qué es CBERS

CBERS (China-Brazil Earth Resources Satellite) es un programa cooperativo
entre el Instituto Nacional de Pesquisas Espaciais (INPE, Brasil) y la
CRESDA / CAST (China), vigente desde 1999. Sus datos son **públicos y
gratuitos** bajo registro abierto en [http://www.cbers.inpe.br/](http://www.cbers.inpe.br/),
una excepción notable en el ecosistema satelital de alta resolución (los
productos comerciales comparables — Pléiades, WorldView — cuestan miles
de dólares por escena).

El observatorio consume la cámara **WPM (Wide Panchromatic and Multispectral)**
de CBERS-4A: pancromática 8 m + multiespectral 16 m, con revisita ~31 días
sobre Sudamérica.

## Resolución comparada

| Sensor          | Resolución espacial | Frecuencia natural | Costo  |
| --------------- | ------------------- | ------------------ | ------ |
| Sentinel-2 ESA  | 10 m                | 5 días             | gratis |
| Landsat 8/9     | 30 m (15 m PAN)     | 16 días            | gratis |
| **CBERS-4A WPM**| **5–8 m pansharpen**| **~31 días**       | **gratis** |
| Pléiades (com.) | 0.5 m               | 1 día (tasking)    | ~US$ 10–25/km² |

CBERS-4A ocupa el nicho "alta resolución, frecuencia media, costo cero":
mejor que Sentinel-2 en detalle pero más esporádico, ideal para complementar
Sentinel-2 cuando se necesita zoom alto sobre cuadras o manzanas.

## Pansharpen explicado

La cámara WPM entrega dos productos crudos: una banda pancromática (PAN)
a 8 m monocromática, y cuatro bandas multiespectrales (azul, verde, rojo,
NIR) a 16 m a color. Pansharpening fusiona ambos: usa la PAN como guía de
detalle espacial y el color del MS para reconstruir un RGB final a 8 m.

Algoritmos comunes: **Brovey** (rápido, color levemente saturado),
**IHS** (mejor preservación de tinte), **Gram-Schmidt** (mejor calidad,
estándar en software comercial). El pipeline del observatorio usa el
algoritmo seleccionado por `scripts/45_cbers_descarga.py`.

**Limitación importante**: pansharpen es una aproximación visual — la
firma espectral del MS de baja resolución se asume preservada en el
resultado, lo cual no siempre es exacto. Por eso usamos CBERS pansharpen
sólo como capa visual (foto del barrio); los índices cuantitativos
(NDVI, NDBI) los seguimos calculando desde Sentinel-2 multiespectral
nativo.

## Limitaciones operativas

- **Frecuencia mensual baja**: revisita real ~31 días, pero el cron
  procesa el último composite "estable" cada 3 meses para amortizar la
  transferencia desde el catálogo INPE (datasets pesados).
- **Cobertura nubosa**: igual que Sentinel-2 (sensor óptico), las nubes
  bloquean la captura. Para cambio estructural en zonas nubosas seguimos
  usando Sentinel-1 SAR.
- **Disponibilidad del catálogo**: el endpoint INPE/S3 puede tener
  ventanas de mantenimiento. El cron mensual del observatorio marca los
  pasos CBERS con `continue-on-error: true` para que un fallo de descarga
  **no rompa el resto del pipeline**.

## Cita

INPE, 2024. *CBERS-4A program documentation*. Instituto Nacional de
Pesquisas Espaciais. Disponible en
[http://www.cbers.inpe.br/](http://www.cbers.inpe.br/).
