"""Inicialización de Earth Engine compatible con local (OAuth) y CI (service account).

Patrón:
    En CI, el workflow setea `EE_SERVICE_ACCOUNT_KEY` apuntando al JSON del SA.
    Localmente, el dev típicamente corre `earthengine authenticate` (OAuth) y
    no setea la env var.

Esta función centraliza la lógica para no duplicarla en cada script:

    from scripts.utils.ee_auth import inicializar_ee_seguro
    inicializar_ee_seguro(project_id="observatorio-posadas")
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


def inicializar_ee_seguro(project_id: Optional[str] = None) -> None:
    """Inicializa Earth Engine usando service account si está disponible.

    Orden de preferencia:
    1. `EE_SERVICE_ACCOUNT_KEY` apuntando a JSON válido → ServiceAccountCredentials.
    2. `project_id` provisto → ee.Initialize(project=project_id) usando ADC.
    3. Default ADC sin proyecto.

    Args:
        project_id: Cloud project ID. Solo se usa en path 2 y 3.

    Raises:
        Exception: si todos los paths fallan.
    """
    import ee

    sa_key = os.environ.get("EE_SERVICE_ACCOUNT_KEY")
    if sa_key and Path(sa_key).exists():
        # En CI: usamos el SA. ServiceAccountCredentials(None, key_path) lee
        # client_email del propio JSON.
        credentials = ee.ServiceAccountCredentials(None, sa_key)
        ee.Initialize(credentials)
        return

    # Local dev: ADC (OAuth flow del usuario).
    if project_id:
        ee.Initialize(project=project_id)
    else:
        ee.Initialize()
