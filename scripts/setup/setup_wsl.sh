#!/usr/bin/env bash
# Setup del entorno de desarrollo en WSL2 Ubuntu para el Observatorio Urbano Posadas.
#
# Qué hace:
#   1. Instala deps del sistema (Python pip + venv, GDAL, ffmpeg, libs de WeasyPrint)
#   2. Crea el venv dentro del proyecto
#   3. Instala las deps de Python con pip (requirements.txt + requirements-dev.txt)
#   4. Deja el venv listo para activar
#
# Uso:
#   Desde Windows:
#     wsl -d Ubuntu -- bash /mnt/c/ProyectosIA/Antigravity/observatorio/scripts/setup/setup_wsl.sh
#   Desde WSL directamente:
#     cd /mnt/c/ProyectosIA/Antigravity/observatorio
#     bash scripts/setup/setup_wsl.sh
#
# El script pide el password de sudo una sola vez para apt install.
# No modifica nada fuera del proyecto salvo los paquetes del sistema listados arriba.

set -euo pipefail

# Colores para la consola
ROJO='\033[0;31m'
VERDE='\033[0;32m'
AMARILLO='\033[1;33m'
AZUL='\033[0;34m'
RESET='\033[0m'

log_info() { echo -e "${AZUL}[setup]${RESET} $*"; }
log_ok() { echo -e "${VERDE}[ok]${RESET} $*"; }
log_warn() { echo -e "${AMARILLO}[warn]${RESET} $*"; }
log_error() { echo -e "${ROJO}[error]${RESET} $*" >&2; }

# Detectar root del proyecto (asumiendo que este script vive en scripts/setup/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

log_info "Raíz del proyecto: $PROJECT_ROOT"
cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# 1. Deps del sistema
# ---------------------------------------------------------------------------

log_info "Actualizando índice de paquetes apt (puede tardar 1-2 min)..."
sudo apt-get update -y

log_info "Instalando paquetes del sistema..."
# Paquetes justificados:
#   python3-pip, python3-venv → pip y entornos virtuales
#   build-essential, python3-dev → compilar extensiones C (para rasterio, shapely)
#   gdal-bin, libgdal-dev → GDAL (requerido por rasterio/geopandas)
#   libpango-1.0-0, libpangoft2-1.0-0, libcairo2, libgdk-pixbuf2.0-0 → WeasyPrint
#   libffi-dev, shared-mime-info → extras de WeasyPrint
#   ffmpeg → timelapses MP4
#   git → ya suele estar pero por las dudas
sudo apt-get install -y \
  python3-pip \
  python3-venv \
  python3-dev \
  build-essential \
  gdal-bin \
  libgdal-dev \
  libpango-1.0-0 \
  libpangoft2-1.0-0 \
  libcairo2 \
  libgdk-pixbuf2.0-0 \
  libffi-dev \
  shared-mime-info \
  ffmpeg \
  git

log_ok "Deps del sistema instaladas"

# ---------------------------------------------------------------------------
# 2. Virtualenv
# ---------------------------------------------------------------------------

VENV_DIR="$PROJECT_ROOT/venv"

if [ -d "$VENV_DIR" ]; then
  log_warn "Ya existe $VENV_DIR, no lo recreo"
else
  log_info "Creando virtualenv en $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
  log_ok "venv creado"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

log_info "Python del venv: $(which python) ($(python --version))"

# ---------------------------------------------------------------------------
# 3. Deps de Python
# ---------------------------------------------------------------------------

log_info "Actualizando pip dentro del venv..."
python -m pip install --upgrade pip setuptools wheel

log_info "Instalando requirements.txt (puede tardar 5-10 min la primera vez)..."
python -m pip install -r requirements.txt

if [ -f requirements-dev.txt ]; then
  log_info "Instalando requirements-dev.txt..."
  python -m pip install -r requirements-dev.txt
fi

log_ok "Deps de Python instaladas"

# ---------------------------------------------------------------------------
# 4. Verificación rápida
# ---------------------------------------------------------------------------

log_info "Verificación rápida de imports críticos..."
python - <<'PY'
import sys
print(f"Python: {sys.version.split()[0]}")
modulos = ["ee", "geopandas", "rasterio", "shapely", "pyproj",
           "PIL", "imageio", "numpy", "pandas", "matplotlib",
           "jinja2", "weasyprint", "tqdm", "loguru", "click",
           "mercantile", "folium"]
faltan = []
for m in modulos:
    try:
        __import__(m)
        print(f"  [ok]   {m}")
    except ImportError as e:
        faltan.append((m, str(e)))
        print(f"  [FAIL] {m}  ({e})")

if faltan:
    print(f"\nFaltan {len(faltan)} módulos. Revisar arriba.")
    sys.exit(1)
print("\nTodos los imports OK.")
PY

log_ok "Setup completo."

# ---------------------------------------------------------------------------
# 5. Mensaje final
# ---------------------------------------------------------------------------

cat <<EOF

${VERDE}══════════════════════════════════════════════════════════════${RESET}
  Setup de WSL completado.

  Para usar el proyecto en próximas sesiones:

    cd /mnt/c/ProyectosIA/Antigravity/observatorio
    source venv/bin/activate

  Próximos pasos manuales (fuera de este script):
    1. Crear proyecto en Google Cloud + habilitar Earth Engine API
    2. Registrarte como usuario de Earth Engine (gratis, no-comercial)
    3. Autenticar con:   earthengine authenticate
    4. Completar el .env con EE_PROJECT_ID
    5. Correr:           python scripts/test_ee_auth.py

${VERDE}══════════════════════════════════════════════════════════════${RESET}
EOF
