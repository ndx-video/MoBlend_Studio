# **Mo.Blend Ecosystem: Master Overview & PRD Index**

> **This document is an overview and index, not a source of truth.** Each PRD below has its own authoritative file in `specs/`. The API contract is authoritative in [Mo.Blend API & Function Spec.md](Mo.Blend%20API%20%26%20Function%20Spec.md) and the manifest contract in [manifest.schema.json](manifest.schema.json). When this overview and a per-PRD file disagree, the per-PRD file wins — update it, then refresh the summary here.

## **Executive Summary & Architectural Overview**

The Mo.Blend ecosystem decouples a **Compute Engine** from the **User Interface**. A locked-down, headless Blender instance acts as an invisible rendering backend, so front-end clients—from a fast desktop app to chat-based LLM agents—drive complex 3D animations using only simple, predefined parameters (text, colors, durations). The official template library (hosted at `lib.moblend.dev`, backed during beta by the GitOps `moblend-registry`) supplies the parametric `.mo.blend` files, ensuring high-quality, standardized output across all platforms. The project website and documentation live at `moblend.dev`.

## **Target Platforms**

| Platform | Priority | Notes |
|----------|----------|-------|
| **Windows** (x64) | Primary | All v1 development and CI target Windows first (WebView2, Wails, Blender headless). |
| **Linux** (x64) | Secondary | Parity as needed; validate WebKit/GPU EEVEE paths on target distros. |
| **macOS** (Apple Silicon) | Secondary | Parity as needed; universal/arm64 builds when desktop MVP is stable on Windows. |

Cross-platform APIs (REST, binary WebSocket on `127.0.0.1:8000`) are identical; platform-specific work is confined to process orchestration, paths, and Wails packaging.

## **Repository Map**

The Mo.Blend ecosystem spans one core monorepo and two external repositories:

| Repository | PRD(s) | Relationship |
|------------|--------|--------------|
| `MoBlend_Studio` (this repo) | 1–6 | Python/Go monorepo: headless engine, API broker, Wails desktop, OBS and Sentinel clients |
| `MoBlend_Lib` | 7 (v1) | Sibling repo — v1 template library backing `lib.moblend.dev` during beta |
| `moblend-registry` | 7 (long-term) | GitOps naming in PRD 7; may supersede or alias `MoBlend_Lib` post-beta |
| `MoBlend_TemplateInspector` | 8 | Separate Blender addon repo for template authors; publishes to the registry (lib.moblend.dev) |

```
MoBlend_Studio/
├── engine/          # Python: bootstrap, moblend engine, FastAPI broker (PRD 1–3)
├── desktop/         # Wails app: Go backend + frontend/ (PRD 4)
├── clients/
│   ├── obs/         # PRD 5 — static HTML/JS for OBS CEF dock
│   └── sentinel/    # PRD 6 — placeholder; placement TBD
├── specs/
├── scripts/
└── ROADMAP.md
```

## **PRD Index**

Each row links to the authoritative spec. Summaries here are intentionally brief.

