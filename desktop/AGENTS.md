# Desktop — Mo.Blend Studio (Wails)

Wails v2 shell: Go backend + React/TypeScript frontend. PRD 4 (§8–§13 for M3).

## Layout

```
desktop/
├── main.go, app.go    # Wails entry + Go bindings
├── wails.json
└── frontend/          # React + Vite — connects directly to broker :8000
```

## Architecture (non-negotiable)

- React talks HTTP/WebSocket to `127.0.0.1:8000` for manifest and viewport data.
- Go spawns/supervises Blender+broker and handles OS concerns (paths, drag-drop, config).
- Go must **not** proxy viewport frames (base64 overhead).

## Development

| Task | Command |
|------|---------|
| Engine + broker | `pwsh -ExecutionPolicy Bypass -File scripts/dev.ps1` (repo root) |
| Wails live reload | `cd desktop && wails dev` |
| Production build | `cd desktop && wails build` |

Go backend changes require restarting `wails dev` (Ctrl+C, relaunch). Frontend hot-reloads via Vite.

## UI design

Stitch exports: [specs/stitch/README.md](../specs/stitch/README.md). Implement React per PRD 4 §11 — do not paste Stitch `code.html`.

## Configuration & persistence

- `wails.json` — window size ≥1280×800 (PRD 4 §10.5)
- Suite config: `%USERPROFILE%\.moblend\config.json` — human-editable shared settings (PRD 4 §7)
- **`studio.db`** (M3a) — Studio-owned metadata: `recent_projects`, `asset_index`, `installed_templates`. Go package: `desktop/internal/store/`. M4c adds install CRUD + `InstallTemplate` binding. See [M3a spec](../specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md), [M4c spec](../specs/M4c%20-%20Go%20Template%20Install.md).
- **`suite_logs.db`** (M3a) — append-only `log_events`; Studio writes via same `store` package. Do not log secrets.

## Frontend verification

All React/GUI changes: run Playwright E2E before claiming completion. Use `/desktop-e2e-verify` or see [desktop/README.md](README.md#automated-e2e-testing-required-for-gui-work).