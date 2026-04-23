# Política de publicación

Este documento establece **qué se publica y qué no** del Observatorio
Urbano Posadas, con foco en la protección de comunidades en situaciones
sensibles.

## Principio rector

El observatorio existe para producir evidencia pública útil para política
urbana. Pero **esa utilidad no justifica cualquier nivel de detalle** si
ese detalle puede generar daño a personas concretas.

## Qué se publica siempre

Para todos los polígonos sin marca `sensible: true`:

- Polígono exacto en el dashboard web.
- Serie temporal completa de conteo de viviendas.
- Estimación de población por rango.
- Imágenes satelitales (Sentinel-2, NICFI) recortadas al polígono.
- Timelapse GIF y MP4.
- Reporte PDF de una página.
- CSV con todos los datos subyacentes (metadatos, serie temporal,
  servicios cercanos).

Todos estos outputs tienen licencia **CC BY 4.0**. Se pueden usar
libremente citando al observatorio.

## Qué NO se publica en los polígonos sensibles

Cuando un polígono está marcado `sensible: true` en
`config/poligonos.geojson`:

- **No** se publica el polígono exacto en el dashboard web.
- **No** se publican imágenes recortadas a alta resolución.
- **No** se publica timelapse individual del polígono.
- **No** se publica reporte PDF individual.

**Sí** se publican:

- Métricas agregadas a nivel **barrio amplio** (por ejemplo, todo El
  Brete incluido dentro de "Costanera Sur", no el polígono exacto).
- Totales sumados a polígonos vecinos no sensibles para que el dato
  macro no se pierda.
- Documentación de que **existe el polígono sensible** y que los datos
  agregados lo incluyen. No lo ocultamos, lo agregamos.

La versión interna del ministerio **sí** recibe el detalle completo,
porque es información operativa para política pública. El detalle
interno está protegido por las mismas reglas que cualquier información
de gestión (no difusión externa no autorizada).

## Criterios para marcar un polígono como sensible

Un polígono debe marcarse `sensible: true` si:

1. Existe **disputa dominial activa** con riesgo real de desalojo por
   parte de privados o el Estado.
2. El polígono es identificable con **un grupo étnico o cultural** cuya
   visibilidad geoespacial puede generar estigma o discriminación.
3. El polígono se encuentra en **zona de riesgo ambiental activo**
   (inundabilidad severa, contaminación) donde publicar el detalle
   podría afectar el valor inmobiliario de los residentes o su acceso
   a crédito.
4. Existe **pedido fundado** de un referente barrial, una organización
   comunitaria, un funcionario o un investigador explicando el riesgo
   específico.

En caso de duda, marcar como sensible y revisar. Es preferible
sub-publicar que exponer.

## Proceso de apelación

Si alguien discrepa con la clasificación (ya sea porque considera que
un polígono no sensible debería serlo, o al revés):

1. Abrir un issue en el repositorio del observatorio con el asunto
   "Revisión política de publicación - [nombre del polígono]".
2. En el issue, fundamentar el pedido (riesgo específico, impacto
   esperado, propuesta alternativa).
3. El equipo del observatorio revisa en menos de 14 días y responde.
4. Si se acuerda el cambio, se actualiza `config/poligonos.geojson` y
   se regenera el dashboard.
5. Si no se acuerda, se documenta la razón públicamente en el issue.

Para casos urgentes (conflicto activo, riesgo inminente), el contacto
directo es:

- Mail: `[completar]`
- Teléfono de emergencia: `[completar]`

En esos casos, se puede solicitar **retiro temporal del polígono** del
dashboard mientras se resuelve, sin necesidad de completar todo el
proceso.

## Transparencia sobre la política misma

El listado de polígonos marcados como sensibles **es público** en
`config/poligonos.geojson` (su existencia, no su geometría exacta). La
política es pública (este documento). Los pedidos de apelación quedan
registrados en issues públicos (salvo que el solicitante pida
confidencialidad por riesgo personal, en cuyo caso se usa el canal
privado).

Esto evita que la "política de publicación" sea usada como excusa para
ocultar datos que deberían ser públicos (corrupción, favoritismo
político). Si el observatorio decide no publicar algo, tiene que poder
justificarlo ante cualquiera.

## Qué hacemos con los pedidos de gobiernos

Si un gobierno (municipal, provincial o nacional) pide que se retire
información del observatorio:

- Si el pedido tiene fundamento de protección de personas, se
  considera según esta política.
- Si el pedido es de **ocultamiento político** (ej. "este dato es
  incómodo para el intendente"), se **rechaza y se documenta
  públicamente** el pedido y el rechazo.

El observatorio no es propiedad del ministro, ni del municipio, ni del
gobierno provincial. Es un bien público. Si en algún momento algún
funcionario presiona para retirar datos legítimos, esa presión se
publica como parte de la transparencia del proyecto.

## Revisión anual

Esta política se revisa una vez al año (al publicar nuevo CHANGELOG
mayor, o en cada aniversario del observatorio). Cambios se documentan
en `CHANGELOG.md` y se notifican en el sitio público.
