# Mo.Blend Engine (Python / bpy)

This package contains the **in-process** logic that runs inside a headless Blender (4.2 LTS+ baseline) instance. It is the "Platform" component (PRD 2).

It is **never** executed by normal system Python for production work — the only supported runtime is the Python interpreter bundled inside the Blender binary you launch with:

```
blender --background --factory-startup --python ...
```

External tooling (tests, dev scripts, type checkers) may import it under a real Python for static analysis only.

## Current status (M2 — API Broker)

- All of M1 (load / set_parameter / save + shadows + manifest + coercion by stable identifier).
- `render_frame(frame, w, h, format)` — Eevee render to JPEG/WEBP bytes (honors client size, restores settings, temp-file based, no extra imaging libs).
- Full broker: FastAPI/uvicorn on 127.0.0.1:8000 (REST + binary WS viewport).
  - `GET /api/v1/manifest`, `PATCH /api/v1/parameters`, `POST /api/v1/project/load`, `POST /save`, `GET /health`, `/templates` (stub).
  - `WS /api/v1/viewport/stream` — exact 13-byte LE REQUEST_FRAME / FRAME / ERROR wire (PRD 3 §3.2).
  - Action queue (bounded) + `bpy.app.timers` consumer; 429 on flood; stale drop for scrubbing.
  - CORS for `http://wails.localhost` + localhost dev origins.
- `bootstrap.py --serve [--port N] [--load PATH]` — long-running entrypoint (M1 one-shots unchanged).
- Runtime deps: `fastapi`, `uvicorn[standard]` (auto-installed into the *Blender python* by `scripts/dev.ps1`).
- Verification clients: `m2_broker_client.py` (automated fps + protocol) + `m2_viewport_tester.html` (visual canvas).

Security flag still forced early. No external runtime image libs. Still zero Go/desktop changes (M3).

## Verification commands (M1 gates)

These must all succeed with **zero manual Blender UI interaction**.

### 1. Direct CLI demo (the literal ROADMAP "CLI invocation" example)

```pwsh
# Windows (typical)
blender --background --factory-startup --python engine\bootstrap.py -- `
  --load "$env:TEMP\m1_minimal_test.mo.blend" `
  --set intensity=1.75 `
  --set label="M1 Demo from CLI" `
  --save
```

After the first run you will see `m1_minimal_test.mo.blend.01` (and more on repeated runs) next to the temp file.

### 2. Full automated round-trip (the integration proof)

```pwsh
blender --background --factory-startup --python engine\tests\m1_roundtrip.py
```

Expected output ends with a big `M1 ROUNDTRIP PASS` banner, lists the 6 mutated parameters, and shows the shadows that were created. Exit code 0 on success.

The script generates its own minimal parametric template on the fly (no committed `.mo.blend` binaries for M1).

### 3. Via the dev launcher (continuous proof on Windows)

```pwsh
pwsh -ExecutionPolicy Bypass -File scripts\dev.ps1
```

The script now runs the engine stub, **then** the full M1 round-trip verification, then still spawns the Wails dev window (M0 behavior preserved).

## Package layout

```
engine/
├── bootstrap.py          # Entry point for `blender --python`. M1 adds a tiny --load/--set/--save demo mode.
├── pyproject.toml        # Ruff + mypy settings (no runtime deps — bpy comes from Blender)
├── README.md             # You are here
├── moblend/
│   ├── __init__.py       # Public re-exports (load_template, set_parameter, save_project, ...)
│   ├── engine.py         # The three M1 public functions + tiny session state
│   ├── manifest.py       # parse + minimal structural validation (no jsonschema dep)
│   ├── nodes.py          # find_target, resolve by identifier, full coercion table, apply + depsgraph
│   └── io.py             # shadow_rotate (.01–.05) + orphans_purge
└── tests/
    ├── m1_roundtrip.py         # M1 synthetic + roundtrip assertions
    ├── m2_broker_client.py     # Host Python: automated REST + binary WS fps / protocol / stale-drop proof
    └── m2_viewport_tester.html # Zero-dep browser canvas test (native WS + paint + scrub + FPS)
```

## Verification commands (M2 gates + M1 regression)

These must succeed with **zero manual Blender UI**.

### 1. One-command dev (recommended)
```pwsh
pwsh -ExecutionPolicy Bypass -File scripts\dev.ps1
```
Runs M1 roundtrip, installs broker deps into Blender python, launches `--serve` (pre-loads M1 test template if present), prints REST smoke, and gives exact commands for the two M2 clients.

### 2. Direct long-running broker (with initial template)
```pwsh
blender --background --factory-startup --python engine\bootstrap.py -- `
  --serve --load "$env:TEMP\m1_minimal_test.mo.blend"
```
(Then in another terminal: the client or open the .html tester.)

### 3. M2 automated proof (host Python)
```pwsh
# one-time
pip install -q websockets httpx
python -m engine.tests.m2_broker_client
```
Expects "M2 BROKER PASS", measured fps, sample frames in %TEMP%, protocol checks, stale-drop behavior.

### 4. Interactive visual proof
Open `engine/tests/m2_viewport_tester.html` in Edge/Chrome while the broker is serving. Use the forms/buttons to load, mutate, request frames, and scrub with the drop-stale flag. Canvas + on-screen FPS.

### 5. M1 regression (still exercised by dev.ps1)
The original three M1 commands continue to work unchanged.

Swagger / OpenAPI is at http://127.0.0.1:8000/docs when the broker is running.

## Developing / testing changes

- Make edits under `engine/moblend/`.
- Re-run `scripts/dev.ps1` (or the direct commands) after changes.
- `python -c "import moblend; help(moblend)"` works from host Python for docs.
- All real bpy work (including the timer consumer) stays on the main thread.

## Next milestones (context for readers)

- M3 will have the Wails desktop (Go) spawn/supervise the broker and the React frontend will talk HTTP + direct binary WS to 127.0.0.1:8000.
- M4 adds real `GET /api/v1/templates` backed by the registry index (currently a stub).
- Slots, asset ingest, MCP, and video export jobs come later.

See [ROADMAP.md](../ROADMAP.md), [PRD 3](../specs/PRD%203%20-%20Broker%20(MCP%20%26%20API%20Server).md), [API & Function Spec](../specs/Mo.Blend%20API%20%26%20Function%20Spec.md), and AGENTS.md (single-port, binary WS only, queue+timer rules).
