# Scripts archivados

Scripts que dejaron de tener sentido o quedaron obsoletos. Se mantienen por
trazabilidad histórica pero no se corren.

## `02_descarga_nicfi.py` — archivado 2026-04-24

**Por qué**: el programa NICFI Satellite Data Program (contrato
Planet ↔ gobierno de Noruega que daba acceso gratuito a mosaicos
PlanetScope para uso no comercial) **terminó el 1 de abril de 2025**.

- El dataset `projects/planet-nicfi/assets/basemaps/americas` en Google Earth
  Engine ya no está accesible para proyectos que no estaban pre-aprobados
  bajo NICFI.
- El reemplazo comercial de Planet es "Tropical Forest Observatory" (TFO),
  con un tier desde ~US$180/mes. No hay versión gratuita.
- Para resolución sub-10m gratis no hay alternativa comparable a nivel
  global actualmente.

**Qué usar en su lugar**:
- Sentinel-2 SR Harmonized (10m, vía Earth Engine, gratis). Ya lo usa
  el pipeline principal (`01_descarga_sentinel.py`).

**Si algún día vuelve**: si Planet o una nueva iniciativa abre de nuevo
el acceso gratuito, el script `02_descarga_nicfi.py` está completo y
funciona contra la API `api.planet.com/basemaps/v1/mosaics`. Solo hay
que restaurar `PLANET_API_KEY` en `.env` y moverlo de vuelta a `scripts/`.

## `diag_planet.py` y `probar_nicfi_gee.py` — archivados 2026-04-24

Scripts diagnóstico que usamos para confirmar que el acceso gratuito no
existe más. Se mantienen por si ayudan a re-diagnosticar cuando cambie
la situación del programa.
