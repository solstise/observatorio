"""Tests de los endpoints del backend.

Se usan fakes en lugar de archivos reales. El data loader real se monkey-patchea
para que cada test controle exactamente lo que expone la API.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

import data_loader  # noqa: E402
import main  # noqa: E402


# Dataset minimo reutilizable entre tests.
FAKE_COLLECTION: dict[str, Any] = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {
                "id": "itaembe_mini",
                "nombre": "Itaembe Mini",
                "categoria": "expansion_activa",
                "score_expansion": 0.82,
                "superficie_km2": 4.2,
                "poblacion_estimada": 12450,
                "edificios_2018": 1820,
                "edificios_2026": 3140,
                "_synthetic": True,
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[-55.95, -27.4], [-55.93, -27.4], [-55.93, -27.38], [-55.95, -27.38], [-55.95, -27.4]]],
            },
        }
    ],
    "_synthetic": True,
}

FAKE_SERIE: list[dict[str, Any]] = [
    {
        "poligono_id": "itaembe_mini",
        "anio": 2018,
        "superficie_construida_km2": 0.82,
        "superficie_vegetacion_km2": 2.10,
        "edificios_total": 1820,
        "confianza_inferior": 0.76,
        "confianza_superior": 0.88,
    },
    {
        "poligono_id": "itaembe_mini",
        "anio": 2026,
        "superficie_construida_km2": 1.92,
        "superficie_vegetacion_km2": 1.34,
        "edificios_total": 3140,
        "confianza_inferior": 1.86,
        "confianza_superior": 1.98,
    },
]

FAKE_POBLACION: list[dict[str, Any]] = [
    {
        "poligono_id": "itaembe_mini",
        "anio": 2026,
        "poblacion_estimada": 12450,
        "densidad_hab_km2": 2964.0,
        "confianza_inferior": 11450.0,
        "confianza_superior": 13450.0,
    }
]

FAKE_SERVICIOS: list[dict[str, Any]] = [
    {
        "poligono_id": "itaembe_mini",
        "servicio": "agua_red",
        "cobertura_pct": 62.0,
        "fuente": "IPRODHA_ficha_publica",
        "anio_referencia": 2024,
    }
]

FAKE_VULN: list[dict[str, Any]] = [
    {
        "poligono_id": "itaembe_mini",
        "indice_vulnerabilidad": 0.62,
        "carencia_servicios": 0.58,
        "riesgo_inundacion": 0.41,
        "accesibilidad_salud": 0.48,
        "accesibilidad_educacion": 0.52,
        "confianza_inferior": 0.55,
        "confianza_superior": 0.69,
    }
]


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Cliente de test con data loader mockeado."""
    monkeypatch.setattr(data_loader, "load_poligonos", lambda: FAKE_COLLECTION)
    monkeypatch.setattr(
        data_loader,
        "find_poligono",
        lambda pid: next(
            (f for f in FAKE_COLLECTION["features"] if f["properties"]["id"] == pid),
            None,
        ),
    )
    monkeypatch.setattr(
        data_loader,
        "load_serie_temporal",
        lambda pid=None: [r for r in FAKE_SERIE if pid is None or r["poligono_id"] == pid],
    )
    monkeypatch.setattr(
        data_loader,
        "load_poblacion",
        lambda pid=None: [r for r in FAKE_POBLACION if pid is None or r["poligono_id"] == pid],
    )
    monkeypatch.setattr(
        data_loader,
        "load_servicios",
        lambda pid=None: [r for r in FAKE_SERVICIOS if pid is None or r["poligono_id"] == pid],
    )
    monkeypatch.setattr(
        data_loader,
        "load_vulnerabilidad",
        lambda pid=None: [r for r in FAKE_VULN if pid is None or r["poligono_id"] == pid],
    )
    return TestClient(main.app)


def test_salud_ok(client: TestClient) -> None:
    """El health check devuelve 200 y status ok con datos mockeados."""
    resp = client.get("/api/salud")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["poligonos_disponibles"] == 1


def test_version(client: TestClient) -> None:
    """/api/version incluye version, fecha y fuentes."""
    resp = client.get("/api/version")
    assert resp.status_code == 200
    body = resp.json()
    assert "version" in body
    assert "fecha_build" in body
    assert "Sentinel-2 (ESA)" in body["fuentes"]


def test_list_poligonos(client: TestClient) -> None:
    """Listado resumido incluye los campos requeridos."""
    resp = client.get("/api/poligonos")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list) and len(body) == 1
    item = body[0]
    assert item["id"] == "itaembe_mini"
    assert item["reporte_pdf_url"].endswith("/reporte.pdf")
    assert 0 <= item["score_expansion"] <= 1


def test_detalle_poligono(client: TestClient) -> None:
    """Detalle combina propiedades + serie + poblacion + servicios + vulnerabilidad."""
    resp = client.get("/api/poligonos/itaembe_mini")
    assert resp.status_code == 200
    body = resp.json()
    assert body["properties"]["nombre"] == "Itaembe Mini"
    assert body["serie_temporal"][0]["anio"] == 2018
    assert body["poblacion"][0]["anio"] == 2026
    assert body["servicios"][0]["servicio"] == "agua_red"
    assert body["vulnerabilidad"]["indice_vulnerabilidad"] == pytest.approx(0.62)


def test_poligono_inexistente_404(client: TestClient) -> None:
    """Un id desconocido devuelve 404 con mensaje claro."""
    resp = client.get("/api/poligonos/no_existe")
    assert resp.status_code == 404
    assert "no_existe" in resp.json()["detail"]


def test_reporte_pdf_404_sin_archivo(client: TestClient) -> None:
    """Si el PDF no esta generado, devuelve 404 y no revienta."""
    resp = client.get("/api/poligonos/itaembe_mini/reporte.pdf")
    assert resp.status_code == 404


def test_imagen_valida_formato_fecha(client: TestClient) -> None:
    """El parametro fecha debe cumplir el patron YYYY-MM."""
    resp = client.get("/api/poligonos/itaembe_mini/imagen", params={"fecha": "mal"})
    assert resp.status_code == 422


def test_salud_degraded_sin_datos(monkeypatch: pytest.MonkeyPatch) -> None:
    """Si no hay datos disponibles, /api/salud responde degraded sin romper."""

    def _raise() -> dict[str, Any]:
        raise data_loader.DataNotAvailableError("faltan datos")

    monkeypatch.setattr(data_loader, "load_poligonos", _raise)
    client = TestClient(main.app)
    resp = client.get("/api/salud")
    assert resp.status_code == 200
    assert resp.json()["status"] == "degraded"
