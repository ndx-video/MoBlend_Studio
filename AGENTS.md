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

**External repos:** `moblend-registry` (PRD 7, powers the official template library), `MoBlend_TemplateInspector` (PRD 8).

**Public sites (pre-flight):** `moblend.dev` (news, info, documentation); `lib.moblend.dev` (official template library / registry public face).

## Platforms

| OS | Priority |
|----|----------|
| **Windows (x64)** | Primary — develop and test here first |
| Linux (x64) | Secondary — parity as needed |
| macOS (Apple Silicon) | Secondary — parity as needed |

Assume WebView2 on Windows, WebKit on macOS/Linux. Path separators and process signals differ by OS; keep platform code in Go (`desktop/`) and Python bootstrap, not in shared frontend logic.

## Monorepo layout

```
engine/          # Python: bootstrap, moblend engine, FastAPI broker
desktop/         # Wails: Go backend + frontend/
clients/obs/     # OBS browser dock
clients/sentinel/# Sentinel UI (placement TBD)
specs/           # PRDs and API contract
scripts/         # Dev orchestration (scripts/dev.ps1 on Windows)
ROADMAP.md       # Milestone order (M0–M6)
.progress/       # Append-only progress log (mandatory — see README)
```

## Architecture rules (do not violate)

1. **Single broker port:** REST, WebSocket viewport, and MCP share `127.0.0.1:8000` (FastAPI/uvicorn).
2. **Viewport = binary WebSocket only (v1):** `WS /api/v1/viewport/stream`. Wire format in [PRD 3 §3.2](specs/PRD%203%20-%20Broker%20(MCP%20%26%20API%20Server).md). **No gRPC for browser/Wails/OBS/Sentinel clients.**
3. **Wails frontend connects directly to the broker** for HTTP and WebSocket. Do **not** stream viewport frames through Go bindings (base64 overhead).
4. **Go may spawn/supervise Blender** but must **never** parse `.mo.blend` or render frames locally—all bpy work goes through the broker.
5. **Blender bpy is single-threaded:** network handlers enqueue to `queue.Queue`; `bpy.app.timers` executes on the main thread.
6. **Frame format:** JPEG for opaque previews; WebP when alpha is required. Independent still frames—not H.264/MSE for interactive scrubbing.
7. **Security:** `127.0.0.1` bind by default; `use_scripts_auto_execute = False`; validate manifest types before queueing.

## Where to look

| Task | Read first |
|------|------------|
| What to build next | [ROADMAP.md](ROADMAP.md) |
| What was already done | [.progress/](.progress/) (latest index per milestone) |
| Progress log rules | [.progress/README.md](.progress/README.md) |
| API contracts | [specs/Mo.Blend API & Function Spec.md](specs/Mo.Blend%20API%20&%20Function%20Spec.md) |
| Viewport protocol | [PRD 3 §3.2](specs/PRD%203%20-%20Broker%20(MCP%20%26%20API%20Server).md) |
| Desktop shell | [PRD 4](specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) |
| Engine / bpy | [PRD 1](specs/PRD%201%20-%20Blender%20Headless%20Base%20Compute.md), [PRD 2](specs/PRD%202%20-%20Platform%20(Mo.Blend%20Python%20Engine).md) |

## Implementation conventions

- **Python:** `engine/` package; type hints; minimal dependencies; run inside Blender's bundled Python or documented venv for dev tooling only.
- **Go:** Wails v2 patterns; `desktop/` module; use `os/exec` for Blender lifecycle on Windows first.
- **Frontend:** React + TypeScript under `desktop/frontend/`; debounce parameter PATCH requests; drop stale WebSocket frame requests when scrubbing.
- **Commits:** Only when the user asks. Do not commit secrets (`.env`, credentials).
- **Scope:** Smallest correct diff; match existing patterns; no drive-by refactors.

## Milestone order

Build bottom-up per [ROADMAP.md](ROADMAP.md): M0 scaffold → M1 engine → M2 broker (REST + WebSocket) → M3 Wails MVP → M4 registry → M5 OBS → M6 Sentinel.

## Progress log (mandatory)

**Read and follow [.progress/README.md](.progress/README.md) on every task that changes the project.**

Strict rules:

1. **Append only.** Create a new file under `.progress/` when work is done. **Never** edit, rename, or delete an existing progress file.
2. **Filename:** `{milestone}.{index}.{descriptor}.md` — e.g. `M002.001.ws-handshake-stub.md`. Milestone token is `M` + the ROADMAP milestone number zero-padded to three digits (M0 → `M000`); index is three-digit per milestone. Use the next available number.
3. **Automatic.** Agents must write a progress entry at the end of any non-trivial session (implementation, spec/architecture changes, decisions, regressions).
4. **Regressions and reversals.** Document as a **new** entry (e.g. `M009.013.deleted-m9-milestone.md`). Do not revise or remove earlier entries for the same topic.
5. **Immutability.** The log is an audit trail of entailed decision-making. Gaps in numbering are fine; renumbering is forbidden.

Use the entry template in `.progress/README.md`. Link related commits, PRDs, and prior progress files.

## gRPC (future only)

gRPC may appear later for **Kubernetes pod-to-pod** render orchestration. Do not add grpc-web proxies or a second client protocol for viewport preview unless the PRDs are explicitly revised.
