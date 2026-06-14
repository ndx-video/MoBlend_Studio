"""Mo.Blend Python Engine public API (M1 core + M2 render).

Implements the functions declared in specs/Mo.Blend API & Function Spec.md:

- load_template, set_parameter, save_project (M1)
- render_frame (M2 viewport / preview support)

All bpy interaction is single-threaded (as required). Network concerns,
action queues, and the broker live in server.py (M2+).
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


_preview_engine_ready = False


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
    global _current_manifest, _current_path, _dirty, _preview_engine_ready

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
    _preview_engine_ready = False

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


# -------------------------------------------------------------------
# M2 viewport support (called by the broker action queue / timer only)
# -------------------------------------------------------------------

import tempfile
import os


def _resolve_eevee_engine() -> str:
    """Return the best available EEVEE render engine id for this Blender build."""
    for engine_id in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            bpy.context.scene.render.engine = engine_id
            if bpy.context.scene.render.engine == engine_id:
                return engine_id
        except Exception:
            continue
    return bpy.context.scene.render.engine


def _ensure_preview_engine(sc: bpy.types.Scene) -> None:
    """One-time EEVEE setup for low-latency viewport previews (PRD 1 §4.1)."""
    global _preview_engine_ready
    if _preview_engine_ready:
        return
    _resolve_eevee_engine()
    ee = getattr(sc, "eevee", None)
    if ee is not None:
        for attr, val in (
            ("taa_render_samples", 1),
            ("use_gtao", False),
            ("use_bloom", False),
            ("use_ssr", False),
            ("use_motion_blur", False),
        ):
            if hasattr(ee, attr):
                try:
                    setattr(ee, attr, val)
                except Exception:
                    pass
    _preview_engine_ready = True


def render_frame(
    frame_number: int,
    width: int | None = None,
    height: int | None = None,
    img_format: str = "JPEG",
) -> bytes:
    """Render a single frame using Eevee and return compressed image bytes.

    Honors optional client-requested width/height (sets resolution + 100% for preview).
    Uses JPEG (opaque Studio) or WEBP (alpha-capable, e.g. OBS). The broker decides
    format per the WS request flags.

    The caller (broker) is responsible for ensuring a template is loaded and any
    parameter mutations + depsgraph flag have occurred before requesting the frame.

    Returns raw bytes of the encoded still. Raises on render failure.
    """
    if _current_manifest is None:
        raise RuntimeError("No template loaded. Call load_template(...) first.")

    sc = bpy.context.scene
    rnd = sc.render
    settings = rnd.image_settings

    # Save prior state for restore (important: previews must not pollute user project settings)
    old_x = rnd.resolution_x
    old_y = rnd.resolution_y
    old_pct = rnd.resolution_percentage
    old_filepath = rnd.filepath
    old_file_format = settings.file_format
    old_transparent = getattr(rnd, "film_transparent", False)

    tmp_path: str | None = None
    try:
        # PRD 1: previews use EEVEE (Eevee Next on Blender 5.x when available)
        _ensure_preview_engine(sc)

        # Honor requested preview size (or keep scene default)
        if width is not None:
            rnd.resolution_x = max(64, min(int(width), 8192))
        if height is not None:
            rnd.resolution_y = max(64, min(int(height), 8192))
        rnd.resolution_percentage = 100

        # Frame
        sc.frame_set(int(frame_number))

        # Format selection per PRD 3 / spec
        fmt = (img_format or "JPEG").upper()
        if fmt == "WEBP":
            settings.file_format = "WEBP"
            rnd.film_transparent = True  # alpha for OBS-style use
        else:
            settings.file_format = "JPEG"
            rnd.film_transparent = False

        # Secure temp file (cleaned immediately after read)
        fd, tmp_path = tempfile.mkstemp(suffix=f".{fmt.lower()}")
        os.close(fd)
        rnd.filepath = tmp_path

        # Actual Eevee render (write_still writes the file using the format we set)
        bpy.ops.render.render(write_still=True)

        with open(tmp_path, "rb") as f:
            data = f.read()

        if not data:
            raise RuntimeError("Render produced empty output.")

        return data
    finally:
        # Always restore render settings
        try:
            rnd.resolution_x = old_x
            rnd.resolution_y = old_y
            rnd.resolution_percentage = old_pct
            rnd.filepath = old_filepath
            settings.file_format = old_file_format
            if hasattr(rnd, "film_transparent"):
                rnd.film_transparent = old_transparent
        except Exception:
            pass

        if tmp_path:
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except Exception:
                pass
