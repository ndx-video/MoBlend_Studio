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

print("[moblend] Mo.Blend engine bootstrap v0.2.0 (M2 — API Broker)")

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
# Lightweight M1 CLI demo + M2 long-running broker support.
# Everything after the first `--` in argv belongs to us.
# Supported (M1 demo):
#   --load PATH
#   --set ID=VALUE   (repeatable)
#   --save
# Supported (M2 broker):
#   --serve                 start FastAPI + binary WS on 127.0.0.1:8000 (keeps Blender alive)
#   --port N                override port (still loopback-only in M2)
#   --load PATH             may be combined with --serve for immediate template availability
# Unknown tokens are ignored (forward-safe for future flags).
# -------------------------------------------------------------------
def _parse_cli() -> dict[str, Any]:
    if "--" not in sys.argv:
        return {}
    try:
        idx = sys.argv.index("--")
    except ValueError:
        return {}
    raw = sys.argv[idx + 1 :]
    result: dict[str, Any] = {
        "load": None,
        "sets": [],
        "save": False,
        "serve": False,
        "port": 8000,
    }
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
        if tok == "--serve":
            result["serve"] = True
            i += 1
            continue
        if tok == "--port" and i + 1 < len(raw):
            try:
                result["port"] = int(raw[i + 1])
            except ValueError:
                pass
            i += 2
            continue
        # Unknown token — ignore (keeps future flags and M1/M2 coexistence safe)
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

# M2 long-running broker path (takes precedence; supports optional initial --load)
if cli_args.get("serve"):
    if bpy is None:
        print("[moblend] --serve requires running inside Blender (bpy).")
        sys.exit(1)
    _script_dir = Path(__file__).parent
    if str(_script_dir) not in sys.path:
        sys.path.insert(0, str(_script_dir))

    # M2: aggressively help Blender's embedded python find packages that were
    # pip-installed into its own interpreter (common Windows embedded gotcha).
    try:
        import site
        site.ENABLE_USER_SITE = True
        # Add the site-packages next to the running python (if any) and common user locations
        py_exe = getattr(sys, "executable", "")
        candidates = []
        if py_exe:
            p = Path(py_exe).resolve()
            candidates += [
                p.parent.parent / "site-packages",
                p.parent / "site-packages",
                p.parent / "lib" / "site-packages",
            ]
        # User site + %APPDATA% python paths (pip --user etc.)
        candidates += list(Path(site.getuserbase()) / "Python*" / "site-packages" for _ in [1])  # glob later
        candidates.append(Path(os.environ.get("APPDATA", "")) / "Python" / "Python313" / "site-packages")
        for c in candidates:
            try:
                cp = Path(c)
                if cp.exists() and str(cp) not in sys.path:
                    sys.path.insert(0, str(cp))
            except Exception:
                pass
        # Also try the "lib" sibling of the current file tree in case of manual layout
        for extra in (Path(_script_dir) / "vendor",):
            if extra.exists() and str(extra) not in sys.path:
                sys.path.insert(0, str(extra))
    except Exception:
        pass

    try:
        from moblend.server import serve_forever  # type: ignore
    except ModuleNotFoundError as e:
        print("[moblend] FATAL: broker dependencies missing inside this Blender's Python.")
        print("    FastAPI/uvicorn must be installed into Blender's python (not your system python).")
        print("    Recommended: run scripts/dev.ps1 (it auto-detects and pip-installs).")
        print("    Manual: <blender-python-exe> -m pip install fastapi 'uvicorn[standard]'")
        print(f"    Original error: {e}")
        sys.exit(1)

    port = int(cli_args.get("port") or 8000)
    load_path = cli_args.get("load")
    print(f"[moblend] entering serve mode on 127.0.0.1:{port}")
    serve_forever(host="127.0.0.1", port=port, initial_load=load_path)
    # serve_forever blocks forever (or until process kill)
    sys.exit(0)

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
# Original M0 stub behavior (no demo/serve flags) — keeps scripts/dev.ps1 happy.
# -------------------------------------------------------------------
if bpy is not None:
    print("[moblend] Stub executed cleanly inside Blender (no template/params yet — M1 demo requires --load etc).")
else:
    print("[moblend] bpy NOT available (executed with host Python — expected for tooling).")

print("[moblend] bootstrap complete.")
sys.exit(0)
