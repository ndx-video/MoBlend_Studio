# Mo.Blend Roadmap

Lightweight milestone plan for the `MoBlend_Studio` monorepo. PRDs in [`specs/`](specs/) define **what** to build; this document defines **when** and **done when** gates.

**Stack:** Python (Blender engine + API broker) · Go (Wails desktop shell) · HTML/JS (OBS, Sentinel clients)

**Platforms:** Windows (primary dev target) · Linux · macOS Apple Silicon (parity as needed)

**External repos:** `moblend-registry` (PRD 7) · `MoBlend_TemplateInspector` (PRD 8)

---

## M0 — Specs & Scaffold

**Goal:** Monorepo layout, dev tooling, empty Wails shell, engine entrypoint stub.

**PRD refs:** All (spec alignment); [PRD 4 — Studio (Wails Desktop UI)](specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) (monorepo section)

**Done when:**
- Directory tree exists: `engine/`, `desktop/`, `clients/obs/`, `clients/sentinel/`, `scripts/`
- `go.mod` at repo root (or under `desktop/`) and `pyproject.toml` under `engine/`
- `scripts/dev` starts the engine stub; Wails opens an empty window

**Out of scope:** Feature-complete engine, registry, or client UIs

---

## M1 — Engine Core

**Goal:** Headless Blender boots, loads a `.mo.blend`, mutates one manifest parameter, saves.

**PRD refs:** [PRD 1](specs/PRD%201%20-%20Blender%20Headless%20Base%20Compute.md), [PRD 2](specs/PRD%202%20-%20Platform%20(Mo.Blend%20Python%20Engine).md)

**Done when:**
- CLI invocation: `blender --background --factory-startup --python ...` loads a test template
- `engine.set_parameter` changes a value reflected in a saved file
- Shadow backup rotation (`.01`–`.05`) works on save
- Integration test or script proves param round-trip without manual Blender UI

**Out of scope:** HTTP API, viewport streaming, desktop UI

---

## M2 — API Broker

**Goal:** REST control plane + binary WebSocket viewport stream on `ws://127.0.0.1:8000/api/v1/viewport/stream`.

**PRD refs:** [PRD 3](specs/PRD%203%20-%20Broker%20(MCP%20%26%20API%20Server).md) §3.2, [API & Function Spec](specs/Mo.Blend%20API%20&%20Function%20Spec.md)

**Done when:**
- `GET /api/v1/manifest`, `PATCH /api/v1/parameters`, `POST /api/v1/project/load` respond correctly
- WebSocket client receives raw JPEG/WebP FRAME messages at ≥30fps for a local template (wire format per PRD 3)
- CORS allows `http://wails.localhost` and dev localhost origins
- Action queue returns 429 under flood conditions; stale frame drop works when scrubbing

**Out of scope:** MCP tools, video export jobs, Wails UI, gRPC (deferred to K8s worker path)

---

## M3 — Desktop MVP

**Goal:** Mo.Blend Studio end-to-end: Suite Manager spawns engine, live canvas, manifest form, slot timeline.

**PRD refs:** [PRD 4](specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md)

**Done when:**
- Go backend spawns/supervises headless Blender+engine on app start; kills on exit
- User selects a local `.mo.blend` → live viewport preview → edits parameters → timeline slots update
- Drag-drop asset → sandbox copy → API ingest works
- Export job can be triggered (202 + poll acceptable for MVP)

**Out of scope:** Registry gallery, OBS, Sentinel, MCP in desktop

---

## M4 — Registry Integration

**Goal:** Template gallery from `moblend-registry` `index.json`; one-click install to `~/.moblend/templates/`.

**PRD refs:** [PRD 7](specs/PRD%207%20-%20Template%20Repository.md) (client side)

**Done when:**
- Suite Manager fetches `index.json` from configured registry URL on launch
- Gallery shows previews; "Install" streams `.mo.blend` via Go backend to local cache
- Loaded installed template works through M3 flow

**Out of scope:** Running registry CI, contributor PR workflow (lives in `moblend-registry` repo)

---

## M5 — OBS Panel

**Goal:** OBS browser dock: pick template, quick edit, render transparent `.webm`, inject into scene.

**PRD refs:** [PRD 5](specs/PRD%205%20-%20OBS%20Extension%20Panel.md)

**Done when:**
- Static panel under `clients/obs/` loads in OBS Custom Browser Dock
- Render & inject pipeline: `POST /render/export` → obs-websocket media source → playback
- Temp file cleanup after playback

**Out of scope:** Mo.Blend Studio UI changes; registry authoring

---

## M6 — Sentinel Kit UI

**Goal:** MCP client + chat-and-canvas for natural-language template iteration.

**PRD refs:** [PRD 6](specs/PRD%206%20-%20Sentinel%20Kit%20UI.md)

**Done when:**
- MCP tool loop: list templates → inspect → apply parameters → preview on canvas
- Chat history + current manifest state kept in sync; delta updates work
- JSON diff inspector shows parameter changes

**Blocked on:** M2 (API + stream)

**TBD:** Packaging — standalone under `clients/sentinel/` vs. route inside Wails app. Decide before starting M6.

**Out of scope:** Custom LLM hosting; cloud render farm

---

## Parallel Track — PRD 8 (External Repo)

**Goal:** Blender addon for template authors in `MoBlend_TemplateInspector`.

**PRD refs:** [specs/README — PRD 8 summary](specs/README.md)

**Done when (in that repo):** Manifest validator/generator, UX sandbox, publish prep `.zip`

**Relationship:** Does not block M0–M3. Authors can use plain Blender + manual manifest until the addon exists.

---

## Working Convention

At the start of each milestone, bring into context:
1. Relevant PRD sections from `specs/`
2. This milestone's **Done when** checklist
3. [API spec](specs/Mo.Blend%20API%20&%20Function%20Spec.md) when touching the broker or clients
4. Latest entries in [.progress/](.progress/) for the current milestone (audit trail; append-only)

When work completes, agents **must** add a progress file per [.progress/README.md](.progress/README.md) — `{milestone}.{index}.{descriptor}.md` (e.g. `M1.001.engine-bootstrap.md`). Never edit prior progress files.

No separate `.planning/` tree — PRDs + this ROADMAP define targets; `.progress/` records history.
