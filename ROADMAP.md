# Mo.Blend Roadmap

Lightweight milestone plan for the `MoBlend_Studio` monorepo. PRDs in `[specs/](specs/)` define **what** to build; this document defines **when** and **done when** gates.

**Stack:** Python (Blender engine + API broker) · Go (Wails desktop shell) · HTML/JS (OBS, Sentinel clients)

**Platforms:** Windows (primary dev target) · Linux · macOS Apple Silicon (parity as needed)

**External repos:** `MoBlend_Lib` (v1 template library) · `moblend-registry` (PRD 7 long-term name) · `MoBlend_SRE` (Sentinel SRE + ndx.moblend Kit — M5) · `MoBlend_OBS` (OBS panel — M6) · `MoBlend_TemplateInspector` (PRD 8 addon)

**Monorepo client stubs:** `clients/sentinel/` and `clients/obs/` remain lightweight pointers to the external repos — not the canonical source tree.

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

## M3 — Desktop MVP ✅ Complete

**Status:** Complete — see [.progress/M003.016.asset-dnd-ingest-complete.md](.progress/M003.016.asset-dnd-ingest-complete.md) and earlier `M003.`* entries.

**Goal:** Mo.Blend Studio end-to-end: Suite Manager spawns engine, live canvas, manifest form, slot timeline.

**PRD refs:** [PRD 4](specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) — **implementation guide: §8–§13** (readiness matrix, Stitch → React, Go bindings); design refs in `[specs/stitch/](specs/stitch/)`

**Done when:**

- Go backend spawns/supervises headless Blender+engine on app start; kills on exit
- User selects a local `.mo.blend` → live viewport preview → edits parameters → timeline slots update
- Drag-drop asset → sandbox copy → API ingest works
- Export job can be triggered (202 + poll acceptable for MVP)

**Out of scope:** Official template library gallery (M4), OBS, Sentinel, MCP in desktop

---

## M3a — Local Persistence & Logging ✅ Complete

**Status:** Complete — see [.progress/M003a.002.persistence-scaffold.md](.progress/M003a.002.persistence-scaffold.md), [.progress/M003a.003.persistence-hardening.md](.progress/M003a.003.persistence-hardening.md).

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

## M4 — Registry Integration ✅ Complete

**Status:** Complete — see [.progress/M004d.001.gallery-suite-manager.md](.progress/M004d.001.gallery-suite-manager.md) and sub-slice entries `M004a`–`M004c`.

**Goal:** Template gallery from the official library at `lib.moblend.dev` (v1 backed by sibling repo `MoBlend_Lib` and its `index.json`); one-click install to `~/.moblend/templates/`.

**Spec:** [M4 — Registry Integration](specs/M4%20-%20Registry%20Integration.md) (parent index + architecture)

**PRD refs:** [PRD 7](specs/PRD%207%20-%20Template%20Repository.md) (client side) · [catalog.schema.json](specs/catalog.schema.json)

**Done when (full M4 — all slices):**

- Suite Manager shows catalog status; broker serves live catalog from configured `registryBaseUrl`
- Gallery shows previews; "Install" streams `.mo.blend` via Go backend to local cache
- Loaded installed template works through M3 flow

**Out of scope:** Full registry CI in `MoBlend_Lib` (optional follow-up in M4a), Stitch search/filter polish, MCP tool wiring (cheap post-M4b follow-up)

**Progress files:** Use `M004` for parent milestone; sub-slices use `M004a`, `M004b`, etc. (e.g. `M004a.001.library-bootstrap.md`).

### M4a — Library Repository Bootstrap ✅ Complete

**Status:** Complete — see [.progress/M004a.001.library-bootstrap.md](.progress/M004a.001.library-bootstrap.md).

**Repo:** Sibling [`MoBlend_Lib`](../MoBlend_Lib) (not this monorepo)

**Spec:** [M4a — Library Repository Bootstrap](specs/M4a%20-%20Library%20Repository%20Bootstrap.md) · Skill: `/implement-m4a-library-bootstrap`

**Done when:**

- `MoBlend_Lib` has PRD 7 layout, `schemas/`, `scripts/build_index.py`, committed `index.json`
- At least one template (`parametric-cube-demo`) with `.mo.blend`, `.manifest.json`, `.webp`

### M4b — Broker Catalog Cache ✅ Complete

**Status:** Complete — see [.progress/M004b.001.broker-catalog.md](.progress/M004b.001.broker-catalog.md).

**Spec:** [M4b — Broker Catalog Cache](specs/M4b%20-%20Broker%20Catalog%20Cache.md) · Skill: `/implement-m4b-broker-catalog`

