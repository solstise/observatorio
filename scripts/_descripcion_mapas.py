"""
Genera descripciones automáticas (caption) para los mapas PNG estáticos del
observatorio, usando la Inference API de Hugging Face.

Para cada PNG en:
    data/processed/calor/mapas/                      (104 mapas LST/UHI)
    data/processed/timelapses/*_comparacion.png       (43 antes/después)

Llama al endpoint:
    https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-base

Y, si el caption viene en inglés, lo traduce con NLLB-200 distilled (en →
spa_Latn). El output se guarda en:
    data/processed/calor/mapas_descripciones.json

Estructura del JSON:
    {
      "lst_2024_verano.png": {
        "source": "calor/mapas",
        "caption_en": "...",
        "caption_es": "...",
        "generated_at": "ISO timestamp",
        "method": "hf-blip" | "placeholder"
      },
      ...
    }

Uso:
    python scripts/_descripcion_mapas.py
    python scripts/_descripcion_mapas.py --dry-run       # no llama HF, sólo lista
    python scripts/_descripcion_mapas.py --force         # re-procesa incluso si ya existe

Variables de entorno:
    HF_TOKEN            Token de Hugging Face (gratis en huggingface.co/settings/tokens)

Sin token configurado, el script genera descripciones placeholder a partir
del filename (parsing por convención del pipeline). Idempotente: si el JSON
ya tiene una entrada para un PNG, no la recalcula salvo --force.

Rate limits:
    HF free tier: 60 req/min. Para 104 + 43 = ~147 mapas tarda ~3 min.

Diseño:
- urllib stdlib only para las llamadas HTTP — evitamos la dep de requests
  para que el script sea ejecutable en el venv mínimo del observatorio.
- Backoff exponencial cuando HF responde 503 ("modelo cargando"), que es
  común en el primer hit a un endpoint no warmeado. Hasta 4 reintentos
  espaciados 6/12/24/48 s.
- Logging estilo loguru para mantener consistencia con el resto del pipeline.
"""

from __future__ import annotations

# --- _OBSERVATORIO_PATH_FIX (no borrar) -------------------------------------
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

import argparse
import base64
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib import error as urllib_error
from urllib import request as urllib_request

# loguru no es estrictamente necesario — fallback a logging stdlib si falta.
try:
    from loguru import logger
except Exception:  # pragma: no cover
    import logging

    logger = logging.getLogger("descripcion_mapas")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


HF_API = "https://api-inference.huggingface.co/models/{model}"
BLIP_MODEL = "Salesforce/blip-image-captioning-base"
NLLB_MODEL = "facebook/nllb-200-distilled-600M"

ROOT = _Path(__file__).resolve().parents[1]
CALOR_MAPAS_DIR = ROOT / "data" / "processed" / "calor" / "mapas"
TIMELAPSES_DIR = ROOT / "data" / "processed" / "timelapses"
OUTPUT_JSON = ROOT / "data" / "processed" / "calor" / "mapas_descripciones.json"
# Espejo público que sirve el frontend. Lo escribimos en cada corrida — el
# script 80_sync_webapp.py no necesita conocerlo. Si no querés exponer el
# JSON en producción, comentar PUBLIC_OUTPUT_JSON.
PUBLIC_OUTPUT_JSON = (
    ROOT / "webapp" / "frontend" / "public" / "data" / "calor" / "mapas_descripciones.json"
)

# Rate limit suave: HF free tier es 60 req/min para inferencia; el modelo
# de translación puede ser más lento. Con sleep 0.4s entre llamadas
# (~2.5 req/s sostenido) nos quedamos bien por debajo.
SLEEP_BETWEEN_REQUESTS_S = 0.4

# Backoff cuando HF nos contesta 503 "model loading". El primer hit a un
# modelo "cold" tarda 20-40s en cargar.
RETRY_DELAYS_S = [6, 12, 24, 48]

