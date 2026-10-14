"""Extrae fechas declaradas por las fuentes semilla sin inferir fechas del evento."""

import csv
import json
import re
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]

if __name__ == "__main__":
    with (ROOT / "data/eventos_anegamiento.csv").open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            try:
                r = requests.get(row["fuente_url"], timeout=20)
                dates = re.findall(r'"datePublished"\s*:\s*"([^\"]+)', r.text)
                print(
                    json.dumps(
                        {
                            "url": row["fuente_url"],
                            "status": r.status_code,
                            "final_url": r.url,
                            "datePublished": dates[:1],
                        },
                        ensure_ascii=False,
                    )
                )
            except requests.RequestException as e:
                print(json.dumps({"url": row["fuente_url"], "error": str(e)}, ensure_ascii=False))
