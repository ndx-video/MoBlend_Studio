# Stitch design exports — Mo.Blend Studio

Google Stitch (see [stitch-prompt.txt](../stitch-prompt.txt)) generated **reference UI** for Mo.Blend Studio. These folders are **not** runnable application code. Agents implement the Wails React app per [PRD 4 §9–§11](../PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md).

## How to use this folder

1. Read **PRD 4 §11** for the Stitch → React workflow (tokens, AppShell, forbidden patterns).
2. Pick a screen from the table below; open its `DESIGN.md` (tokens) and `screen.png` (visual QA).
3. Reimplement layout in `desktop/frontend/src/features/<name>/` — do **not** copy `code.html` (CDN Tailwind, static data, broken links).
4. Wire live data per the **Key APIs** column; mark `STUB(M4)` / `BLOCKED` where backend is missing (see PRD 4 §8).

## Screen index

| Folder | Purpose | Route | Key APIs / bindings | Milestone |
|--------|---------|-------|---------------------|-----------|
| [screen_home](screen_home/) | Template gallery / landing | `/` | M3: Go `PickMoBlendFile` + `POST /project/load`; M4: `GET /templates` | M3 stub → M4 gallery |
| [screen_projects](screen_projects/) | Recent projects | `/projects` | Go `GetRecentProjects`, `AddRecentProject` | M3 |
| [screen_edit](screen_edit/) | Core editor (viewport, params, timeline) | `/editor` | WS viewport, `GET /manifest`, `PATCH /parameters`, `PATCH /slots` *(blocked M2)* | M3 |
| [screen_assets](screen_assets/) | Local asset library | `/assets` | Go sandbox list + drop; ingest API *(blocked M2)* | M3 partial |
| [screen_export](screen_export/) | Export / publish | `/export` | `POST /render/export`, poll status *(blocked M2)* | M3 shell |
| [screen_suite-manager](screen_suite-manager/) | Engine health & setup | `/settings/suite` | Go `StartEngine`/`StopEngine`, `GET /health` | M3 |
| [screen_user-settings](screen_user-settings/) | User preferences | `/settings` | Go `GetConfig` / `SetConfig` → `~/.moblend/config.json` | M3 |

Each folder contains:

| File | Use |
|------|-----|
| `DESIGN.md` | Design tokens (YAML) + brand/layout prose — extract once to `desktop/frontend/src/theme/tokens.css` |
| `screen.png` | Screenshot for visual comparison |
| `code.html` | Layout reference only — **do not embed in Wails** |

## Original prompt vs exports

[stitch-prompt.txt](../stitch-prompt.txt) requested **four** screens: Home/Gallery, Editor, Export, Suite Manager. This repo has **seven** exports; **Projects**, **Assets**, and **User Settings** were added during design. All seven are first-class routes in PRD 4 §9.

## Shared chrome

All screens share the same **left navigation rail** (Home, Projects, Assets, Suite Manager, Settings). Implement once as `AppShell` in `desktop/frontend/src/layout/` and reuse across routes.

## Related docs

- [PRD 4 — Studio (Wails Desktop UI)](../PRD%204%20-%20Studio%20(Wails%20Desktop%20UI).md) — §8 readiness, §9 phasing, §10–§13 architecture
- [ROADMAP.md](../../ROADMAP.md) — M3 done-when gates
- [m2_viewport_tester.html](../../engine/tests/m2_viewport_tester.html) — viewport wire protocol reference
