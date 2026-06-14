"""Mo.Blend Python Engine public API (M1 core).

Implements exactly the three functions declared in the Internal Engine API
section of specs/Mo.Blend API & Function Spec.md for M1:

- load_template
- set_parameter
- save_project (with incremental shadow handling)

All bpy interaction is single-threaded (as required). Network concerns,
action queues, and the broker are M2+.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import bpy  # type: ignore[import-not-found]

from . import io, manifest, nodes

# -------------------------------------------------------------------
# In-memory session state (simple module globals are sufficient for M1;
# the broker in M2 will sit on top of this and serialize access via queue).
# -------------------------------------------------------------------

_current_manifest: dict[str, Any] | None = None
_current_path: str | None = None
_dirty: bool = False


def get_current_manifest() -> dict[str, Any] | None:
    """Return a shallow copy of the currently loaded manifest (or None)."""
    return dict(_current_manifest) if _current_manifest is not None else None


def is_dirty() -> bool:
    """True if a parameter mutation has occurred since last load or save."""
    return _dirty


# -------------------------------------------------------------------
# Public API surface (the contract other layers will call)
# -------------------------------------------------------------------

def load_template(filepath: str) -> dict[str, Any]:
    """Load a .mo.blend template, parse + validate its manifest, replace scene.

    Enforces the .mo.blend-only sandbox rule (PRD 2 §2.1).
    Returns the manifest dict (authoritative contract for this template).
    """
    global _current_manifest, _current_path, _dirty

    p = Path(filepath).resolve()
    path_str = str(p)

    # Strict extension enforcement (even for compound .mo.blend)
    if not path_str.lower().endswith(".mo.blend"):
        raise ValueError(
            f"Refusing to load non-.mo.blend file (sandbox rule): {filepath}"
        )

    # Security: never auto-execute scripts from templates
    try:
        bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    except Exception:
        pass

    # This replaces the entire bpy data (the "clear + load" semantics)
    bpy.ops.wm.open_mainfile(filepath=path_str)

    m = manifest.parse_manifest_from_scene()
    manifest.minimal_validate(m)

    _current_manifest = copy.deepcopy(m)
    _current_path = path_str
    _dirty = False

    # Return a copy so callers cannot accidentally mutate our state
    return copy.deepcopy(_current_manifest)


def set_parameter(param_id: str, value: Any) -> bool:
    """Mutate one parameter by id using the loaded manifest contract.

    Looks up the param, coerces the value, resolves the exact socket by
    stable identifier (never position), writes .default_value, and flags
    the depsgraph.

    Returns True on success, False if the param_id was unknown or the
    target socket could not be resolved in the current file.
    """
    global _dirty

    if _current_manifest is None:
        raise RuntimeError("No template loaded. Call load_template(...) first.")

    param = manifest.find_parameter(_current_manifest, param_id)
    if param is None:
        return False

    ptype: str = param["type"]
    opts: list[str] | None = param.get("options")

    coerced = nodes.coerce_value(value, ptype, opts)

    tree = nodes.find_target_node_tree(param["node_target"])
    if tree is None:
        return False

    item = nodes.resolve_input_socket_by_identifier(tree, param["socket_identifier"])
    if item is None:
        return False

    nodes.apply_to_socket(item, ptype, coerced)
    nodes.flag_depsgraph_update()

    manifest.sync_parameter_default(_current_manifest, param_id, ptype, coerced, opts)
    manifest.write_manifest_to_scene(_current_manifest)

    _dirty = True
    return True


def save_project(filepath: str | None = None, incremental: bool = True) -> str:
    """Write the current Blender session to disk.

    If incremental=True (default), rotates the .01–.05 shadow backups first
    (PRD 2 §2.2). Always runs orphans_purge before the write.

    Returns the absolute path of the file that was written.
    """
    global _dirty, _current_path

    target = filepath or _current_path
    if not target:
        raise RuntimeError(
            "No save target. Either load a template first or pass an explicit filepath."
        )

    target_path = Path(target).resolve()
    path_str = str(target_path)

    if not path_str.lower().endswith(".mo.blend"):
        raise ValueError(
            f"Refusing to save non-.mo.blend file (sandbox rule): {target}"
        )

    io.orphans_purge()

    if incremental:
        io.shadow_rotate(target_path)

    bpy.ops.wm.save_as_mainfile(filepath=str(target_path))

    # If we saved over (or as) the current session, keep state consistent
    _current_path = str(target_path)
    _dirty = False

    return str(target_path)
