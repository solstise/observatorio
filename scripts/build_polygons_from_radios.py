"""Reconstruye config/poligonos.geojson sin solapamientos a partir de radios censales INDEC.

Estrategia (Opción A pura — radio al menor polígono que contiene su centroide)
==============================================================================

Los 43 polígonos heredados venían de dos fuentes:
* 7 bbox manuales 2x2 km que cubrían un área genérica ("buffer 2x2 km centro OSM")
* 36 polígonos OSM ``admin_level=10`` legítimos

Como los bbox manuales se solapan con los polygons OSM de barrios reales que caen
dentro, había 18 pares solapados (7 con >50% overlap).

Solución
--------
La fuente autoritativa son los radios censales INDEC 2022 (525 radios del depto
Capital de Misiones). Son mutuamente exclusivos por construcción y permiten
agregar datos oficiales (población, viviendas) de forma trazable.

Algoritmo
---------
1. Cargar los 525 radios INDEC. Filtrar urbanos+mixtos (descartamos rurales R
   que cubren áreas enormes al norte sin valor urbano).
2. Cargar los 43 polígonos legacy.
3. **Para cada radio R**:

   - Calcular su *centroide robusto* (``representative_point``).
   - Buscar todos los polígonos legacy ``p`` cuya geometría contiene el
     centroide.
   - Si la lista es no vacía: gana el polígono de **menor área legacy**
     (chico-primero). Esto preserva los barrios chicos OSM cuando un bbox
     manual los engloba.
   - Si está vacía: el radio queda libre (afuera de los barrios monitoreados).

4. **Pasada de rescate**: para polígonos legacy que quedaron sin radios:
   asignamos el radio libre cuya **intersección con el polígono legacy es
   máxima**, siempre que esa intersección cubra ≥ 30% del polígono legacy.
   Esto rescata bbox manuales cuyo centroide cayó en otro polígono.

5. La nueva geometría de p = ``unary_union`` de sus radios.

Resultado:
* Cada polígono = unión de radios INDEC enteros → mutuamente exclusivos.
* Los datos de población oficial son trazables radio por radio.
* Algunos polígonos pueden cambiar de tamaño respecto al legacy (es esperable
  porque el legacy era un bbox grueso).

Output
------
- ``config/poligonos.geojson`` sobreescrito.
- ``config/poligonos.geojson.bak.AAAAMMDD-HHMMSS`` backup automático.

Uso
---
::

    wsl -d Ubuntu -- bash -c "cd /mnt/c/ProyectosIA/Antigravity/observatorio \\
        && source venv/bin/activate && python scripts/build_polygons_from_radios.py"
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Set, Tuple

import geopandas as gpd
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
PATH_RADIOS = ROOT / "data/raw/indec/radios_censales_capital_misiones.geojson"
PATH_POLIGONOS = ROOT / "config/poligonos.geojson"


# Tolerancias
MIN_INTERSECT_M2 = 100.0  # ignoramos contactos en arista (<100 m^2)
MIN_RESCUE_RATIO_P = 0.30  # rescate: intersección debe cubrir 30% del POLÍGONO legacy
EPS_AREA_KM2 = 0.001  # criterio de disjointness final
RADIOS_TIPOS_VALIDOS = {"U", "M"}  # urbanos y mixtos


def load_data() -> Tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    radios = gpd.read_file(PATH_RADIOS).to_crs("EPSG:32721")
    poligonos = gpd.read_file(PATH_POLIGONOS).to_crs("EPSG:32721")
    n_orig = len(radios)
    radios = radios[radios["tro"].isin(RADIOS_TIPOS_VALIDOS)].reset_index(drop=True).copy()
    print(f"Radios INDEC cargados: {n_orig} | filtro tro in {RADIOS_TIPOS_VALIDOS}: {len(radios)}")
    print(f"Polígonos legacy: {len(poligonos)}")
    if "cod_indec" not in radios.columns:
        raise RuntimeError("radios censales sin cod_indec")
    return radios, poligonos


def asignar_por_centroide(
    radios: gpd.GeoDataFrame, poligonos: gpd.GeoDataFrame
) -> Dict[str, List[str]]:
    """Cada radio va al polígono legacy más chico que contiene su centroide."""
    poligonos = poligonos.copy()
    poligonos["_area_m2"] = poligonos.geometry.area
    sindex = poligonos.sindex

    radios = radios.copy()
    radios["_centroid"] = radios.geometry.representative_point()

    asignados: Dict[str, List[str]] = defaultdict(list)
    for _, rrow in radios.iterrows():
        cod = rrow["cod_indec"]
        cent = rrow["_centroid"]
        cand_idx = list(sindex.intersection((cent.x, cent.y, cent.x, cent.y)))
        contenedores: List[Tuple[float, str]] = []  # (area_legacy, pid)
        for pidx in cand_idx:
            prow = poligonos.iloc[pidx]
            if prow.geometry.contains(cent):
                contenedores.append((prow["_area_m2"], prow["id"]))
        if not contenedores:
            continue
        contenedores.sort()  # menor área primero
        winner = contenedores[0][1]
        asignados[winner].append(cod)
    return asignados


def rescatar_polygons_vacios(
    radios: gpd.GeoDataFrame,
    poligonos: gpd.GeoDataFrame,
    asignados: Dict[str, List[str]],
) -> List[str]:
    """Polígonos sin radios: tomamos el radio libre que cubra la mayor parte
    del polígono legacy, si esa cobertura es ≥ MIN_RESCUE_RATIO_P del polígono."""
    asignados_set = set(c for v in asignados.values() for c in v)
    descartados: List[str] = []

    radios = radios.copy()
    radios["_area_m2"] = radios.geometry.area

    poligonos = poligonos.copy()
    poligonos["_area_m2"] = poligonos.geometry.area

    for _, prow in poligonos.iterrows():
        pid = prow["id"]
        if asignados.get(pid):
            continue
        # ranking por intersection con p, restringido a radios libres
        candidatos: List[Tuple[float, str]] = []  # (inter_area, cod)
        for _, rrow in radios.iterrows():
            cod = rrow["cod_indec"]
            if cod in asignados_set:
                continue
            if not prow.geometry.intersects(rrow.geometry):
                continue
            inter_area = prow.geometry.intersection(rrow.geometry).area
            if inter_area < MIN_INTERSECT_M2:
                continue
            candidatos.append((inter_area, cod))
        if not candidatos:
            descartados.append(pid)
            print(f"  [DESCARTE] {pid}: sin radios libres con intersección no trivial")
            continue
        candidatos.sort(reverse=True)
        # tomamos los radios cuya intersección suma cubra al menos MIN_RESCUE_RATIO_P
        # pero solo si los radios mismos están mayoritariamente dentro de p
        elegidos: List[str] = []
        cubierto = 0.0
        target = MIN_RESCUE_RATIO_P * prow["_area_m2"]
        for inter, cod in candidatos:
            r_in_p = inter / radios.set_index("cod_indec").loc[cod].geometry.area
            if r_in_p < 0.30:
                continue  # radio mayoritariamente afuera
            elegidos.append(cod)
            cubierto += inter
            if cubierto >= target:
                break
        if not elegidos or cubierto < target:
            descartados.append(pid)
            print(
                f"  [DESCARTE] {pid}: solo {cubierto/1e6:.3f} km^2 de cobertura útil "
                f"(<{MIN_RESCUE_RATIO_P:.0%} de {prow['_area_m2']/1e6:.3f} km^2)"
            )
            continue
        for c in elegidos:
            asignados_set.add(c)
        asignados[pid].extend(elegidos)
        print(
            f"  [RESCATE] {pid}: {len(elegidos)} radios libres adyacentes "
            f"({cubierto/1e6:.3f} km^2 de {prow['_area_m2']/1e6:.3f} km^2 legacy)"
        )
    return descartados


def build_geometries(
    radios: gpd.GeoDataFrame, poligonos: gpd.GeoDataFrame, asignaciones: Dict[str, List[str]]
) -> Tuple[gpd.GeoDataFrame, List[str]]:
    """Construye las geometrías finales en tres pasadas, garantizando disjoint.

    **Pasada 1 (polígonos con radios)**: geometría = ``unary_union(radios)``
    intersectado con el ``legacy_geom_buffered`` (legacy + buffer 200m). Esto
    impide que un radio mixto enorme se "expanda" más allá del bbox legacy
    original, manteniendo realismo y evitando absorber área de un polígono
    vecino. La parte del radio que queda fuera del buffer se asigna al
    siguiente polígono que la contenga.

    **Pasada 2 (polígonos sin radios — salvamento)**: usamos la geometría
    legacy directamente (sin INDEC). Restamos lo ya consumido por la pasada 1.

    **Pasada 3 (validación)**: si después de las pasadas 1+2 quedan
    solapamientos no triviales, se reporta como error.
    """
    radios_idx = radios.set_index("cod_indec")
    rows = []
    descartados = []

    # Buffer alrededor del legacy: 200 m para tolerar imprecisiones de bbox manual
    BUFFER_M = 200.0

    # Procesamos polígonos en orden de área legacy ascendente (chico-primero
    # para que los chicos consoliden su área antes de que los grandes la pidan)
    pol_sorted = poligonos.copy()
    pol_sorted["_area_m2"] = pol_sorted.geometry.area
    pol_sorted = pol_sorted.sort_values(["_area_m2", "prioridad"]).reset_index(drop=True)

    union_consumida = None  # geometría ya tomada por polígonos previos

    for _, prow in pol_sorted.iterrows():
        pid = prow["id"]
        legacy_geom = prow.geometry
        legacy_area = legacy_geom.area
        legacy_buffered = legacy_geom.buffer(BUFFER_M)

        cods = asignaciones.get(pid, [])
        if cods:
            geoms = [radios_idx.loc[c].geometry for c in cods]
            radios_union = unary_union(geoms)
            # Clip al buffer del legacy
            new_geom = radios_union.intersection(legacy_buffered)
            # Restar lo ya consumido por polígonos chicos previos
            if union_consumida is not None and not union_consumida.is_empty:
                new_geom = new_geom.difference(union_consumida)
            if not new_geom.is_valid:
                new_geom = new_geom.buffer(0)
            fuente = "INDEC radios censales 2022 (cpr=54 dpto=Capital)"
        else:
            # salvamento: legacy diff(consumido)
            new_geom = legacy_geom
            if union_consumida is not None and legacy_geom.intersects(union_consumida):
                new_geom = legacy_geom.difference(union_consumida)
            if not new_geom.is_valid:
                new_geom = new_geom.buffer(0)
            fuente = "OSM legacy clip-difference (sin radios INDEC asignados)"

        if new_geom.is_empty:
            descartados.append(pid)
            print(f"  [DESCARTE] {pid}: geometría final vacía")
            continue
        ratio_kept = new_geom.area / legacy_area if legacy_area > 0 else 0
        # umbral de aceptación: si quedó muy chico vs legacy y NO tiene radios, descartamos
        if not cods and ratio_kept < 0.50:
            descartados.append(pid)
            print(
                f"  [DESCARTE] {pid}: salvamento sin radios, quedó {ratio_kept:.0%} del legacy"
            )
            continue
        # umbral mínimo absoluto: 0.05 km^2 (5 ha) — si menos, no tiene sentido monitorear
        if new_geom.area < 5e4:
            descartados.append(pid)
            print(f"  [DESCARTE] {pid}: área final {new_geom.area/1e6:.4f} km^2 < 0.05 km^2")
            continue

        keep_cols = ["id", "nombre", "categoria", "prioridad"]
        props = {k: prow[k] for k in keep_cols if k in poligonos.columns}
        for opt in ("descripcion", "fuente"):
            if opt in poligonos.columns and prow[opt]:
                props[opt] = prow[opt]
        props["n_radios"] = len(cods)
        props["cod_indec_radios"] = ",".join(sorted(cods))
        props["fuente_geometria"] = fuente
        rows.append({**props, "geometry": new_geom})
        union_consumida = (
            unary_union([union_consumida, new_geom]) if union_consumida is not None else new_geom
        )

    gdf = gpd.GeoDataFrame(rows, crs="EPSG:32721")
    return gdf, descartados


def validar_disjoint(gdf: gpd.GeoDataFrame) -> List[Tuple[str, str, float]]:
    """Verifica que ningún par solape > EPS_AREA_KM2. Devuelve violaciones."""
    fail = []
    n = len(gdf)
    for i in range(n):
        a = gdf.iloc[i]
        for j in range(i + 1, n):
            b = gdf.iloc[j]
            if not a.geometry.intersects(b.geometry):
                continue
            inter_km2 = a.geometry.intersection(b.geometry).area / 1e6
            if inter_km2 > EPS_AREA_KM2:
                fail.append((a["id"], b["id"], inter_km2))
    return fail


def main() -> None:
    radios, poligonos = load_data()

    print("\n=== Paso 1: asignar radios por centroide (chico-primero) ===")
    asignaciones = asignar_por_centroide(radios, poligonos)
    total = sum(len(v) for v in asignaciones.values())
    poligonos_con_radios = sum(1 for v in asignaciones.values() if v)
    print(f"  Total radios asignados: {total} / {len(radios)}")
    print(f"  Polígonos con al menos 1 radio: {poligonos_con_radios} / {len(poligonos)}")

    print("\n=== Paso 2: rescate de polígonos vacíos ===")
    pre_descarte = rescatar_polygons_vacios(radios, poligonos, asignaciones)
    print(f"  Tras rescate: descartados (sin radios) = {len(pre_descarte)}")
    if pre_descarte:
        print(f"  IDs descartados: {pre_descarte}")

    total2 = sum(len(v) for v in asignaciones.values())
    print(f"\n  Total radios asignados final: {total2} / {len(radios)}")

    print("\n=== Paso 3: construir geometrías ===")
    gdf, descartados = build_geometries(radios, poligonos, asignaciones)
    print(f"  Polígonos finales: {len(gdf)}  | descartados: {len(descartados)}")

    print("\n=== Paso 4: validar disjointness ===")
    violaciones = validar_disjoint(gdf)
    if violaciones:
        print(f"  FALLAN {len(violaciones)} pares:")
        for a, b, area in violaciones[:20]:
            print(f"    {a} <-> {b}: {area:.4f} km^2")
        raise RuntimeError("disjointness no se logra")
    print("  OK — todos los pares solapan < 0.001 km^2")

    print("\n=== Paso 5: resumen áreas finales ===")
    areas_final = (gdf.geometry.area / 1e6).tolist()
    listado = sorted(zip(gdf["id"].tolist(), areas_final, gdf["n_radios"].tolist()), key=lambda x: -x[1])
    for idv, a, n in listado:
        print(f"  {idv:42s}  {a:7.3f} km^2  ({n} radios)")

    # Backup antes de sobrescribir
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = PATH_POLIGONOS.with_suffix(f".geojson.bak.{ts}")
    shutil.copy(PATH_POLIGONOS, backup)
    print(f"\nBackup -> {backup.name}")

    # Guardar GeoJSON
    gdf_wgs = gdf.to_crs("EPSG:4326")
    geojson_obj = json.loads(gdf_wgs.to_json())
    out_text = json.dumps(geojson_obj, ensure_ascii=False, indent=1)
    PATH_POLIGONOS.write_text(out_text, encoding="utf-8")
    print(f"Escrito -> {PATH_POLIGONOS} ({PATH_POLIGONOS.stat().st_size:,} bytes)")

    if descartados:
        print(f"\nDESCARTADOS_IDS: {','.join(descartados)}")


if __name__ == "__main__":
    main()
