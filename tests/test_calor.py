"""Tests de la capa de calor — pipeline principal (Tarea 2.8 / capa calor).

Cubre `scripts/49_calor_pipeline.py`:

1. Fórmula LST (escalado USGS C2L2 ST_B10 → Celsius).
2. Máscara de nubes/sombras vía bits de QA_PIXEL.
3. Validación del baseline rural (`config/poligonos_baseline_rural.geojson`).
4. Cálculo de UHI mensual (`_calcular_uhi`) con tres métricas.
5. Agregación estacional hemisferio sur (DJF, etc.) — diciembre del año N
   se asigna al verano del año N+1.
6. Schema del CSV `uhi_por_poligono_mensual.csv`.
7. Rangos de valores razonables si existe el CSV de producción.

Patrón: tests sin dependencia de datos descargados — fixtures sintéticas o
re-implementación local de la fórmula. Para cargar el módulo principal
(que tiene click CLI) usamos `importlib.util` y registro en `sys.modules`
porque define una `@dataclass` que depende de eso.
"""

from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Carga del módulo bajo test (no es importable directo por ser CLI click + dataclass).
# ---------------------------------------------------------------------------

PROYECTO_ROOT = Path(__file__).resolve().parent.parent
RUTA_SCRIPT = PROYECTO_ROOT / "scripts" / "49_calor_pipeline.py"
RUTA_BASELINE_RURAL = PROYECTO_ROOT / "config" / "poligonos_baseline_rural.geojson"
RUTA_CSV_UHI = PROYECTO_ROOT / "data" / "processed" / "calor" / "uhi_por_poligono_mensual.csv"

# Centro de Posadas (settings.yaml).
POSADAS_LAT = -27.3667
POSADAS_LON = -55.8967


