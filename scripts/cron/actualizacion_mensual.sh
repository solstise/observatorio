#!/usr/bin/env bash
# Actualización mensual automática — Observatorio Urbano Posadas.
#
# IMPORTANTE: este archivo DEBE estar con line endings LF (sin CR). Si lo
# editás en Windows, configurá `.gitattributes` con `*.sh text eol=lf` o
# usá `dos2unix scripts/cron/actualizacion_mensual.sh` antes de commitear.
# En Alpine/Ubuntu, CRLF rompe la ejecución con "bad interpreter".
#
# Invocación desde cron (ver scripts/cron/README.md):
#     0 2 1 * * /opt/observatorio/scripts/cron/actualizacion_mensual.sh
#
# Exit codes
#   0  todo OK
#   1  fallo crítico (no se generó ningún output útil)
#   2  éxito parcial (algún paso falló pero hay outputs utilizables)

set -euo pipefail
IFS=$'\n\t'

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
VENV_DIR="${OBSERVATORIO_VENV:-${PROJECT_ROOT}/.venv}"
FRONTEND_DATA_DIR="${OBSERVATORIO_FRONTEND_DATA:-${PROJECT_ROOT}/webapp/public/data}"
LOG_DIR="${OBSERVATORIO_LOG_DIR:-/var/log/observatorio}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
TODAY="$(date +%Y%m%d)"
LOG_FILE="${LOG_DIR}/${TODAY}.log"

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

echo "================================================================="
echo "Observatorio Urbano Posadas — actualización ${TIMESTAMP}"
echo "Project root: ${PROJECT_ROOT}"
echo "Venv:         ${VENV_DIR}"
echo "Frontend:     ${FRONTEND_DATA_DIR}"
echo "Log:          ${LOG_FILE}"
echo "================================================================="

PARCIAL=0
FATAL=0

log_step() {
    echo ""
    echo "--- [$(date +%H:%M:%S)] $* ---"
}

run_step() {
    local nombre="$1"; shift
    log_step "${nombre}"
    if "$@"; then
        echo "[OK] ${nombre}"
    else
        local rc=$?
        echo "[FAIL rc=${rc}] ${nombre}"
        PARCIAL=1
        return ${rc}
    fi
}

# ---------------------------------------------------------------------------
# Activación venv
# ---------------------------------------------------------------------------

if [[ ! -f "${VENV_DIR}/bin/activate" ]]; then
    echo "[FATAL] No existe el venv en ${VENV_DIR}."
    exit 1
fi
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
cd "${PROJECT_ROOT}"
echo "Python: $(python --version) | $(which python)"

MES_ACTUAL="$(date +%Y-%m)"

# ---------------------------------------------------------------------------
# Pipeline de descarga y procesamiento
# ---------------------------------------------------------------------------

run_step "02 Planet NICFI (${MES_ACTUAL})" \
    python scripts/02_descarga_nicfi.py --meses "${MES_ACTUAL}" || true

run_step "01 Sentinel-2 del mes (${MES_ACTUAL})" \
    python scripts/01_descarga_sentinel2.py --fechas "${MES_ACTUAL}" || true

run_step "20 Conteo edificios incremental" \
    python scripts/20_contar_techos.py --incremental || true

run_step "40 Distancias a servicios" \
    python scripts/40_calcular_distancias_servicios.py || true

run_step "35 Vulnerabilidad (borrador)" \
    python scripts/35_indice_vulnerabilidad.py || true

run_step "50 Timelapses" \
    python scripts/50_generar_timelapse.py || true

run_step "60 PDFs" \
    python scripts/60_generar_pdf.py || true

# ---------------------------------------------------------------------------
# Sincronización con el frontend
# ---------------------------------------------------------------------------

if [[ -d "${PROJECT_ROOT}/data/processed" && -d "${PROJECT_ROOT}/data/outputs" ]]; then
    mkdir -p "${FRONTEND_DATA_DIR}"
    log_step "rsync processed/ → frontend"
    if ! rsync -a --delete \
        --exclude '*.tmp' \
        "${PROJECT_ROOT}/data/processed/" \
        "${FRONTEND_DATA_DIR}/processed/"; then
        echo "[FAIL] rsync processed"
        PARCIAL=1
    fi
    log_step "rsync outputs/ → frontend"
    if ! rsync -a \
        "${PROJECT_ROOT}/data/outputs/" \
        "${FRONTEND_DATA_DIR}/outputs/"; then
        echo "[FAIL] rsync outputs"
        PARCIAL=1
    fi
else
    echo "[WARN] data/processed o data/outputs no existen — skip rsync."
    PARCIAL=1
fi

# ---------------------------------------------------------------------------
# Notificaciones
# ---------------------------------------------------------------------------

notify_slack() {
    local payload
    payload="$(printf '{"text":"Observatorio Posadas: actualización %s — estado=%s (log=%s)"}' \
        "${TIMESTAMP}" "$1" "${LOG_FILE}")"
    curl -fsS -X POST -H 'Content-Type: application/json' \
        --data "${payload}" "${SLACK_WEBHOOK_URL}" >/dev/null || true
}

notify_telegram() {
    curl -fsS -X POST \
        "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_CHAT_ID}" \
        -d "text=Observatorio Posadas ${TIMESTAMP} — estado=$1" >/dev/null || true
}

ESTADO="ok"
if [[ ${FATAL} -ne 0 ]]; then
    ESTADO="fatal"
elif [[ ${PARCIAL} -ne 0 ]]; then
    ESTADO="parcial"
fi

if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
    notify_slack "${ESTADO}"
fi
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
    notify_telegram "${ESTADO}"
fi

echo ""
echo "================================================================="
echo "Fin ${TIMESTAMP} — estado=${ESTADO} (parcial=${PARCIAL} fatal=${FATAL})"
echo "================================================================="

if [[ ${FATAL} -ne 0 ]]; then
    exit 1
elif [[ ${PARCIAL} -ne 0 ]]; then
    exit 2
else
    exit 0
fi