# Mapa estación → adjetivo, para los placeholders.
ESTACION_LABEL = {
    "verano": "verano",
    "otono": "otoño",
    "invierno": "invierno",
    "primavera": "primavera",
}


# ----------------------------------------------------------------------------
# Captioning vía HF Inference API
# ----------------------------------------------------------------------------


def _http_post(url: str, *, headers: Dict[str, str], body: bytes, timeout: int = 60) -> bytes:
    req = urllib_request.Request(url, data=body, headers=headers, method="POST")
    with urllib_request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def caption_with_blip(image_path: Path, hf_token: str) -> Optional[str]:
    """Devuelve el caption en inglés desde BLIP, o None si todo falló.

    Retry con backoff cuando HF responde 503 (modelo cargando). El payload
    es el binario de la imagen — BLIP acepta image/* directo en el body.
    """
    url = HF_API.format(model=BLIP_MODEL)
    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "image/png",
        "Accept": "application/json",
    }
    body = image_path.read_bytes()

    last_err: Optional[str] = None
    for attempt, delay in enumerate(RETRY_DELAYS_S + [0], start=1):
        try:
            data = _http_post(url, headers=headers, body=body)
            parsed = json.loads(data.decode("utf-8"))
            # BLIP devuelve [{"generated_text": "..."}].
            if isinstance(parsed, list) and parsed and "generated_text" in parsed[0]:
                return str(parsed[0]["generated_text"]).strip()
            if isinstance(parsed, dict) and "error" in parsed:
                # Modelo cargando; HF a veces no usa el código 503 sino un
                # 200 con error en el body. Tratamos ambos casos igual.
                last_err = str(parsed["error"])
                if "loading" in last_err.lower() and delay:
                    logger.info(f"BLIP cargando, reintento en {delay}s ({last_err})")
                    time.sleep(delay)
                    continue
                logger.warning(f"BLIP error: {last_err}")
                return None
            logger.warning(f"BLIP response inesperado: {parsed!r}")
            return None
        except urllib_error.HTTPError as e:  # pragma: no cover
            last_err = f"HTTP {e.code}"
            if e.code == 503 and delay:
                logger.info(f"BLIP 503 (cold), reintento en {delay}s")
                time.sleep(delay)
                continue
            if e.code == 429 and delay:
                logger.info(f"BLIP 429 (rate limit), reintento en {delay}s")
                time.sleep(delay)
                continue
            try:
                detail = e.read().decode("utf-8", errors="replace")[:200]
                last_err = f"{last_err}: {detail}"
            except Exception:
                pass
            logger.warning(f"BLIP fallo definitivo: {last_err}")
            return None
        except Exception as e:  # pragma: no cover
            last_err = str(e)
            logger.warning(f"BLIP error inesperado: {last_err}")
            return None
    logger.warning(f"BLIP agotó retries para {image_path.name}: {last_err}")
    return None


def translate_to_spanish(text_en: str, hf_token: str) -> Optional[str]:
    """Traduce inglés→español con NLLB-200. None si falla."""
    if not text_en:
        return None
    url = HF_API.format(model=NLLB_MODEL)
    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "inputs": text_en,
        "parameters": {
            "src_lang": "eng_Latn",
            "tgt_lang": "spa_Latn",
        },
        "options": {"wait_for_model": True},
    }
    body = json.dumps(payload).encode("utf-8")
    for attempt, delay in enumerate(RETRY_DELAYS_S + [0], start=1):
        try:
            data = _http_post(url, headers=headers, body=body)
            parsed = json.loads(data.decode("utf-8"))
            # NLLB returns [{"translation_text": "..."}].
            if isinstance(parsed, list) and parsed:
                first = parsed[0]
                if isinstance(first, dict) and "translation_text" in first:
                    return str(first["translation_text"]).strip()
                if isinstance(first, str):
                    return first.strip()
            if isinstance(parsed, dict) and "error" in parsed:
                err = str(parsed["error"])
                if "loading" in err.lower() and delay:
                    logger.info(f"NLLB cargando, reintento en {delay}s")
                    time.sleep(delay)
                    continue
                logger.warning(f"NLLB error: {err}")
                return None
            logger.warning(f"NLLB response inesperado: {parsed!r}")
            return None
        except urllib_error.HTTPError as e:  # pragma: no cover
            if e.code in (503, 429) and delay:
                logger.info(f"NLLB {e.code}, reintento en {delay}s")
                time.sleep(delay)
                continue
            logger.warning(f"NLLB fallo: HTTP {e.code}")
            return None
        except Exception as e:  # pragma: no cover
            logger.warning(f"NLLB error inesperado: {e}")
            return None
    return None


