"""Registro de lluvia medida (SYNOP 87178) y resumen del WRF del SMN, sin red."""

import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f"scripts/{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


obs = _load("63_lluvia_observada")
wrf = _load("64_wrf_smn")

# Reportes reales de Posadas Aero del 21 y 22 de octubre de 2026.
SYNOP = [
    "87178,2026,10,21,18,00,AAXX 21184 87178 12470 60301 10232 20178 39985 40131 57009 60032 80270 333 56400 80630=",
    "87178,2026,10,22,00,00,AAXX 22004 87178 12470 80000 10190 20190 39990 40150 52010 60251 79790 333 56400=",
    "87178,2026,10,22,06,00,AAXX 22064 87178 12470 61607 10200 20190 39980 40140 57005 60301 79590 333 56400=",
    "87178,2026,10,22,12,00,AAXX 22124 87178 12470 63208 10200 20190 39990 40170 51020 60754 79560 333 10210 20195=",
    "87178,2026,10,15,12,00,AAXX 15124 87178 32470 71608 10198 20172 30002 40150 52021 87700 333 10198=",
]


def test_decodifica_lluvia_de_24h_y_tiempo_presente():
    r = obs.decodificar(SYNOP[3])
    assert r["utc"] == datetime(2026, 10, 22, 12, tzinfo=timezone.utc)
    assert r["mm_24h"] == 75
    assert r["ww"] == 95
    # iR=3 a las 12 UTC: sin lluvia, el grupo se omite.
    assert obs.decodificar(SYNOP[4])["mm_24h"] == 0
    # Fuera de las 12 UTC no se informa total diario.
    assert obs.decodificar(SYNOP[1])["mm_24h"] is None
    assert obs.decodificar("87177,2026,10,22,12,00,AAXX 22124 87177 12470") is None


@pytest.mark.parametrize("code,mm", [("000", 0), ("075", 75), ("990", 0), ("993", 0.3)])
def test_tabla_3590(code, mm):
    assert obs._rrr(code) == pytest.approx(mm)


def test_dia_pluviometrico_termina_a_las_12_utc():
    dias = {d["fecha"]: d for d in obs.resumir_por_dia([obs.decodificar(x) for x in SYNOP[:4]])}
    # 18 UTC del 21 pertenece al día que termina el 22; 12 UTC del 22 también.
    assert set(dias) == {"2026-10-22"}
    assert dias["2026-10-22"]["mm"] == 75
    assert dias["2026-10-22"]["tormenta"] is True
    assert dias["2026-10-22"]["reportes"] == 4


def test_fusion_no_borra_un_valor_con_un_vacio():
    previo = [
        {"fecha": "2026-10-22", "mm": 75.0, "tormenta": True, "granizo": False, "reportes": 11}
    ]
    nuevo = [
        {"fecha": "2026-10-22", "mm": None, "tormenta": False, "granizo": True, "reportes": 13}
    ]
    fila = obs.fusionar(previo, nuevo)[0]
    assert fila["mm"] == 75.0
    # Día partido entre dos consultas: las marcas se combinan.
    assert fila["granizo"] is True
    assert fila["tormenta"] is True
    assert fila["reportes"] == 13
    corregido = obs.fusionar(previo, [{**nuevo[0], "mm": 76.0}])[0]
    assert corregido["mm"] == 76.0


def test_wrf_resume_solo_horas_futuras_y_dias_locales():
    corrida = datetime(2026, 10, 22, 18, tzinfo=timezone.utc)
    ahora = corrida + timedelta(hours=2, minutes=30)
    cajas = {}
    for plazo in range(1, 13):
        caja = np.zeros((3, 3))
        caja[1, 1] = 1.0
        caja[0, 2] = 5.0 if plazo == 6 else 0.0
        cajas[plazo] = caja
    r = wrf.resumir(corrida, cajas, ahora, radio=1)
    # Plazos 1 y 2 ya pasaron.
    assert len(r["horas"]) == 10
    assert r["horas"][0]["time"] == "2026-10-22T18:00:00-03:00"
    assert r["max_1h_centro"] == 1.0
    assert r["max_1h_zona"] == 5.0
    dias = {d["fecha"]: d for d in r["dias"]}
    # La corrida de 18 UTC son las 15 h locales: los plazos 3..9 cierran entre las
    # 18:00 y las 00:00 del 22 (la hora que cierra a medianoche es del 22).
    assert dias["2026-10-22"]["horas"] == 7
    assert dias["2026-10-22"]["centro"] == 7.0
    assert dias["2026-10-22"]["max_zona"] == 7.0
    assert dias["2026-10-23"]["horas"] == 3


def test_wrf_indice_mas_cercano():
    lat, lon = np.meshgrid(np.linspace(-28, -27, 11), np.linspace(-56.5, -55.5, 11), indexing="ij")
    j, i = wrf.indice_cercano(lat, lon, (-27.4, -55.9))
    assert (round(float(lat[j, i]), 2), round(float(lon[j, i]), 2)) == (-27.4, -55.9)


