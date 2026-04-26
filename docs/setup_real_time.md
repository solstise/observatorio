# Setup pipeline real-time (cron + Upstash + SSE)

Este documento explica cómo activar el refresh automático del forecast
climático y las alertas, sin que un humano corra scripts cada 6h.

## Arquitectura

```
   GitHub Actions (cron 6h)
   ────────────────────────
   refresh-forecast.yml
        │
        ├── python scripts/57_forecast_clima.py    (lo crea L1)
        ├── python scripts/58_alertas_clima.py     (lo crea L1)
        ├── python scripts/_publish_to_upstash.py  ← este repo
        │       │
        │       └── HTTP POST → Upstash Redis (REST API)
        │
        ├── git push origin data                   (rama de datos derivados)
        │
        └── ssh root@VPS && bash deploy-vps.sh     (rebuild Next.js)


   Frontend Next.js
   ────────────────
   /api/forecast?key=...        → Upstash GET (con fallback a /public/data/)
   /api/forecast/stream         → SSE: poll Upstash cada 30s, push 'update'
   useLiveData(key)             → fetch + SSE + polling fallback
   <UpdateIndicator />          → dot vivo + "actualizado hace X min"
```

## Pre-requisito: el repo tiene que estar en GitHub

Hoy `C:\ProyectosIA\Antigravity\observatorio\` es un repo git **local** sin
remote configurado. Para que el cron corra, hay que empujarlo a GitHub.

```bash
cd /mnt/c/ProyectosIA/Antigravity/observatorio
# Crear el repo en GitHub (privado o público) — vacío, sin README ni .gitignore.
git remote add origin git@github.com:<tu-usuario>/observatorio.git
git push -u origin main
# La rama 'data' la crea sola el workflow en su primera corrida con cambios.
```

Si preferís no subir el repo, podés correr el cron localmente con
`Windows Task Scheduler` o `cron` en WSL:

```cron
# crontab -e en WSL
0 */6 * * * cd /mnt/c/ProyectosIA/Antigravity/observatorio && \
  source venv/bin/activate && \
  python scripts/57_forecast_clima.py && \
  python scripts/58_alertas_clima.py && \
  python scripts/_publish_to_upstash.py >> logs/cron.log 2>&1
```

## Paso 1: cuenta Upstash (3 min, gratis)

Upstash da 10k commands/día y 256 MB gratis — más que suficiente para esto.

1. https://upstash.com → "Sign up with GitHub" (no requiere tarjeta).
2. Console → "Create Database":
   - Name: `observatorio-posadas`
   - Type: **Regional** (más barato; el global cuesta más para nada)
   - Primary Region: `sa-east-1` (São Paulo, ~30 ms desde Posadas)
   - TLS: **enabled**
   - Eviction: `noeviction` (queremos que las claves expiren por TTL, no por LRU)
3. Una vez creada, en la sección **REST API** copiá:
   - `UPSTASH_REDIS_REST_URL` (algo como `https://xxx-xxx.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (token largo, **secreto**)

Guardá ambos en `.env` local (para test) y en GitHub Secrets (para CI).

## Paso 2: configurar GitHub Secrets

Ir a **Settings → Secrets and variables → Actions → New repository secret**.

Crear estos secrets (todos requeridos):

| Secret name | Valor | De dónde |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | URL del REST API | Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | Token Bearer | Upstash console |
| `VPS_SSH_KEY` | Contenido completo de `~/.ssh/id_ed25519` (clave privada) | Tu máquina (la que usa para `ssh root@187.77.54.19`) |
| `VPS_KNOWN_HOSTS` | Output de `ssh-keyscan 187.77.54.19` | Local |
| `EE_SERVICE_ACCOUNT_JSON` | JSON completo del service account | Google Cloud Console (si los scripts L1 usan Earth Engine) |

> **Tip seguridad**: la clave SSH del VPS es **muy** sensible. Considerá
> crear una clave dedicada solo para el deploy del cron, con un usuario
> sin sudo si es posible. Mínimo, ponele `command="bash deploy-vps.sh"`
> en `~/.ssh/authorized_keys` para que solo pueda correr el deploy.

## Paso 3: configurar variables del frontend en el VPS

El endpoint `/api/forecast` también necesita las credenciales de Upstash
para leer del cache (no solo el cron las precisa). Editar
`/opt/apps/.env` o el archivo `.env` que use Hostinger para inyectar
variables al contenedor:

```env
UPSTASH_REDIS_REST_URL=https://xxx-xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=ya29.xxx
```

Si no las seteás, el endpoint cae limpio al fallback de leer
`/public/data/forecast/*.json` — el frontend sigue funcionando, solo que
sin "vivo" SSE (el `UpdateIndicator` queda en estado `polling`).

