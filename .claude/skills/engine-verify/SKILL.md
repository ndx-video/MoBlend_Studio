---
name: engine-verify
description: Verify engine and broker changes with M1/M2 gates. Use after modifying engine/ Python code.
paths:
  - "engine/**/*.py"
disable-model-invocation: true
---

# Engine verification

After changes under `engine/`, confirm gates in [engine/README.md](../../../engine/README.md).

## Recommended (Windows)

```powershell
pwsh -ExecutionPolicy Bypass -File scripts/dev.ps1
```

Runs M1 roundtrip, installs broker deps into Blender Python, launches `--serve`, prints REST smoke.

## Targeted checks

| Gate | Command |
|------|---------|
| M1 roundtrip | `blender --background --factory-startup --python engine\tests\m1_roundtrip.py` |
| M2 broker | `python -m engine.tests.m2_broker_client` (requires `pip install websockets httpx`) |
| Visual WS | Open `engine/tests/m2_viewport_tester.html` while broker serves |

## Pass criteria

- M1: exit 0, `M1 ROUNDTRIP PASS` banner.
- M2: `M2 BROKER PASS`, protocol checks, stale-drop behavior.
- Zero manual Blender UI interaction.