| PRD | Authoritative file | One-line scope |
|-----|--------------------|----------------|
| 1 | [PRD 1 — Blender Headless Base Compute](PRD%201%20-%20Blender%20Headless%20Base%20Compute.md) | Standard headless Blender as a sandboxed render/geometry engine. |
| 2 | [PRD 2 — Platform (Mo.Blend Python Engine)](PRD%202%20-%20Platform%20(Mo.Blend%20Python%20Engine).md) | In-process bpy logic: manifest parsing, parameter mutation, slot timeline, asset ingestion. |
| 3 | [PRD 3 — Broker (MCP & API Server)](PRD%203%20-%20Broker%20(MCP%20%26%20API%20Server).md) | FastAPI broker: REST control plane, binary WebSocket viewport, MCP agent plane. |
| 4 | [PRD 4 — Studio (Wails Desktop UI)](PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) | Mo.Blend Studio desktop app (Go + React/TS), Suite Manager, no-nodes editor. |
| 5 | [PRD 5 — OBS Extension Panel](PRD%205%20-%20OBS%20Extension%20Panel.md) | OBS CEF dock for render-and-inject broadcast graphics. |
| 6 | [PRD 6 — Sentinel Kit UI](PRD%206%20-%20Sentinel%20Kit%20UI.md) | MCP chat-and-canvas agent workspace for natural-language editing. |
| 7 | [PRD 7 — Template Repository](PRD%207%20-%20Template%20Repository.md) | GitOps registry: artifact schema, CI validation, `index.json` catalog. |
| 8 | (external repo — summarized below) | Blender addon for template authors. |
| — | [Mo.Blend API & Function Spec](Mo.Blend%20API%20%26%20Function%20Spec.md) | Engine API, REST/WebSocket broker contract, MCP tools. |
| — | [manifest.schema.json](manifest.schema.json) | Canonical `.mo.blend` manifest schema. |
| M3a | [M3a — Local Persistence & Logging](M3a%20-%20Local%20Persistence%20%26%20Logging.md) | SQLite under `<moblend_home>/`: `studio.db`, `broker.db`, `suite_logs.db`; one-shot impl prompt §11. |
| M4 | [M4 — Registry Integration](M4%20-%20Registry%20Integration.md) | Template library client integration; sliced M4a–M4d. |
| — | [catalog.schema.json](catalog.schema.json) | Canonical `index.json` catalog schema (library + broker). |

### **PRD 1 — Blender Headless Base Compute**

Standard, unmodified Blender (4.2 LTS+ baseline) launched via `blender --background --factory-startup --python ...`. Disables auto-script execution, handles SIGINT/SIGTERM (and Windows process termination) with an emergency save to `<moblend_home>/recovery/crash_recovery.mo.blend`, and renders exclusively with EEVEE (the 4.2+ real-time engine). The camera is template-defined (perspective or orthographic), not forced. See PRD 1 for version-pinning and lifecycle details.

### **PRD 2 — Platform (Mo.Blend Python Engine)**

The bpy-side brain: parses the JSON manifest, coerces high-level parameter values to Blender socket values (resolving sockets by stable `socket_identifier`), runs the keyframe-free slot timeline via a normalized-time Geometry Node, ingests external assets with SHA-256 dedup, and manages rolling shadow backups (`.01`–`.05`).

### **PRD 3 — Broker (MCP & API Server)**

FastAPI/uvicorn broker on `127.0.0.1:8000` with a producer/consumer action queue that bridges async HTTP to single-threaded bpy. Three planes: REST control plane (`/api/v1/...`), binary WebSocket viewport stream (`/api/v1/viewport/stream`), and the MCP agent plane. Loopback-only by default; any non-loopback bind (`--bind-public`) requires a bearer token. gRPC is reserved for future Kubernetes worker-to-worker RPC only — never for browser clients.

### **PRD 4 — Studio (Wails Desktop UI)**

A Wails v2 app (Go backend + React/TS frontend) presenting a CapCut-style, no-nodes editor. The frontend connects directly to the broker for HTTP and the viewport WebSocket; the Go backend spawns/supervises Blender, sandboxes dropped assets, and streams template binaries. Includes the Suite Manager hub for component/version/health management.

### **PRD 5 — OBS Extension Panel**

A lightweight HTML/JS dock running in OBS's built-in CEF. Fetches the template catalog, exposes a minimal quick-edit form, then runs the render-and-inject pipeline (`POST /api/v1/render/export` → poll status → obs-websocket media source) with auto-cleanup. Dual-PC LAN setups require the broker's `--bind-public` bearer token.

### **PRD 6 — Sentinel Kit UI**

An MCP client chat-and-canvas workspace. Control plane over REST/SSE for tool calls and state sync; data plane over the binary viewport WebSocket for zero-latency canvas painting. Drives the `moblend_list_templates` → `moblend_inspect_template` → `moblend_apply_parameters` → `moblend_render_preview` loop with delta updates and a JSON diff state inspector.

