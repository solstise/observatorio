"""Rate limiting para la API del Observatorio Urbano Posadas.

Usa slowapi con almacenamiento en memoria por defecto. Para produccion
se puede configurar Redis mediante la variable de entorno REDIS_URL.

Reglas:
- Requests publicas: RATE_LIMIT_PUBLIC (default 100/minute).
- Requests con header X-API-Key valido: RATE_LIMIT_AUTHED (default 600/minute).
"""

from __future__ import annotations

import os

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


PUBLIC_LIMIT = os.getenv("RATE_LIMIT_PUBLIC", "100/minute")
AUTHED_LIMIT = os.getenv("RATE_LIMIT_AUTHED", "600/minute")
API_KEY = os.getenv("API_KEY") or None
REDIS_URL = os.getenv("REDIS_URL") or None


def key_func(request: Request) -> str:
    """Key por IP; si viene API key valida se prefijea para aumentar quota."""
    ip = get_remote_address(request)
    api_key = request.headers.get("X-API-Key")
    if API_KEY and api_key == API_KEY:
        return f"authed:{ip}"
    return f"public:{ip}"


def dynamic_limit(_: Request) -> str:
    """Devuelve el limite segun el prefijo de la key."""
    # slowapi llama a esta funcion con el mismo request que key_func.
    # Nos apoyamos en que el prefijo de la key se define arriba.
    # Slowapi evalua limite por string ("100/minute"), no por callable.
    # Por eso usamos dos limites explicitos con @limiter.limit en main.py.
    return PUBLIC_LIMIT


def build_limiter() -> Limiter:
    """Construye el Limiter con backend en memoria (default) o Redis."""
    storage_uri = REDIS_URL if REDIS_URL else "memory://"
    return Limiter(key_func=key_func, storage_uri=storage_uri)


def is_authed(request: Request) -> bool:
    """True si el request trae una API key valida."""
    if not API_KEY:
        return False
    return request.headers.get("X-API-Key") == API_KEY
