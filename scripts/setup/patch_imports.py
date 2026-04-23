"""Parcha los scripts ejecutables del proyecto para inyectar el root al sys.path.

Problema: los scripts usan `from scripts.utils.X import Y` pero al correrse
con `python scripts/test_ee_auth.py` Python no encuentra el paquete `scripts`
porque el root del proyecto no está en sys.path.

Solución: insertar al principio de cada script ejecutable un bloque que
suba buscando `pyproject.toml` y agrega ese directorio a sys.path.

Idempotente: si el archivo ya tiene el parche (detectado por el marcador
`_OBSERVATORIO_PATH_FIX`), no lo aplica de nuevo.

Uso:
    python scripts/setup/patch_imports.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MARCADOR = "_OBSERVATORIO_PATH_FIX"

PATCH = """\
# --- {marcador} (no borrar) -------------------------------------------------
# Aseguramos que el root del proyecto esté en sys.path para que los imports
# `from scripts.utils.X` funcionen al correr este archivo como script.
import sys as _sys
from pathlib import Path as _Path
_p = _Path(__file__).resolve().parent
while _p != _p.parent:
    if (_p / "pyproject.toml").exists():
        if str(_p) not in _sys.path:
            _sys.path.insert(0, str(_p))
        break
    _p = _p.parent
# --- fin del parche ---------------------------------------------------------

""".format(marcador=MARCADOR)

# Regex que matchea la primera línea que importa de `scripts.`
PATRON_IMPORT_SCRIPTS = re.compile(r"^(from scripts\.|import scripts\.)", re.MULTILINE)


def parchar(archivo: Path) -> str:
    """Aplica el parche si falta. Retorna 'patched', 'skipped' o 'no-match'."""
    texto = archivo.read_text(encoding="utf-8")
    if MARCADOR in texto:
        return "skipped"
    match = PATRON_IMPORT_SCRIPTS.search(texto)
    if not match:
        return "no-match"
    idx = match.start()
    nuevo_texto = texto[:idx] + PATCH + texto[idx:]
    archivo.write_text(nuevo_texto, encoding="utf-8")
    return "patched"


def main() -> int:
    raiz = Path(__file__).resolve().parent.parent.parent
    carpeta_scripts = raiz / "scripts"
    if not carpeta_scripts.exists():
        print(f"No encontré {carpeta_scripts}", file=sys.stderr)
        return 1

    archivos = sorted(carpeta_scripts.rglob("*.py"))
    # Excluimos los utils — se importan desde los ejecutables que ya tienen el parche.
    ejecutables = [a for a in archivos if "utils" not in a.parts and "setup" not in a.parts]

    resultados = {"patched": [], "skipped": [], "no-match": []}
    for a in ejecutables:
        estado = parchar(a)
        resultados[estado].append(a.relative_to(raiz))

    print(f"Parcheados: {len(resultados['patched'])}")
    for p in resultados["patched"]:
        print(f"  + {p}")
    print(f"Ya parcheados (skip): {len(resultados['skipped'])}")
    print(f"Sin imports de scripts (no-match): {len(resultados['no-match'])}")
    for p in resultados["no-match"]:
        print(f"  - {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