### **PRD 7 — Mo.Blend Template Repository (The Registry / Official Library)**

The `moblend-registry` GitOps repo (separate) is the source of truth and CI engine. It produces the catalog and artifacts that power the official public template library at `lib.moblend.dev` (beta: static/raw delivery; future: full web portal). Strict per-template artifacts (`.mo.blend`, `.manifest.json`, `.webp`), CI validation, and a generated flattened `index.json`. Clients fetch the catalog via the broker's `GET /api/v1/templates`. The project site (news/info/docs) is at `moblend.dev`.

### **PRD 8 — Mo.Blend Template Inspector (External — Blender Addon)**

**Objective:** A native Blender addon for advanced creators and template authors. It validates manifests, previews the casual-user experience, and packages templates for submission to the official library (`lib.moblend.dev` via the registry).

**Repository:** `MoBlend_TemplateInspector` (separate repo; not yet created). See the External Repositories table above.

**Summary:** The addon provides manifest generation/validation from Geometry Node sockets (emitting stable `socket_identifier` bindings), a mock Mo.Blend Desktop UX sandbox inside Blender, and a one-click publish-prep pipeline (sanitization, size optimization, `.zip` packaging). The full specification will live in that repository when development begins. This track is parallel to the core monorepo and does not block M0–M3.

## **Non-Functional Requirements (NFRs)**

Measurable targets that complement the per-PRD functional requirements and the ROADMAP "Done when" gates. Values marked *(target)* are engineering goals to validate during M2–M3; others are hard constraints stated in the PRDs.

| Area | Requirement | Source |
|------|-------------|--------|
| Viewport frame rate | 30 fps locally; 60 fps when EEVEE + encode keep up | PRD 3 §3.2 |
| Viewport latency | REQUEST_FRAME → canvas paint p95 < 50 ms on loopback *(target)* | PRD 3 §3.2 |
| Action queue poll | bpy timer polls the queue ~every 0.01 s | PRD 3 §2.1 |
| Backpressure | Return `429 queue_full` when the action queue exceeds capacity (default depth 256 *(target)*) | PRD 3 §2.1 |
| Parameter writes | Client must debounce/throttle fast PATCH `/parameters` (e.g. sliders) | PRD 4 §6.2 |
| Asset download | Max 10 MB per asset; magic-number MIME validation; SSRF host blocking | PRD 3 §4 |
| Asset dedup | SHA-256 content hashing | PRD 2 §5 |
| Shadow backups | Rolling buffer of 5 (`.01`–`.05`) | PRD 2 §2.2 |
| Registry artifacts | `.mo.blend` ≤ 50 MB; `.webp` ≤ 2 MB | PRD 7 §4 |
| Security default | Bind `127.0.0.1`; bearer token required when `--bind-public` | PRD 3 §4 |
| Blender baseline | 4.2 LTS minimum; Suite Manager refuses out-of-range binaries | PRD 1 §2.2 |
| Memory hygiene | Orphan purge before every save/export | PRD 2 §2.1 |

## **Glossary**

Project nomenclature. Codenames (**Platform**, **Broker**, **Studio**, **Sentinel**) prefix the descriptive subtitle in PRD filenames; in-body references still use `PRD n` by number.

### Components (codenames)

