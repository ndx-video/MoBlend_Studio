#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Mo.Blend M1 dev launcher (scripts/dev.ps1).

.DESCRIPTION
  Starts the engine (M1 core) via headless Blender, runs the M1 round-trip
  verification (synthetic template + load/set/save + shadow rotation + persistence
  proof), then launches the Wails desktop dev server in a new window.

  The verification step proves the four M1 "done when" gates on every dev run
  (no manual Blender UI required).

  Run from repo root:
    pwsh -ExecutionPolicy Bypass -File scripts/dev.ps1

  Or (if .ps1 is associated):
    .\scripts\dev.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent

Write-Host "=== Mo.Blend M1 Dev ===" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot" -ForegroundColor DarkGray

# --- Locate Blender (prefer the latest winget-managed install) ---
$blenderExe = $null
$candidates = @(
    "blender",  # if user added any Blender dir to PATH
    "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
    "C:\Program Files\Blender Foundation\Blender 5.1\blender-launcher.exe"
)

# Also scan for any higher 5.x or 4.x if present (take the highest version dir)
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
    Write-Warning "If this fails, add the Blender 5.1 (or latest) folder to your PATH or edit this script."
    $blenderExe = "blender"
}

Write-Host "Using Blender: $blenderExe" -ForegroundColor Green

# --- Engine stub ---
$stub = Join-Path $repoRoot "engine\bootstrap.py"
Write-Host "`n[1/3] Running engine stub..." -ForegroundColor Yellow
Write-Host "    $blenderExe --background --factory-startup --python `"$stub`"" -ForegroundColor DarkGray

& $blenderExe --background --factory-startup --python $stub 2>&1

Write-Host "`nEngine stub finished." -ForegroundColor Green

# --- M1 Engine Core verification (added for M1; proves the four ROADMAP gates) ---
Write-Host "`n[2/3] M1 Engine Core round-trip (synthetic template + load/set/save + shadows)..." -ForegroundColor Yellow
$m1Verify = Join-Path $repoRoot "engine\tests\m1_roundtrip.py"
& $blenderExe --background --factory-startup --python $m1Verify 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "M1 verification failed (exit $LASTEXITCODE). See output above."
    exit 1
}
Write-Host "M1 verification PASS" -ForegroundColor Green

# --- Wails desktop (empty window) ---
$wailsCmd = "wails"
# Prefer the one we installed via go
$goBin = Join-Path $env:USERPROFILE "go\bin\wails.exe"
if (Test-Path $goBin) { $wailsCmd = $goBin }

$desktopDir = Join-Path $repoRoot "desktop"
Write-Host "`n[3/3] Launching Wails dev (empty shell UI) in a new window..." -ForegroundColor Yellow
Write-Host "    cd $desktopDir ; $wailsCmd dev" -ForegroundColor DarkGray
Write-Host "    (The Wails desktop window should appear shortly — this is the M0 empty shell.)" -ForegroundColor DarkGray

try {
    Start-Process -FilePath "pwsh" -ArgumentList @(
        "-NoExit",
        "-Command",
        "cd '$desktopDir'; & '$wailsCmd' dev"
    ) -WindowStyle Normal | Out-Null

    Write-Host "`nWails dev started in separate window." -ForegroundColor Green
} catch {
    Write-Warning "Could not auto-spawn Wails window. Run manually:"
    Write-Host "    cd desktop" -ForegroundColor Cyan
    Write-Host "    wails dev" -ForegroundColor Cyan
}

Write-Host "`nM1 Engine Core ready (see ROADMAP.md for M2 — API Broker)." -ForegroundColor Cyan
Write-Host "Tip: Re-run this script after engine/ changes — it now runs the full M1 round-trip verification before launching Wails." -ForegroundColor DarkGray
