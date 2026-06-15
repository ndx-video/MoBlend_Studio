"""Mo.Blend manifest parsing and light structural validation.

The manifest lives at bpy.context.scene['moblend_manifest'] as a plain dict
that conforms to specs/manifest.schema.json (authoritative, but we avoid
a runtime jsonschema dependency for M1 — minimal deps rule).
"""

from __future__ import annotations

from typing import Any

import bpy  # type: ignore[import-not-found]
import json


# Canonical scalar + asset types from the schema. image/video/font are
# routed through ingest_asset (M3) and still validated here for manifest round-trips.
ALLOWED_PARAM_TYPES: frozenset[str] = frozenset(
    {
        "string",
        "text",
        "int",
        "float",
        "bool",
        "color_rgba",
        "enum",
        "image",
        "video",
        "font",
    }
)


def parse_manifest_from_scene() -> dict[str, Any]:
    """Return the raw manifest dict embedded in the current scene.

    Tolerates the value being stored as a JSON string (very reliable for
    roundtrips across save/load) or as a native dict (convenient in-memory).
    Raises a clear error if neither form is present or valid.
    """
    scene = bpy.context.scene
    raw = scene.get("moblend_manifest")
    if raw is None:
        raise RuntimeError(
            "No 'moblend_manifest' custom property on the active scene. "
            "Is this a valid .mo.blend template?"
        )
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
    raise RuntimeError(
        "The 'moblend_manifest' custom property exists but is not a dict "
        "and could not be parsed as JSON. Corrupt or non-Mo.Blend file?"
    )


def minimal_validate(manifest: dict[str, Any]) -> None:
    """Lightweight structural validation sufficient for M1.

    Enforces the keys the engine actually relies on at runtime.
    Does not attempt full JSON Schema validation (that lives in registry CI
    and can be added to the broker later without changing this surface).
    """
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be a dict")

    if manifest.get("version") != "1.0":
        raise ValueError("manifest.version must be '1.0' for this engine")

    if not manifest.get("template_id"):
        raise ValueError("manifest.template_id is required")

    params = manifest.get("parameters")
    if not isinstance(params, list) or len(params) == 0:
        raise ValueError("manifest.parameters must be a non-empty list")

    for idx, p in enumerate(params):
        if not isinstance(p, dict):
            raise ValueError(f"parameter[{idx}] must be an object")
        for required in ("id", "type", "node_target", "socket_identifier"):
            if required not in p or p[required] in (None, ""):
                raise ValueError(
                    f"parameter[{idx}] missing or empty required field '{required}'"
                )
        ptype = p["type"]
        if ptype not in ALLOWED_PARAM_TYPES:
            raise ValueError(
                f"parameter[{idx}] type '{ptype}' is not supported "
                f"(allowed: {sorted(ALLOWED_PARAM_TYPES)})"
            )
        if ptype == "enum":
            opts = p.get("options")
            if not isinstance(opts, list) or len(opts) == 0:
                raise ValueError(f"parameter[{idx}] (enum) requires non-empty 'options' list")


def find_parameter(manifest: dict[str, Any], param_id: str) -> dict[str, Any] | None:
    """Return the parameter definition for param_id or None."""
    for p in manifest.get("parameters", []):
        if isinstance(p, dict) and p.get("id") == param_id:
            return p
    return None


def encode_default_for_manifest(
    ptype: str,
    coerced: Any,
    options: list[str] | None = None,
) -> Any:
    """Encode a Blender socket value into the client-facing manifest `default` form.

    Inverse of nodes.coerce_value — used to keep moblend_manifest in sync after
    set_parameter so GET /manifest and load_template reflect current values.
    """
    if ptype in ("string", "text"):
        return str(coerced)

    if ptype == "int":
        return int(coerced)

    if ptype == "float":
        return float(coerced)

    if ptype == "bool":
        return bool(coerced)

    if ptype == "color_rgba":
        if isinstance(coerced, (list, tuple)) and len(coerced) >= 3:
            r, g, b = float(coerced[0]), float(coerced[1]), float(coerced[2])
            a = float(coerced[3]) if len(coerced) > 3 else 1.0
            return _rgba_to_hex(r, g, b, a)
        return str(coerced)

    if ptype == "enum":
        if options and isinstance(coerced, int):
            idx = max(0, min(coerced, len(options) - 1))
            return options[idx]
        return coerced

    return coerced


def _rgba_to_hex(r: float, g: float, b: float, a: float = 1.0) -> str:
    """Linear RGBA floats (0..1) -> #RRGGBB or #RRGGBBAA hex string."""
    ri, gi, bi = int(round(r * 255)), int(round(g * 255)), int(round(b * 255))
    if a >= 0.999:
        return f"#{ri:02X}{gi:02X}{bi:02X}"
    ai = int(round(a * 255))
    return f"#{ri:02X}{gi:02X}{bi:02X}{ai:02X}"


def sync_parameter_default(
    manifest: dict[str, Any],
    param_id: str,
    ptype: str,
    coerced: Any,
    options: list[str] | None = None,
) -> None:
    """Update the parameter's `default` field in the in-memory manifest."""
    param = find_parameter(manifest, param_id)
    if param is not None:
        param["default"] = encode_default_for_manifest(ptype, coerced, options)


def write_manifest_to_scene(manifest: dict[str, Any]) -> None:
    """Persist the manifest dict to scene['moblend_manifest'] as a JSON string."""
    bpy.context.scene["moblend_manifest"] = json.dumps(manifest)


def sync_slots(manifest: dict[str, Any], slots: list[dict[str, Any]]) -> None:
    """Replace the top-level 'slots' array in the in-memory manifest.

    Called by set_slot after successful update so that GET /manifest and
    subsequent loads reflect the new time bounds / preset choices.
    Slots are optional in the schema; this is a no-op if manifest lacks support.
    """
    if isinstance(slots, list):
        manifest["slots"] = slots
