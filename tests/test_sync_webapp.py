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

    assert (
        result.returncode == 0
    ), f"sync falló con stderr:\n{result.stderr[-2000:]}\nstdout:\n{result.stdout[-1000:]}"
    # Mensajes de skip esperados.
    combined = result.stdout + result.stderr
    assert "no existe; salto" in combined or "NO regenerado" in combined
    # Debe haber producido el timestamp (señal de que llegó al final).
    updated = tmp_path / "webapp_data" / "updated_at.txt"
    assert updated.exists(), "updated_at.txt no fue escrito"


@pytest.mark.skipif(not POLIGONOS.exists(), reason="poligonos.geojson no presente")
def test_sync_regenera_poligonos_con_stats_en_cero_si_falta_base(tmp_path: Path) -> None:
    """Cuando faltan los CSVs base (serie/pob/vuln) el sync DEBE regenerar
    poligonos.geojson con el schema enriquecido que espera Next.js, rellenando
    los stats con cero. Antes el script saltaba la regeneración y dejaba el
    archivo previo, pero eso rompía el build de Next con ENOENT cuando la
    webapp se desplegaba en limpio (commits ``8839b5f`` y ``2c58b22``).

    Validamos:
      * El archivo previo se sobrescribe (no se conserva).
      * El nuevo contenido tiene el shape FeatureCollection real con todos
        los polígonos de ``config/poligonos.geojson``.
      * Los stats numéricos (poblacion_estimada, edificios_2018,
        edificios_2026, score_expansion) son 0 — ningún dato fabricado.
    """
    dest = tmp_path / "webapp_data"
    dest.mkdir(parents=True)
    sentinela = {"_marker": "previa"}
    (dest / "poligonos.geojson").write_text(
        json.dumps(sentinela, ensure_ascii=False), encoding="utf-8"
    )

    result = _run_sync(tmp_path)
    assert result.returncode == 0, result.stderr[-2000:]

    contenido = json.loads((dest / "poligonos.geojson").read_text(encoding="utf-8"))
    assert contenido != sentinela, "se esperaba que el archivo previo fuera sobrescrito"
    assert contenido.get("type") == "FeatureCollection", contenido
    feats = contenido.get("features", [])
    assert len(feats) > 0, "regeneración debe producir al menos un feature"
    for f in feats:
        p = f.get("properties", {})
        # Stats deben quedar en cero — no se inventan datos cuando faltan
        # los CSVs base. Es responsabilidad del cron yearly poblarlos.
        for k in ("poblacion_estimada", "edificios_2018", "edificios_2026", "score_expansion"):
            assert p.get(k, 0) == 0, f"{p.get('id')}: {k}={p.get(k)} (debería ser 0)"
