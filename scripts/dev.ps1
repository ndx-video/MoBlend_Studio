#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Mo.Blend M1/M2 dev launcher (scripts/dev.ps1).

.DESCRIPTION
  [1/5] Engine stub
  [2/5] M1 round-trip verification
  [3/5] Install broker deps into Blender's Python
  [4/5] Launch long-running API broker (--serve)
  [5/5] Automated M2 broker client (REST + binary WS)

  Run from repo root:
    pwsh -ExecutionPolicy Bypass -File scripts/dev.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent

Write-Host "=== Mo.Blend M1/M2 Dev ===" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot" -ForegroundColor DarkGray

# --- Locate Blender (prefer the latest winget-managed install) ---
$blenderExe = $null
$candidates = @(
    "blender",
    "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
    "C:\Program Files\Blender Foundation\Blender 5.1\blender-launcher.exe"
)

$base = "C:\Program Files\Blender Foundation"
if (Test-Path $base) {
    $latestDir = Get-ChildItem $base -Directory |
        Where-Object { $_.Name -match 'Blender \d' } |
        Sort-Object { [version]($_.Name -replace 'Blender ','') } -Descending |
        Select-Object -First 1
    if ($latestDir) {
        $auto = Join-Path $latestDir.FullName "blender.exe"
        if (Test-Path $auto) { $candidates = @($auto) + $candidates }
    }
}

foreach ($c in $candidates) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
        $blenderExe = $c
        break
    }
    if (Test-Path $c) {
        $blenderExe = $c
        break
    }
}

if (-not $blenderExe) {
    Write-Warning "Could not auto-detect Blender. Falling back to 'blender' in PATH."
    $blenderExe = "blender"
}

Write-Host "Using Blender: $blenderExe" -ForegroundColor Green

# --- [1/5] Engine stub ---
$stub = Join-Path $repoRoot "engine\bootstrap.py"
Write-Host "`n[1/5] Running engine stub..." -ForegroundColor Yellow
Write-Host "    $blenderExe --background --factory-startup --python `"$stub`"" -ForegroundColor DarkGray

& $blenderExe --background --factory-startup --python $stub 2>&1
Write-Host "Engine stub finished." -ForegroundColor Green

# --- [2/5] M1 Engine Core verification ---
Write-Host "`n[2/5] M1 Engine Core round-trip..." -ForegroundColor Yellow
$m1Verify = Join-Path $repoRoot "engine\tests\m1_roundtrip.py"
& $blenderExe --background --factory-startup --python $m1Verify 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "M1 verification failed (exit $LASTEXITCODE). See output above."
    exit 1
}
Write-Host "M1 verification PASS" -ForegroundColor Green

# --- Wails discovery (optional manual launch note) ---
$wailsCmd = "wails"
$goBin = Join-Path $env:USERPROFILE "go\bin\wails.exe"
if (Test-Path $goBin) { $wailsCmd = $goBin }
$desktopDir = Join-Path $repoRoot "desktop"

# --- [3/5] Broker deps into Blender's Python ---
Write-Host "`n[3/5] Ensuring FastAPI/uvicorn in Blender's Python (M2 broker)..." -ForegroundColor Yellow

$blenderPy = $null
try {
    $probeOut = & $blenderExe --background --factory-startup --python-expr "import sys; print(sys.executable)" 2>&1
    $cand = $probeOut | Select-String -Pattern '\.exe$' | Select-Object -Last 1
    if ($cand) { $blenderPy = $cand.Line.Trim() }
} catch { }

if (-not $blenderPy -or -not (Test-Path $blenderPy)) {
    $blenderDir = Split-Path $blenderExe -Parent
    $possible = @(
        (Join-Path $blenderDir "python\python.exe"),
        (Join-Path $blenderDir "python\bin\python.exe"),
        (Join-Path $blenderDir "4.2\python\bin\python.exe"),
        (Join-Path $blenderDir "..\python\python.exe")
    )
    foreach ($p in $possible) {
        if (Test-Path $p) { $blenderPy = $p; break }
    }
}

