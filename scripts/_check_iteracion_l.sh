#!/bin/bash
BASE="https://observatorio.sistemaswinter.com"
echo "=== Páginas nuevas y existentes ==="
for url in / /clima /calor /prioridades /densidad /3d /explorar /metodologia /poligono/itaembe_guazu /feed.xml /feed.atom /poligono/itaembe_guazu/feed.xml /manifest.json; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url")
  echo "$url: $code"
done
echo ""
echo "=== Datos forecast ==="
for f in /data/forecast/forecast_diario.csv /data/forecast/forecast_horario.csv /data/forecast/aqi_diario.csv /data/forecast/alertas_activas.json /data/forecast/_metadata.json; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B" "$BASE$f")
  echo "$f: $size"
done
echo ""
echo "=== PWA assets ==="
for f in /sw.js /icons/icon-192.png /icons/icon-512.png; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B" "$BASE$f")
  echo "$f: $size"
done
