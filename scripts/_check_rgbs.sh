#!/bin/bash
# Check Sentinel-2 RGBs for failed polygons
DIR="/mnt/c/ProyectosIA/Antigravity/observatorio/data/raw/sentinel2"
for id in a4_nueva_esperanza federal norte complejo_gervasio_artigas san_isidro cima_del_sol posadas_completa; do
  count=$(ls "${DIR}/${id}_"*_rgb.tif 2>/dev/null | wc -l)
  echo "${id}: ${count} RGBs"
done