if ($blenderPy -and (Test-Path $blenderPy)) {
    Write-Host "    Blender Python: $blenderPy" -ForegroundColor DarkGray
    $vendorDir = Join-Path $repoRoot "engine\vendor"
    if (-not (Test-Path $vendorDir)) {
        New-Item -ItemType Directory -Path $vendorDir | Out-Null
    }
    & $blenderPy -m pip install --quiet --disable-pip-version-check --upgrade --target $vendorDir fastapi "uvicorn[standard]" 2>&1 | Out-Null
    $vendorPath = $vendorDir -replace '\\', '/'
    $verifyExpr = "import sys; sys.path.insert(0, r'$vendorDir'); import fastapi, uvicorn; print('BROKER_DEPS_OK', fastapi.__version__, uvicorn.__version__)"
    $verify = & $blenderExe --background --factory-startup --python-expr $verifyExpr 2>&1 | Select-String -Pattern 'BROKER_DEPS_OK'
    if ($verify) {
        Write-Host "    Broker runtime deps verified inside Blender python." -ForegroundColor Green
    } else {
        Write-Warning "pip reported success but Blender python cannot import fastapi/uvicorn yet."
    }
} else {
    Write-Warning "Could not locate Blender's python.exe for pip install."
}

# --- [4/5] Launch broker in background ---
$m1Test = Join-Path $env:TEMP "m1_minimal_test.mo.blend"
$serveCmd = "`"$blenderExe`" --background --factory-startup --python `"$stub`" -- --serve"
if (Test-Path $m1Test) {
    $serveCmd = "`"$blenderExe`" --background --factory-startup --python `"$stub`" -- --serve --load `"$m1Test`""
}

Write-Host "`n[4/5] Launching Mo.Blend API Broker..." -ForegroundColor Yellow
Write-Host "    $serveCmd" -ForegroundColor DarkGray

try {
    $serveArgs = @(
        "--background",
        "--factory-startup",
        "--python", $stub,
        "--", "--serve"
    )
    if (Test-Path $m1Test) {
        $serveArgs += @("--load", $m1Test)
    }
    Start-Process -FilePath $blenderExe -ArgumentList $serveArgs -WindowStyle Normal | Out-Null
    Write-Host "Broker serve started in separate window." -ForegroundColor Green
} catch {
    Write-Warning "Could not auto-spawn broker window. Run manually:"
    Write-Host "    $serveCmd" -ForegroundColor Cyan
}

# Wait for broker health (retry up to ~45s)
Write-Host "    Waiting for broker health..." -ForegroundColor DarkGray
$healthOk = $false
for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -TimeoutSec 2 -ErrorAction Stop
        Write-Host "Broker health: loaded=$($h.loaded) template_id=$($h.template_id)" -ForegroundColor Green
        $healthOk = $true
        break
    } catch {
        # still starting
    }
}
if (-not $healthOk) {
    Write-Warning "Broker did not respond to /health within 45s. M2 client may fail."
}

# --- [5/5] Automated M2 broker client ---
Write-Host "`n[5/5] M2 broker verification client..." -ForegroundColor Yellow

$hasWebsockets = $false
try {
    & python -c "import websockets" 2>$null
    if ($LASTEXITCODE -eq 0) { $hasWebsockets = $true }
} catch { }

if (-not $hasWebsockets) {
    Write-Warning "Host Python missing 'websockets' — skipping automated M2 WS test."
    Write-Host "    pip install websockets httpx" -ForegroundColor Cyan
    Write-Host "    python -m engine.tests.m2_broker_client" -ForegroundColor Cyan
} else {
    Push-Location $repoRoot
    try {
        & python -m engine.tests.m2_broker_client --port 8000 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "M2 broker verification failed (exit $LASTEXITCODE)."
            exit 1
        }
        Write-Host "M2 verification PASS" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

Write-Host "`n(Optional Wails shell: cd desktop; $wailsCmd dev )" -ForegroundColor DarkGray
Write-Host "`n=== M2 API Broker ready ===" -ForegroundColor Cyan
Write-Host "Broker URL  : http://127.0.0.1:8000  (Swagger: /docs)" -ForegroundColor White
Write-Host "Interactive : engine/tests/m2_viewport_tester.html" -ForegroundColor White
Write-Host "Tip: Re-run scripts/dev.ps1 after engine changes." -ForegroundColor DarkGray