# ----------------------------------------------------------------------------
# Placeholders (sin HF token)
# ----------------------------------------------------------------------------


_RE_LST = re.compile(r"^lst_(\d{4})_(\w+)\.png$")
_RE_UHI_RURAL = re.compile(r"^uhi_vs_rural_(\d{4})_(\w+)\.png$")
_RE_UHI_CIUDAD = re.compile(r"^uhi_vs_ciudad_(\d{4})_(\w+)\.png$")
_RE_COMPARACION = re.compile(r"^(.+?)_comparacion(?:_hd)?\.png$")


def placeholder_caption(filename: str, source: str) -> Dict[str, str]:
    """Genera un caption razonable a partir del filename, sin llamar a HF."""
    m = _RE_LST.match(filename)
    if m:
        anio, est = m.group(1), m.group(2)
        est_label = ESTACION_LABEL.get(est, est)
        return {
            "caption_en": f"Surface temperature map of Posadas in {est_label} {anio}.",
            "caption_es": f"Mapa de temperatura del suelo (LST) de Posadas en {est_label} {anio}.",
        }
    m = _RE_UHI_RURAL.match(filename)
    if m:
        anio, est = m.group(1), m.group(2)
        est_label = ESTACION_LABEL.get(est, est)
        return {
            "caption_en": f"Urban heat island vs rural baseline in Posadas, {est_label} {anio}.",
            "caption_es": f"Mapa de isla de calor urbana respecto al campo en Posadas, {est_label} {anio}.",
        }
    m = _RE_UHI_CIUDAD.match(filename)
    if m:
        anio, est = m.group(1), m.group(2)
        est_label = ESTACION_LABEL.get(est, est)
        return {
            "caption_en": f"Urban heat anomaly vs city average in Posadas, {est_label} {anio}.",
            "caption_es": f"Mapa de anomalía térmica respecto al promedio de Posadas, {est_label} {anio}.",
        }
    m = _RE_COMPARACION.match(filename)
    if m:
        slug = m.group(1).replace("_", " ")
        return {
            "caption_en": f"Before/after satellite comparison of {slug}.",
            "caption_es": f"Comparación satelital antes/después del polígono {slug}.",
        }
    # Fallback genérico.
    return {
        "caption_en": f"Map: {filename}",
        "caption_es": f"Mapa: {filename}",
    }


# ----------------------------------------------------------------------------
# Iteración por archivos
# ----------------------------------------------------------------------------


def collect_images() -> Iterable[tuple[Path, str]]:
    """Devuelve pares (path, source_label) para todos los PNG a procesar."""
    if CALOR_MAPAS_DIR.exists():
        for p in sorted(CALOR_MAPAS_DIR.glob("*.png")):
            yield p, "calor/mapas"
    if TIMELAPSES_DIR.exists():
        for p in sorted(TIMELAPSES_DIR.glob("*_comparacion*.png")):
            # Excluimos los _hd: tienen el mismo contenido que el _comparacion
            # base, solo cambia la resolución; se describirían igual.
            if p.name.endswith("_hd.png"):
                continue
            yield p, "timelapses"


