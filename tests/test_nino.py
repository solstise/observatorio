"""Fixtures sintéticos: umbrales, ventanas, faltantes y exposición agregada."""

import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
import yaml

from scripts.nino_model import (
    agregar_exposicion,
    nivel_lluvia,
    resumen_ensemble,
    rolling_max,
    score_impacto,
    tipo_equipamiento,
)

ROOT = Path(__file__).resolve().parents[1]
T = yaml.safe_load((ROOT / "config/alertas.yaml").read_text(encoding="utf-8"))["anegamiento_v2"]


@pytest.mark.parametrize(
    "tags,expected",
    [
        ({"name": "Cavas"}, None),
        ({"name": "Centro de Atención al Cliente"}, None),
        ({"name": "Escuela de inglés", "amenity": "language_school"}, None),
        ({"name": "Centro de Atención al Vecino - Las Heras"}, "CAV"),
        ({"name": "CAV Itaembé"}, "CAV"),
        ({"amenity": "school"}, "Escuela"),
    ],
)
def test_facilities_do_not_invent_cav(tags, expected):
    assert tipo_equipamiento(tags) == expected


@pytest.mark.parametrize(
    "one,day,level",
    [
        (0, 0, "sin_umbral"),
        (19.99, 49.99, "sin_umbral"),
        (20, 0, "atencion"),
        (0, 50, "atencion"),
        (40, 0, "alto"),
        (0, 80, "alto"),
        (70, 0, "muy_alto"),
        (0, 120, "muy_alto"),
        (20, 120, "muy_alto"),
        (None, 0, "a_verificar"),
    ],
)
def test_thresholds(one, day, level):
    assert nivel_lluvia(one, day, T) == level


def test_rolling_windows_are_complete_and_cross_midnight():
    assert rolling_max([0, 25, 30, 0], 3) == 55
    assert rolling_max([1] * 23, 24) is None
    assert rolling_max([1, np.nan, 3], 2) is None
    assert rolling_max([np.nan, 4, 6], 2) == 10


@pytest.fixture
def ensemble():
    now = datetime(2026, 10, 14, 3, 30, tzinfo=timezone.utc)
    times = [
        (now.replace(tzinfo=None, minute=0) - timedelta(hours=3) + timedelta(hours=h)).isoformat()
        for h in range(100)
    ]
    return now, {
        "utc_offset_seconds": -10800,
        "hourly": {
            "time": times,
            "precipitation_member01": [0] + [40] + [0] * 98,
            "precipitation_member02": [0] * 100,
            "precipitation_member03": [None] * 100,
        },
    }


def test_ensemble_probability_uses_members_and_excludes_missing(ensemble):
    now, data = ensemble
    r = resumen_ensemble(data, T, now)
    assert len(r["horas"]) == 72
    assert r["n_miembros"] == 2
    assert r["lluvia_max_1h"] == 20
    assert r["probabilidades"]["alto"] == 50
    assert r["probabilidades"]["muy_alto"] == 0
    assert datetime.fromisoformat(r["horas"][0]["time"]) > now


def _hourly_payload(now, members, extra=None):
    start = now.replace(tzinfo=None, minute=0) - timedelta(hours=3)
    hourly = {"time": [(start + timedelta(hours=h)).isoformat() for h in range(100)]}
    for n, series in enumerate(members, 1):
        hourly[f"precipitation_member{n:02d}"] = series
    hourly.update(extra or {})
    return {"utc_offset_seconds": -10800, "hourly": hourly}


def test_storm_at_different_hours_is_not_flattened():
    # Tres escenarios con 30 mm en una hora distinta: la mediana hora por hora
    # da cero, pero en todos los escenarios llueve fuerte en algún momento.
    now = datetime(2026, 10, 22, 21, 30, tzinfo=timezone.utc)
    members = []
    for shift in (10, 20, 30):
        series = [0.0] * 100
        series[shift] = 30.0
        members.append(series)
    r = resumen_ensemble(_hourly_payload(now, members), T, now)
    assert max(h["p50"] for h in r["horas"]) == 0
    assert r["lluvia_max_1h"] == 30
    assert r["lluvia_24h"] == 30
    assert r["nivel"] == "atencion"
    assert r["probabilidades"]["atencion"] == 100


