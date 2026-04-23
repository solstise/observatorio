"""Configuracion comun de pytest para el backend.

Asegura que el directorio del backend este en sys.path para que los modulos
`main`, `data_loader`, `models` y `rate_limit` sean importables cuando pytest
se ejecuta desde la raiz del proyecto o desde webapp/backend/.
"""

from __future__ import annotations

import sys
from pathlib import Path


_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))
