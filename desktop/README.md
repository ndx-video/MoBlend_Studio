# Mo.Blend Studio (Wails desktop)

Wails v2 shell for **Mo.Blend Studio** — Go backend + React/TypeScript frontend. Product spec: [PRD 4](../specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) (§8–§13 cover M3 implementation, Stitch integration, and platform readiness).

## Layout

```
desktop/
├── main.go, app.go    # Wails entry + Go bindings (M3: engine spawn, file I/O)
├── wails.json
└── frontend/          # React + Vite — connects **directly** to broker :8000
```

**Architecture:** React talks HTTP/WebSocket to `127.0.0.1:8000` for render and manifest data. Go spawns/supervises Blender+broker and handles OS concerns (paths, drag-drop, config). Go must **not** proxy viewport frames. See [AGENTS.md](../AGENTS.md).

## Development

### Engine + broker (prerequisite)

From repo root (Windows):

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/dev.ps1
```

Starts M1 verify, installs broker deps into `engine/vendor`, launches the API broker, runs M2 client. Broker: `http://127.0.0.1:8000` (Swagger: `/docs`).

### Wails live reload

```powershell
cd desktop
wails dev
```

Requires [Wails v2](https://wails.io/) and Node.js for `frontend/`. During M3, Go should spawn the broker on app start; until then use `dev.ps1` alongside `wails dev`.

### Build

```powershell
cd desktop
wails build
```

## UI design references

Stitch exports (screenshots + tokens): [specs/stitch/README.md](../specs/stitch/README.md). Implement React per PRD 4 §11 — do not paste Stitch `code.html`.

## Configuration

`wails.json` — project settings. Window size should be ≥1280×800 for Stitch layouts (PRD 4 §10.5).

**`<moblend_home>`** (`%USERPROFILE%\.moblend\`): `config.json` (shared settings), `studio.db` + `suite_logs.db` (M3a — see [M3a spec](../specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md)).

## Automated E2E Testing (Required for GUI Work)

**All React / frontend / GUI changes must be verified with the Playwright E2E suite before claiming completion.** This replaces manual `wails dev` + click / refresh / debug loops.

### Running the tests (from `desktop/frontend/`)

```powershell
npm run test:e2e            # headless (default — use this for fast iteration)
npm run test:e2e:ui         # Playwright UI mode (visual debugging)
npm run test:e2e:headed     # headed browser
npm run test:e2e:report     # view last report
```

- Tests auto-start the Vite dev server (`npm run dev`) via Playwright's `webServer` config.
- Heavy mocking of Wails Go bindings (`window.go.main.App.*`) and the broker REST/WS APIs is provided so you can develop the UI without a live broker or full Wails process every time.
- Use `data-testid` attributes (already present on nav, buttons, canvas container, etc.) for stable selectors.
- Screenshots + traces are captured on failure in `test-results/`.

**Important when developing:** Frontend (React) changes usually hot-reload live via the Vite watcher. **Go backend changes** (broker spawn logic, default template auto-load, "attach to existing broker" probe in `app.go`) require you to **fully kill the current `wails dev` (Ctrl+C) and restart `wails dev`** so the Go side is recompiled with the new behavior.

### Why this exists

Manual testing of the Wails-embedded React app (HashRouter, dynamic manifest-driven inspector, canvas viewport hook, Suite Manager start flow, etc.) is too slow and error-prone. The E2E suite (set up during M3) must be part of the development workflow for any change touching `desktop/frontend/src/`.

See `desktop/frontend/e2e/` (mocks.ts + *.spec.ts) and `playwright.config.ts` for details.