def test_daily_totals_close_at_midnight_local():
    # 21:30 UTC = 18:30 en Posadas. La serie arranca a las 18:00 locales, así que
    # el índice 1 es la hora que termina a las 19:00.
    now = datetime(2026, 10, 22, 21, 30, tzinfo=timezone.utc)
    series = [0.0] * 100
    series[6] = 12.0  # hora que termina a las 00:00 del 23: pertenece al 22
    series[7] = 5.0  # hora que termina a la 01:00 del 23
    r = resumen_ensemble(_hourly_payload(now, [series, series]), T, now)
    days = {d["fecha"]: d for d in r["dias"]}
    assert days["2026-10-22"]["p50"] == 12
    assert days["2026-10-22"]["horas"] == 6
    assert days["2026-10-23"]["p50"] == 5
    assert days["2026-10-23"]["horas"] == 24
    assert sum(d["horas"] for d in r["dias"]) == 72


def test_storm_and_gust_probabilities_use_their_own_members():
    now = datetime(2026, 10, 22, 21, 30, tzinfo=timezone.utc)
    rain = [[0.0] * 100] * 4
    codes = {
        "weather_code_member01": [95] + [3] * 99,
        "weather_code_member02": [3] * 100,
        "weather_code_member03": [None] * 100,
        "weather_code_member04": [3] * 50 + [99] + [3] * 49,
    }
    gusts = {"wind_gusts_10m_member01": [70.0] * 100, "wind_gusts_10m_member02": [20.0] * 100}
    r = resumen_ensemble(_hourly_payload(now, rain, {**codes, **gusts}), T, now)
    # El primer valor (95) es pasado; el 99 cae dentro de las 72 h futuras.
    assert r["tormenta"]["n_miembros_tormenta"] == 3
    assert r["tormenta"]["prob_tormenta"] == pytest.approx(33.3)
    assert r["tormenta"]["prob_rafagas"] == 50
    assert r["tormenta"]["n_miembros_rafagas"] == 2


def test_storm_probability_missing_is_none_not_zero(ensemble):
    now, data = ensemble
    r = resumen_ensemble(data, T, now)
    assert r["tormenta"]["prob_tormenta"] is None
    assert all(d["prob_rafagas"] is None for d in r["dias"])


def test_missing_horizon_rejected(ensemble):
    now, data = ensemble
    data["hourly"]["time"] = data["hourly"]["time"][:50]
    with pytest.raises(ValueError, match="72"):
        resumen_ensemble(data, T, now)


def test_empty_precipitation_rejected(ensemble):
    now, data = ensemble
    data["hourly"] = {"time": data["hourly"]["time"]}
    with pytest.raises(ValueError, match="miembros"):
        resumen_ensemble(data, T, now)


def test_score_needs_rain_and_exposure():
    rain = {"lluvia_max_1h": 70, "lluvia_24h": 0}
    assert score_impacto(rain, 100, T) == 100
    assert score_impacto(rain, 0, T) == 25
    assert score_impacto(rain, None, T) is None
    assert score_impacto({"lluvia_max_1h": 0, "lluvia_24h": 0}, 100, T) == 0


def test_small_exposure_fixture_counts_once():
    r = agregar_exposicion(["muy_expuesto", "expuesto", "no_expuesto", "no_expuesto"], 400)
    assert r["viviendas_muy_expuestas"] == 1
    assert r["viviendas_expuestas"] == 2
    assert r["pct_viviendas_expuestas"] == 50
    assert (
        r["poblacion_expuesta_min"],
        r["poblacion_expuesta_estimada"],
        r["poblacion_expuesta_max"],
    ) == (160, 200, 240)


def test_unknown_exposure_never_becomes_zero():
    r = agregar_exposicion(["a_verificar", "expuesto"], 100)
    assert r["pct_viviendas_expuestas"] is None
    assert r["poblacion_expuesta_estimada"] is None
    assert r["estado"] == "a_verificar"
    assert agregar_exposicion([])["pct_viviendas_expuestas"] is None


def test_geospatial_classification_boundaries():
    spec = importlib.util.spec_from_file_location(
        "exposicion", ROOT / "scripts/61_exposicion_hidrica.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    actual = mod.clasificar(
        np.array([49, 50, 100, 101, 400, 110, 80]),
        np.array([1.9, 1.9, 4, 3.9, np.nan, np.nan, np.nan]),
    )
    assert actual.tolist() == [
        "muy_expuesto",
        "expuesto",
        "no_expuesto",
        "expuesto",
        "no_expuesto",
        "a_verificar",
        "expuesto",
    ]


def test_sync_rejects_old_snapshot(tmp_path):
    import json

    from scripts.sync_forecast import sync_forecast

    source = tmp_path / "data/processed/forecast"
    source.mkdir(parents=True)
    (source / "_metadata.json").write_text(
        json.dumps({"generated_at": "2026-01-01T00:00:00+00:00"})
    )
    with pytest.raises(ValueError, match="frescura"):
        sync_forecast(tmp_path)
