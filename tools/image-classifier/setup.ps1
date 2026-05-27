# Setup del clasificador SigLIP en local (Windows / PowerShell).
#
# Lo que hace:
#   1. Crea un venv aislado en tools/image-classifier/.venv
#   2. Instala torch + torchvision (CPU wheels, ~600 MB en vez de los 2GB de CUDA)
#   3. Instala el resto de deps de requirements.txt
#
# Lo que NO hace: descargar el modelo SigLIP. Eso ocurre automáticamente la
# primera vez que ejecutes `python classify_siglip.py` (~370 MB, una vez).
#
# Uso:
#   .\setup.ps1
#
# Es idempotente — si el venv ya existe, lo reutiliza. Si quieres uno limpio:
#   Remove-Item -Recurse -Force .venv
#   .\setup.ps1
#
# Nota sobre encoding: este archivo está guardado con BOM UTF-8 (3 bytes
# invisibles al inicio) para que PowerShell 5.1 (Windows PowerShell legacy)
# lo lea correctamente. Sin BOM, PS 5.1 asume CP1252 y los emojis (🔥 📦 ✅)
# se corrompen → bytes UTF-8 mal interpretados como comillas → parse error.
# PowerShell 7+ no necesita BOM (asume UTF-8) pero el BOM tampoco molesta.

$ErrorActionPreference = "Stop"

# Cambiar al directorio del script (por si lo invocan desde otra carpeta)
Set-Location -Path $PSScriptRoot

# ── 1. Verificar Python ────────────────────────────────────────────────
Write-Host "🔍 Verificando Python..." -ForegroundColor Cyan
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "❌ Python no está en PATH. Instálalo desde https://python.org y reinicia PowerShell." -ForegroundColor Red
    exit 1
}
$pyVersion = & python --version 2>&1
Write-Host "   $pyVersion"

# ── 2. Crear venv si no existe ─────────────────────────────────────────
if (Test-Path ".venv") {
    Write-Host "✓ Venv ya existe en .venv (reusando)" -ForegroundColor Green
} else {
    Write-Host "📦 Creando venv en .venv..." -ForegroundColor Cyan
    & python -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Falló creando venv" -ForegroundColor Red
        exit 1
    }
}

$pipExe = Join-Path $PSScriptRoot ".venv\Scripts\pip.exe"
$pyExe  = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

# ── 3. Upgrade pip (a veces el venv trae uno viejo) ────────────────────
Write-Host "⬆️  Actualizando pip..." -ForegroundColor Cyan
& $pyExe -m pip install --upgrade pip --quiet

# ── 4. Instalar torch + torchvision (CPU) ──────────────────────────────
# CUDA pesa ~2 GB y solo sirve si tienes GPU NVIDIA. CPU es ~600 MB y
# funciona en cualquier máquina. Si tienes GPU y quieres aprovecharla,
# borra esta línea y reinstala sin --index-url.
Write-Host "🔥 Instalando torch + torchvision (CPU, ~600 MB)..." -ForegroundColor Cyan
& $pipExe install torch torchvision --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Falló instalando torch/torchvision" -ForegroundColor Red
    exit 1
}

# ── 5. Instalar el resto de requirements ───────────────────────────────
Write-Host "📚 Instalando transformers, Pillow, tqdm, modal, etc..." -ForegroundColor Cyan
& $pipExe install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Falló instalando requirements.txt" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ Setup completo." -ForegroundColor Green
Write-Host ""
Write-Host "📌 Ahora puedes ejecutar el clasificador desde la raíz del proyecto:" -ForegroundColor Gray
Write-Host "   npm run images:classify         # local (CPU)" -ForegroundColor Cyan
Write-Host "   npm run images:classify-modal   # cloud GPU (necesita 'npm run images:setup-modal' la primera vez)" -ForegroundColor Cyan
Write-Host ""
Write-Host "   La primera vez images:classify descargará el modelo SigLIP (~370 MB)." -ForegroundColor Gray
Write-Host "   Después se ejecuta directamente desde caché en ~10s de arranque." -ForegroundColor Gray
