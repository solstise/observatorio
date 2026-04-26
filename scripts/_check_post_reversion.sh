#!/bin/bash
BASE="https://observatorio.sistemaswinter.com"
echo "=== L1 + L2 + L5 (deben responder 200) ==="
for url in / /clima /calor /prioridades /densidad /3d /explorar /metodologia /poligono/itaembe_guazu; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url")
  echo "$url: $code"
done
echo ""
echo "=== D1-D5 (deben responder 404, ya no existen) ==="
for url in /feed.xml /feed.atom /poligono/itaembe_guazu/feed.xml /sw.js /manifest.json /icons/icon-192.png; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url")
  echo "$url: $code"
done
echo ""
echo "=== Forecast data (L1) ==="
for f in /data/forecast/forecast_diario.csv /data/forecast/alertas_activas.json; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B" "$BASE$f")
  echo "$f: $size"
done
