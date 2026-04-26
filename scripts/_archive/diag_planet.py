"""Diagnóstico Planet NICFI: lista mosaicos accesibles con la API key."""

from __future__ import annotations

import os
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
KEY = os.environ.get("PLANET_API_KEY", "")

print(f"API key presente: {'yes (' + KEY[:8] + '...)' if KEY else 'NO'}\n")

# 1) Listar todos los mosaicos accesibles
print("=== 1) Lista general ===")
r = requests.get(
    "https://api.planet.com/basemaps/v1/mosaics",
    auth=(KEY, ""),
    params={"_page_size": 50},
    timeout=30,
)
print(f"Status: {r.status_code}")
if r.status_code != 200:
    print(f"  body: {r.text[:400]}")
data = r.json() if r.status_code == 200 else {}
mosaicos = data.get("mosaics", [])
print(f"Mosaicos accesibles: {len(mosaicos)}")
for m in mosaicos[:20]:
    name = m.get("name", "?")
    fa = str(m.get("first_acquired", ""))[:10]
    la = str(m.get("last_acquired", ""))[:10]
    res = m.get("resolution", "")
    print(f"  - {name}  res={res}  from={fa}  to={la}")

# 2) Probar nombres específicos
print("\n=== 2) Probar nombres específicos ===")
candidatos = [
    "planet_medres_normalized_analytic_2024-07_mosaic",
    "planet_medres_normalized_analytic_2023-06_mosaic",
    "planet_medres_normalized_analytic_2022-06_mosaic",
    "planet_medres_visual_2024-07_mosaic",
    "planet_medres_visual_2023-06_mosaic",
    "global_monthly_2024_07_mosaic",
    "global_monthly_2023_06_mosaic",
    "planet_tropicalforest_2024-07_mosaic",
]
for nombre in candidatos:
    r = requests.get(
        "https://api.planet.com/basemaps/v1/mosaics",
        auth=(KEY, ""),
        params={"name__is": nombre},
        timeout=20,
    )
    n = len(r.json().get("mosaics", [])) if r.status_code == 200 else 0
    print(f"  {nombre}: {r.status_code}, hits={n}")

# 3) Perfil / organizaciones del user
print("\n=== 3) Perfil del usuario ===")
for endpoint in [
    "https://api.planet.com/auth/v1/experimental/public/my/subscriptions",
    "https://api.planet.com/auth/v1/experimental/public/users/me",
    "https://api.planet.com/compute/ops/",
]:
    r = requests.get(endpoint, auth=(KEY, ""), timeout=20)
    print(f"  {endpoint}: {r.status_code}")
    if r.status_code == 200:
        print(f"    body[:300]: {r.text[:300]}")
