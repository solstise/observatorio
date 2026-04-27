#!/usr/bin/env bash
# ==============================================================================
# Deploy observatorio → VPS (187.77.54.19 / observatorio.sistemaswinter.com)
# Uso: bash deploy-vps.sh
#
# Qué hace:
#   1. Tarealiza SOLO webapp/frontend (el backend FastAPI no se deploya por
#      ahora; el frontend sirve datos estáticos desde public/data/).
#   2. Sube el tar por SSH a /opt/apps/observatorio/.
#   3. Dispara `docker compose build observatorio` y `up -d` en el host.
#
# Requisitos previos (primer deploy):
#   - Entrada `observatorio` agregada a /opt/apps/docker-compose.yml
#     (usá deploy/observatorio.compose.snippet.yml como referencia).
#   - DNS de observatorio.sistemaswinter.com → 187.77.54.19.
#   - Reverse proxy del VPS (nginx/Traefik) ruteando el subdominio al
#     puerto 3011 del host.
# ==============================================================================

set -euo pipefail

VPS_HOST="root@187.77.54.19"
VPS_APP_DIR="/opt/apps/observatorio"
APP_NAME="observatorio"
LOCAL_SRC="webapp/frontend"

cd "$(dirname "$0")"

if [[ ! -d "$LOCAL_SRC" ]]; then
  echo "ERROR: no encuentro $LOCAL_SRC. Corré este script desde la raíz del proyecto." >&2
  exit 1
fi

echo "======================================================"
echo "  Deploy $APP_NAME -> VPS"
echo "  Destino: $VPS_HOST:$VPS_APP_DIR"
echo "======================================================"

echo ""
echo "[1/3] Asegurando que el directorio remoto exista..."
ssh -o StrictHostKeyChecking=no "$VPS_HOST" "mkdir -p '$VPS_APP_DIR'"

echo ""
echo "[2/3] Sincronizando $LOCAL_SRC/ al VPS (tar via ssh)..."
tar \
  --exclude='./node_modules' \
  --exclude='./.next' \
  --exclude='./.git' \
  --exclude='./.env' \
  --exclude='./.env.local' \
  --exclude='./out' \
  --exclude='./dist' \
  --exclude='./build' \
  --exclude='./*.log' \
  -czf - -C "$LOCAL_SRC" . | \
  ssh -o StrictHostKeyChecking=no "$VPS_HOST" "tar -xzf - -C '$VPS_APP_DIR'"

echo "  Sincronización OK."

echo ""
echo "[3/3] Building contenedor Docker en el VPS (puede tardar 2-4 min)..."
# pipefail para que el | tail -20 no enmascare un fallo del build
# (Docker Hub puede dar TLS handshake timeout transitorio al pullear el
# base image — sin pipefail, el script reporta éxito y queda corriendo
# la imagen vieja con datos viejos).
ssh "$VPS_HOST" "
  set -eo pipefail
  cd /opt/apps
  # Reintentamos build hasta 3 veces ante fallos transitorios de Docker Hub.
  attempts=0
  until docker compose build $APP_NAME 2>&1 | tail -30; do
    attempts=\$((attempts + 1))
    if [ \"\$attempts\" -ge 3 ]; then
      echo 'ERROR: docker compose build falló 3 veces seguidas' >&2
      exit 1
    fi
    echo \"Build falló (intento \$attempts/3). Reintentando en 20s...\"
    sleep 20
  done
  docker compose up -d $APP_NAME
  sleep 3
  docker ps --filter name=$APP_NAME --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
"

echo ""
echo "======================================================"
echo "  Deploy completo"
echo "  URL directa: http://187.77.54.19:3011"
echo "  URL pública: https://observatorio.sistemaswinter.com (tras DNS + nginx)"
echo "======================================================"
