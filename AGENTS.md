# Agent Guide — MoBlend_Studio

Instructions for AI coding agents working in this repository.

## Project summary

Mo.Blend is a **Python + Go monorepo** that wraps headless Blender as a parametric motion-graphics engine. Users edit `.mo.blend` templates through simple controls—not node graphs. See [specs/README.md](specs/README.md) for the full product picture.

| Layer | Tech | PRD |
|-------|------|-----|
| Compute | Headless Blender + Python engine | 1, 2 |
| Broker | FastAPI + uvicorn inside Blender | 3 |
| Desktop | Wails v2 (Go + React/TS) | 4 |
| OBS client | Static HTML/JS in CEF | 5 |
| Sentinel client | MCP chat + canvas | 6 |

**External repos:** `MoBlend_Lib` (v1 template library), `moblend-registry` (PRD 7 long-term), `MoBlend_SRE` (Sentinel SRE + Kit — M5), `MoBlend_OBS` (OBS panel — M6), `MoBlend_TemplateInspector` (PRD 8 addon).

**Public sites:** [moblend.dev](https://moblend.dev); [lib.moblend.dev](https://lib.moblend.dev).

## Platforms

| OS | Priority |
|----|----------|
| **Windows (x64)** | Primary |
| Linux (x64) | Secondary |
| macOS (Apple Silicon) | Secondary |

Keep platform-specific code in Go (`desktop/`) and Python bootstrap—not in shared frontend logic.

## Monorepo layout

```
engine/          # Python: bootstrap, moblend engine, FastAPI broker → engine/AGENTS.md
desktop/         # Wails: Go backend + frontend/ → desktop/AGENTS.md
clients/obs/     # Stub → MoBlend_OBS (M6)
clients/sentinel/# Stub → MoBlend_SRE (M5)
specs/           # PRDs and API contract
scripts/         # Dev orchestration (scripts/dev.ps1 on Windows)
ROADMAP.md       # Milestone order (M0–M6, M3a persistence)
.progress/       # Append-only progress log → .progress/AGENTS.md
```

## Architecture rules (do not violate)

1. **Single broker port:** REST, WebSocket viewport, and MCP share `127.0.0.1:8000`.
2. **Viewport = binary WebSocket only (v1):** `WS /api/v1/viewport/stream`. Wire format in [PRD 3 §3.2](specs/PRD%203%20-%20Broker%20(MCP%20%26%20API%20Server).md). **No gRPC for browser/Wails/OBS/Sentinel clients.**
3. **Wails frontend connects directly to the broker** for HTTP and WebSocket—not through Go bindings.
4. **Go may spawn/supervise Blender** but must **never** parse `.mo.blend` or render frames locally.
5. **Blender bpy is single-threaded:** network handlers enqueue to `queue.Queue`; `bpy.app.timers` executes on the main thread.
6. **Frame format:** JPEG for opaque previews; WebP when alpha is required. Independent still frames—not H.264/MSE.
7. **Security:** `127.0.0.1` bind by default; `use_scripts_auto_execute = False`; validate manifest types before queueing.

## Where to look

| Task | Read first |
|------|------------|
| What to build next | [ROADMAP.md](ROADMAP.md) |
| What was already done | [.progress/](.progress/) |
| Progress log rules | [.progress/AGENTS.md](.progress/AGENTS.md) |
| API contracts | [specs/Mo.Blend API & Function Spec.md](specs/Mo.Blend%20API%20&%20Function%20Spec.md) |
| Viewport protocol | [PRD 3 §3.2](specs/PRD%203%20-%20Broker%20(MCP%20%26%20API%20Server).md) |
| Desktop shell | [desktop/AGENTS.md](desktop/AGENTS.md) · PRD 4 §8–§13 · [specs/stitch/README.md](specs/stitch/README.md) |
| Engine / bpy | [engine/AGENTS.md](engine/AGENTS.md) · PRD 1 · PRD 2 |
| Local persistence (M3a) | [specs/M3a - Local Persistence & Logging.md](specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md) |
| Registry integration (M4) | [specs/M4 - Registry Integration.md](specs/M4%20-%20Registry%20Integration.md) · slices M4a–M4d |

## Scoped configuration (load by address, not prose)

| Mechanism | Location | Loads when |
|-----------|----------|------------|
| Nested agent guide | `{dir}/AGENTS.md` | Working in or under `{dir}/` |
| Path-scoped rules | `.claude/rules/*.md` | Matching file paths (see `paths` frontmatter) |
| Path-scoped rules | `.cursor/rules/*.mdc` | Matching file paths (see `globs` frontmatter) |
| Procedures / checklists | `.claude/skills/*/SKILL.md` | Matching `paths` or `/skill-name` invocation |

## Milestone order

Build bottom-up per [ROADMAP.md](ROADMAP.md): M0 → M1 → M2 → M3 → **M3a** → **M4** (M4a → M4b → M4c → M4d) → M5 → M6.

## Local persistence (M3a+)

Under `<moblend_home>/` (`%USERPROFILE%\.moblend\` on Windows):

| File | Owner | Holds |
|------|-------|-------|
| `config.json` | Suite (human-editable) | Blender path, broker URL, shared settings |
| `studio.db` | Studio Go only | Recents, asset index, install map (cache) |
| `broker.db` | Broker Python only | Export jobs, catalog cache metadata |
| `suite_logs.db` | Studio + broker (append) | Cross-suite `log_events` — not operational state |

**Authoritative:** `.mo.blend`, `assets/`, `templates/` on disk — SQLite is index/cache only.  
**New persistent state:** see decision table in [M3a spec](specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md) §9. No logging daemon in M3a.

## Global conventions

- **Commits:** Only when the user asks. Do not commit secrets.
- **Scope:** Smallest correct diff; match existing patterns; no drive-by refactors.
- **Progress log:** After non-trivial work, run the `/write-progress-entry` skill or follow [.progress/AGENTS.md](.progress/AGENTS.md).

## gRPC (future only)

gRPC may appear later for **Kubernetes pod-to-pod** render orchestration. Do not add grpc-web proxies or a second client protocol for viewport preview unless PRDs are revised.