def test_ship_caso_calculado_a_mano():
    from scripts.nino_model import categoria_granizo, consenso_granizo, ship

    # CAPE 2000, mezcla 14,9 g/kg (tope 13,6), gradiente 16 °C / 2,7 km, −T500 = 8,
    # cizalladura 20 m/s (72 km/h del oeste en 500 hPa, calma en superficie).
    valor = ship(2000, 20, 1000, -8, 8, 5800, 3100, 72, 270, 0, 0, 4000)
    assert float(valor) == pytest.approx(0.614, abs=0.005)
    # Con poca energía: escala con el CAPE y además se multiplica por CAPE / 1300.
    bajo = ship(650, 20, 1000, -8, 8, 5800, 3100, 72, 270, 0, 0, 4000)
    assert float(bajo) == pytest.approx(0.614 * (650 / 2000) * (650 / 1300), abs=0.003)
    # Sin nivel de congelación (ECMWF) no se aplica ese ajuste.
    assert float(ship(2000, 20, 1000, -8, 8, 5800, 3100, 72, 270, 0, 0, np.nan)) == pytest.approx(
        0.614, abs=0.005
    )
    assert categoria_granizo(1.2) == "alto"
    assert categoria_granizo(0.5) == "moderado"
    assert categoria_granizo(0.49) == "bajo"
    assert categoria_granizo(np.nan) is None
    assert consenso_granizo(["moderado", "moderado", "bajo"]) == "moderado"
    assert consenso_granizo(["alto", "bajo", "bajo"]) == "bajo"
    assert consenso_granizo(["alto", "moderado", "bajo"]) == "moderado"
    assert consenso_granizo([None, "alto"]) == "alto"
    assert consenso_granizo([None, None]) is None


def test_climatologia_solo_usa_anios_completos():
    clima = _load("67_climatologia_lluvia")
    filas = []
    for anio in range(2010, 2016):
        for dia in pd.date_range(f"{anio}-01-01", f"{anio}-12-31"):
            filas.append(
                {"fecha": dia.date().isoformat(), "mm": 60.0 if dia.dayofyear == 100 else 0.0}
            )
    # 2016 con apenas 100 días informados: no entra en la estadística.
    for dia in pd.date_range("2016-01-01", periods=100):
        filas.append({"fecha": dia.date().isoformat(), "mm": 200.0 if dia.dayofyear == 50 else 0.0})
    datos = clima.climatologia(pd.DataFrame(filas))
    assert datos["anios_completos"] == list(range(2010, 2016))
    assert datos["diarios_desde_10mm"] == [60.0] * 6
    assert 200.0 not in datos["diarios_desde_10mm"]
    assert datos["tres_dias_desde_20mm"] == [60.0] * 6
    assert datos["mensual"]["04"]["mediana"] == 60.0


# Mensajes reales con errores, tal como los publica Ogimet.
SYNOP_2017_555 = (
    "87178,2017,03,02,12,00,AAXX 02124 87178 32970 10506 10262 20227 39934 40076 52012 "
    "81070 333 10283 20237 56000 81360 555 10090 60851 72518="
)
SYNOP_2004 = [
    "87178,2004,05,11,18,00,AAXX 11184 87178 32970 70909 10247 20169 39966 40111 57032 87070 333 56070 87360=",
    "87178,2004,05,12,00,00,AAXX 12004 87178 32970 80906 10209 20172 39972 40117 51005 8807/ 333 10250 20187 56009 88360=",
    "87178,2004,05,12,06,00,AAXX 12064 87178 11270 81104 10196 20185 39954 40097 57017 69931 72052 8467/ 333 56009 84704 88360 96450=",
    "87178,2004,05,12,12,00,AAXX 12124 87178 01230 81602 10196 20187 39972 40116 52013 69194 71052 886// 333 10210 20192 56099 69961 84705 88610=",
]


def test_seccion_555_no_es_lluvia():
    r = obs.decodificar(SYNOP_2017_555)
    # iR=3: sin lluvia. El grupo 72518 de la sección 555 no es un total de 24 h.
    assert r["mm_24h"] == 0


def test_total_incoherente_con_sus_partes_queda_sin_dato():
    dias = {d["fecha"]: d for d in obs.resumir_por_dia([obs.decodificar(x) for x in SYNOP_2004])}
    # 919 mm informados con 0 + 0 + 0,3 mm en los grupos de 6 h: error de tipeo.
    assert dias["2004-05-12"]["mm"] is None
    assert obs.control_dia(75, [3, 25, 30]) == 75
    assert obs.control_dia(414, [0, 14, 0]) is None
    assert obs.control_dia(5, [10]) is None
    assert obs.control_dia(250, []) == 250
    assert obs.control_dia(400, []) is None
    # Día partido entre consultas (falta la parte de las 18 UTC): solo el tope general.
    assert obs.control_dia(280, [40, 30], completas=False) == 280
    assert obs.control_dia(280, [40, 30], completas=True) is None
