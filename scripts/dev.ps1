#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Mo.Blend M0 dev launcher (scripts/dev.ps1).

.DESCRIPTION
  Starts the engine stub via headless Blender (demonstrates --python entrypoint)
  and launches the Wails desktop dev server in a new window (opens the empty shell UI).

  Run from repo root:
    pwsh -ExecutionPolicy Bypass -File scripts/dev.ps1

  Or (if .ps1 is associated):
    .\scripts\dev.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent

Write-Host "=== Mo.Blend M0 Dev ===" -ForegroundColor Cyan
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
Write-Host "`n[1/2] Running engine stub..." -ForegroundColor Yellow
Write-Host "    $blenderExe --background --factory-startup --python `"$stub`"" -ForegroundColor DarkGray

& $blenderExe --background --factory-startup --python $stub 2>&1

Write-Host "`nEngine stub finished." -ForegroundColor Green

# --- Wails desktop (empty window) ---
$wailsCmd = "wails"
# Prefer the one we installed via go
$goBin = Join-Path $env:USERPROFILE "go\bin\wails.exe"
if (Test-Path $goBin) { $wailsCmd = $goBin }

$desktopDir = Join-Path $repoRoot "desktop"
Write-Host "`n[2/2] Launching Wails dev (empty shell UI) in a new window..." -ForegroundColor Yellow
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

Write-Host "`nM0 scaffold ready. See ROADMAP.md for next (M1 — Engine Core)." -ForegroundColor Cyan
Write-Host "Tip: After changes to engine/ you can re-run this script to re-verify the stub." -ForegroundColor DarkGray
