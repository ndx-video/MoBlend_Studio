#!/usr/bin/env python3
"""
Mo.Blend Engine bootstrap.

Usage (headless, M1 demo / one-shot):
    blender --background --factory-startup --python engine/bootstrap.py -- \
        --load /path/to/template.mo.blend \
        --set intensity=2.5 \
        --set label="Hello M1" \
        --save

When no --load/--set/--save flags are present after the `--` separator,
falls back to the original M0 stub print (for scripts/dev.ps1 compatibility).

The script is executed by Blender with `bpy` pre-imported. It must stay
side-effect light when acting as a long-running server entrypoint (M2+).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

print("[moblend] Mo.Blend engine bootstrap v0.1.0 (M1 — Engine Core)")

bpy: Any = None
try:
    import bpy  # type: ignore[import-not-found]  # Injected by Blender
except ImportError:
    pass

if bpy is not None:
    ver = getattr(bpy.app, "version_string", "unknown")
    bin_path = getattr(bpy.app, "binary_path", "unknown")
    print(f"[moblend] bpy available — Blender {ver}")
    print(f"[moblend] binary: {bin_path}")
else:
    print("[moblend] bpy NOT available (executed with host Python — expected for tooling).")

print(f"[moblend] Script: {__file__}")
print(f"[moblend] CWD:    {os.getcwd()}")

# -------------------------------------------------------------------
# Always enforce the security rule as early as possible (PRD 1 §2.3).
# Templates must never auto-execute Python.
# -------------------------------------------------------------------
if bpy is not None:
    try:
        bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    except Exception:
        pass

# -------------------------------------------------------------------
# Lightweight M1 CLI demo support.
# Everything after the first `--` in argv belongs to us.
# Supported (very small surface for the ROADMAP checklist):
#   --load PATH
#   --set ID=VALUE   (repeatable)
#   --save
# -------------------------------------------------------------------
def _parse_cli() -> dict[str, Any]:
    if "--" not in sys.argv:
        return {}
    try:
        idx = sys.argv.index("--")
    except ValueError:
        return {}
    raw = sys.argv[idx + 1 :]
    result: dict[str, Any] = {"load": None, "sets": [], "save": False}
    i = 0
    while i < len(raw):
        tok = raw[i]
        if tok == "--load" and i + 1 < len(raw):
            result["load"] = raw[i + 1]
            i += 2
            continue
        if tok == "--set" and i + 1 < len(raw):
            result["sets"].append(raw[i + 1])
            i += 2
            continue
        if tok == "--save":
            result["save"] = True
            i += 1
            continue
        # Unknown token for demo mode — ignore (keeps future server flags safe)
        i += 1
    return result


def _run_m1_demo(cli: dict[str, Any]) -> int:
    """Execute the one-shot load / mutate / save flow for M1 verification."""
    # Import here so the module can still be imported for its prints when bpy missing
    from moblend.engine import load_template, save_project, set_parameter  # type: ignore

    exit_code = 0
    loaded_manifest = None

    if cli.get("load"):
        load_path = cli["load"]
        print(f"[moblend] demo: load_template({load_path!r})")
        try:
            loaded_manifest = load_template(load_path)
            print(f"[moblend] demo: loaded template_id={loaded_manifest.get('template_id')}")
            print(f"[moblend] demo: parameters: {[p['id'] for p in loaded_manifest.get('parameters', [])]}")
        except Exception as exc:
            print(f"[moblend] demo: LOAD FAILED: {exc}")
            return 1

    for assignment in cli.get("sets", []):
        if "=" not in assignment:
            print(f"[moblend] demo: ignoring malformed --set {assignment!r}")
            continue
        pid, pval = assignment.split("=", 1)
        # Try to make a sensible Python value (numbers, bools, strings, hex colors)
        val: Any = pval
        low = pval.lower()
        if low in ("true", "false"):
            val = low == "true"
        else:
            try:
                if "." in pval or "e" in low:
                    val = float(pval)
                else:
                    val = int(pval)
            except ValueError:
                val = pval  # keep as string (or the raw hex etc.)

        print(f"[moblend] demo: set_parameter({pid!r}, {val!r})")
        try:
            ok = set_parameter(pid, val)
            if not ok:
                print(f"[moblend] demo: set_parameter({pid}) returned False (unknown id or missing target)")
                exit_code = 1
        except Exception as exc:
            print(f"[moblend] demo: SET FAILED for {pid}: {exc}")
            exit_code = 1

    if cli.get("save"):
        try:
            saved = save_project(incremental=True)
            print(f"[moblend] demo: saved -> {saved}")
            # Show any shadows that now exist next to it
            base = Path(saved)
            shadows = sorted(base.parent.glob(base.name + ".[0-9][0-9]"))
            if shadows:
                print(f"[moblend] demo: shadows present: {[s.name for s in shadows]}")
        except Exception as exc:
            print(f"[moblend] demo: SAVE FAILED: {exc}")
            exit_code = 1

    if loaded_manifest or cli.get("sets") or cli.get("save"):
        print("[moblend] M1 demo complete.")
    return exit_code


cli_args = _parse_cli()
if cli_args.get("load") or cli_args.get("sets") or cli_args.get("save"):
    # One-shot demo / verification path (satisfies the ROADMAP "CLI invocation" gate)
    if bpy is None:
        print("[moblend] demo requested but bpy is not available — cannot continue.")
        sys.exit(1)
    # Make sibling package importable when blender runs this script directly
    _script_dir = Path(__file__).parent
    if str(_script_dir) not in sys.path:
        sys.path.insert(0, str(_script_dir))
    code = _run_m1_demo(cli_args)
    print("[moblend] bootstrap complete.")
    sys.exit(code)

# -------------------------------------------------------------------
# Original M0 stub behavior (no demo flags) — keeps scripts/dev.ps1 happy
# until the long-running server entrypoint is added in M2.
# -------------------------------------------------------------------
if bpy is not None:
    print("[moblend] Stub executed cleanly inside Blender (no template/params yet — M1 demo requires --load etc).")
else:
    print("[moblend] bpy NOT available (executed with host Python — expected for tooling).")

print("[moblend] bootstrap complete.")
sys.exit(0)