def load_existing(out_path: Path) -> Dict[str, Dict[str, Any]]:
    if not out_path.exists():
        return {}
    try:
        return json.loads(out_path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning(f"JSON existente no parseó, reinicio: {out_path}")
        return {}


def save_output(out_path: Path, data: Dict[str, Dict[str, Any]]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    # sort_keys garantiza que el diff sea legible cuando se commitea.
    payload = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    out_path.write_text(payload, encoding="utf-8")
    # Espejo público para que el frontend Next.js pueda leer aria-labels y
    # tooltips desde /data/calor/mapas_descripciones.json sin extra setup.
    if PUBLIC_OUTPUT_JSON != out_path:
        PUBLIC_OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        PUBLIC_OUTPUT_JSON.write_text(payload, encoding="utf-8")


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="No llamar a HF; sólo listar los PNG que se procesarían.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reprocesar todos los PNG, incluso si ya tienen entrada.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Máximo de PNG a procesar (útil para smoke tests).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    hf_token = os.environ.get("HF_TOKEN", "").strip()
    has_token = bool(hf_token)

    if not has_token:
        logger.warning(
            "HF_TOKEN no configurado — generaré captions placeholder a partir "
            "del filename. Configurá el token en huggingface.co/settings/tokens "
            "para obtener captions reales con BLIP."
        )

    images = list(collect_images())
    if args.limit:
        images = images[: args.limit]

    if args.dry_run:
        logger.info(f"--dry-run: {len(images)} PNG candidatos para captioning")
        for p, source in images[:10]:
            logger.info(f"  {source}/{p.name}")
        if len(images) > 10:
            logger.info(f"  ... ({len(images) - 10} más)")
        # Imprimimos el modo (con/sin HF) y dónde quedaría el output.
        logger.info(
            f"Modo: {'HF BLIP+NLLB' if has_token else 'placeholder'}. "
            f"Output: {OUTPUT_JSON.relative_to(ROOT)}"
        )
        return 0

    existing = load_existing(OUTPUT_JSON)
    procesados = 0
    skipped = 0
    fallidos = 0

    for path, source in images:
        key = path.name
        if not args.force and key in existing:
            skipped += 1
            continue

        logger.info(f"[{procesados + 1}/{len(images)}] {source}/{key}")

        if has_token:
            caption_en = caption_with_blip(path, hf_token)
            if caption_en:
                caption_es = translate_to_spanish(caption_en, hf_token)
                if not caption_es:
                    # El traductor falló: usamos el fallback de placeholder
                    # mezclado con el caption en inglés para no perder info.
                    placeholder = placeholder_caption(key, source)
                    caption_es = placeholder["caption_es"]
                method = "hf-blip"
            else:
                # BLIP falló: caemos a placeholder por filename.
                placeholder = placeholder_caption(key, source)
                caption_en = placeholder["caption_en"]
                caption_es = placeholder["caption_es"]
                method = "placeholder"
                fallidos += 1
        else:
            placeholder = placeholder_caption(key, source)
            caption_en = placeholder["caption_en"]
            caption_es = placeholder["caption_es"]
            method = "placeholder"

        existing[key] = {
            "source": source,
            "caption_en": caption_en,
            "caption_es": caption_es,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "method": method,
        }
        procesados += 1

        # Persistimos cada 20 entradas para no perder progreso si la corrida
        # se interrumpe (ej. ctrl-c, rate limit fatal).
        if procesados % 20 == 0:
            save_output(OUTPUT_JSON, existing)
            logger.info(f"Checkpoint guardado ({procesados} procesados)")

        if has_token:
            time.sleep(SLEEP_BETWEEN_REQUESTS_S)

    save_output(OUTPUT_JSON, existing)

    logger.info("---")
    logger.info(f"Total PNG candidatos: {len(images)}")
    logger.info(f"Procesados nuevos: {procesados}")
    logger.info(f"Saltados (ya existentes): {skipped}")
    logger.info(f"BLIP falló (cayó a placeholder): {fallidos}")
    logger.info(f"Output: {OUTPUT_JSON.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