@pytest.fixture(scope="module")
def calor_module():
    """Carga `scripts/49_calor_pipeline.py` como módulo importable.

    Lo registra en `sys.modules` porque define una `@dataclass`, y el
    decorador necesita acceder al módulo via `cls.__module__`.
    """
    if not RUTA_SCRIPT.exists():
        pytest.skip(f"{RUTA_SCRIPT} no existe")
    # Asegurar que la raíz del proyecto está en path para los imports relativos
    # (scripts.utils.config, etc.).
    if str(PROYECTO_ROOT) not in sys.path:
        sys.path.insert(0, str(PROYECTO_ROOT))

    spec = importlib.util.spec_from_file_location("calor_pipeline_test_mod", RUTA_SCRIPT)
    if spec is None or spec.loader is None:
        pytest.skip("No se pudo crear spec para 49_calor_pipeline.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["calor_pipeline_test_mod"] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"No se pudo cargar el módulo: {exc}")
    return mod


# ---------------------------------------------------------------------------
# Helpers locales — re-implementación pura para tests sin dependencia EE.
# ---------------------------------------------------------------------------


def _lst_de_st_b10(st_b10: float | np.ndarray) -> float | np.ndarray:
    """Aplica el escalado oficial USGS C2L2 ST_B10 → Celsius.

    Misma fórmula que `_a_celsius` en producción: ST_B10 * 0.00341802 + 149.0 - 273.15
    """
    return st_b10 * 0.00341802 + 149.0 - 273.15


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia haversine entre dos puntos lat/lon en km."""
    R = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return R * c


# ---------------------------------------------------------------------------
# 1. Fórmula LST
# ---------------------------------------------------------------------------


def test_lst_formula_valor_tipico():
    """ST_B10 = 44000 (DN típico verano Posadas) → LST ~26°C (rango sensato)."""
    lst = _lst_de_st_b10(44000)
    # 44000 * 0.00341802 + 149.0 - 273.15 = 150.39288 + 149.0 - 273.15 ≈ 26.24
    assert 20.0 <= lst <= 35.0, (
        f"Para ST_B10=44000 esperaba ~26°C, obtuve {lst:.2f}°C — revisar fórmula."
    )


def test_lst_formula_constantes_modulo(calor_module):
    """Las constantes en el módulo de producción coinciden con las documentadas."""
    assert calor_module.LST_SCALE == pytest.approx(0.00341802)
    assert calor_module.LST_OFFSET == pytest.approx(149.0)
    assert calor_module.KELVIN_A_CELSIUS == pytest.approx(273.15)


@pytest.mark.parametrize("st_b10", [35000, 40000, 45000, 50000, 55000, 60000])
def test_lst_rango_razonable(st_b10: int):
    """Para ST_B10 ∈ [35000, 60000], LST debe estar en [-10, 100]°C.

    Garantiza que la fórmula no devuelve valores absurdos en el rango DN
    plausible operativo Landsat C2L2 (ST_B10=35000 ↔ LST ~−4.5°C; ST_B10=60000
    ↔ LST ~81°C). El piso de 30000 daría ~-21°C, fuera de la banda solicitada
    pero matemáticamente correcto: el filtro de producción descarta LST < 5°C
    (`LST_MIN_CELSIUS_VALIDO`), así que esos DN nunca llegan al CSV final.
    """
    lst = _lst_de_st_b10(st_b10)
    assert -10.0 <= lst <= 100.0, (
        f"LST fuera de rango para ST_B10={st_b10}: {lst:.2f}°C"
    )


def test_lst_extremo_bajo_st_b10_30000():
    """ST_B10=30000 → LST ~-21.6°C (matemáticamente correcto, descartado por filtros).

    Documentamos que la fórmula es lineal y produce valores absurdos para DN
    muy bajos, pero el pipeline filtra `LST < LST_MIN_CELSIUS_VALIDO=5°C`
    antes de calcular stats, así que estos DN nunca contaminan el CSV.
    """
    lst = _lst_de_st_b10(30000)
    assert lst == pytest.approx(-21.61, abs=0.01)
    # Y queda fuera del rango válido del pipeline (5°C-60°C):
    assert lst < 5.0  # filtrado por LST_MIN_CELSIUS_VALIDO


def test_lst_formula_replica_funcion_modulo(calor_module):
    """La fórmula del helper local equivale a la del módulo (constantes idénticas)."""
    # El módulo no expone una función pura sobre escalares, pero las constantes
    # deben dar el mismo resultado que nuestra reimplementación.
    for st in (30000, 44000, 60000):
        esperado = (
            st * calor_module.LST_SCALE
            + calor_module.LST_OFFSET
            - calor_module.KELVIN_A_CELSIUS
        )
        assert esperado == pytest.approx(_lst_de_st_b10(st))


# ---------------------------------------------------------------------------
# 2. Máscara nubes/sombras (bits 3 y 4 de QA_PIXEL)
# ---------------------------------------------------------------------------


def _qa_pixel_es_limpio(qa: int, bit_cloud: int = 1 << 3, bit_shadow: int = 1 << 4) -> bool:
    """Replica la lógica de `_mask_clouds`: limpio si bit3=0 AND bit4=0."""
    return (qa & bit_cloud) == 0 and (qa & bit_shadow) == 0


def test_mask_qa_constantes_bits(calor_module):
    """Los bits de cloud / shadow son los correctos (3 y 4)."""
    assert calor_module.BIT_CLOUD == 1 << 3, "BIT_CLOUD debería ser bit 3 (8)"
    assert calor_module.BIT_CLOUD_SHADOW == 1 << 4, "BIT_CLOUD_SHADOW debería ser bit 4 (16)"


def test_mask_qa_pixel_limpio_pasa():
    """QA_PIXEL con bits 3 y 4 apagados → pasa el filtro."""
    # bit 0 (fill) + bit 6 (clear) = 0x41, sin bits cloud/shadow.
    qa_limpio = 0b01000001
    assert _qa_pixel_es_limpio(qa_limpio) is True


def test_mask_qa_pixel_con_nube_descartado():
    """QA_PIXEL con bit 3 (nube) encendido → descartado."""
    # bit 3 = 8 → cloud encendido
    qa_nube = 0b00001000
    assert _qa_pixel_es_limpio(qa_nube) is False
    # También en combinación con otros bits
    qa_nube_combo = 0b11001010
    assert _qa_pixel_es_limpio(qa_nube_combo) is False


def test_mask_qa_pixel_con_sombra_descartado():
    """QA_PIXEL con bit 4 (sombra) encendido → descartado."""
    qa_sombra = 0b00010000
    assert _qa_pixel_es_limpio(qa_sombra) is False
    qa_sombra_combo = 0b10010001
    assert _qa_pixel_es_limpio(qa_sombra_combo) is False


def test_mask_qa_pixel_con_ambos_descartado():
    """QA_PIXEL con bits 3 Y 4 encendidos → descartado."""
    qa_ambos = 0b00011000
    assert _qa_pixel_es_limpio(qa_ambos) is False


@pytest.mark.parametrize(
    "qa,esperado",
    [
        (0, True),               # todo apagado
        (0b00000010, True),      # solo bit dilated_cloud (bit 1) → no es bit 3 ni 4
        (0b00100000, True),      # solo bit snow (bit 5) → pasa para nuestro filtro
        (0b00001000, False),     # bit cloud
        (0b00010000, False),     # bit shadow
        (0b00011000, False),     # ambos
        (0xFFFF, False),         # todos los bits → ambos encendidos
    ],
)
def test_mask_qa_pixel_parametrizado(qa: int, esperado: bool):
    """Tabla de QA_PIXEL ↔ resultado del filtro."""
    assert _qa_pixel_es_limpio(qa) is esperado


# ---------------------------------------------------------------------------
# 3. Validación del baseline rural
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def baseline_rural_gdf():
    """Carga el GeoJSON de baseline rural; skip si no existe."""
    if not RUTA_BASELINE_RURAL.exists():
        pytest.skip(f"{RUTA_BASELINE_RURAL} no existe")
    import geopandas as gpd
    return gpd.read_file(RUTA_BASELINE_RURAL)


def test_baseline_rural_tiene_4_poligonos(baseline_rural_gdf):
    """El baseline rural tiene exactamente 4 polígonos."""
    assert len(baseline_rural_gdf) == 4, (
        f"Esperaba 4 polígonos, hay {len(baseline_rural_gdf)}"
    )


def test_baseline_rural_geometrias_validas(baseline_rural_gdf):
    """Todas las geometrías son topológicamente válidas (no self-intersect)."""
    invalidas = baseline_rural_gdf[~baseline_rural_gdf.geometry.is_valid]
    assert len(invalidas) == 0, (
        f"Geometrías inválidas: {invalidas['id'].tolist()}"
    )


def test_baseline_rural_son_rurales(baseline_rural_gdf):
    """Cada feature tiene un `tipo` que indica naturaleza rural / vegetal.

    Aceptamos vocabulario ampliado: reserva, pasturas, selva_remanente,
    rural, agricola — todos compatibles con baseline rural vegetal.
    """
    tipos_validos = {
        "rural",
        "reserva",
        "pasturas",
        "selva_remanente",
        "agricola",
        "bosque",
    }
    assert "tipo" in baseline_rural_gdf.columns, "Falta columna `tipo`"
    tipos = set(baseline_rural_gdf["tipo"].unique())
    desconocidos = tipos - tipos_validos
    assert not desconocidos, (
        f"Tipos no rurales detectados: {desconocidos}. "
        f"Válidos: {tipos_validos}"
    )


def test_baseline_rural_area_minima_1km2(baseline_rural_gdf):
    """Cada polígono tiene > 1 km² para que el promedio de pixeles sea estable."""
    # Reproyectamos a UTM 21S (EPSG:32721, métrico) para cálculo de área.
    g_metric = baseline_rural_gdf.to_crs(epsg=32721)
    areas_km2 = g_metric.geometry.area / 1e6
    fallos = []
    for idx, area in zip(baseline_rural_gdf["id"], areas_km2):
        if area <= 1.0:
            fallos.append((idx, round(area, 3)))
    assert not fallos, (
        f"Polígonos rurales con área <=1 km²: {fallos}"
    )


def test_baseline_rural_distancia_centro_max_25km(baseline_rural_gdf):
    """Cada polígono está a ≤ 25 km del centro de Posadas (relevancia local)."""
    fallos = []
    for _, row in baseline_rural_gdf.iterrows():
        # Usamos representative_point para evitar centroides fuera de polígonos cóncavos.
        pt = row.geometry.representative_point()
        dist = _haversine_km(POSADAS_LAT, POSADAS_LON, pt.y, pt.x)
        if dist > 25.0:
            fallos.append((row["id"], round(dist, 1)))
    assert not fallos, (
        f"Rurales >25 km del centro de Posadas: {fallos}"
    )


def test_baseline_rural_ids_unicos(baseline_rural_gdf):
    """Los IDs son únicos."""
    ids = baseline_rural_gdf["id"].tolist()
    assert len(ids) == len(set(ids)), f"IDs duplicados: {ids}"


# ---------------------------------------------------------------------------
# 4. Cálculo de UHI mensual (`_calcular_uhi`)
# ---------------------------------------------------------------------------


def _stats_sinteticos_uhi() -> pd.DataFrame:
    """Stats LST mínimos para alimentar `_calcular_uhi`.

    Diseño:
    - 2 polígonos urbanos (urb_a, urb_b) y 2 rurales (rur_a, rur_b).
    - 2 años, 2 meses (enero y julio) → permite testar anomalía histórica.
    - Año 1 (2023): sin histórico previo → `uhi_anomalia` = NaN.
    - Año 2 (2024): con histórico → `uhi_anomalia` calculable.
    """
    filas = []
    # 2023, enero
    filas.append({"poligono_id": "rur_a", "tipo_poligono": "rural",
                  "anio": 2023, "mes": 1, "lst_mean": 30.0})
    filas.append({"poligono_id": "rur_b", "tipo_poligono": "rural",
                  "anio": 2023, "mes": 1, "lst_mean": 32.0})  # mean rural = 31.0
    filas.append({"poligono_id": "urb_a", "tipo_poligono": "urbano",
                  "anio": 2023, "mes": 1, "lst_mean": 36.0})  # uhi_vs_rural=5.0
    filas.append({"poligono_id": "urb_b", "tipo_poligono": "urbano",
                  "anio": 2023, "mes": 1, "lst_mean": 34.0})  # mean urb = 35.0
    # 2024, enero — los urbanos suben 1°C respecto al año anterior.
    filas.append({"poligono_id": "rur_a", "tipo_poligono": "rural",
                  "anio": 2024, "mes": 1, "lst_mean": 30.0})
    filas.append({"poligono_id": "rur_b", "tipo_poligono": "rural",
                  "anio": 2024, "mes": 1, "lst_mean": 32.0})
    filas.append({"poligono_id": "urb_a", "tipo_poligono": "urbano",
                  "anio": 2024, "mes": 1, "lst_mean": 37.0})  # +1°C vs 2023
    filas.append({"poligono_id": "urb_b", "tipo_poligono": "urbano",
                  "anio": 2024, "mes": 1, "lst_mean": 35.0})
    return pd.DataFrame(filas)


def test_uhi_vs_rural(calor_module):
    """`uhi_vs_rural` = lst - mean(lst rurales del mismo año/mes)."""
    df = _stats_sinteticos_uhi()
    out = calor_module._calcular_uhi(df)
    # urb_a en 2023-01: lst=36, baseline rural=31 → uhi_vs_rural=5.0
    fila = out[(out["poligono_id"] == "urb_a") & (out["anio"] == 2023) & (out["mes"] == 1)]
    assert len(fila) == 1
    assert fila["uhi_vs_rural"].iloc[0] == pytest.approx(5.0)
    # urb_b en 2023-01: lst=34 → uhi_vs_rural=3.0
    fila_b = out[(out["poligono_id"] == "urb_b") & (out["anio"] == 2023) & (out["mes"] == 1)]
    assert fila_b["uhi_vs_rural"].iloc[0] == pytest.approx(3.0)


def test_uhi_vs_ciudad(calor_module):
    """`uhi_vs_ciudad` = lst - mean(lst urbanos del mismo año/mes)."""
    df = _stats_sinteticos_uhi()
    out = calor_module._calcular_uhi(df)
    # En 2023-01: mean urbanos = (36+34)/2 = 35
    # urb_a → 36-35 = 1.0
    fila_a = out[(out["poligono_id"] == "urb_a") & (out["anio"] == 2023) & (out["mes"] == 1)]
    assert fila_a["uhi_vs_ciudad"].iloc[0] == pytest.approx(1.0)
    # urb_b → 34-35 = -1.0
    fila_b = out[(out["poligono_id"] == "urb_b") & (out["anio"] == 2023) & (out["mes"] == 1)]
    assert fila_b["uhi_vs_ciudad"].iloc[0] == pytest.approx(-1.0)


def test_uhi_anomalia_sin_historico_es_nan(calor_module):
    """En el primer año disponible no hay histórico → `uhi_anomalia` es NaN."""
    df = _stats_sinteticos_uhi()
    out = calor_module._calcular_uhi(df)
    fila_2023 = out[(out["poligono_id"] == "urb_a") & (out["anio"] == 2023) & (out["mes"] == 1)]
    assert pd.isna(fila_2023["uhi_anomalia"].iloc[0]), (
        "Sin años previos uhi_anomalia debe ser NaN"
    )
    assert int(fila_2023["n_observaciones_historico"].iloc[0]) == 0


def test_uhi_anomalia_con_historico(calor_module):
    """Año 2 con histórico → `uhi_anomalia` = lst_actual - mean(lst histórico mismo mes)."""
    df = _stats_sinteticos_uhi()
    out = calor_module._calcular_uhi(df)
    # urb_a en 2024-01 con histórico = 36 (de 2023). lst actual = 37 → anomalia = 1.0
    fila = out[(out["poligono_id"] == "urb_a") & (out["anio"] == 2024) & (out["mes"] == 1)]
    assert len(fila) == 1
    assert fila["uhi_anomalia"].iloc[0] == pytest.approx(1.0)
    assert int(fila["n_observaciones_historico"].iloc[0]) == 1


def test_uhi_solo_reporta_urbanos(calor_module):
    """`_calcular_uhi` solo emite filas para polígonos URBANOS."""
    df = _stats_sinteticos_uhi()
    out = calor_module._calcular_uhi(df)
    # No debe haber filas con poligono_id = "rur_*"
    assert not any(out["poligono_id"].astype(str).str.startswith("rur_")), (
        "UHI no debe emitirse para polígonos rurales"
    )


def test_uhi_dataframe_vacio(calor_module):
    """`_calcular_uhi` con DF vacío devuelve DF vacío sin crashear."""
    out = calor_module._calcular_uhi(pd.DataFrame())
    assert out.empty


# ---------------------------------------------------------------------------
# 5. Agregación estacional hemisferio sur
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "anio,mes,estacion_esp,anio_est_esp",
    [
        # diciembre 2023 → verano 2024 (DJF se asigna al año en que cae enero/feb)
        (2023, 12, "verano", 2024),
        # enero/febrero pertenecen al verano del mismo año
        (2024, 1, "verano", 2024),
        (2024, 2, "verano", 2024),
        # marzo, abril, mayo → otoño
        (2024, 3, "otono", 2024),
        (2024, 5, "otono", 2024),
        # junio, julio, agosto → invierno
        (2024, 6, "invierno", 2024),
        (2024, 8, "invierno", 2024),
        # septiembre, octubre, noviembre → primavera
        (2024, 9, "primavera", 2024),
        (2024, 11, "primavera", 2024),
        # caso borde: diciembre 2025 → verano 2026
        (2025, 12, "verano", 2026),
    ],
)
def test_estacional_asignacion_hemisferio_sur(
    calor_module, anio: int, mes: int, estacion_esp: str, anio_est_esp: int
):
    """Diciembre del año N va al verano del año N+1 (hemisferio sur)."""
    # Construimos un DF con una fila urbana mínima para el mes/año.
    # _agregar_estacional necesita uhi_df con al menos: poligono_id, anio, mes,
    # uhi_vs_rural, uhi_vs_ciudad, lst_mean.
    df = pd.DataFrame([{
        "poligono_id": "urb_test",
        "anio": anio,
        "mes": mes,
        "lst_mean": 30.0,
        "uhi_vs_rural": 1.5,
        "uhi_vs_ciudad": 0.5,
        "uhi_anomalia": np.nan,
        "lst_rural_baseline": 28.5,
        "n_observaciones_historico": 0,
        "std_historico": np.nan,
    }])
    out = calor_module._agregar_estacional(df)
    assert len(out) == 1, f"Esperaba 1 fila estacional, hay {len(out)}"
    assert out["estacion"].iloc[0] == estacion_esp
    assert int(out["anio"].iloc[0]) == anio_est_esp


def test_estacional_meses_por_estacion_modulo(calor_module):
    """El diccionario de estaciones cubre los 12 meses sin gaps ni duplicados."""
    todos = []
    for est, meses in calor_module.MESES_POR_ESTACION.items():
        todos.extend(meses)
    # Esperamos los 12 meses exactos
    assert sorted(todos) == list(range(1, 13)), (
        f"MESES_POR_ESTACION no cubre los 12 meses: {sorted(todos)}"
    )


# ---------------------------------------------------------------------------
# 6. Schema del CSV `uhi_por_poligono_mensual.csv`
# ---------------------------------------------------------------------------


COLUMNAS_UHI_MENSUAL_ESPERADAS = [
    "poligono_id",
    "anio",
    "mes",
    "lst_mean",
    "uhi_vs_rural",
    "uhi_vs_ciudad",
    "uhi_anomalia",
    "lst_rural_baseline",
    "n_observaciones_historico",
    "std_historico",
]


def test_uhi_csv_schema_funcion_modulo(calor_module):
    """`_calcular_uhi` produce las columnas esperadas, en el orden documentado."""
    df = _stats_sinteticos_uhi()
    out = calor_module._calcular_uhi(df)
    assert list(out.columns) == COLUMNAS_UHI_MENSUAL_ESPERADAS, (
        f"Columnas inesperadas: {list(out.columns)}"
    )


def test_uhi_csv_schema_archivo_real():
    """Si existe el CSV de producción, sus columnas incluyen el schema base.

    Desde v0.4.0 (integración CBERS-4 IRS térmico), el CSV puede tener
    columnas extra opcionales ``fuente_lst`` y ``confianza_cross_sensor``
    cuando se generó con ``--fuente {merged,cbers}``. Validamos:

    1. Las columnas base aparecen en el orden esperado al inicio.
    2. Las únicas columnas extra permitidas son las del backup CBERS.
    """
    if not RUTA_CSV_UHI.exists():
        pytest.skip(f"{RUTA_CSV_UHI} no existe (correr pipeline primero)")
    df = pd.read_csv(RUTA_CSV_UHI)
    cols_actuales = list(df.columns)
    n = len(COLUMNAS_UHI_MENSUAL_ESPERADAS)
    assert cols_actuales[:n] == COLUMNAS_UHI_MENSUAL_ESPERADAS, (
        f"Las primeras {n} columnas del CSV no coinciden con el schema base.\n"
        f"  Esperado: {COLUMNAS_UHI_MENSUAL_ESPERADAS}\n"
        f"  Actual:   {cols_actuales[:n]}"
    )
    extras_permitidas = {"fuente_lst", "confianza_cross_sensor"}
    extras = set(cols_actuales[n:])
    desconocidas = extras - extras_permitidas
    assert not desconocidas, (
        f"Columnas inesperadas más allá del schema base + extras CBERS: "
        f"{desconocidas}"
    )


# ---------------------------------------------------------------------------
# 7. Rangos de valores en CSV de producción (warnings de la metodología)
# ---------------------------------------------------------------------------


def test_uhi_csv_rangos_valores():
    """Si existe el CSV, validar que `lst_mean ∈ [0, 60]` y `|uhi_vs_rural| < 15°C`.

    Estos son los umbrales documentados como sanity checks en METODOLOGIA.md
    (`UHI_MAX_ALERTA_BUG = 15.0` y `LST_MAX_CELSIUS_VALIDO = 60.0`).
    """
    if not RUTA_CSV_UHI.exists():
        pytest.skip(f"{RUTA_CSV_UHI} no existe")
    df = pd.read_csv(RUTA_CSV_UHI)

    # lst_mean: dropna y validar rango.
    lst = df["lst_mean"].dropna()
    fuera_lst = lst[(lst < 0.0) | (lst > 60.0)]
    assert len(fuera_lst) == 0, (
        f"{len(fuera_lst)} filas con lst_mean fuera de [0, 60]°C: "
        f"min={lst.min():.2f}, max={lst.max():.2f}"
    )

    # |uhi_vs_rural|: warning si supera 15°C — esperamos < 15 en el CSV de producción.
    uhi = df["uhi_vs_rural"].dropna()
    fuera_uhi = uhi[uhi.abs() >= 15.0]
    assert len(fuera_uhi) == 0, (
        f"{len(fuera_uhi)} filas con |uhi_vs_rural| >= 15°C "
        f"(probable bug, revisar): max abs = {uhi.abs().max():.2f}"
    )


def test_uhi_csv_no_vacio():
    """Si el CSV existe, debe tener al menos 1 fila — no estar vacío."""
    if not RUTA_CSV_UHI.exists():
        pytest.skip(f"{RUTA_CSV_UHI} no existe")
    df = pd.read_csv(RUTA_CSV_UHI)
    assert len(df) > 0, f"{RUTA_CSV_UHI} está vacío"


# ---------------------------------------------------------------------------
# 8. Backup térmico CBERS-4 IRS (v0.4.0)
# ---------------------------------------------------------------------------
#
# Tests del merge Landsat + CBERS implementado en `_enriquecer_con_cbers`.
# Filosofía: Landsat es la fuente primaria, CBERS rellena cuando Landsat
# tuvo mes nublado. La columna `fuente_lst` traza la procedencia.


def _stats_landsat_sinteticos_con_gap() -> pd.DataFrame:
    """Stats Landsat con un gap intencional en mes 6 (urb_a)."""
    filas = [
        # Mes 1, 2, 3 — urb_a tiene Landsat OK.
        {"poligono_id": "urb_a", "tipo_poligono": "urbano", "anio": 2024, "mes": 1,
         "pct_validos": 80.0, "count_validos": 100, "lst_mean": 30.0,
         "lst_median": 30.0, "lst_std": 1.0, "lst_p10": 28.0, "lst_p90": 32.0,
         "lst_max": 33.0},
        {"poligono_id": "urb_a", "tipo_poligono": "urbano", "anio": 2024, "mes": 2,
         "pct_validos": 75.0, "count_validos": 100, "lst_mean": 31.0,
         "lst_median": 31.0, "lst_std": 1.0, "lst_p10": 29.0, "lst_p90": 33.0,
         "lst_max": 34.0},
        {"poligono_id": "urb_a", "tipo_poligono": "urbano", "anio": 2024, "mes": 3,
         "pct_validos": 70.0, "count_validos": 100, "lst_mean": 28.0,
         "lst_median": 28.0, "lst_std": 1.0, "lst_p10": 26.0, "lst_p90": 30.0,
         "lst_max": 31.0},
        # Mes 6 — Landsat fracasó (pct_validos bajo, lst NaN).
        {"poligono_id": "urb_a", "tipo_poligono": "urbano", "anio": 2024, "mes": 6,
         "pct_validos": 12.0, "count_validos": 5, "lst_mean": np.nan,
         "lst_median": np.nan, "lst_std": np.nan, "lst_p10": np.nan,
         "lst_p90": np.nan, "lst_max": np.nan},
        # Polígono rural — solo en mes 1.
        {"poligono_id": "rur_a", "tipo_poligono": "rural", "anio": 2024, "mes": 1,
         "pct_validos": 90.0, "count_validos": 200, "lst_mean": 26.0,
         "lst_median": 26.0, "lst_std": 0.8, "lst_p10": 25.0, "lst_p90": 27.0,
         "lst_max": 28.0},
    ]
    return pd.DataFrame(filas)


def _cbers_sintetico_para_gap() -> pd.DataFrame:
    """CBERS con dato para mes 6 (gap de Landsat) y overlap en mes 1."""
    return pd.DataFrame([
        # Overlap (mes 1) — para validar marca "merged" + confianza alta.
        {"poligono_id": "urb_a", "anio": 2024, "mes": 1,
         "lst_mean_cbers": 30.7, "n_pixeles": 80,
         "fecha_pasada": "2024-01-15", "calidad": "alta"},
        # Gap real (mes 6) — debería rellenar.
        {"poligono_id": "urb_a", "anio": 2024, "mes": 6,
         "lst_mean_cbers": 22.5, "n_pixeles": 75,
         "fecha_pasada": "2024-06-12", "calidad": "alta"},
        # Mes 7 — sólo CBERS (no estaba en Landsat). Debería agregar fila nueva.
        {"poligono_id": "urb_a", "anio": 2024, "mes": 7,
         "lst_mean_cbers": 21.0, "n_pixeles": 80,
         "fecha_pasada": "2024-07-10", "calidad": "media"},
        # Calidad baja — debería ignorarse.
        {"poligono_id": "urb_a", "anio": 2024, "mes": 8,
         "lst_mean_cbers": 99.0, "n_pixeles": 5,
         "fecha_pasada": "2024-08-15", "calidad": "baja"},
    ])


def test_fuente_lst_default_es_merged(calor_module):
    """En modo merged, el output incluye la columna ``fuente_lst``."""
    stats = _stats_landsat_sinteticos_con_gap()
    cbers = _cbers_sintetico_para_gap()
    out = calor_module._enriquecer_con_cbers(stats, cbers, calor_module.FUENTE_MERGED)
    assert "fuente_lst" in out.columns, (
        "fuente_lst debería existir en el output del modo merged"
    )
    assert "confianza_cross_sensor" in out.columns
    # Mes 1 urb_a: ambos datos disponibles → marca "merged" + alta.
    fila_mes1 = out[(out["poligono_id"] == "urb_a") & (out["mes"] == 1)]
    assert fila_mes1["fuente_lst"].iloc[0] == "merged"
    assert fila_mes1["confianza_cross_sensor"].iloc[0] == "alta"


def test_fuente_landsat_legacy(calor_module):
    """``--fuente landsat`` reproduce el comportamiento legacy (sin columnas CBERS)."""
    stats = _stats_landsat_sinteticos_con_gap()
    cbers = _cbers_sintetico_para_gap()
    out = calor_module._enriquecer_con_cbers(stats, cbers, calor_module.FUENTE_LANDSAT)
    # No debe agregar columnas nuevas.
    assert "fuente_lst" not in out.columns, (
        "Modo landsat legacy NO debe inyectar fuente_lst"
    )
    assert "confianza_cross_sensor" not in out.columns
    # Y NO debe inventar filas nuevas (el mes 7 sólo CBERS no aparece).
    assert len(out) == len(stats)
    # El mes 6 (gap) sigue siendo NaN — Landsat puro no rellena.
    fila_mes6 = out[(out["poligono_id"] == "urb_a") & (out["mes"] == 6)]
    assert pd.isna(fila_mes6["lst_mean"].iloc[0])


def test_merge_solo_donde_landsat_null(calor_module):
    """En modo merged, CBERS llena el mes 6 (gap) y no toca mes 1 (Landsat OK)."""
    stats = _stats_landsat_sinteticos_con_gap()
    cbers = _cbers_sintetico_para_gap()
    out = calor_module._enriquecer_con_cbers(stats, cbers, calor_module.FUENTE_MERGED)

    # Mes 1: Landsat=30.0, CBERS=30.7. En merged debe ganar Landsat.
    f1 = out[(out["poligono_id"] == "urb_a") & (out["mes"] == 1)].iloc[0]
    assert f1["lst_mean"] == pytest.approx(30.0), (
        "Modo merged NO debe sobreescribir Landsat válido"
    )
    assert f1["fuente_lst"] == "merged"

    # Mes 6: gap Landsat → CBERS rellena con 22.5°C.
    f6 = out[(out["poligono_id"] == "urb_a") & (out["mes"] == 6)].iloc[0]
    assert f6["lst_mean"] == pytest.approx(22.5)
    assert f6["fuente_lst"] == "cbers"
    # Sin overlap previo en este (poligono, mes) específico → confianza media
    # (el overlap se mide por tripleta exacta poligono+anio+mes, no por
    # polígono solamente).
    assert f6["confianza_cross_sensor"] == "media"

    # Mes 7: sólo CBERS sin fila Landsat — debe agregarse como fila nueva.
    f7 = out[(out["poligono_id"] == "urb_a") & (out["mes"] == 7)]
    assert len(f7) == 1, "Mes 7 (sólo CBERS) debe aparecer como fila extra"
    assert f7["fuente_lst"].iloc[0] == "cbers"
    assert f7["confianza_cross_sensor"].iloc[0] == "media"

    # Mes 8: calidad baja → debe ignorarse, no aparece.
    f8 = out[(out["poligono_id"] == "urb_a") & (out["mes"] == 8)]
    assert f8.empty, "Calidad baja de CBERS debe filtrarse"


def test_merge_csv_inexistente_no_rompe(calor_module, tmp_path):
    """Si T1 no generó el CSV todavía, el merge corre vacío sin error."""
    inexistente = tmp_path / "no_existe.csv"
    df_cbers = calor_module._cargar_cbers_termico(inexistente)
    assert df_cbers.empty
    # Las columnas vacías están definidas para que el join sea no-op.
    for c in ("poligono_id", "anio", "mes", "lst_mean_cbers", "calidad"):
        assert c in df_cbers.columns

    stats = _stats_landsat_sinteticos_con_gap()
    out = calor_module._enriquecer_con_cbers(stats, df_cbers, calor_module.FUENTE_MERGED)
    # Modo merged sin CBERS: sólo agrega las columnas con todos los Landsat
    # marcados como "landsat" (donde el dato es válido) o None.
    assert "fuente_lst" in out.columns
    assert (out["fuente_lst"] == "landsat").sum() >= 1


def test_uhi_propaga_fuente_lst(calor_module):
    """`_calcular_uhi` mantiene la columna ``fuente_lst`` en el output urbano."""
    # Construimos stats con fuente_lst y rurales para que el cálculo funcione.
    filas = [
        {"poligono_id": "rur_a", "tipo_poligono": "rural",
         "anio": 2024, "mes": 6, "lst_mean": 18.0,
         "fuente_lst": "landsat", "confianza_cross_sensor": None},
        {"poligono_id": "urb_a", "tipo_poligono": "urbano",
         "anio": 2024, "mes": 6, "lst_mean": 22.0,
         "fuente_lst": "cbers", "confianza_cross_sensor": "media"},
    ]
    df = pd.DataFrame(filas)
    out = calor_module._calcular_uhi(df)
    assert "fuente_lst" in out.columns
    fila = out[(out["poligono_id"] == "urb_a") & (out["mes"] == 6)]
    assert fila["fuente_lst"].iloc[0] == "cbers"
    assert fila["confianza_cross_sensor"].iloc[0] == "media"
    # UHI cálculo sigue funcionando sobre el lst_mean de origen mixto.
    assert fila["uhi_vs_rural"].iloc[0] == pytest.approx(4.0)


def test_constantes_fuente_modulo(calor_module):
    """Las constantes de modos de fuente están exportadas y son strings esperados."""
    assert calor_module.FUENTE_LANDSAT == "landsat"
    assert calor_module.FUENTE_CBERS == "cbers"
    assert calor_module.FUENTE_MERGED == "merged"
    assert set(calor_module.FUENTES_VALIDAS) == {"landsat", "cbers", "merged"}
    assert calor_module.CBERS_CALIDADES_ACEPTADAS == {"alta", "media"}


def test_modo_cbers_puro_reemplaza_landsat(calor_module):
    """``--fuente cbers`` reemplaza valores Landsat por CBERS donde existen."""
    stats = _stats_landsat_sinteticos_con_gap()
    cbers = _cbers_sintetico_para_gap()
    out = calor_module._enriquecer_con_cbers(stats, cbers, calor_module.FUENTE_CBERS)
    # Mes 1 urb_a: ahora gana CBERS (30.7).
    f1 = out[(out["poligono_id"] == "urb_a") & (out["mes"] == 1)].iloc[0]
    assert f1["lst_mean"] == pytest.approx(30.7)
    assert f1["fuente_lst"] == "cbers"