## Paso 4: probar localmente antes de mergear

### 4a. Test del helper Upstash (dry-run)

```bash
cd /mnt/c/ProyectosIA/Antigravity/observatorio
source venv/bin/activate
python scripts/_publish_to_upstash.py --dry-run
```

Output esperado:
```
[INFO] No encontré archivos JSON para publicar en webapp/frontend/public/data/forecast.
       Esto es normal si los scripts L1 (57/58) todavía no corrieron.
```

(Eso significa que el helper funciona — solo le falta data porque L1
todavía no terminó.)

### 4b. Test con datos reales

Una vez que L1 publique sus scripts y haya corrido:

```bash
ls webapp/frontend/public/data/forecast/  # debería haber JSONs
export UPSTASH_REDIS_REST_URL=...         # de Upstash console
export UPSTASH_REDIS_REST_TOKEN=...
python scripts/_publish_to_upstash.py
```

### 4c. Test del workflow con `act`

[`act`](https://github.com/nektos/act) corre workflows de GitHub Actions
localmente con Docker. Útil para validar el YAML antes de pushear.

```bash
# Una vez:
brew install act   # macOS / Linux
# o: choco install act-cli   (Windows)

# Listar workflows:
act --list

# Correr el workflow refresh-forecast en modo dry:
act schedule -W .github/workflows/refresh-forecast.yml --secret-file .secrets

# Donde .secrets es un archivo plano con KEY=value (no commitearlo):
# UPSTASH_REDIS_REST_URL=...
# UPSTASH_REDIS_REST_TOKEN=...
# VPS_SSH_KEY=...
```

### 4d. Trigger manual desde GitHub UI

Más simple si ya está pusheado: **Actions → Refresh forecast (cron 6h) →
Run workflow** (botón a la derecha). Permite incluso saltearse el deploy
con el input `skip_deploy=true` si solo querés probar Upstash.

### 4e. Build del frontend

```bash
cd webapp/frontend
npm run build
```

Verifica que `UpdateIndicator`, `useLiveData` y los route handlers
compilan sin errores TS.

## Paso 5: monitoreo

### El cron corrió bien

- **GitHub Actions UI**: https://github.com/<tu-usuario>/observatorio/actions/workflows/refresh-forecast.yml
  Cada run con check verde.
- **Upstash console**: la pestaña "Data Browser" muestra las claves
  `forecast:diario:*` con TTL decreciendo. Si las ves expiradas, el cron no corrió.
- **Frontend**: el dot del header debería estar verde y pulsante.

### El cron falló

- El workflow tiene un step final (`failure()`) que abre un issue en GitHub
  con la traza. Activá notificaciones de issues para enterarte.
- El `<UpdateIndicator>` se pondrá naranja después de 12h y rojo después
  de 24h. Es la señal en producción.

## Limpieza / desactivar

Para pausar el cron sin borrar nada:
- **Settings → Actions → General → Disable workflows** o
- Editá el `.yml` comentando el bloque `schedule:`.

Para resetear las claves de Upstash (panic button):
```bash
curl -X POST "$UPSTASH_REDIS_REST_URL" \
  -H "Authorization: Bearer $UPSTASH_REDIS_REST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '["FLUSHDB"]'
```

## FAQ

**¿Es Upstash obligatorio?**
No. Si no configurás `UPSTASH_REDIS_REST_URL`, el `/api/forecast` cae al
modo "leer del filesystem local", el SSE cierra limpio al instante y el
hook usa polling cada 5 min. La UX es peor (datos hasta 5 min de retraso
en vez de "instantáneo") pero todo sigue funcionando. Sumar Upstash es
opcional; siempre podés activarlo después.

**¿Por qué SSE y no WebSockets?**
SSE atraviesa proxies HTTP sin config (Cloudflare, nginx, Hostinger lo
soportan out-of-the-box). WebSockets requieren upgrade headers y a veces
fallan en redes corporativas. SSE además tiene reconnect automático del
browser sin código extra.

**¿Por qué la rama `data`?**
Mantener los CSVs/JSONs auto-generados en `main` ensucia el git log con
~120 commits/mes solo del bot. La rama `data` es un "cementerio" de
snapshots — útil para comparar evoluciones, sin polucionar code reviews.
El deploy lee igual de los archivos locales (que `git pull origin data`
sincroniza en el VPS antes de buildear).

**¿Puedo cambiar la frecuencia (no 6h)?**
Sí, editá el `cron:` en `.github/workflows/refresh-forecast.yml` y el
`TTL_SECONDS` en `scripts/_publish_to_upstash.py` para que coincidan
(idealmente TTL >= cron + margen).
