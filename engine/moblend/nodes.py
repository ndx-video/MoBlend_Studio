"""Mo.Blend node targeting + type coercion + mutation.

Core of engine.set_parameter. Resolves targets by name (node group or material)
then by stable socket interface *identifier* (never positional index).
Implements the full scalar coercion table required for M1.
"""

from __future__ import annotations

from typing import Any

import bpy  # type: ignore[import-not-found]


def find_target_node_tree(name: str) -> Any | None:
    """Locate a node tree by the manifest node_target string.

    Supports:
    - bpy.data.node_groups[name]  (Geometry Node groups, etc.)
    - bpy.data.materials[name].node_tree  (material node trees, e.g. "Material_Neon")
    """
    if not name:
        return None

    ng = bpy.data.node_groups.get(name)
    if ng is not None:
        return ng

    mat = bpy.data.materials.get(name)
    if mat is not None and getattr(mat, "node_tree", None) is not None:
        return mat.node_tree

    return None


def resolve_input_socket_by_identifier(node_tree: Any, socket_identifier: str) -> Any | None:
    """Find the interface input socket item by its stable .identifier.

    This is the *only* correct way per PRD 2 §3 and the schema docs.
    Positional index or name lookup will break the moment an author
    reorders sockets in the group.
    """
    if node_tree is None or not socket_identifier:
        return None

    interface = getattr(node_tree, "interface", None)
    if interface is None or not hasattr(interface, "items_tree"):
        return None

    for item in interface.items_tree:
        if getattr(item, "item_type", None) != "SOCKET":
            continue
        if getattr(item, "in_out", None) != "INPUT":
            continue
        if getattr(item, "identifier", None) == socket_identifier:
            return item

    return None


# -------------------------------------------------------------------
# Coercion (raw client/API value -> Blender-ready default_value)
# Matches the canonical types in manifest.schema.json + PRD 2 examples.
# -------------------------------------------------------------------

def coerce_value(raw: Any, ptype: str, options: list[str] | None = None) -> Any:
    """Translate a high-level value into the Python object Blender expects
    for a socket's .default_value on its interface declaration.
    """
    if ptype in ("string", "text"):
        return str(raw)

    if ptype == "int":
        return int(raw)

    if ptype == "float":
        return float(raw)

    if ptype == "bool":
        if isinstance(raw, str):
            return raw.lower() in ("1", "true", "yes", "on")
        return bool(raw)

    if ptype == "color_rgba":
        if isinstance(raw, (list, tuple)) and len(raw) >= 3:
            r, g, b = (float(raw[0]), float(raw[1]), float(raw[2]))
            a = float(raw[3]) if len(raw) > 3 else 1.0
            return (r, g, b, a)
        if isinstance(raw, str) and raw.startswith("#"):
            return _hex_to_linear_rgba(raw)
        # Fallback: try to treat as iterable of 3/4 numbers
        try:
            vals = [float(x) for x in raw][:4]
            while len(vals) < 4:
                vals.append(1.0 if len(vals) == 3 else 0.0)
            return tuple(vals)
        except Exception:
            return (0.0, 0.0, 0.0, 1.0)

    if ptype == "enum":
        if options:
            # Accept either the label or a 0-based index
            if isinstance(raw, int):
                idx = max(0, min(raw, len(options) - 1))
                return idx  # we will wire an Int socket for the demo
            if isinstance(raw, str):
                if raw in options:
                    return options.index(raw)
                # try numeric string
                try:
                    idx = int(raw)
                    return max(0, min(idx, len(options) - 1))
                except ValueError:
                    pass
        # No options or unknown value — return as string (caller decides socket)
        return str(raw)

    # Unknown type — let the caller fail loudly (defensive)
    return raw


def _hex_to_linear_rgba(hex_str: str) -> tuple[float, float, float, float]:
    """#RRGGBB or #RRGGBBAA -> (r,g,b,a) floats in 0..1 (simple linear map)."""
    h = hex_str.lstrip("#")
    if len(h) == 6:
        r = int(h[0:2], 16) / 255.0
        g = int(h[2:4], 16) / 255.0
        b = int(h[4:6], 16) / 255.0
        return (r, g, b, 1.0)
    if len(h) == 8:
        r = int(h[0:2], 16) / 255.0
        g = int(h[2:4], 16) / 255.0
        b = int(h[4:6], 16) / 255.0
        a = int(h[6:8], 16) / 255.0
        return (r, g, b, a)
    return (0.0, 0.0, 0.0, 1.0)


def apply_to_socket(item: Any, ptype: str, coerced: Any) -> None:
    """Write the coerced value onto the interface item's default_value."""
    if item is None:
        return
    # Most socket interface items accept the matching Python type directly
    # (float/int/str/bool/tuple-of-4 for color, int for our enum demo).
    try:
        item.default_value = coerced
    except Exception:
        # Last-ditch: for color sometimes a Color object is expected
        if ptype == "color_rgba" and isinstance(coerced, (list, tuple)):
            try:
                from mathutils import Color  # type: ignore

                c = Color((coerced[0], coerced[1], coerced[2]))
                # alpha lives separately on some items
                item.default_value = (coerced[0], coerced[1], coerced[2], coerced[3])
            except Exception:
                item.default_value = coerced  # let it raise if truly incompatible
        else:
            raise


def flag_depsgraph_update() -> None:
    """Force a depsgraph refresh so that the next viewport frame (or render)
    sees the mutated socket values. Called after every successful set_parameter.
    """
    try:
        bpy.context.evaluated_depsgraph_get().update()
    except Exception:
        # In some headless contexts this may be a no-op; not fatal for M1.
        pass
