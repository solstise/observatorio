#!/bin/bash
for id in itaembe_guazu villa_cabello chacra_32 bajada_vieja centro villa_sarita villa_urquiza nemesio_parma el_brete itaembe_mini miguel_lanus itaembe_pora aguas_corrientes villa_bonita; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "https://observatorio.sistemaswinter.com/data/media/${id}.pdf")
  echo "$id: $code"
done