| Term | PRD | What it is |
|------|-----|------------|
| **Platform** | 2 | The Mo.Blend Python engine running inside Blender's `bpy` memory space — the "brain" that parses manifests, mutates Geometry Node sockets, drives the slot timeline, and ingests assets. |
| **Broker** | 3 | The FastAPI/uvicorn server on `127.0.0.1:8000` exposing the REST control plane, the binary WebSocket viewport, and the MCP agent plane. Isolates single-threaded `bpy` from the network. |
| **Studio** | 4 | Mo.Blend Studio — the Wails v2 desktop app (Go backend + React/TS frontend), the casual-user, no-nodes editor. |
| **OBS Panel** | 5 | The OBS Extension Panel — a lightweight HTML/JS dock running in OBS's built-in CEF for render-and-inject broadcast graphics. (No codename; descriptive name only.) |
| **Sentinel** | 6 | The Sentinel Kit UI — an MCP chat-and-canvas workspace where an LLM acts as a virtual technical artist. |
| **Suite Manager** | 4 | The hub panel inside Studio that tracks/install/health-checks the suite components (Blender, Platform, Broker, official template library connection). |
| **Template Inspector** | 8 | External Blender addon (`MoBlend_TemplateInspector`) for authoring/validating templates and prepping them for the official library (via `moblend-registry`). |
| **Registry** | 7 | `moblend-registry` GitOps backend; its content is exposed publicly as the official template library at `lib.moblend.dev` (beta delivery via raw Git + future web UI). |

### Domain terms

| Term | Meaning |
|------|---------|
| **`.mo.blend`** | A parametric Blender template file. Logic is constrained to Geometry/Material Nodes; a JSON manifest is embedded in scene custom properties. |
| **Manifest** | The JSON "API contract" of a template (`scene['moblend_manifest']`), mapping high-level parameters to node sockets. Canonical schema: [`manifest.schema.json`](manifest.schema.json). |
| **Parameter** | A single exposed control (`id`, `type`, `node_target`, `socket_identifier`, `default`, …). Allowed `type` values are a fixed enum (string, text, int, float, bool, color_rgba, enum, image, video, font). |
| **`socket_identifier`** | The stable Blender node-tree interface identifier a parameter binds to (e.g. `"Socket_2"`) — never a positional index. |
| **Slot / Slot timeline** | Keyframe-free, sequential time blocks (e.g. Intro/Hold/Outro) translated to normalized time by a master Geometry Node, abstracting away keyframes. |
| **Slot preset** | A named animation behavior a slot can run (`preset_id`), declared by the manifest under `slot_presets`. |
| **Action Queue** | The thread-safe `queue.Queue` the Broker's web thread pushes tasks onto; a `bpy.app.timers` consumer executes them on Blender's main thread. |
| **Control / Data / Agent plane** | The Broker's three surfaces: REST (control), binary WebSocket viewport (data), MCP/JSON-RPC (agent). |
| **EEVEE** | Blender's real-time rasterization render engine (the 4.2+ engine formerly dev-named "Eevee Next"); the exclusive renderer for Mo.Blend. |
| **`index.json`** | The flattened catalog generated by registry CI (in `moblend-registry`); the Broker caches it (sourced from the official library at `lib.moblend.dev` or configured backing URL) and serves it via `GET /api/v1/templates`. |
| **Shadow backup** | The rolling incremental save buffer (`.01`–`.05`) protecting against corruption. |
| **`<moblend_home>`** | The suite config/data directory: `%USERPROFILE%\.moblend\` on Windows, `~/.moblend/` on Linux/macOS. Holds `config.json`, SQLite indexes (`studio.db`, `broker.db`, `suite_logs.db`), `assets/`, `templates/`. See [M3a spec](M3a%20-%20Local%20Persistence%20%26%20Logging.md). |
| **`studio.db`** | Studio Go metadata index (recents, asset index, installed-template map). Not authoritative for projects. |
| **`broker.db`** | Broker Python metadata index (export jobs, catalog cache). Not authoritative for manifests. |
| **`suite_logs.db`** | Cross-suite append-only diagnostic log (`log_events`). Shared file; operational state stays in component DBs. |
| **MCP** | Model Context Protocol — the JSON-RPC standard the Broker exposes so any compliant LLM can drive Mo.Blend via tools (`moblend_list_templates`, `moblend_inspect_template`, `moblend_apply_parameters`, `moblend_render_preview`). |

## **Build Order**

See [ROADMAP.md](../ROADMAP.md) for the milestone sequence (M0 scaffold → M1 engine → M2 broker → M3 desktop MVP → **M3a persistence** → M4 registry → M5 OBS → M6 Sentinel) and the per-milestone "Done when" gates.
