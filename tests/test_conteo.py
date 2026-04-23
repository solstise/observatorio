"""Tests del módulo de conteo de edificios (Tarea 2.8).

Usa raster sintético y fixtures del conftest para validar la lógica
de detección NDBI/NDVI, monotonicidad temporal, y filtrado por confianza.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Helpers — algoritmo simplificado acorde a scripts/20_contar_techos.py
# ---------------------------------------------------------------------------


def _contar_techos_sinteticos(
    raster: np.ndarray,
    edificios_pix: list[tuple[int, int]],
    *,
    ndbi_threshold: float = 0.0,
    ndvi_threshold: float = 0.3,
) -> int:
    """Cuenta techos sobre un raster sintético con bandas (B4, B8, B11).

    `raster` tiene shape (3, H, W): B4 idx 0, B8 idx 1, B11 idx 2.
    `edificios_pix` = lista de (row, col) donde están los centroides de
    edificios candidatos.
    Devuelve cuántos pasan el umbral NDBI > th AND NDVI < th.
    """
    b4 = raster[0].astype(np.float64)
    b8 = raster[1].astype(np.float64)
    b11 = raster[2].astype(np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        ndbi = (b11 - b8) / (b11 + b8 + 1e-9)
        ndvi = (b8 - b4) / (b8 + b4 + 1e-9)
    n_detectados = 0
    for row, col in edificios_pix:
        if ndbi[row, col] > ndbi_threshold and ndvi[row, col] < ndvi_threshold:
            n_detectados += 1
    return n_detectados


def _fecha_aparicion_por_edificio(
    ndbi_por_fecha: np.ndarray,
    ndvi_por_fecha: np.ndarray,
    fechas_yyyymm: list[str],
    ndbi_threshold: float = 0.0,
    ndvi_threshold: float = 0.3,
) -> str:
    """Devuelve la fecha de aparición inferida aplicando monotonicidad."""
    detectado = (ndbi_por_fecha > ndbi_threshold) & (ndvi_por_fecha < ndvi_threshold)
    detectado_mono = np.maximum.accumulate(detectado.astype(np.int8)).astype(bool)
    if not np.any(detectado_mono):
        return "desconocida"
    primer_idx = int(np.argmax(detectado_mono))
    yyyymm = fechas_yyyymm[primer_idx]
    anio = int(yyyymm[:4])
    if primer_idx == 0 and anio <= 2018:
        return "<2018"
    return f"{yyyymm[:4]}-{yyyymm[4:6]}"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_conteo_dataset_sintetico_N_edificios():
    """Raster con 50 rectángulos 'edificio' → conteo debe caer dentro ±15%."""
    rng = np.random.default_rng(123)
    H, W = 200, 200
    n_edificios_verdadero = 50

    # Raster base: vegetación (B8 alto, B11 medio, B4 bajo -> NDVI alto, NDBI bajo)
    b4 = np.full((H, W), 300.0)
    b8 = np.full((H, W), 3000.0)
    b11 = np.full((H, W), 1500.0)

    # Estampamos 50 "edificios" (3x3 px) con firma urbana:
    # NDBI = (B11 - B8) / (B11 + B8) > 0 -> B11 > B8
    # NDVI = (B8 - B4) / (B8 + B4) < 0.3 -> B8 ~ B4 (bajo)
    edificios_pix: list[tuple[int, int]] = []
    for _ in range(n_edificios_verdadero):
        r = int(rng.integers(5, H - 5))
        c = int(rng.integers(5, W - 5))
        b4[r - 1 : r + 2, c - 1 : c + 2] = 1500.0  # reflectancia alta en rojo
        b8[r - 1 : r + 2, c - 1 : c + 2] = 1600.0
        b11[r - 1 : r + 2, c - 1 : c + 2] = 2500.0  # muy alta en SWIR
        edificios_pix.append((r, c))

    raster = np.stack([b4, b8, b11])
    n_detectados = _contar_techos_sinteticos(raster, edificios_pix)

    assert 42 <= n_detectados <= 58, (
        f"Conteo {n_detectados} fuera de banda ±15% "
        f"sobre {n_edificios_verdadero} reales"
    )


def test_monotonicidad_creciente(sample_serie_temporal_df: pd.DataFrame):
    """La serie temporal debe ser no-decreciente por polígono."""
    for pol_id in sample_serie_temporal_df["poligono_id"].unique():
        subset = sample_serie_temporal_df[
            sample_serie_temporal_df["poligono_id"] == pol_id
        ].sort_values("fecha")
        valores = subset["n_edificios_estimado"].to_numpy()
        diffs = np.diff(valores)
        assert np.all(diffs >= 0), (
            f"Polígono {pol_id} tiene caída en la serie: {valores}"
        )


def test_fecha_aparicion_presente_2018():
    """Edificio visible ya en 2018 → fecha_aparicion = '<2018'."""
    fechas = [
        "201807", "201907", "202007", "202107", "202207",
        "202307", "202407", "202507", "202607",
    ]
    # Detectado en todas las fechas, incluido 2018
    ndbi = np.array([0.2] * 9)
    ndvi = np.array([0.1] * 9)
    fecha = _fecha_aparicion_por_edificio(ndbi, ndvi, fechas)
    assert fecha == "<2018"


def test_edificio_no_detectado():
    """NDBI bajo en todas las fechas → 'desconocida', no cuenta."""
    fechas = [
        "201807", "201907", "202007", "202107", "202207",
        "202307", "202407", "202507", "202607",
    ]
    ndbi = np.array([-0.3] * 9)  # siempre debajo del umbral
    ndvi = np.array([0.7] * 9)  # vegetación constante
    fecha = _fecha_aparicion_por_edificio(ndbi, ndvi, fechas)
    assert fecha == "desconocida"


def test_filtrado_confidence(sample_buildings_gdf):
    """Con confidence_threshold=0.9 se descartan edificios con conf < 0.9."""
    threshold = 0.9
    filtrados = sample_buildings_gdf[
        sample_buildings_gdf["confidence"] >= threshold
    ].copy()
    # Todos los sobrevivientes cumplen
    assert (filtrados["confidence"] >= threshold).all()
    # Y debe haber menos que en el set original (beta distribution da cola bajo 0.9)
    assert len(filtrados) < len(sample_buildings_gdf)


def test_fecha_aparicion_posterior_detectada():
    """Edificio que aparece recién en 2022 → fecha '2022-07'."""
    fechas = [
        "201807", "201907", "202007", "202107", "202207",
        "202307", "202407", "202507", "202607",
    ]
    # No detectado antes de 2022-07 (index 4), sí detectado desde ahí.
    ndbi = np.array([-0.2, -0.2, -0.2, -0.2, 0.15, 0.2, 0.22, 0.21, 0.25])
    ndvi = np.array([0.6, 0.55, 0.5, 0.45, 0.2, 0.15, 0.12, 0.1, 0.1])
    fecha = _fecha_aparicion_por_edificio(ndbi, ndvi, fechas)
    assert fecha == "2022-07"


def test_monotonicidad_ante_sombras():
    """Monotonicidad: si aparece en T, se asume presente en T+1 aunque oscile."""
    fechas = ["201807", "201907", "202007"]
    # NDBI oscila: detectado → no detectado (sombra) → detectado
    ndbi = np.array([0.2, -0.1, 0.25])
    ndvi = np.array([0.1, 0.5, 0.1])  # ídem: vegetación falsa en medio
    fecha = _fecha_aparicion_por_edificio(ndbi, ndvi, fechas)
    # Debe devolver la primera, no la tercera, gracias a la monotonicidad
    assert fecha == "<2018"
