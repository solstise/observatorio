"""Smoke de producción: falla ante rutas, snapshot o PNG inválidos."""

import argparse
import json
from datetime import datetime, timezone
from urllib.request import urlopen


def main(base):
    results = []
    for path in (
        "/",
        "/nino",
        "/pronostico/riesgos",
        "/datos/metodologia",
        "/poligono/villa_urquiza",
    ):
        with urlopen(base + path, timeout=60) as response:
            body = response.read().decode("utf-8")
            if response.status != 200:
                raise ValueError(f"{path}: {response.status}")
            if path == "/nino" and ("103" not in body or "no emite alertas oficiales" not in body):
                raise ValueError("Aviso de canales oficiales ausente")
            results.append({"path": path, "status": response.status})
    for path in ("/data/forecast/_metadata.json", "/data/nino/estado.json"):
        with urlopen(base + path, timeout=30) as response:
            data = json.load(response)
        age = (
            datetime.now(timezone.utc) - datetime.fromisoformat(data["generated_at"])
        ).total_seconds()
        if not -300 <= age < 86400:
            raise ValueError(f"{path}: snapshot fuera de 24 h")
        results.append(
            {"path": path, "generated_at": data["generated_at"], "age_hours": round(age / 3600, 3)}
        )
    with urlopen(base + "/nino/opengraph-image", timeout=30) as response:
        if response.status != 200 or response.read(8) != b"\x89PNG\r\n\x1a\n":
            raise ValueError("OG inválida")
        results.append({"path": "/nino/opengraph-image", "status": 200, "format": "PNG"})
    return {"checked_at": datetime.now(timezone.utc).isoformat(), "url": base, "checks": results}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="https://sateliteposadas.com")
    args = parser.parse_args()
    print(json.dumps(main(args.base.rstrip("/")), ensure_ascii=False, indent=2))
