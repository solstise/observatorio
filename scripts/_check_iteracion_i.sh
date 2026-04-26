#!/bin/bash
BASE="https://observatorio.sistemaswinter.com"
echo "=== Pages ==="
for url in / /poligono/itaembe_guazu /poligono/posadas_completa /prioridades /calor; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url")
  echo "$url: $code"
done
echo ""
echo "=== Data check ==="
curl -s "$BASE/data/poligonos.geojson" | python3 -c "
import sys, json
d = json.load(sys.stdin)
fs = d['features']
print(f'Total polígonos en geojson live: {len(fs)}')
guazu = [f for f in fs if f['properties']['id']=='itaembe_guazu']
if guazu:
    print(f\"itaembe_guazu superficie: {guazu[0]['properties']['superficie_km2']} km²\")
posadas = [f for f in fs if f['properties']['id']=='posadas_completa']
if posadas:
    print(f\"posadas_completa superficie: {posadas[0]['properties']['superficie_km2']} km²\")
"
echo ""
echo "=== Open-Meteo test ==="
curl -s "https://api.open-meteo.com/v1/forecast?latitude=-27.37&longitude=-55.90&daily=temperature_2m_max&timezone=America/Argentina/Cordoba&forecast_days=1" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Hoy en Posadas: {d['daily']['temperature_2m_max'][0]}°C max\")
"
