# MoBlend_Studio

Motion graphics for Blender — a geometry-nodes template engine that runs as an API/MCP service, with a Wails desktop studio and lightweight web clients for OBS and AI agents.

**Stack:** Python (Blender engine + FastAPI broker) · Go (Wails v2 desktop) · HTML/JS (OBS, Sentinel)

> This file is a **map** to the project's documentation. To avoid drift, it deliberately does **not** repeat details (platforms, repo layout, API contracts, milestones) that are maintained in the docs linked below — follow the links for the definitive, single-source-of-truth versions.

## Components

Mo.Blend is a small set of cooperating components (codenames in **bold**). The **[Components glossary in `specs/README.md`](specs/README.md#glossary)** is the definitive reference for what each one is, its PRD, and the domain vocabulary.

| Component | PRD | Role |
|-----------|-----|------|
| **Platform** | 2 | Python engine inside headless Blender — parses manifests, mutates nodes, drives the slot timeline. |
| **Broker** | 3 | FastAPI/MCP server (REST control plane + binary WebSocket viewport) on `127.0.0.1:8000`. |
| **Studio** | 4 | Wails v2 desktop app — the casual-user, no-nodes editor. |
| **Sentinel SRE / Kit** | 6 | MCP chat-and-canvas + ndx.moblend Kit garage (`MoBlend_SRE`, M5). |
| **OBS Panel** | 5 | OBS CEF dock for render-and-inject broadcast graphics (`MoBlend_OBS`, M6). |
| **Registry** | 7 | `moblend-registry` (GitOps) powering the official template library at `lib.moblend.dev`. |
| **Template Inspector** | 8 | `MoBlend_TemplateInspector` — external Blender authoring addon. |

**Public presence (pre-flight):** Project site & docs at [moblend.dev](https://moblend.dev); official template library at [lib.moblend.dev](https://lib.moblend.dev).

## Documentation map

| Document | What you'll find |
|----------|------------------|
| **[specs/README.md](specs/README.md)** | The definitive entry point: executive overview, target platforms, repository map, PRD index, non-functional requirements, and the Components + domain **glossary**. |
| [specs/Mo.Blend API & Function Spec.md](specs/Mo.Blend%20API%20&%20Function%20Spec.md) | REST, binary WebSocket, and MCP communication contracts. |
| [specs/manifest.schema.json](specs/manifest.schema.json) | Canonical `.mo.blend` manifest schema (the template ↔ client contract). |
| [specs/](specs/) | All per-PRD specifications. |
| [ROADMAP.md](ROADMAP.md) | Milestone build order (M0–M6, M3a persistence) and "Done when" exit criteria. |
| [specs/M3a - Local Persistence & Logging.md](specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md) | SQLite layout under `~/.moblend/`, logging conventions, one-shot implementation prompt. |
| [AGENTS.md](AGENTS.md) | Guide for AI coding agents: architecture rules you must not violate, conventions, and where to look. |
| **[.progress/README.md](.progress/README.md)** | How development rolls — the append-only progress log: naming, immutability, and when to write an entry. Browse [.progress/](.progress/) to see the development history. |
