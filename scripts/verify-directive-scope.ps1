# Dry-check: which agent directives load for a given working file path.
# Simulates session-start (global) vs nested traversal vs path-glob match.
param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$Normalized = $FilePath -replace '\\', '/'

function Get-NestedAgentsMd {
    param([string]$TargetPath)
    $results = @()
    $dir = Split-Path $TargetPath -Parent
    while ($dir -and $dir.StartsWith($RepoRoot)) {
        $agents = Join-Path $dir "AGENTS.md"
        if (Test-Path $agents) {
            $rel = $agents.Substring($RepoRoot.Length + 1) -replace '\\', '/'
            if ($rel -ne 'AGENTS.md') { $results += $rel }
        }
        $parent = Split-Path $dir -Parent
        if ($parent -eq $dir) { break }
        $dir = $parent
    }
    return $results
}

function Test-GlobMatch {
    param([string]$Pattern, [string]$Path)
    $p = $Pattern -replace '\\', '/'
    $f = $Path -replace '\\', '/'
    # Minimal glob: ** and * and {a,b} brace expansion
    $expanded = @($p)
    if ($p -match '\{([^}]+)\}') {
        $inner = $Matches[1]
        $expanded = $inner.Split(',') | ForEach-Object { $p -replace '\{[^}]+\}', $_.Trim() }
    }
    foreach ($pat in $expanded) {
        $regex = '^' + ($pat -replace '\.', '\.' -replace '\*\*/', '(?:.*/)?' -replace '\*\*', '.*' -replace '\*', '[^/]*') + '$'
        if ($f -match $regex) { return $true }
    }
    return $false
}

function Get-ClaudeRules {
    param([string]$TargetPath)
    $rulesDir = Join-Path $RepoRoot ".claude/rules"
    if (-not (Test-Path $rulesDir)) { return @() }
    Get-ChildItem $rulesDir -Filter "*.md" -Recurse | ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        if ($content -match '(?s)^---\s*\n(.*?)\n---') {
            $yaml = $Matches[1]
            $paths = @()
            foreach ($line in ($yaml -split "`n")) {
                if ($line -match '^\s*-\s*"(.+)"\s*$') { $paths += $Matches[1] }
            }
            if ($paths.Count -eq 0) { return }
            foreach ($pat in $paths) {
                if (Test-GlobMatch -Pattern $pat -Path $TargetPath) {
                    $rel = $_.FullName.Substring($RepoRoot.Length + 1) -replace '\\', '/'
                    return [PSCustomObject]@{ File = $rel; Pattern = $pat; LoadReason = "path-glob match" }
                }
            }
        }
    } | Where-Object { $_ }
}

function Get-CursorRules {
    param([string]$TargetPath)
    $rulesDir = Join-Path $RepoRoot ".cursor/rules"
    if (-not (Test-Path $rulesDir)) { return @() }
    Get-ChildItem $rulesDir -Filter "*.mdc" -Recurse | ForEach-Object {
        $content = Get-Content $_.FullName -Raw
        if ($content -match '(?s)^---\s*\n(.*?)\n---') {
            $yaml = $Matches[1]
            if ($yaml -match 'alwaysApply:\s*true') {
                $rel = $_.FullName.Substring($RepoRoot.Length + 1) -replace '\\', '/'
                return [PSCustomObject]@{ File = $rel; Pattern = "(always)"; LoadReason = "session start (alwaysApply)" }
            }
            $globs = @()
            if ($yaml -match '(?m)^globs:\s*(.+)$') {
                $globs = ($Matches[1] -split ',') | ForEach-Object { $_.Trim() }
            }
            foreach ($pat in $globs) {
                if (Test-GlobMatch -Pattern $pat -Path $TargetPath) {
                    $rel = $_.FullName.Substring($RepoRoot.Length + 1) -replace '\\', '/'
                    return [PSCustomObject]@{ File = $rel; Pattern = $pat; LoadReason = "path-glob match" }
                }
            }
        }
    } | Where-Object { $_ }
}

function Get-ClaudeSkills {
    param([string]$TargetPath)
    $skillsDir = Join-Path $RepoRoot ".claude/skills"
    if (-not (Test-Path $skillsDir)) { return @() }
    Get-ChildItem $skillsDir -Directory | ForEach-Object {
        $skillFile = Join-Path $_.FullName "SKILL.md"
        if (-not (Test-Path $skillFile)) { return }
        $content = Get-Content $skillFile -Raw
        if ($content -match '(?s)^---\s*\n(.*?)\n---') {
            $yaml = $Matches[1]
            $paths = @()
            foreach ($line in ($yaml -split "`n")) {
                if ($line -match '^\s*-\s*"(.+)"\s*$') { $paths += $Matches[1] }
            }
            foreach ($pat in $paths) {
                if (Test-GlobMatch -Pattern $pat -Path $TargetPath) {
                    $rel = $skillFile.Substring($RepoRoot.Length + 1) -replace '\\', '/'
                    return [PSCustomObject]@{ File = $rel; Pattern = $pat; LoadReason = "skill paths match (on-demand)" }
                }
            }
        }
    } | Where-Object { $_ }
}

Write-Host "Directive scope dry-check"
Write-Host "  Repo:  $RepoRoot"
Write-Host "  File:  $Normalized"
Write-Host ""

Write-Host "SESSION START (always loaded):"
Write-Host "  - AGENTS.md (root)"
Write-Host "  - CLAUDE.md (root, imports AGENTS.md)"
Write-Host ""

Write-Host "NESTED TRAVERSAL (on-demand when working in subtree):"
$nested = Get-NestedAgentsMd -TargetPath (Join-Path $RepoRoot $Normalized)
if ($nested.Count -eq 0) {
    Write-Host "  (none)"
} else {
    $nested | ForEach-Object { Write-Host "  - $_" }
}
Write-Host ""

Write-Host "PATH-GLOB RULES (.claude/rules):"
$claudeRules = @(Get-ClaudeRules -TargetPath $Normalized)
if ($claudeRules.Count -eq 0) { Write-Host "  (none)" }
else { $claudeRules | ForEach-Object { Write-Host "  - $($_.File) [$($_.Pattern)]" } }
Write-Host ""

Write-Host "PATH-GLOB RULES (.cursor/rules):"
$cursorRules = @(Get-CursorRules -TargetPath $Normalized)
if ($cursorRules.Count -eq 0) { Write-Host "  (none)" }
else { $cursorRules | ForEach-Object { Write-Host "  - $($_.File) [$($_.Pattern)]" } }
Write-Host ""

Write-Host "SKILLS (paths-conditional, on-demand):"
$skills = @(Get-ClaudeSkills -TargetPath $Normalized)
if ($skills.Count -eq 0) { Write-Host "  (none auto-match; invoke via /skill-name)" }
else { $skills | ForEach-Object { Write-Host "  - $($_.File) [$($_.Pattern)]" } }
Write-Host ""

$sessionOnly = @("AGENTS.md", "CLAUDE.md")
$scoped = $nested.Count + $claudeRules.Count + $cursorRules.Count + $skills.Count
Write-Host "Summary: $scoped scoped directive(s) for this path; root loads $($sessionOnly.Count) global file(s) at session start."