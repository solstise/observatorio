"""Caminos del agua (script 68) sobre relieves sintéticos con resultado conocido, sin red."""

import importlib.util
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "terreno", ROOT / "scripts/68_anegamientos_terreno.py"
)
terreno = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terreno)


def _valle(alto=9, ancho=7):
    """Valle en V que baja hacia el sur: el cauce es la columna del medio."""
    filas = np.arange(alto)[:, None]
    columnas = np.abs(np.arange(ancho) - ancho // 2)[None, :]
    return 100.0 - filas + 2.0 * columnas


def test_el_agua_baja_por_el_fondo_del_valle():
    z = _valle()
    lleno = terreno.rellenar(z)
    aporte = terreno.aporte_ha(lleno, terreno.direcciones(lleno))
    medio = z.shape[1] // 2
    # El fondo del valle junta más agua cuanto más abajo, y más que cualquier ladera.
    assert np.all(np.diff(aporte[1:-1, medio]) > 0)
    assert aporte[-2, medio] == aporte[-2].max()
    # Cada celda aporta 30 m x 30 m = 0,09 ha.
    assert aporte.min() == terreno.PIXEL**2 / 1e4


def test_un_pozo_se_rellena_hasta_su_borde():
    z = _valle()
    z[4, 3] = 90.0  # pozo de 6 m dentro del cauce (el borde de salida está a 95 m)
    lleno = terreno.rellenar(z)
    assert 95.0 <= lleno[4, 3] < 95.01
    # Rellenado, el pozo ya no corta el camino: el agua sigue valle abajo.
    aporte = terreno.aporte_ha(lleno, terreno.direcciones(lleno))
    assert aporte[-2, 3] > aporte[5, 3] > aporte[3, 3]


def test_sin_dato_no_recibe_agua():
    z = _valle()
    z[0, 0] = np.nan
    lleno = terreno.rellenar(z)
    assert np.isnan(lleno[0, 0])
    destino = terreno.direcciones(lleno)
    assert 0 not in destino
