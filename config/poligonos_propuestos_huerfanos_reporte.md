# Propuesta: polígonos nuevos para zonas huérfanas

Generado: 2026-05-05

- **Radios huérfanos detectados**: 229
- **Sub-clusters generados**: 21
- **Polígonos válidos tras clip y reverse-geocode**: 21
- **A publicar en sitio**: 18
- **Marcados publicar_en_sitio=false** (densidad < 1.0 radios/km²): 3
- **Solapamientos contra los 44 legacy**: 0

## Polígonos a publicar

| ID | Nombre | Radios | km² | Densidad | Orientación |
|---|---|---:|---:|---:|---|
| `dm_santa_rita` | DM Santa Rita | 18 | 2.92 | 6.16 | oeste |
| `dm_itaembe_mini_este` | DM Itaembé Miní Este | 15 | 4.85 | 3.10 | suroeste |
| `dm_miguel_lanus` | DM Miguel Lanús | 14 | 7.10 | 1.97 | sur |
| `cit_riberas_del_parana` | CIT Riberas del Paraná | 15 | 2.28 | 6.57 | noroeste |
| `dm_villa_urquiza` | DM Villa Urquiza | 13 | 1.58 | 8.25 | sur |
| `fatima_sur` | Fátima (sur) | 10 | 2.87 | 3.49 | sur |
| `dm_santa_rita_suroeste` | DM Santa Rita (suroeste) | 27 | 3.45 | 7.83 | suroeste |
| `puerto_canela` | Puerto Canela | 18 | 16.68 | 1.08 | oeste |
| `villa_dolores` | Villa Dolores | 18 | 3.42 | 5.27 | suroeste |
| `dm_itaembe_mini_este_suroeste` | DM Itaembé Miní Este (suroeste) | 8 | 3.12 | 2.56 | suroeste |
| `cit_riberas_del_parana_oeste` | CIT Riberas del Paraná (oeste) | 19 | 3.17 | 5.99 | oeste |
| `dm_miguel_lanus_sur` | DM Miguel Lanús (sur) | 10 | 5.55 | 1.80 | sur |
| `san_martin_sureste` | San Martín (sureste) | 9 | 2.28 | 3.95 | sureste |
| `horacio_quiroga` | Horacio Quiroga | 8 | 2.13 | 3.76 | sureste |
| `malvinas` | Malvinas | 8 | 5.45 | 1.47 | sureste |
| `dm_villa_urquiza_sureste` | DM Villa Urquiza (sureste) | 5 | 0.92 | 5.41 | sureste |
| `el_portal` | El Portal | 4 | 1.12 | 3.57 | sur |
| `porvenir_2` | Porvenir 2 | 2 | 1.61 | 1.24 | suroeste |

## Polígonos descartados (`publicar_en_sitio=false`)

Zonas con muy baja densidad de radios INDEC — son periurbanos o rurales donde el monitoreo a escala de barrio no aporta. Se conservan en el config para auditoría pero no se renderizan en el mapa.

| ID | Nombre | Radios | km² | Densidad |
|---|---|---:|---:|---:|
| `cit_villa_cabello` | CIT Villa Cabello | 2 | 36.56 | 0.05 |
| `los_patitos` | Los Patitos | 5 | 8.21 | 0.61 |
| `la_eugenia` | La Eugenia | 1 | 1.05 | 0.95 |

## Naming

Las **Delegaciones Municipales (DM)** y **Centros de Integración Territorial (CIT)** son divisiones administrativas oficiales del Municipio de Posadas, capturadas por OpenStreetMap. El reverse-geocoding las elige automáticamente cuando el centroide del cluster cae en una de ellas — es la mejor fuente de naming porque es la estructura formal con la que ya razona el Municipio.

## Cómo aplicar

1. Abrir `config/poligonos_propuestos_huerfanos.geojson` en QGIS o geojson.io para revisión visual.
2. Renombrar manualmente los IDs/nombres genéricos (ej. `Sector Avenida Quaranta` → `chacras_uno_uno`) si querés algo más vernacular.
3. Si conforma: correr el script de merge (a crear) que appendea estos features al `config/poligonos.geojson` principal sin tocar los 44 originales.
