#!/bin/bash
echo "=== PDFs ==="
for id in itaembe_guazu villa_cabello chacra_32 bajada_vieja centro villa_sarita villa_urquiza nemesio_parma el_brete itaembe_mini miguel_lanus itaembe_pora aguas_corrientes villa_bonita cima_del_sol san_isidro yacyreta santa_rita alta_gracia el_palomar villa_mola; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://observatorio.sistemaswinter.com/data/media/${id}.pdf")
  echo "$id.pdf: $code"
done
echo ""
echo "=== Polygon pages ==="
for id in cima_del_sol san_isidro yacyreta santa_rita alta_gracia el_palomar villa_mola fatima san_lucas; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://observatorio.sistemaswinter.com/poligono/$id")
  echo "/poligono/$id: $code"
done
echo ""
echo "=== Data ==="
curl -s -o /dev/null -w "calor/uhi_mensual.csv: %{http_code} %{size_download}B\n" "https://observatorio.sistemaswinter.com/data/calor/uhi_mensual.csv"
curl -s -o /dev/null -w "poligonos.geojson: %{http_code} %{size_download}B\n" "https://observatorio.sistemaswinter.com/data/poligonos.geojson"
curl -s -o /dev/null -w "serie_temporal.csv: %{http_code} %{size_download}B\n" "https://observatorio.sistemaswinter.com/data/serie_temporal.csv"
