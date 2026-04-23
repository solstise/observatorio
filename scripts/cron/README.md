# Cron: actualización mensual del Observatorio Urbano Posadas

Este directorio contiene el script que corre automáticamente cada mes en el
VPS Hostinger y deja los outputs listos para que el dashboard web los sirva.

## Qué hace `actualizacion_mensual.sh`

1. Activa el `.venv` del proyecto (override con `OBSERVATORIO_VENV`).
2. Descarga el mosaico **Planet NICFI** del mes actual.
3. Descarga la **Sentinel-2** más limpia del mes.
4. Re-corre el **conteo de edificios** en modo incremental.
5. Recalcula **distancias a servicios** (OSM) y el **score de vulnerabilidad**
   (borrador).
6. Regenera **timelapses** por polígono.
7. Regenera **PDFs** editoriales.
8. Sincroniza con `rsync` los directorios `data/processed/` y `data/outputs/`
   hacia `webapp/public/data/` (override con `OBSERVATORIO_FRONTEND_DATA`).
9. Envía notificación a **Slack** (si `SLACK_WEBHOOK_URL`) y/o **Telegram**
   (si `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`).
10. Deja un log completo en `/var/log/observatorio/YYYYMMDD.log` (override con
    `OBSERVATORIO_LOG_DIR`).

Exit codes:

- `0` — todo OK.
- `1` — fallo crítico: no hay outputs utilizables.
- `2` — éxito parcial: al menos un paso falló pero hay outputs útiles.

## Instalación en el VPS

Asumiendo que el repo está clonado en `/opt/observatorio/` y el venv vive en
`/opt/observatorio/.venv/`:

```bash
sudo mkdir -p /var/log/observatorio
sudo chown <usuario>:<usuario> /var/log/observatorio
chmod +x /opt/observatorio/scripts/cron/actualizacion_mensual.sh
```

Editar el crontab del usuario que corre el observatorio:

```bash
crontab -e
```

Agregar (primer día de cada mes, 2 AM):

```cron
0 2 1 * * /opt/observatorio/scripts/cron/actualizacion_mensual.sh
```

Si se prefiere "primer lunes del mes a las 2 AM", usar:

```cron
0 2 * * 1 [ "$(date +\%d)" -le 07 ] && /opt/observatorio/scripts/cron/actualizacion_mensual.sh
```

## Variables de entorno relevantes

El script hereda todo el `.env` vía `source .venv/bin/activate` (si el venv
está configurado para leerlo) o se pueden declarar directamente en
`/etc/environment` / `~/.profile`.

| Variable | Uso |
|----------|-----|
| `PLANET_API_KEY` | descarga Planet NICFI |
| `EE_PROJECT_ID` / `EE_SERVICE_ACCOUNT_FILE` | Earth Engine (Sentinel-2) |
| `SLACK_WEBHOOK_URL` | notificación Slack al terminar |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | notificación Telegram |
| `OBSERVATORIO_VENV` | override del path al venv |
| `OBSERVATORIO_FRONTEND_DATA` | override del destino `rsync` |
| `OBSERVATORIO_LOG_DIR` | override del directorio de logs |

## Plan B: correr local y subir solo outputs

Si el VPS no tiene RAM/CPU suficiente (la descarga NICFI + training puede
ser pesada), una alternativa es:

1. Correr `actualizacion_mensual.sh` en la máquina del autor (WSL2 + GPU).
2. Solo subir al VPS los outputs procesados con:

   ```bash
   rsync -az --delete data/processed/ usuario@vps:/opt/observatorio/data/processed/
   rsync -az data/outputs/ usuario@vps:/opt/observatorio/data/outputs/
   ```

3. En el VPS, cron liviano solo regenera el build del frontend:

   ```cron
   15 2 1 * * cd /opt/observatorio/webapp && pnpm build > /var/log/observatorio/webbuild.log 2>&1
   ```

## Troubleshooting

- **`bad interpreter: /usr/bin/env bash^M`**: el archivo quedó con CRLF.
  Solucionar con `dos2unix scripts/cron/actualizacion_mensual.sh` o
  asegurarse de tener `*.sh text eol=lf` en el `.gitattributes` del repo.
- **Permisos**: el script debe ser ejecutable (`chmod +x`).
- **Timezone**: cron usa la TZ del sistema. Para Posadas poné
  `TZ=America/Argentina/Buenos_Aires` en el crontab si el VPS está en UTC.
- **Logs**: para depurar una corrida manualmente:

  ```bash
  /opt/observatorio/scripts/cron/actualizacion_mensual.sh
  tail -f /var/log/observatorio/$(date +%Y%m%d).log
  ```
