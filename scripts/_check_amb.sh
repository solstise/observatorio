#!/bin/bash
BASE="https://observatorio.sistemaswinter.com"
for f in /data/dynamic_world.csv /data/sentinel1.csv /data/mapbiomas.csv /data/ghsl.csv /data/viirs.csv /data/chirps.csv /data/no2.csv /data/lst.csv /data/firms.csv /data/wdpa.csv; do
  size=$(curl -s -o /dev/null -w "%{http_code} %{size_download}B" "$BASE$f")
  echo "$f: $size"
done
