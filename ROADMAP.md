# Mo.Blend Roadmap

Lightweight milestone plan for the `MoBlend_Studio` monorepo. PRDs in [`specs/`](specs/) define **what** to build; this document defines **when** and **done when** gates.

**Stack:** Python (Blender engine + API broker) · Go (Wails desktop shell) · HTML/JS (OBS, Sentinel clients)

**Platforms:** Windows (primary dev target) · Linux · macOS Apple Silicon (parity as needed)

**External repos:** `moblend-registry` (PRD 7 — powers official template library) · `MoBlend_TemplateInspector` (PRD 8)

**Public sites:** `moblend.dev` (news / info / docs) · `lib.moblend.dev` (official template library)

---

## M0 — Specs & Scaffold

**Goal:** Monorepo layout, dev tooling, empty Wails shell, engine entrypoint stub.

**PRD refs:** All (spec alignment); [PRD 4 — Studio (Wails Desktop UI)](specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) (monorepo section)

**Done when:**
- Directory tree exists: `engine/`, `desktop/`, `clients/obs/`, `clients/sentinel/`, `scripts/`
- `go.mod` at repo root (or under `desktop/`) and `pyproject.toml` under `engine/`
- `scripts/dev.ps1` starts the engine stub; Wails opens an empty window

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

**PRD refs:** [PRD 4](specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) — **implementation guide: §8–§13** (readiness matrix, Stitch → React, Go bindings); design refs in [`specs/stitch/`](specs/stitch/)

**Done when:**
- Go backend spawns/supervises headless Blender+engine on app start; kills on exit
- User selects a local `.mo.blend` → live viewport preview → edits parameters → timeline slots update
- Drag-drop asset → sandbox copy → API ingest works
- Export job can be triggered (202 + poll acceptable for MVP)

**Out of scope:** Official template library gallery (M4), OBS, Sentinel, MCP in desktop

---

## M3a — Local Persistence & Logging

**Goal:** Proactive SQLite patterns under `<moblend_home>/` — component-scoped operational DBs plus a shared suite log DB — so M4+ features have a clear metadata layer without ad hoc JSON or a logging daemon.

**Spec:** [M3a — Local Persistence & Logging](specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md) (includes **one-shot implementation prompt** in §11)

**PRD refs:** [PRD 4](specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) §4 Suite Manager diagnostics, §7 config; [PRD 1](specs/PRD%201%20-%20Blender%20Headless%20Base%20Compute.md) §5 `<moblend_home>`

**Done when:**
- `<moblend_home>/studio.db`, `broker.db`, and `suite_logs.db` exist with v1 schemas and migration runners
- `studio.db` owns recents (migrated from `config.json` `recentProjects`), asset index rows on sandbox copy, stub `installed_templates`
- `broker.db` owns stub `export_jobs` and `catalog_cache` tables; wired on broker serve startup
- `suite_logs.db` receives append-only events from Studio Go and broker Python (`WAL` + `busy_timeout`); no secrets in `context_json`
- Thin wrappers: `desktop/internal/store/` (Go), `engine/moblend/store.py` + `engine/moblend/log.py` (Python)
- Go unit tests + host-Python `engine/tests/m3a_store_test.py` pass; Playwright E2E still green if recents bindings changed
- Agent docs updated (this ROADMAP, spec, nested `AGENTS.md` files)

**Out of scope:** Logging micro-daemon, HTTP log ingest, Suite Manager log viewer UI, M4 catalog population, log retention/pruning jobs

**Progress files:** Use milestone token `M003a` (e.g. `M003a.001.persistence-scaffold.md`).

---

## M4 — Registry Integration

**Goal:** Template gallery from the official library at `lib.moblend.dev` (backed by `moblend-registry` `index.json`); one-click install to `~/.moblend/templates/`.

**PRD refs:** [PRD 7](specs/PRD%207%20-%20Template%20Repository.md) (client side)

**Done when:**
- Suite Manager fetches `index.json` from the configured library/registry URL (e.g. `lib.moblend.dev` or backing raw source) on launch
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

When work completes, agents **must** add a progress file per [.progress/README.md](.progress/README.md) — `{milestone}.{index}.{descriptor}.md` (e.g. `M001.001.engine-bootstrap.md`; the milestone token is zero-padded to three digits, so M0 → `M000`). Sub-milestone **M3a** uses token `M003a` (e.g. `M003a.001.persistence-scaffold.md`). Never edit prior progress files.

No separate `.planning/` tree — PRDs + this ROADMAP define targets; `.progress/` records history.
