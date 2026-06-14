#!/usr/bin/env python3
"""
Mo.Blend Engine bootstrap (M0 stub).

Usage (headless):
    blender --background --factory-startup --python engine/bootstrap.py

The script is executed by Blender with `bpy` pre-imported in the global scope.
It must remain side-effect light for now; M1 will expand to project load + set_parameter.

This file can also be executed directly with system Python for basic smoke tests
( b p y  will be unavailable outside Blender).
"""
from __future__ import annotations

import os
import sys

print("[moblend] Mo.Blend engine stub v0.0.0 (M0 — Specs & Scaffold)")
print(f"[moblend] Python: {sys.version.splitlines()[0]}")
print(f"[moblend] Script: {__file__}")
print(f"[moblend] CWD:    {os.getcwd()}")

bpy = None
try:
    import bpy  # type: ignore[import-not-found]  # Injected by Blender
except ImportError:
    pass

if bpy is not None:
    ver = getattr(bpy.app, "version_string", "unknown")
    bin_path = getattr(bpy.app, "binary_path", "unknown")
    print(f"[moblend] bpy available — Blender {ver}")
    print(f"[moblend] binary: {bin_path}")
    # M0: intentionally do nothing with the scene.
    # Future: load .mo.blend, parse manifest from custom props, etc.
    print("[moblend] Stub executed cleanly inside Blender (no template/params yet).")
else:
    print("[moblend] bpy NOT available (executed with host Python — expected for tooling).")

print("[moblend] bootstrap complete.")
sys.exit(0)
