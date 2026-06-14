# Mo.Blend Engine (Python / bpy)

This package contains the **in-process** logic that runs inside a headless Blender (4.2 LTS+ baseline) instance. It is the "Platform" component (PRD 2).

It is **never** executed by normal system Python for production work — the only supported runtime is the Python interpreter bundled inside the Blender binary you launch with:

```
blender --background --factory-startup --python ...
```

External tooling (tests, dev scripts, type checkers) may import it under a real Python for static analysis only.

## Current status (M1 — Engine Core)

- `load_template(path)` — opens a strict `.mo.blend` (rejects plain `.blend`), parses + lightly validates the manifest embedded at `scene['moblend_manifest']`.
- `set_parameter(id, value)` — coerces the high-level value, resolves the target by `node_target` + stable `socket_identifier` (never index), writes the interface `default_value`, and flags the depsgraph.
- `save_project(..., incremental=True)` — runs `orphans_purge()`, rotates the `.01`–`.05` shadow backups when incremental, then `save_as_mainfile`.
- Full support for the core scalar parameter types: `string`/`text`, `int`, `float`, `bool`, `color_rgba`, `enum`.
- Security: `use_scripts_auto_execute = False` is forced on every entry.
- No external runtime dependencies (bpy is supplied by Blender).

Out of scope for M1 (see ROADMAP): broker (FastAPI), viewport streaming, slots/timeline, asset ingestion (image/video/font), crash recovery, config, MCP.

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
    └── m1_roundtrip.py   # The self-contained integration verifier (synthetic template generator + asserts)
```

## Developing / testing changes

- Make edits under `engine/moblend/`.
- Re-run the verification commands above (especially #2 and #3).
- The code aims to be compatible with the ruff/mypy configuration declared in `pyproject.toml`.
- All real work happens under `bpy`; the dual-mode guards in `bootstrap.py` only exist so the file can be imported for linting outside Blender.

## Next milestones (context for readers)

- M2 will turn the long-running `bootstrap` into the FastAPI + WebSocket broker on 127.0.0.1:8000. The one-shot demo path in `bootstrap.py` can stay for manual smoke tests.
- Real authored `.mo.blend` templates (from the registry / PRD 8 addon) will become additional test vectors once they exist (M4+).

See [ROADMAP.md](../ROADMAP.md), [PRD 1](../specs/PRD%201%20-%20Blender%20Headless%20Base%20Compute.md), [PRD 2](../specs/PRD%202%20-%20Platform%20(Mo.Blend%20Python%20Engine).md), and the [API & Function Spec](../specs/Mo.Blend%20API%20%26%20Function%20Spec.md).
