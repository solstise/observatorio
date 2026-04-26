# Changelog config/poligonos.geojson

_Última actualización_: 2026-04-25 (rev. fix overlap)

Total polígonos: **43** (14 existentes preservados + 29 agregados, todos disjuntos).

## 2026-04-25 — Fix de solapamientos (release crítica)

### Problema detectado

El audit `scripts/_audit_overlaps.py` reportó **18 pares con solapamiento ≥ 1%**,
**13 con ≥ 10%**, **7 con ≥ 50%**:

| Solapamiento | Polígonos involucrados |
|---:|---|
| 92% | `villa_sarita` ⊂ `bajada_vieja` |
| 80% | `rocamora` ⊂ `aguas_corrientes` |
| 73% | `23_de_septiembre` ⊂ `aguas_corrientes` |
| 67% | `el_palomar` ⊂ `aguas_corrientes` |
| 63% | `alta_gracia` ⊂ `chacra_32` |
| 53% | `centro` ↔ `bajada_vieja` |
| 50% | `itaembe_mini` ↔ `itaembe_pora` |

**Causa raíz**: los 14 polígonos originales eran *bbox manuales 2x2 km*
(`buffer 2x2 km centro OSM`). Al expandir a 43 con polígonos OSM
`admin_level=10` reales, los polígonos OSM caían dentro de los bbox manuales.
Cualquier suma agregada contaba dos veces las zonas en overlap.

### Solución aplicada

**Estrategia A (Opción A del prompt) con clip al bbox legacy + buffer 200m**:
ver `scripts/build_polygons_from_radios.py` para el código reproducible.

1. **Fuente autoritativa**: radios censales INDEC 2022 (`geonode:radios_censales2`)
   descargados vía WFS desde
   `https://geonode.indec.gob.ar/geoserver/ows`. Total: **525 radios** del
   departamento Capital de Misiones (cpr=54, dpto=Capital). Filtramos a 512
   urbanos+mixtos (descartamos rurales `R` que cubren áreas enormes al norte).
   Los radios INDEC son mutuamente exclusivos por construcción y permiten
   trazar datos oficiales de población. Script de descarga reproducible:
   `scripts/get_radios_censales.py`.
2. **Asignación radio→polígono** por *centroide del radio en el polígono
   legacy más chico que lo contiene* (chico-primero, así los barrios chicos
   OSM ganan a los bbox grandes legacy).
3. **Construcción de geometría final**: para cada polígono `p`,
   `geom_final = unary_union(radios_asignados) ∩ legacy_geom_buffered_200m`.
   Esto evita que radios mixtos enormes (suburbanos, hasta 6 km²) inflen un
   polígono más allá del territorio que originalmente representaba. La parte
   del radio fuera del buffer queda disponible para el polígono adyacente.
4. **Salvamento por clip-difference** para polígonos sin radios INDEC adentro:
   se usa la geometría OSM legacy y se le resta la unión de los polígonos ya
   construidos. Aceptamos si queda ≥ 50% del área legacy original.

### Resultado

- **43 polígonos preservados** (los mismos IDs que antes).
- **0 pares con solapamiento ≥ 0.001 km²** (verificado por
  `scripts/_audit_overlaps.py` y `tests/test_geometrias.py::test_poligonos_no_solapan`).
- Áreas finales todas en rango razonable: máxima `itaembe_guazu` 4.08 km²,
  mínima `a_3_2_sector_b` 0.14 km².

### Polígonos cuya geometría cambió significativamente (>20% diferencia área)

Estos eran los bbox manuales originales (área legacy = 3.98 km² con shape
exacto de cuadrado 2x2 km). Ahora son la unión de radios INDEC dentro del
bbox legacy + buffer 200m, con la forma irregular real de los barrios:

| ID | área legacy km² | área nueva km² | n_radios | Δ |
|---|---:|---:|---:|---:|
| `aguas_corrientes` | 3.982 | 2.092 | 22 | -47% |
| `bajada_vieja` | 3.982 | 0.566 | 6 | -86% |
| `centro` | 2.073 | 2.008 | 32 | -3% |
| `chacra_32` | 3.982 | 3.558 | 27 | -11% |
| `itaembe_guazu` | 11.907 | 4.079 | 20 | -66% |
| `itaembe_mini` | 3.982 | 1.266 | 5 | -68% |
| `itaembe_pora` | 3.982 | 2.718 | 12 | -32% |
| `nemesio_parma` | 3.982 | 2.138 | 1 | -46% |
| `villa_bonita` | 3.983 | 2.477 | 9 | -38% |
| `villa_cabello` | 3.982 | 2.590 | 20 | -35% |
| `villa_sarita` | 0.592 | 0.546 | 8 | -8% |

Lo importante: **los IDs y nombres NO cambiaron**, solo la geometría se
ajustó a barrios reales según radios censales INDEC. Los datos previos
(PDFs, narrativas) siguen siendo coherentes con el ID, solo la huella
geográfica es más realista.

### Polígonos descartados

