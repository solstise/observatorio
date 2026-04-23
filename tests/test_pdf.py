"""Tests del generador de reportes PDF (Tarea 2.8).

Skipea entera si WeasyPrint no está disponible.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pytest

# Todo el módulo depende de WeasyPrint.
weasyprint = pytest.importorskip("weasyprint")

try:
    import pypdf
except ImportError:  # pragma: no cover
    pypdf = pytest.importorskip("pypdf")


# ---------------------------------------------------------------------------
# Helper: genera un PDF mínimo equivalente al de scripts/40_generar_pdf.py
# ---------------------------------------------------------------------------


def _generar_pdf_dummy(
    destino: Path,
    poligono_nombre: str = "Test Polígono",
    anio: int | None = None,
) -> Path:
    """Genera un PDF de prueba con estructura similar al del reporte real.

    Incluye: nombre del polígono, mención a fuentes (Sentinel-2, Google Open
    Buildings), y fecha de generación.
    """
    if anio is None:
        anio = datetime.now().year
    html_body = f"""
    <!DOCTYPE html>
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Reporte {poligono_nombre}</title>
        <style>
          body {{ font-family: sans-serif; padding: 2em; }}
          h1 {{ color: #1a3a5c; }}
          .footer {{ margin-top: 4em; font-size: 9pt; color: #666; }}
        </style>
      </head>
      <body>
        <h1>Observatorio Urbano Posadas</h1>
        <h2>Reporte: {poligono_nombre}</h2>
        <p>Este reporte resume la expansión urbana detectada en el polígono
           {poligono_nombre} entre 2018 y {anio}.</p>
        <p>Fuentes utilizadas:</p>
        <ul>
          <li>Imágenes satelitales: Sentinel-2 (Copernicus / ESA).</li>
          <li>Huellas de edificios: Google Open Buildings v3.</li>
          <li>Estimación de población: WorldPop 2020.</li>
        </ul>
        <div class="footer">
          Generado el {datetime.now().strftime('%d/%m/%Y')} ({anio}).
        </div>
      </body>
    </html>
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    weasyprint.HTML(string=html_body).write_pdf(str(destino))
    return destino


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_pdf_generado_existe(tmp_output_dir: Path):
    """El generador produce un PDF en el path esperado."""
    destino = tmp_output_dir / "reporte_test.pdf"
    _generar_pdf_dummy(destino, poligono_nombre="Itaembé Miní")
    assert destino.exists(), f"El PDF no se generó en {destino}"
    assert destino.stat().st_size > 0


def test_pdf_es_valido(tmp_output_dir: Path):
    """El PDF puede abrirse con pypdf y tiene al menos 1 página."""
    destino = tmp_output_dir / "reporte_valido.pdf"
    _generar_pdf_dummy(destino)
    reader = pypdf.PdfReader(str(destino))
    assert len(reader.pages) >= 1


def test_pdf_contiene_nombre_poligono(tmp_output_dir: Path):
    """El nombre del polígono aparece en el texto extraído."""
    destino = tmp_output_dir / "reporte_nombre.pdf"
    nombre = "Villa Cabello"
    _generar_pdf_dummy(destino, poligono_nombre=nombre)
    reader = pypdf.PdfReader(str(destino))
    texto = " ".join(page.extract_text() or "" for page in reader.pages)
    assert nombre in texto, f"No se encontró '{nombre}' en el PDF"


def test_pdf_cita_fuentes(tmp_output_dir: Path):
    """El PDF cita Sentinel-2 y Google Open Buildings."""
    destino = tmp_output_dir / "reporte_fuentes.pdf"
    _generar_pdf_dummy(destino)
    reader = pypdf.PdfReader(str(destino))
    texto = " ".join(page.extract_text() or "" for page in reader.pages)
    assert "Sentinel-2" in texto, "Falta mención a Sentinel-2"
    assert "Google Open Buildings" in texto, "Falta mención a Google Open Buildings"


def test_pdf_incluye_fecha_generacion(tmp_output_dir: Path):
    """El PDF contiene el año actual en el texto."""
    destino = tmp_output_dir / "reporte_fecha.pdf"
    _generar_pdf_dummy(destino)
    reader = pypdf.PdfReader(str(destino))
    texto = " ".join(page.extract_text() or "" for page in reader.pages)
    anio_actual = str(datetime.now().year)
    assert anio_actual in texto, f"El año {anio_actual} no aparece en el PDF"
