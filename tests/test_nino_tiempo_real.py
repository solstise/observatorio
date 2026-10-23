"""Registro de lluvia medida (SYNOP 87178) y resumen del WRF del SMN, sin red."""

import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
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
    previo = [{"fecha": "2026-10-22", "mm": 75.0, "tormenta": True, "granizo": False}]
    nuevo = [{"fecha": "2026-10-22", "mm": None, "tormenta": True, "granizo": True}]
    fila = obs.fusionar(previo, nuevo)[0]
    assert fila["mm"] == 75.0
    assert fila["granizo"] is True
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
