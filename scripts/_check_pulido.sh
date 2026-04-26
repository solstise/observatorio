#!/bin/bash
BASE="https://observatorio.sistemaswinter.com"
echo "=== Pages ==="
for url in / /calor /prioridades /metodologia /poligono/itaembe_guazu /poligono/federal /poligono/cima_del_sol /poligono/posadas_completa; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url")
  echo "$url: $code"
done
echo ""
echo "=== Data ==="
for f in /data/social/ranking.csv /data/poblacion.csv /data/dynamic_world.csv /data/sentinel1.csv /data/calor/uhi_estacional.csv; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B" "$BASE$f")
  echo "$f: $size"
done
echo ""
echo "=== Audit overlap ==="
cd /mnt/c/ProyectosIA/Antigravity/observatorio
source venv/bin/activate
python scripts/_audit_overlaps.py | tail -5
