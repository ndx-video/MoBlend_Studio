# MoBlend_Studio

Motion graphics for Blender — a geometry-nodes template engine that runs as an API/MCP service, with a Wails desktop studio and lightweight web clients for OBS and AI agents.

**Stack:** Python (Blender engine + FastAPI broker) · Go (Wails v2 desktop) · HTML/JS (OBS, Sentinel)

## Platforms

| OS | Priority |
|----|----------|
| **Windows (x64)** | Primary development and release target |
| Linux (x64) | Supported; parity as needed |
| macOS (Apple Silicon) | Supported; parity as needed |

## Monorepo layout

```
MoBlend_Studio/
├── engine/          # Python: headless bootstrap, moblend engine, API broker (PRD 1–3)
├── desktop/         # Wails app: Go backend + frontend/ (PRD 4)
├── clients/
│   ├── obs/         # PRD 5 — OBS browser dock
│   └── sentinel/    # PRD 6 — MCP chat workspace (placement TBD)
├── specs/           # Product requirements & API contracts
├── scripts/         # Dev orchestration
├── AGENTS.md        # AI agent guide (architecture rules, conventions)
└── ROADMAP.md       # Milestone plan (M0–M6)
```

## Viewport streaming

Live preview uses a **binary WebSocket** on the FastAPI broker—not gRPC:

```
ws://127.0.0.1:8000/api/v1/viewport/stream
```

Wails, OBS, and Sentinel clients connect directly from the browser/webview. Wire format: [PRD 3 §3.2](specs/PRD%203%20-%20MCP%20&%20API%20Server%20(Expanded).md). gRPC is reserved for a future Kubernetes worker-to-worker path only.

## External repositories

| Repository | PRD | Role |
|------------|-----|------|
| `moblend-registry` | 7 | GitOps template CDN (`index.json`, `.mo.blend` artifacts) |
| `MoBlend_TemplateInspector` | 8 | Blender addon for template authors (not yet created) |

## Documentation

- **[ROADMAP.md](ROADMAP.md)** — Build order and exit criteria (start here for implementation)
- **[AGENTS.md](AGENTS.md)** — Guide for AI coding agents
- **[specs/Mo.Blend System PRDs.md](specs/Mo.Blend%20System%20PRDs.md)** — Master overview + repository map
- **[specs/Mo.Blend API & Function Spec.md](specs/Mo.Blend%20API%20&%20Function%20Spec.md)** — REST, WebSocket, and MCP contracts

## PRD index

| PRD | Document | Location |
|-----|----------|----------|
| 1 | Blender Headless Base Compute | `specs/` |
| 2 | Mo.Blend Python Engine | `specs/` |
| 3 | MCP & API Server | `specs/` |
| 4 | Wails Desktop UI (Mo.Blend Studio) | `specs/` |
| 5 | OBS Extension Panel | `clients/obs/` (future) |
| 6 | Sentinel Kit UI | `clients/sentinel/` (future) |
| 7 | Template Repository | `moblend-registry` repo |
| 8 | Template Inspector (Blender addon) | `MoBlend_TemplateInspector` repo |
