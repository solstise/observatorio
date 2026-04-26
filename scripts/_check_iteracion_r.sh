#!/bin/bash
BASE="https://observatorio.sistemaswinter.com"
echo "=== Páginas (deben 200) ==="
for url in / /clima /calor /prioridades /proyecciones /comparar /metodologia /densidad /3d /explorar /poligono/itaembe_guazu /poligono/posadas_completa; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url")
  echo "  $url: $code"
done
echo ""
echo "=== R3: copy obsoleto eliminado (deben NO aparecer) ==="
for term in "Fase 2" "v0.3" "Beta interno" "experimental — v0" "fase 3" "Vista experimental"; do
  count=$(curl -s "$BASE" "$BASE/calor" "$BASE/3d" "$BASE/clima" "$BASE/prioridades" "$BASE/densidad" "$BASE/explorar" 2>/dev/null | grep -c "$term")
  echo "  '$term': $count menciones (esperado 0)"
done
echo ""
echo "=== R4: DataFreshness chips visibles ==="
for url in /calor /clima /poligono/itaembe_guazu /metodologia; do
  count=$(curl -s "$BASE$url" | grep -cE "data-freshness|frescura|hace.*minut|hace.*hora|hace.*dia")
  echo "  $url: $count matches freshness"
done
echo ""
echo "=== /metodologia#frescura ==="
curl -s "$BASE/metodologia" | grep -oE "id=\"frescura\"|frescura de datos|Salud del pipeline" | sort -u
echo ""
echo "=== R2: AireMultigasCard + glosario terms ==="
curl -s "$BASE/poligono/itaembe_guazu" | grep -oE "Calidad del aire — Itaem|TROPOMI|CAMS|toggle|forecast|histórico" | sort -u | head -10
echo ""
echo "=== Glosario términos nuevos ==="
curl -s "$BASE/metodologia" | grep -oE "glosario-(tropomi|so2|co-monoxido|hcho|ch4|cams|aqi|pearson|rmse|sesgo|ndbi|srtm|maptiler|maplibre|deck-gl|h3|sse|upstash|wmo)\b" | sort -u
