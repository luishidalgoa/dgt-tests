#!/usr/bin/env bash
# Setup del clasificador SigLIP en local (macOS / Linux / WSL).
#
# Lo que hace:
#   1. Crea un venv aislado en tools/image-classifier/.venv
#   2. Instala torch + torchvision (CPU wheels)
#   3. Instala el resto de deps de requirements.txt
#
# Lo que NO hace: descargar el modelo SigLIP. Eso ocurre automáticamente
# la primera vez que ejecutes `python classify_siglip.py` (~370 MB, una vez).
#
# Uso:
#   chmod +x setup.sh && ./setup.sh
#
# Es idempotente — reutiliza el venv si existe. Para uno limpio:
#   rm -rf .venv && ./setup.sh

set -euo pipefail

cd "$(dirname "$0")"

# ── 1. Verificar Python ────────────────────────────────────────────────
echo "🔍 Verificando Python..."
if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ python3 no está en PATH. Instálalo desde https://python.org."
    exit 1
fi
python3 --version

# ── 2. Crear venv si no existe ─────────────────────────────────────────
if [ -d ".venv" ]; then
    echo "✓ Venv ya existe en .venv (reusando)"
else
    echo "📦 Creando venv en .venv..."
    python3 -m venv .venv
fi

PIP=".venv/bin/pip"
PY=".venv/bin/python"

# ── 3. Upgrade pip ─────────────────────────────────────────────────────
echo "⬆️  Actualizando pip..."
"$PY" -m pip install --upgrade pip --quiet

# ── 4. Instalar torch + torchvision (CPU) ──────────────────────────────
# CPU wheels ~600 MB. Si tienes GPU NVIDIA y quieres aprovecharla, omite
# el --index-url y pip elegirá los wheels CUDA (~2 GB).
echo "🔥 Instalando torch + torchvision (CPU, ~600 MB)..."
"$PIP" install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# ── 5. Instalar el resto de requirements ───────────────────────────────
echo "📚 Instalando transformers, Pillow, tqdm, sentencepiece, accelerate..."
"$PIP" install -r requirements.txt

echo
echo "✅ Setup completo."
echo
echo "📌 Ahora puedes ejecutar el clasificador desde la raíz del proyecto:"
echo "   npm run images:classify"
echo
echo "   La primera vez descargará el modelo SigLIP (~370 MB)."
echo "   Después se ejecuta directamente desde caché en ~10s de arranque."
