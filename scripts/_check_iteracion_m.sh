#!/bin/bash
BASE="https://observatorio.sistemaswinter.com"
echo "=== Páginas (deben 200) ==="
for url in / /clima /calor /prioridades /proyecciones /comparar /metodologia /densidad /3d /explorar /poligono/itaembe_guazu /poligono/posadas_completa; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url")
  echo "$url: $code"
done
echo ""
echo "=== SEO assets (M1) ==="
for url in /sitemap.xml /robots.txt; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B" "$BASE$url")
  echo "$url: $size"
done
echo ""
echo "=== Open Graph dinámico (M1) ==="
for url in /opengraph-image /clima/opengraph-image /poligono/itaembe_guazu/opengraph-image; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{content_type} %{size_download}B" "$BASE$url")
  echo "$url: $size"
done
echo ""
echo "=== Datos proyecciones (M3) ==="
for f in /data/proyecciones/proyecciones.csv /data/proyecciones/_metadata.json; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B" "$BASE$f")
  echo "$f: $size"
done
echo ""
echo "=== Headers cache (M4) ==="
curl -sI "$BASE/data/poligonos.geojson" | grep -iE "cache-control|etag|content-type" | head -3
