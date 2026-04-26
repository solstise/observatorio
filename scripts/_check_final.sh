#!/bin/bash
BASE="https://observatorio.sistemaswinter.com"
echo "=== Pages ==="
for url in / /calor /prioridades /metodologia /comparar /descargas /poligono/itaembe_guazu /poligono/centro /poligono/federal /poligono/cima_del_sol; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url")
  echo "$url: $code"
done
echo ""
echo "=== Data files ==="
for url in /data/social/ranking.csv /data/social/distancias.csv /data/calor/uhi_estacional.csv /data/poligonos.geojson /data/serie_temporal.csv /data/poblacion.csv; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B" "$BASE$url")
  echo "$url: $size"
done
echo ""
echo "=== Audit overlap ==="
cd /mnt/c/ProyectosIA/Antigravity/observatorio
source venv/bin/activate
python scripts/_audit_overlaps.py | tail -8