**0 polígonos descartados**. El polígono `federal` (3.04 km² OSM legacy) no
tenía radios INDEC con centroide adentro (la zona está cubierta por un radio
mixto cuyo centroide cae en `complejo_gervasio_artigas`), pero el salvamento
por clip-difference lo preservó al 89% del área legacy. Idem `colonia_laosiana`
(0.24 km², preservada al 100% por salvamento).

### Polígonos sin radios INDEC asignados (geometría = OSM legacy clip)

- `federal` (asentamiento_crecimiento_rapido, prio=1): 2.71 km², geometría OSM
  preservada por clip-difference. **Sin datos de población oficial directa**;
  para población usar estimación por edificios/WorldPop.
- `colonia_laosiana` (asentamiento_crecimiento_rapido, prio=2): 0.24 km²,
  geometría OSM preservada. Idem comentario sobre población.

Estos dos polígonos llevan el flag `fuente_geometria = "OSM legacy
clip-difference (sin radios INDEC asignados)"` y `n_radios = 0`.

### Bbox del proyecto extendido

`config/settings.yaml > geografia.bbox`: extendido al oeste de -56.00 a
-56.05 y al sur de -27.50 a -27.51 para incluir `nemesio_parma` e
`itaembe_guazu`, cuyas geometrías legacy ya excedían el bbox previo sin
que el test lo detectara (bug pre-existente).

### Trazabilidad por radio

Cada polígono lleva ahora dos campos nuevos:
- `n_radios`: cantidad de radios INDEC que lo componen.
- `cod_indec_radios`: lista CSV de códigos INDEC (`cpr` + `cde` + `cfn` + `cro`)
  para ligar con datos oficiales de población/viviendas/etc.

### Validación

```bash
# 0 pares solapados
wsl -d Ubuntu -- bash -c "cd /mnt/c/ProyectosIA/Antigravity/observatorio && source venv/bin/activate && python scripts/_audit_overlaps.py"
# Polígonos cargados: 43
# Pares con solapamiento >= 0.0001 km²: 0
# Sin solapamientos detectados (mutuamente exclusivos)

# Tests pasan
wsl -d Ubuntu -- bash -c "cd /mnt/c/ProyectosIA/Antigravity/observatorio && source venv/bin/activate && pytest tests/test_geometrias.py -v"
# 6/6 PASSED
```

### Backups

Los 3 backups generados durante el desarrollo del fix viven en
`config/poligonos.geojson.bak.AAAAMMDD-HHMMSS`. El backup canónico
pre-fix es `poligonos.geojson.bak.20260425-144548`.

---

## 2026-04-24 — Estado pre-fix

Total polígonos: **43** (14 existentes + 29 nuevos).

## Barrios existentes (no modificados)

| ID | Nombre | Categoría | Fuente |
|----|--------|-----------|--------|
| `itaembe_guazu` | Itaembé Guazú | asentamiento_crecimiento_rapido | OSM Nominatim + extensión manual |
| `itaembe_mini` | Itaembé Miní | asentamiento_crecimiento_rapido | buffer 2x2 km centro OSM |
| `chacra_32` | Chacra 32 | consolidado_crecimiento | buffer 2x2 km centro OSM |
| `villa_cabello` | Villa Cabello | control_consolidado | buffer 2x2 km centro OSM |
| `el_brete` | El Brete | zona_sensible | buffer 2x2 km centro OSM |
| `miguel_lanus` | Miguel Lanús | consolidado_crecimiento | OSM Nominatim relation/3511484 |
| `villa_sarita` | Villa Sarita | zona_sensible | OSM Nominatim relation/4833951 |
| `nemesio_parma` | Nemesio Parma | asentamiento_crecimiento_rapido | buffer 2x2 km centro OSM |
| `itaembe_pora` | Itaembé Porá | asentamiento_crecimiento_rapido | buffer 2x2 km centro OSM |
| `villa_urquiza` | Villa Urquiza | consolidado_crecimiento | OSM Nominatim relation/4843702 |
| `aguas_corrientes` | Aguas Corrientes | consolidado_crecimiento | buffer 2x2 km centro OSM |
| `centro` | Centro | control_consolidado | OSM Nominatim relation/5501263 |
| `bajada_vieja` | Bajada Vieja | zona_sensible | buffer 2x2 km centro OSM |
| `villa_bonita` | Villa Bonita | consolidado_crecimiento | buffer 2x2 km centro OSM |

## Barrios agregados

