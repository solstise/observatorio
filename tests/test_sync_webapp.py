"""Tests del script de sincronización con la webapp.

Verifican que `80_sync_webapp.py` tolere la ausencia de los CSVs base
(serie/poblacion/vulnerabilidad/servicios) que produce solo el yearly,
sin romper el monthly cron.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "80_sync_webapp.py"
POLIGONOS = REPO_ROOT / "config" / "poligonos.geojson"


def _run_sync(tmp_path: Path, **paths: str) -> subprocess.CompletedProcess:
    args = [sys.executable, str(SCRIPT)]
    args += ["--poligonos", paths.get("poligonos", str(POLIGONOS))]
    args += ["--serie", paths.get("serie", str(tmp_path / "missing_serie.csv"))]
    args += ["--poblacion", paths.get("poblacion", str(tmp_path / "missing_pob.csv"))]
    args += ["--servicios", paths.get("servicios", str(tmp_path / "missing_svc.csv"))]
    args += ["--vulnerabilidad", paths.get("vulnerabilidad", str(tmp_path / "missing_vuln.csv"))]
    args += ["--webapp-data", str(tmp_path / "webapp_data")]
    args += ["--webapp-media", str(tmp_path / "webapp_media")]
    return subprocess.run(args, capture_output=True, text=True, cwd=REPO_ROOT)


@pytest.mark.skipif(not POLIGONOS.exists(), reason="poligonos.geojson no presente")
def test_sync_tolera_csvs_faltantes(tmp_path: Path) -> None:
    """Si faltan los CSVs base, el sync no debe abortar — debe loguear warnings,
    saltar las transformaciones afectadas, y aún así emitir updated_at."""
    result = _run_sync(tmp_path)

    assert result.returncode == 0, (
        f"sync falló con stderr:\n{result.stderr[-2000:]}\nstdout:\n{result.stdout[-1000:]}"
    )
    # Mensajes de skip esperados.
    combined = result.stdout + result.stderr
    assert "no existe; salto" in combined or "NO regenerado" in combined
    # Debe haber producido el timestamp (señal de que llegó al final).
    updated = tmp_path / "webapp_data" / "updated_at.txt"
    assert updated.exists(), "updated_at.txt no fue escrito"


@pytest.mark.skipif(not POLIGONOS.exists(), reason="poligonos.geojson no presente")
def test_sync_no_sobrescribe_poligonos_si_falta_base(tmp_path: Path) -> None:
    """Si ya hay un poligonos.geojson previo en webapp/ y faltan los CSVs base,
    el sync debe dejarlo intacto."""
    dest = tmp_path / "webapp_data"
    dest.mkdir(parents=True)
    sentinela = {"_marker": "previa"}
    (dest / "poligonos.geojson").write_text(
        json.dumps(sentinela, ensure_ascii=False), encoding="utf-8"
    )

    result = _run_sync(tmp_path)
    assert result.returncode == 0, result.stderr[-2000:]

    contenido = json.loads((dest / "poligonos.geojson").read_text(encoding="utf-8"))
    assert contenido == sentinela, "poligonos.geojson previo fue sobrescrito sin datos base"
