$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path "$root\backend")) { throw 'backend directory is required' }
Push-Location $root
try {
    npm run build:web
    if ($LASTEXITCODE -ne 0) { throw "Web build failed: $LASTEXITCODE" }
    py -m pip install -e "backend[desktop]"
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed: $LASTEXITCODE" }
} finally {
    Pop-Location
}
Push-Location $PSScriptRoot
try {
    py release.py prepare
    if ($LASTEXITCODE -ne 0) { throw "Build identity failed: $LASTEXITCODE" }
    py -m PyInstaller --noconfirm --clean zhishu.spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed: $LASTEXITCODE" }
    if (-not (Test-Path -LiteralPath "$PSScriptRoot\dist")) { throw 'Missing dist directory' }
    py release.py package
    if ($LASTEXITCODE -ne 0) { throw "Release ZIP failed: $LASTEXITCODE" }
} finally {
    Pop-Location
}