| ID | Nombre | Categoría | OSM rel/id | Área km² | Prioridad |
|----|--------|-----------|-----------|---------:|----------:|
| `a4_nueva_esperanza` | A4 - Nueva Esperanza | asentamiento_crecimiento_rapido | [rel/3514152](https://www.openstreetmap.org/relation/3514152) | 0.760 | 1 |
| `colonia_laosiana` | Colonia Laosiana | asentamiento_crecimiento_rapido | [rel/4861854](https://www.openstreetmap.org/relation/4861854) | 0.241 | 2 |
| `federal` | Federal | asentamiento_crecimiento_rapido | [rel/6757034](https://www.openstreetmap.org/relation/6757034) | 3.038 | 1 |
| `norte` | Norte | consolidado_crecimiento | [rel/6760048](https://www.openstreetmap.org/relation/6760048) | 2.040 | 2 |
| `complejo_gervasio_artigas` | Complejo Gervasio Artigas | asentamiento_crecimiento_rapido | [rel/10766017](https://www.openstreetmap.org/relation/10766017) | 2.963 | 1 |
| `nu_pora` | Ñu Porá | asentamiento_crecimiento_rapido | [rel/6755392](https://www.openstreetmap.org/relation/6755392) | 1.145 | 1 |
| `don_santiago` | Don Santiago | asentamiento_crecimiento_rapido | [rel/6757430](https://www.openstreetmap.org/relation/6757430) | 1.081 | 1 |
| `fatima` | Fátima | consolidado_crecimiento | [rel/10760518](https://www.openstreetmap.org/relation/10760518) | 0.960 | 2 |
| `santa_helena` | Santa Helena | asentamiento_crecimiento_rapido | [rel/3512043](https://www.openstreetmap.org/relation/3512043) | 0.916 | 2 |
| `lomas_de_garupa` | Lomas de Garupá | asentamiento_crecimiento_rapido | [rel/6755379](https://www.openstreetmap.org/relation/6755379) | 0.890 | 1 |
| `complejo_habitacional_virgen_de_fatima` | Complejo Habitacional Vírgen de Fátima | consolidado_crecimiento | [rel/3512679](https://www.openstreetmap.org/relation/3512679) | 0.738 | 2 |
| `san_isidro` | San Isidro | consolidado_crecimiento | [rel/3790694](https://www.openstreetmap.org/relation/3790694) | 0.842 | 2 |
| `cima_del_sol` | Cima del Sol | asentamiento_crecimiento_rapido | [rel/7905679](https://www.openstreetmap.org/relation/7905679) | 0.801 | 1 |
| `el_laurel` | El Laurel | consolidado_crecimiento | [rel/10483119](https://www.openstreetmap.org/relation/10483119) | 0.768 | 2 |
| `yacyreta` | Yacyretá | consolidado_crecimiento | [rel/5283273](https://www.openstreetmap.org/relation/5283273) | 0.694 | 2 |
| `rocamora` | Rocamora | consolidado_crecimiento | [rel/4833658](https://www.openstreetmap.org/relation/4833658) | 0.692 | 3 |
| `monsenor_kemerer` | Monseñor Kemerer | consolidado_crecimiento | [rel/7754516](https://www.openstreetmap.org/relation/7754516) | 0.680 | 3 |
| `san_lucas` | San Lucas | consolidado_crecimiento | [rel/3988783](https://www.openstreetmap.org/relation/3988783) | 0.664 | 3 |
| `luis_piedrabuena` | Luis Piedrabuena | consolidado_crecimiento | [rel/3559462](https://www.openstreetmap.org/relation/3559462) | 0.630 | 3 |
| `san_martin` | San Martín | consolidado_crecimiento | [rel/7740064](https://www.openstreetmap.org/relation/7740064) | 0.558 | 3 |
| `santa_rita` | Santa Rita | consolidado_crecimiento | [rel/4852077](https://www.openstreetmap.org/relation/4852077) | 0.556 | 3 |
| `alta_gracia` | Alta Gracia | consolidado_crecimiento | [rel/4830334](https://www.openstreetmap.org/relation/4830334) | 0.550 | 3 |
| `el_palomar` | El Palomar | consolidado_crecimiento | [rel/4843690](https://www.openstreetmap.org/relation/4843690) | 0.549 | 3 |
| `villa_mola` | Villa Mola | consolidado_crecimiento | [rel/4835711](https://www.openstreetmap.org/relation/4835711) | 0.286 | 2 |
| `las_dolores` | Las Dolores | consolidado_crecimiento | [rel/4826623](https://www.openstreetmap.org/relation/4826623) | 0.469 | 3 |
| `san_marcos` | San Marcos | consolidado_crecimiento | [rel/3599517](https://www.openstreetmap.org/relation/3599517) | 0.463 | 3 |
| `san_jorge` | San Jorge | consolidado_crecimiento | [rel/3599714](https://www.openstreetmap.org/relation/3599714) | 0.261 | 3 |
| `a_3_2_sector_b` | A-3-2 Sector B | asentamiento_crecimiento_rapido | [rel/13694559](https://www.openstreetmap.org/relation/13694559) | 0.240 | 2 |
| `23_de_septiembre` | 23 de Septiembre | consolidado_crecimiento | [rel/4833655](https://www.openstreetmap.org/relation/4833655) | 0.280 | 3 |

## Procedencia de las geometrías nuevas

Todas las geometrías nuevas provienen de **OpenStreetMap `admin_level=10`** (límites de barrio oficiales de Posadas), extraídas vía Overpass API el 2026-04-25 con `scripts/get_barrios_osm.py`. Las geometrías son polígonos reales (no buffers) ensambladas a partir de los `outer ways` de cada relación con Shapely (`linemerge` + `polygonize`).

Atribución obligatoria: © OpenStreetMap contributors, ODbL.

## Cobertura

Área total nuevos: ~**24.8 km²**.
