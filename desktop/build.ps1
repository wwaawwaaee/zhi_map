param([switch]$SkipInstaller)

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

# Inno Setup's own uninstall entry. The HKLM key lands under WOW6432Node because
# Inno Setup is a 32-bit installer.
$InnoUninstallKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1'
)

function Get-InnoCompiler {
    $candidates = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe")
    foreach ($key in $InnoUninstallKeys) {
        $location = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).InstallLocation
        if ($location) { $candidates += Join-Path $location 'ISCC.exe' }
    }
    foreach ($candidate in $candidates) { if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate } }
    return $null
}

# ISCC.exe carries no version resource -- its FileVersion is always 0.0.0.0 -- so the
# installed version has to come from the uninstall entry. Returns $null when it cannot
# be determined, and the caller then skips the version gate rather than guess.
function Get-InnoVersion {
    foreach ($key in $InnoUninstallKeys) {
        $value = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).DisplayVersion
        if ($value -and $value -match '^\d+(\.\d+)+') { return [version]$Matches[0] }
    }
    return $null
}

# The WebView2 bootstrapper gets embedded in the installer so the target machine needs
# no network. Cached under desktop\build\ (gitignored, and safe to fill in by hand).
# Fetching it is best-effort on purpose: it goes through a Microsoft CDN that some
# networks cannot reach, and a release build must not hinge on a third-party host.
# Returns $null when no trustworthy bootstrapper is available; the installer then just
# points users at the download page.
function Get-WebView2Bootstrapper {
    $target = "$PSScriptRoot\build\MicrosoftEdgeWebview2Setup.exe"
    if (-not (Test-Path -LiteralPath $target)) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
        Write-Host 'Downloading the Microsoft Edge WebView2 bootstrapper...'
        try {
            Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $target -UseBasicParsing
        } catch {
            Write-Warning "Could not download the WebView2 bootstrapper: $($_.Exception.Message)"
            Remove-Item -LiteralPath $target -ErrorAction SilentlyContinue
            return $null
        }
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') {
        Write-Warning "Discarding $target : not a valid Microsoft-signed binary."
        Remove-Item -LiteralPath $target -ErrorAction SilentlyContinue
        return $null
    }
    return $target
}

function Invoke-InstallerBuild {
    $iscc = Get-InnoCompiler
    if (-not $iscc) {
        throw 'Inno Setup not found. Install 6.3+ from https://jrsoftware.org/isdl.php, or pass -SkipInstaller to build only the ZIP.'
    }
    $found = Get-InnoVersion
    if ($found -and $found -lt [version]'6.3') {
        throw "Inno Setup 6.3 or newer is required, found $found : $iscc. The x64compatible architecture identifier needs 6.3."
    }
    # Inno Setup ships no Simplified Chinese translation. Use the third-party
    # ChineseSimplified.isl when the maintainer installed it, otherwise English.
    $language = @('/DLANG_NAME=english', '/DLANG_FILE=compiler:Default.isl')
    if (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $iscc) 'Languages\ChineseSimplified.isl')) {
        $language = @('/DLANG_NAME=chinesesimplified', '/DLANG_FILE=compiler:Languages\ChineseSimplified.isl')
    } else {
        Write-Warning 'Inno Setup has no Languages\ChineseSimplified.isl; the installer wizard will be in English.'
    }
    $bootstrapper = Get-WebView2Bootstrapper
    $embed = if ($bootstrapper) { '1' } else { '0' }
    if (-not $bootstrapper) {
        Write-Warning 'Building an installer without the bundled WebView2 runtime; it will point users at the download page instead.'
    }
    $build = Get-Content -LiteralPath "$PSScriptRoot\build-info.json" -Raw | ConvertFrom-Json
    & $iscc "/DAPP_VERSION=$($build.version)" "/DBUILD_ID=$($build.build_id)" "/DEMBED_WEBVIEW2=$embed" $language "$PSScriptRoot\installer.iss"
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed: $LASTEXITCODE" }
    py release.py installer
    if ($LASTEXITCODE -ne 0) { throw "Installer release step failed: $LASTEXITCODE" }
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
    if ($SkipInstaller) {
        Write-Warning 'Skipped the installer build (-SkipInstaller); only the portable ZIP was produced.'
    } else {
        Invoke-InstallerBuild
    }
} finally {
    Pop-Location
}