**Done when:**

- `GET /api/v1/templates` returns cached catalog (not `[]`)
- `<moblend_home>/catalog/index.json` + `broker.db` `catalog_cache` populated
- `engine/tests/m4_catalog_test.py` passes

### M4c — Go Template Install ✅ Complete

**Status:** Complete — see [.progress/M004c.001.go-template-install.md](.progress/M004c.001.go-template-install.md).

**Spec:** [M4c — Go Template Install](specs/M4c%20-%20Go%20Template%20Install.md) · Skill: `/implement-m4c-go-install`

**Done when:**

- Wails `InstallTemplate` streams binary to `~/.moblend/templates/`
- `studio.db` `installed_templates` rows; version-aware skip re-download
- `go test ./internal/store/...` passes

### M4d — Gallery UI and Suite Manager ✅ Complete

**Status:** Complete — see [.progress/M004d.001.gallery-suite-manager.md](.progress/M004d.001.gallery-suite-manager.md).

**Spec:** [M4d — Gallery UI and Suite Manager](specs/M4d%20-%20Gallery%20UI%20and%20Suite%20Manager.md) · Skill: `/implement-m4d-gallery-ui`

**Done when:**

- Home gallery install/open flow; Suite Manager catalog status
- Playwright E2E green; mark **M4 ✅ Complete** above

---

## M5 — Sentinel SRE and ndx.moblend Kit

**Goal:** Sentinel SRE garage + ndx.moblend Kit: MCP chat-and-canvas for natural-language template iteration, and an agent workspace where users park an LLM to author Kit assets (Lua, YAML, JSON, Go templates, JS, CSS, etc.) against the Mo.Blend broker API.

**Repo:** Sibling [`MoBlend_SRE`](../MoBlend_SRE) (not this monorepo). `clients/sentinel/` here is a stub pointer only.

**Spec:** [ndx.moblend Kit — M5 slices](../MoBlend_SRE/specs/ndx.moblend.kit.md) (parent index + one-shot prompts in `MoBlend_SRE/specs/`)

**Harness:** `../sentinel/sndev.exe harness start -d -p ../MoBlend_SRE --mcp` — see [Sentinel docs](../sentinel/docs/README.md)

**PRD refs:** [PRD 6](specs/PRD%206%20-%20Sentinel%20Kit%20UI.md)

**Monorepo companions:** Expect iterative broker/engine work in `MoBlend_Studio` as Kit and SRE needs surface (MCP tool coverage, export paths, catalog reads). Foundational components evolve alongside client milestones — not a frozen platform handoff.

**Done when:**

