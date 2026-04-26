"""
Publica forecast y alertas a Upstash Redis (REST API) para que el frontend
los pueda leer sin re-procesar CSVs en cada request.

Uso:
    python scripts/_publish_to_upstash.py
    python scripts/_publish_to_upstash.py --dry-run        # no envía nada, solo loguea
    python scripts/_publish_to_upstash.py --source path    # path alternativo a forecast/

Variables de entorno:
    UPSTASH_REDIS_REST_URL     URL del REST API (https://xxx.upstash.io)
    UPSTASH_REDIS_REST_TOKEN   Token Bearer del REST API

Diseño:
- Usamos exclusivamente el REST API de Upstash (HTTPS), no la conexión TCP de
  Redis. Razones: (1) GitHub Actions runners cachean TLS, (2) no necesitamos
  instalar `redis-py` en CI, (3) firewall del VPS no requiere abrir puerto.
- TTL fijo de 6h (21600 s) — coincide con el cron del workflow. Si el cron
  no corre en la próxima ventana, las claves expiran solas y el frontend cae
  al fallback (CSV local servido desde /data/).
- Las claves siguen el patrón `forecast:diario:<id>` y `alertas:activas`.
- Cuando el script detecta cambio, hace PUBLISH al canal `forecast:updates`
  para que el frontend (vía SSE) reciba el "ping" y re-fetchee.

Este script es idempotente: si Upstash no está configurado (env vacío),
imprime un warning y exitea limpio (no rompe el cron).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

# TTL de las claves en segundos — debe ser >= cadencia del cron, sino las
# claves expiran y el frontend ve "no data" entre corridas.
TTL_SECONDS = 21600  # 6h

# Canal de pub/sub que escucha el frontend vía SSE.
PUBSUB_CHANNEL = "forecast:updates"

# Timeout de cada request HTTP a Upstash. Generoso porque el runner gratuito
# de Upstash a veces tiene latencia >1s en cold start.
HTTP_TIMEOUT_S = 15.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("publish_to_upstash")


@dataclass(frozen=True)
class UpstashConfig:
    """Credenciales para el REST API de Upstash."""

    url: str
    token: str

    @classmethod
    def from_env(cls) -> "UpstashConfig | None":
        """Lee URL y TOKEN del entorno. Devuelve None si falta alguno."""
        url = os.environ.get("UPSTASH_REDIS_REST_URL", "").strip().rstrip("/")
        token = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
        if not url or not token:
            return None
        return cls(url=url, token=token)


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------


def _post_command(cfg: UpstashConfig, command: list[str | int]) -> dict[str, Any]:
    """Ejecuta un comando Redis vía REST API.

    El REST API de Upstash acepta el comando como una lista JSON en el body.
    Ej: ["SET", "key", "value", "EX", 21600]
    """
    body = json.dumps(command).encode("utf-8")
    req = urllib_request.Request(
        url=cfg.url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {cfg.token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib_request.urlopen(req, timeout=HTTP_TIMEOUT_S) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload) if payload else {}
    except urllib_error.HTTPError as e:
        # Reportamos el body del error para debugging (Upstash devuelve JSON
        # con el detalle).
        detail = e.read().decode("utf-8", errors="replace") if e.fp else str(e)
        log.error("HTTP %s ejecutando %s: %s", e.code, command[0], detail)
        raise
    except urllib_error.URLError as e:
        log.error("Network error ejecutando %s: %s", command[0], e)
        raise


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------


def publish_forecast(
    cfg: UpstashConfig,
    key: str,
    payload: dict[str, Any] | list[Any],
    ttl: int = TTL_SECONDS,
) -> None:
    """Guarda payload bajo `key` con TTL.

    Usa SET ... EX <ttl> para que la clave expire sola si el cron deja de
    correr. El payload se serializa como JSON compacto.
    """
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    result = _post_command(cfg, ["SET", key, raw, "EX", ttl])
    log.info("SET %s (%d bytes, ttl=%ds) → %s", key, len(raw), ttl, result.get("result"))


def notify_subscribers(cfg: UpstashConfig, channel: str, message: str) -> None:
    """Notifica a los suscriptores SSE del frontend.

    El frontend mantiene una conexión SSE a /api/forecast/stream que a su
    vez hace polling al endpoint REST `GET <channel>` o usa el comando
    PUBSUB. En la práctica, como Upstash REST no soporta SUBSCRIBE de larga
    duración, el frontend hace polling cada N segundos a una clave separada
    `forecast:lastUpdate` que actualizamos acá. Es un patrón conocido como
    "fan-out via TTL" y funciona bien con free-tier.
    """
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    # Tres operaciones: PUBLISH (clientes con conexión TCP nativa, si los hay),
    # SET de la última actualización (para SSE polling), y log.
    _post_command(cfg, ["PUBLISH", channel, message])
    _post_command(
        cfg,
        ["SET", "forecast:lastUpdate", timestamp, "EX", TTL_SECONDS],
    )
    log.info("PUBLISH %s '%s' (lastUpdate=%s)", channel, message, timestamp)


# ---------------------------------------------------------------------------
# Discovery de archivos a publicar
# ---------------------------------------------------------------------------


def discover_payloads(source_dir: Path) -> dict[str, Any]:
    """Escanea el directorio `forecast/` y devuelve mapping clave→payload.

    Convención:
        forecast/<id>.json              → key `forecast:diario:<id>`
        forecast/_resumen.json          → key `forecast:diario:posadas_completa`
        forecast/_metadata.json         → key `forecast:metadata` (no `:diario`)
        forecast/alertas_activas.json   → key `alertas:activas`
        alertas/activas.json            → key `alertas:activas` (legado)

    Si el archivo no existe, no se incluye. Esto permite correr el cron antes
    de que L1 termine sus scripts sin que falle la publicación.
    """
    payloads: dict[str, Any] = {}

    # Stems "especiales" que NO son barrios — se mapean a claves dedicadas
    # en lugar de `forecast:diario:<stem>`.
    SPECIAL_KEYS: dict[str, str] = {
        "_metadata": "forecast:metadata",
        "metadata": "forecast:metadata",
        "_resumen": "forecast:diario:posadas_completa",
        "resumen": "forecast:diario:posadas_completa",
        "posadas_completa": "forecast:diario:posadas_completa",
        "alertas_activas": "alertas:activas",
    }

    forecast_dir = source_dir
    if forecast_dir.exists():
        for path in sorted(forecast_dir.glob("*.json")):
            stem = path.stem
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                log.warning("JSON inválido en %s: %s", path, exc)
                continue
            target_key = SPECIAL_KEYS.get(stem, f"forecast:diario:{stem}")
            payloads[target_key] = data

    # Alertas activas también pueden vivir en sibling dir `alertas/`
    # (convención antigua). Si hay archivo, sobre-escribe el de forecast/.
    alertas_path = source_dir.parent / "alertas" / "activas.json"
    if alertas_path.exists():
        try:
            payloads["alertas:activas"] = json.loads(
                alertas_path.read_text(encoding="utf-8"),
            )
        except json.JSONDecodeError as exc:
            log.warning("JSON inválido en %s: %s", alertas_path, exc)

    return payloads


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No envía nada a Upstash, solo loguea lo que enviaría.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("webapp/frontend/public/data/forecast"),
        help="Directorio con los JSON de forecast (default: webapp/frontend/public/data/forecast)",
    )
    parser.add_argument(
        "--key",
        type=str,
        default=None,
        help="Si se especifica, publica solo esta clave (debug).",
    )
    args = parser.parse_args(argv)

    cfg = UpstashConfig.from_env()
    if cfg is None and not args.dry_run:
        log.warning(
            "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN no seteados. "
            "Saltando publicación (no es un error fatal).",
        )
        return 0

    payloads = discover_payloads(args.source)
    if not payloads:
        log.warning(
            "No encontré archivos JSON para publicar en %s. "
            "Esto es normal si los scripts L1 (57/58) todavía no corrieron.",
            args.source,
        )
        return 0

    if args.key:
        payloads = {k: v for k, v in payloads.items() if k == args.key}
        if not payloads:
            log.error("La clave --key=%s no se encontró entre los payloads.", args.key)
            return 2

    log.info("Listo para publicar %d clave(s):", len(payloads))
    for key in payloads:
        log.info("  - %s", key)

    if args.dry_run:
        log.info("DRY-RUN: no se envió nada a Upstash.")
        return 0

    # mypy: cfg ya está validado arriba (no es None cuando llegamos acá fuera de dry-run).
    assert cfg is not None
    failures = 0
    for key, payload in payloads.items():
        try:
            publish_forecast(cfg, key, payload)
        except (urllib_error.HTTPError, urllib_error.URLError):
            failures += 1

    if failures == 0:
        try:
            notify_subscribers(cfg, PUBSUB_CHANNEL, f"refreshed:{int(time.time())}")
        except (urllib_error.HTTPError, urllib_error.URLError):
            log.error("notify_subscribers falló pero los SET ya pasaron.")
            failures += 1

    if failures > 0:
        log.error("%d operación(es) Upstash fallaron", failures)
        return 1

    log.info("Publicación completa.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
