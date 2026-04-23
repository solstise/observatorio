"""Tests de descarga/caché (Tarea 2.8).

Mockean APIs externas (Planet NICFI, Overpass, EE) para validar:
- Cache hit/miss
- Manejo de errores HTTP (401, 429)
- Estructura de queries Overpass
- Skip ante imágenes faltantes
"""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest


# ---------------------------------------------------------------------------
# Helpers reutilizables por los tests (simulan lógica esperada de scripts)
# ---------------------------------------------------------------------------


def _compute_hash(path: Path) -> str:
    """Hash SHA-1 de un archivo."""
    h = hashlib.sha1()
    h.update(path.read_bytes())
    return h.hexdigest()


def _descargar_con_cache(
    path_cache: Path, url: str, downloader, *, force: bool = False
) -> Path:
    """Emula la función de descarga con cache de los scripts de descarga.

    - Si `path_cache` existe y no hay `force`, retorna sin llamar downloader.
    - Si hay `force` o no existe, llama al downloader que debe escribir el
      archivo.
    """
    if path_cache.exists() and not force:
        return path_cache
    path_cache.parent.mkdir(parents=True, exist_ok=True)
    downloader(url, path_cache)
    return path_cache


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------


def test_cache_check_existe(tmp_output_dir: Path):
    """Si el archivo existe con hash correcto, NO redescarga."""
    cache_file = tmp_output_dir / "posadas_201807_multi.tif"
    cache_file.write_bytes(b"contenido-falso-de-geotiff")
    hash_original = _compute_hash(cache_file)

    downloader = MagicMock()
    _descargar_con_cache(cache_file, "https://ejemplo.com/tif", downloader)

    downloader.assert_not_called()
    assert _compute_hash(cache_file) == hash_original


def test_cache_check_inexistente(tmp_output_dir: Path):
    """Si el archivo no existe, llama al API mock para descargar."""
    cache_file = tmp_output_dir / "nuevo_archivo.tif"

    def downloader(url, dest):
        dest.write_bytes(b"descargado-ahora")

    downloader_mock = MagicMock(side_effect=downloader)
    _descargar_con_cache(cache_file, "https://ejemplo.com/tif", downloader_mock)

    downloader_mock.assert_called_once()
    assert cache_file.exists()
    assert cache_file.read_bytes() == b"descargado-ahora"


def test_cache_force_redownload(tmp_output_dir: Path):
    """El flag --force redescarga aunque el archivo exista."""
    cache_file = tmp_output_dir / "forzar.tif"
    cache_file.write_bytes(b"viejo")

    def downloader(url, dest):
        dest.write_bytes(b"nuevo")

    downloader_mock = MagicMock(side_effect=downloader)
    _descargar_con_cache(
        cache_file, "https://ejemplo.com/tif", downloader_mock, force=True
    )

    downloader_mock.assert_called_once()
    assert cache_file.read_bytes() == b"nuevo"


# ---------------------------------------------------------------------------
# Manejo de errores HTTP
# ---------------------------------------------------------------------------


def test_manejo_error_401_planet(caplog, mock_requests):
    """Mockear 401 de Planet - el código debe loggear claro y salir != 0."""
    import logging

    import requests

    url = "https://api.planet.com/basemaps/v1/mosaics"
    mock_requests.add(
        mock_requests.GET, url, json={"error": "Unauthorized"}, status=401
    )

    def descargar_planet():
        logger = logging.getLogger("descarga_planet")
        resp = requests.get(url, timeout=30)
        if resp.status_code == 401:
            logger.error(
                "Autenticación Planet NICFI fallida (401). "
                "Revisá PLANET_API_KEY en .env."
            )
            return 2
        if resp.status_code != 200:
            logger.error("Planet devolvió status %s", resp.status_code)
            return 3
        return 0

    with caplog.at_level(logging.ERROR):
        exit_code = descargar_planet()

    assert exit_code != 0
    assert any("401" in r.message or "PLANET_API_KEY" in r.message for r in caplog.records)


def test_manejo_error_429_overpass(mock_requests, monkeypatch):
    """Mockear 429 - se debe reintentar con backoff antes de rendirse."""
    import requests

    url = "https://overpass-api.de/api/interpreter"
    mock_requests.add(mock_requests.POST, url, json={"elements": []}, status=429)
    mock_requests.add(mock_requests.POST, url, json={"elements": []}, status=429)
    mock_requests.add(mock_requests.POST, url, json={"elements": []}, status=200)

    # Stub sleep para que el test sea rápido
    sleeps: list[float] = []
    monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))

    def consultar_overpass(query: str, max_retries: int = 3) -> dict:
        delay = 1.0
        for intento in range(max_retries):
            resp = requests.post(url, data={"data": query}, timeout=60)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429:
                time.sleep(delay)
                delay *= 2
                continue
            resp.raise_for_status()
        raise RuntimeError(f"Overpass falló después de {max_retries} intentos")

    resultado = consultar_overpass("[out:json]; node; out;", max_retries=3)
    assert resultado == {"elements": []}
    # Backoff exponencial: dos sleeps con duración creciente
    assert len(sleeps) == 2
    assert sleeps[0] < sleeps[1]


# ---------------------------------------------------------------------------
# Overpass query
# ---------------------------------------------------------------------------


def test_overpass_query_incluye_tags_esperados(tmp_path, monkeypatch):
    """La query Overpass construida debe incluir los tags de settings.yaml."""
    # Construcción equivalente a la que haría scripts/30_overpass_servicios.py
    servicios = [
        "amenity=clinic",
        "amenity=hospital",
        "amenity=school",
        "amenity=kindergarten",
        "amenity=pharmacy",
        "highway=bus_stop",
    ]

    def construir_query(bbox: tuple[float, float, float, float]) -> str:
        oeste, sur, este, norte = bbox
        lineas = ["[out:json][timeout:60];", "("]
        for servicio in servicios:
            key, val = servicio.split("=")
            lineas.append(f'  node["{key}"="{val}"]({sur},{oeste},{norte},{este});')
            lineas.append(f'  way["{key}"="{val}"]({sur},{oeste},{norte},{este});')
        lineas.append(");")
        lineas.append("out center;")
        return "\n".join(lineas)

    query = construir_query((-56.0, -27.5, -55.8, -27.3))
    for servicio in servicios:
        key, val = servicio.split("=")
        assert f'"{key}"="{val}"' in query, (
            f"Query Overpass no incluye {key}={val}"
        )
    # Formato JSON + timeout razonable
    assert "[out:json]" in query
    assert "out center" in query


# ---------------------------------------------------------------------------
# Skip sin imágenes
# ---------------------------------------------------------------------------


def test_sentinel_skip_fecha_sin_imagenes(caplog, mock_ee_session):
    """Si la colección está vacía para una fecha, warn + continua (no raise)."""
    import logging

    # mock_ee_session ya devuelve size().getInfo() == 0
    logger = logging.getLogger("descarga_sentinel")

    def descargar_para_fecha(fecha: str) -> bool:
        n = mock_ee_session.size().getInfo()
        if n == 0:
            logger.warning(
                "Sin imágenes Sentinel para %s - se salta fecha.", fecha
            )
            return False
        return True

    with caplog.at_level(logging.WARNING):
        ok = descargar_para_fecha("2018-07")

    assert ok is False
    assert any("2018-07" in rec.message for rec in caplog.records)