- MCP tool loop: list templates → inspect → apply parameters → preview on canvas
- Chat history + current manifest state kept in sync; delta updates work
- JSON diff inspector shows parameter changes
- SRE garage can scaffold/edit ndx.moblend Kit modules that call broker REST/MCP against a local headless engine
- **Agent skills investigation (M5 slice):** evaluate open-source Blender MCP/skill patterns (e.g. [Blender Lab MCP](https://www.blender.org/lab/mcp-server/), [blender-ai-mcp](https://github.com/PatrykIti/blender-ai-mcp), [blender-mcp](https://github.com/ahujasid/blender-mcp)) and document what to **adapt** vs **reject** for Mo.Blend; ship initial `SKILL.md` guidance in the SRE repo

**Agent skills ownership:** Skills live in **`MoBlend_SRE`** — the garage where agents write Kit code. The monorepo broker implements authoritative `moblend_*` MCP tools and REST; the SRE repo hosts client-side skills, broker/MCP adapters, and Kit-authoring workflows. Do **not** port generic “open Blender UI + socket addon” MCP stacks wholesale — they assume interactive bpy and conflict with headless manifest-only compute (PRD 1–2). Raw scene-graph manipulation skills belong in **`MoBlend_TemplateInspector`** (PRD 8) for template authors, not Sentinel end-users.

**Out of scope:** Custom LLM hosting; cloud render farm; OBS render-and-inject (M6)

### M5a — SRE Bootstrap & Kit Scaffold

**Repo:** `MoBlend_SRE` · **Prompt:** [ndx.moblend.kit.md § M5a](../MoBlend_SRE/specs/ndx.moblend.kit.md#m5a--sre-bootstrap--kit-scaffold)

**Done when:** `ndx.moblend/` kit discovered by harness; dev loop verified with `sndev.exe`

### M5b — Mo.Blend Broker Connector & Core Flows

**Repo:** `MoBlend_SRE/ndx.moblend/` · **Prompt:** [§ M5b](../MoBlend_SRE/specs/ndx.moblend.kit.md#m5b--moblend-broker-connector--core-flows)

**Done when:** Lua connector + list/inspect/apply flows work against live broker

### M5c — Agent Skills Pack & Blender MCP Research

**Repo:** `MoBlend_SRE/.claude/skills/` · **Prompt:** [§ M5c](../MoBlend_SRE/specs/ndx.moblend.kit.md#m5c--agent-skills-pack--blender-mcp-research)

**Done when:** Skills shipped; `specs/blender-mcp-research.md` adapt/reject doc complete

### M5d — React GUI Kit (Studio design parity)

**Repo:** `MoBlend_SRE/ndx.moblend/ui/` → `pb/app/` · **Prompt:** [§ M5d](../MoBlend_SRE/specs/ndx.moblend.kit.md#m5d--react-gui-kit-studio-design-parity)

**Done when:** React SPA at `/kt/ndx/moblend/` cherry-picks Studio tokens, viewport hook, manifest form; visual QA vs `specs/stitch/screen_edit`

### M5e — State Sync & JSON Diff Inspector

**Repo:** `MoBlend_SRE/ndx.moblend/` · **Prompt:** [§ M5e](../MoBlend_SRE/specs/ndx.moblend.kit.md#m5e--state-sync--json-diff-inspector)

**Done when:** Manifest diff panel + state sync per PRD 6 §2.3, §3.3

**Progress files:** Use `M005` for parent; sub-slices `M005a` … `M005e` (e.g. `M005a.001.sre-kit-scaffold.md`).

**Future (post-M5, monorepo): Studio Sentinel embed** — Optional Wails route `/sentinel`: full-viewport `<iframe>` to user-configured `sentinelKitUrl` (`~/.moblend/config.json`, edited in Suite Manager). Nav-rail button appears only after Go sanity checks: harness `GET /hl`, kit listed on `GET /hl/kt` (`ndx.moblend`), broker `GET /api/v1/health`. Studio does not re-implement PRD 6 UI. See [PRD 4 §13.3](specs/PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md#133-future-iterations-post-m3), [PRD 6 §5.4](specs/PRD%206%20-%20Sentinel%20Kit%20UI.md#54-moblend-studio-iframe-shell), [MoBlend_SRE spec §10](../MoBlend_SRE/specs/ndx.moblend.kit.md#10-future--moblend-studio-iframe-embed-post-m5).

---

## M6 — OBS Panel

**Goal:** OBS browser dock: pick template, quick edit, render transparent `.webm`, inject into scene.

**Repo:** Sibling [`MoBlend_OBS`](../MoBlend_OBS) (not this monorepo). `clients/obs/` here is a stub pointer only.

**PRD refs:** [PRD 5](specs/PRD%205%20-%20OBS%20Extension%20Panel.md)

**Monorepo companions:** Broker export job API, alpha WebM path, and optional `--bind-public` + bearer-token hardening may need iteration as the OBS repo integrates.

**Done when:**

- Static panel loads in OBS Custom Browser Dock
- Render & inject pipeline: `POST /render/export` → obs-websocket media source → playback
- Temp file cleanup after playback

**Out of scope:** Mo.Blend Studio UI changes; registry authoring; Sentinel SRE / Kit (M5)

---

## Parallel Track — PRD 8 (External Repo)

**Goal:** Blender addon for template authors in `MoBlend_TemplateInspector`.

**PRD refs:** [specs/README — PRD 8 summary](specs/README.md)

**Done when (in that repo):** Manifest validator/generator, UX sandbox, publish prep `.zip`

**Relationship:** Does not block M0–M3. Authors can use plain Blender + manual manifest until the addon exists.

---

## Current focus

**Next slice:** [M5 — Sentinel SRE and ndx.moblend Kit](#m5--sentinel-sre-and-ndxmoblend-kit)

---

## Working Convention

At the start of each milestone, bring into context:

1. Relevant PRD sections from `specs/`
2. This milestone's **Done when** checklist
3. [API spec](specs/Mo.Blend%20API%20&%20Function%20Spec.md) when touching the broker or clients
4. Latest entries in [.progress/](.progress/) for the current milestone (audit trail; append-only)

When work completes, agents **must** add a progress file per [.progress/README.md](.progress/README.md) — `{milestone}.{index}.{descriptor}.md` (e.g. `M001.001.engine-bootstrap.md`; the milestone token is zero-padded to three digits, so M0 → `M000`). Sub-milestones use letter suffixes: **M3a** → `M003a`; **M4a** → `M004a`, **M4b** → `M004b`, etc. Never edit prior progress files.

No separate `.planning/` tree — PRDs + this ROADMAP define targets; `.progress/` records history.