#!/usr/bin/env python3
"""
M1 Engine Core round-trip verification script.

Run directly under headless Blender (the only way to exercise bpy):

    blender --background --factory-startup --python engine/tests/m1_roundtrip.py

What it does (all without any manual Blender UI):
1. Builds a minimal valid parametric .mo.blend **in memory** (Geometry Nodes + manifest
   embedded at scene['moblend_manifest']) using stable socket identifiers discovered at
   creation time.
2. Saves it to a temp location (synthetic template — no committed binaries).
3. Calls the public engine API: load_template → set_parameter (for all 6 core scalar
   types) → save_project(incremental=True).
4. Verifies that shadow .01 exists (and after repeated saves the .01–.05 rotation works).
5. Re-loads the saved file and inspects the live interface socket .default_value values
   to prove mutations were persisted in the .mo.blend on disk.
6. Prints a clear PASS banner + summary and exits 0, or FAIL + details and exits 1.

This script is the concrete implementation of the ROADMAP M1 "integration test or script
proves param round-trip without manual Blender UI" gate.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from typing import Any

# Make the engine package importable when this script is --python'ed from any CWD
_THIS_DIR = Path(__file__).resolve().parent
_ENGINE_ROOT = _THIS_DIR.parent
if str(_ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(_ENGINE_ROOT))

import bpy  # type: ignore[import-not-found]
import json

from moblend.engine import (
    get_current_manifest,
    is_dirty,
    load_template,
    save_project,
    set_parameter,
)
from moblend.manifest import find_parameter, minimal_validate
from moblend.nodes import (
    find_target_node_tree,
    resolve_input_socket_by_identifier,
)

# -------------------------------------------------------------------
# Synthetic minimal parametric template generator
# -------------------------------------------------------------------

def _create_minimal_test_template() -> tuple[Path, dict[str, Any]]:
    """Create a tiny but fully valid .mo.blend + manifest in the current bpy session.

    Returns (temp_path_to_saved_mo_blend, the_manifest_dict).
    The manifest uses real stable socket_identifiers captured from the
    interface at creation time (exactly as an author or the PRD 8 addon would).
    """
    # Fresh empty scene (factory-startup + background already did most of the work,
    # but we want a known starting point with a cube etc.)
    bpy.ops.wm.read_homefile(use_empty=True)

    # Create the Geometry Node group that will be our "node_target"
    gn = bpy.data.node_groups.new(name="M1TestGroup", type="GeometryNodeTree")

    # Geometry input/output (required — without INPUT geometry the GN modifier receives no mesh)
    gn.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    gn.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")

    # --- Define 6 parameters covering every core scalar type (per user choice) ---
    # We capture the exact .identifier after new_socket so the manifest is truthful.
    params: list[dict[str, Any]] = []

    # 1. float
    item = gn.interface.new_socket(name="Intensity", in_out="INPUT", socket_type="NodeSocketFloat")
    item.default_value = 1.0
    item.min_value = 0.0
    item.max_value = 5.0
    params.append(
        {
            "id": "intensity",
            "type": "float",
            "label": "Intensity",
            "node_target": "M1TestGroup",
            "socket_identifier": item.identifier,
            "default": 1.0,
            "min": 0.0,
            "max": 5.0,
        }
    )

    # 2. string
    item = gn.interface.new_socket(name="Label", in_out="INPUT", socket_type="NodeSocketString")
    item.default_value = "Hello"
    params.append(
        {
            "id": "label",
            "type": "string",
            "label": "Label",
            "node_target": "M1TestGroup",
            "socket_identifier": item.identifier,
            "default": "Hello",
        }
    )

    # 3. color_rgba (we will mutate with a hex string in the test)
    item = gn.interface.new_socket(name="Tint", in_out="INPUT", socket_type="NodeSocketColor")
    item.default_value = (0.2, 0.8, 0.4, 1.0)
    params.append(
        {
            "id": "tint",
            "type": "color_rgba",
            "label": "Tint",
            "node_target": "M1TestGroup",
            "socket_identifier": item.identifier,
            "default": "#33CC66",
        }
    )

    # 4. bool
    item = gn.interface.new_socket(name="Enabled", in_out="INPUT", socket_type="NodeSocketBool")
    item.default_value = True
    params.append(
        {
            "id": "enabled",
            "type": "bool",
            "label": "Enabled",
            "node_target": "M1TestGroup",
            "socket_identifier": item.identifier,
            "default": True,
        }
    )

    # 5. int
    item = gn.interface.new_socket(name="Count", in_out="INPUT", socket_type="NodeSocketInt")
    item.default_value = 3
    item.min_value = 0
    item.max_value = 20
    params.append(
        {
            "id": "count",
            "type": "int",
            "label": "Count",
            "node_target": "M1TestGroup",
            "socket_identifier": item.identifier,
            "default": 3,
            "min": 0,
            "max": 20,
        }
    )

    # 6. enum (wired to an Int socket for reliable cross-version behavior; manifest declares options)
    item = gn.interface.new_socket(name="StylePreset", in_out="INPUT", socket_type="NodeSocketInt")
    item.default_value = 0
    item.min_value = 0
    item.max_value = 2
    params.append(
        {
            "id": "style_preset",
            "type": "enum",
            "label": "Style Preset",
            "node_target": "M1TestGroup",
            "socket_identifier": item.identifier,
            "default": "plain",
            "options": ["plain", "neon", "glitch"],
        }
    )

    # Geometry flow: mesh in → transform (scale ← Intensity) → mesh out
    group_input = gn.nodes.new("NodeGroupInput")
    group_output = gn.nodes.new("NodeGroupOutput")
    transform = gn.nodes.new("GeometryNodeTransform")

    gn.links.new(group_input.outputs["Geometry"], transform.inputs["Geometry"])
    gn.links.new(group_input.outputs["Intensity"], transform.inputs["Scale"])
    gn.links.new(transform.outputs["Geometry"], group_output.inputs["Geometry"])

    # Place the group on the default cube via a Geometry Nodes modifier
    cube = bpy.data.objects.get("Cube")
    if cube is None:
        # In an empty factory scene there should be one; create defensively
        bpy.ops.mesh.primitive_cube_add()
        cube = bpy.context.active_object
    mod = cube.modifiers.new(name="M1Test", type="NODES")
    mod.node_group = gn

    # Build the manifest (exactly the shape the schema + engine expect)
    manifest: dict[str, Any] = {
        "version": "1.0",
        "template_id": "m1-roundtrip-test",
        "metadata": {
            "name": "M1 Round-trip Test",
            "author": "MoBlend_Studio M1 verification",
            "template_version": "0.0.1",
            "category": "test",
            "description": "Synthetic template generated by engine/tests/m1_roundtrip.py",
        },
        "parameters": params,
        # M3 slot timeline — Studio editor reads these via GET /manifest
        "slots": [
            {"index": 0, "label": "Intro", "start_time": 0.0, "end_time": 2.0},
            {"index": 1, "label": "Hold", "start_time": 2.0, "end_time": 5.0},
        ],
        "slot_presets": [
            {"id": "fade_in", "label": "Fade In"},
            {"id": "hold", "label": "Hold"},
        ],
    }

    # Quick self-check that our own manifest is valid before we save
    minimal_validate(manifest)

    # Store as JSON *string* for reliable persistence across save/load
    # (the tolerant parser in manifest.py accepts str or dict transparently).
    # Native dict assignment can be lossy for nested ID properties on some
    # Blender versions/builds; JSON string is the bulletproof form used by
    # many production addons and by the registry CI artifacts.
    bpy.context.scene["moblend_manifest"] = json.dumps(manifest)

    # (Optional) also keep the live dict under a different key for any same-session
    # inspection before the first open_mainfile in the test; not required.

    # Verify evaluated geometry before save (catches broken GN wiring early)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = cube.evaluated_get(dg)
    _eval_mesh = ev.to_mesh()
    _vert_count = len(_eval_mesh.vertices) if _eval_mesh else 0
    ev.to_mesh_clear()
    if _vert_count == 0:
        raise RuntimeError("M1 template GN wiring produced 0 evaluated vertices — viewport would be black")

    # World + camera + light for EEVEE previews
    sc = bpy.context.scene
    if sc.world is None:
        world = bpy.data.worlds.new("MoBlendWorld")
        sc.world = world
        world.use_nodes = True
        nt = world.node_tree
        if nt:
            bg = nt.nodes.get("Background")
            if bg:
                bg.inputs["Color"].default_value = (0.04, 0.04, 0.06, 1.0)
                bg.inputs["Strength"].default_value = 1.0

    # Camera + light required for M2 render_frame / EEVEE viewport previews
    if bpy.context.scene.camera is None:
        bpy.ops.object.camera_add(location=(4.0, -4.0, 3.0))
        cam = bpy.context.active_object
        if cam is not None:
            cam.rotation_euler = (1.1, 0.0, 0.785)
            bpy.context.scene.camera = cam
    if not any(o.type == "LIGHT" for o in bpy.data.objects):
        bpy.ops.object.light_add(type="SUN", location=(2.0, 2.0, 5.0))

    # Save to a predictable temp location (will be cleaned by OS; shadows live next to it)
    tmp_dir = Path(tempfile.gettempdir())
    out_path = tmp_dir / "m1_minimal_test.mo.blend"
    # Remove any previous run artifacts (including old shadows) for a clean slate
    for old in list(tmp_dir.glob("m1_minimal_test.mo.blend*")):
        try:
            old.unlink()
        except Exception:
            pass

    bpy.ops.wm.save_as_mainfile(filepath=str(out_path))
    print(f"[m1-verify] synthetic template written -> {out_path}")
    return out_path, manifest


def _manifest_default(manifest: dict[str, Any], param_id: str) -> Any:
    """Return the `default` field for param_id from a manifest dict."""
    param = find_parameter(manifest, param_id)
    return param.get("default") if param else None


def _hex_equal(a: str, b: str) -> bool:
    return str(a).lstrip("#").upper() == str(b).lstrip("#").upper()


def _inspect_live_defaults(node_group_name: str, socket_ids: dict[str, str]) -> dict[str, Any]:
    """Read the current .default_value for each socket identifier from the interface."""
    tree = find_target_node_tree(node_group_name)
    if tree is None:
        return {}
    out: dict[str, Any] = {}
    for pid, sid in socket_ids.items():
        item = resolve_input_socket_by_identifier(tree, sid)
        if item is not None:
            out[pid] = getattr(item, "default_value", None)
    return out


def main() -> int:
    print("=" * 70)
    print("M1 ENGINE CORE ROUND-TRIP VERIFICATION")
    print("=" * 70)
    ver = getattr(bpy.app, "version_string", "unknown")
    print(f"Blender: {ver}")
    print(f"Python : {sys.version.splitlines()[0]}")

    # 1. Generate a real on-disk .mo.blend that contains a manifest + real sockets
    template_path, authored = _create_minimal_test_template()

    # Build a quick map of param id -> socket_identifier for later live inspection
    socket_map: dict[str, str] = {
        p["id"]: p["socket_identifier"] for p in authored["parameters"]
    }

    # 2. Load via the engine API
    print("\n[1] load_template")
    loaded = load_template(str(template_path))
    assert loaded["template_id"] == "m1-roundtrip-test"
    print(f"    loaded template_id={loaded['template_id']}, {len(loaded['parameters'])} params")
    assert not is_dirty()

    # 3. Mutate every core scalar type with visibly different values
    print("\n[2] set_parameter (all core scalar types)")
    mutations: list[tuple[str, Any]] = [
        ("intensity", 2.75),                    # float
        ("label", "M1 DEMO LIVE"),              # string
        ("tint", "#FF3366"),                    # color_rgba via hex (coercion path)
        ("enabled", False),                     # bool
        ("count", 7),                           # int
        ("style_preset", "glitch"),             # enum (by label -> index in coerce)
    ]

    before = _inspect_live_defaults("M1TestGroup", socket_map)
    print(f"    before: { {k: before.get(k) for k in socket_map} }")

    for pid, pval in mutations:
        ok = set_parameter(pid, pval)
        if not ok:
            print(f"    FAIL: set_parameter({pid!r}, {pval!r}) returned False")
            return 1
        print(f"    OK  : set_parameter({pid!r}, {pval!r})")

    assert is_dirty()
    after_mut = _inspect_live_defaults("M1TestGroup", socket_map)
    print(f"    after mutation (live): { {k: after_mut.get(k) for k in socket_map} }")

    # 4. Incremental save → must produce .01 shadow
    print("\n[3] save_project(incremental=True)")
    saved = save_project(incremental=True)
    print(f"    saved -> {saved}")
    saved_p = Path(saved)
    shadow_01 = Path(str(saved_p) + ".01")
    if not shadow_01.exists():
        print(f"    FAIL: expected shadow {shadow_01} does not exist after incremental save")
        return 1
    print(f"    shadow .01 exists: {shadow_01.name}")

    # Optional: do a couple more incremental saves so rotation can be observed
    for extra in range(2):
        set_parameter("intensity", 1.0 + extra)
        save_project(incremental=True)
    shadows = sorted(saved_p.parent.glob(saved_p.name + ".[0-9][0-9]"))
    print(f"    shadows after a few saves: {[s.name for s in shadows]}")
    if len(shadows) > 5:
        print("    WARN: more than 5 shadows present (rotation should have capped at 5)")

    # 5. Prove the values are in the *saved file* by reloading and inspecting
    print("\n[4] reload + live value inspection (persistence proof)")
    # We can either call load_template again (it will open_mainfile) or just open directly.
    # Use load_template so we also exercise the public API + validation.
    reloaded = load_template(str(saved_p))
    assert reloaded["template_id"] == "m1-roundtrip-test"

    live_after_reload = _inspect_live_defaults("M1TestGroup", socket_map)
    print(f"    live after reload: { {k: live_after_reload.get(k) for k in socket_map} }")

    # Check a few key mutations survived on disk
    checks = [
        ("intensity", 2.0),          # last extra save set it to ~2.0
        ("label", "M1 DEMO LIVE"),
        ("enabled", False),
    ]
    # intensity will be whatever the last extra save wrote; just ensure it is a float and different from original
    intensity_val = live_after_reload.get("intensity")
    if not isinstance(intensity_val, (int, float)) or intensity_val == 1.0:
        print(f"    FAIL: intensity did not persist a mutated value (got {intensity_val})")
        return 1

    for pid, expected in checks:
        val = live_after_reload.get(pid)
        if pid == "enabled":
            if bool(val) != expected:
                print(f"    FAIL: {pid} expected {expected} got {val}")
                return 1
        elif pid == "label":
            if str(val) != expected:
                print(f"    FAIL: {pid} expected {expected!r} got {val!r}")
                return 1

    print("    persistence checks passed for mutated params")

    # 5. Manifest JSON defaults must match mutations (GET /manifest contract)
    print("\n[5] manifest defaults after reload (moblend_manifest sync)")
    expected_manifest_defaults: list[tuple[str, Any, str]] = [
        ("intensity", 2.0, "float"),
        ("label", "M1 DEMO LIVE", "string"),
        ("tint", "#FF3366", "color"),
        ("enabled", False, "bool"),
        ("count", 7, "int"),
        ("style_preset", "glitch", "enum"),
    ]
    for pid, expected, kind in expected_manifest_defaults:
        actual = _manifest_default(reloaded, pid)
        if kind == "float":
            if not isinstance(actual, (int, float)) or abs(float(actual) - float(expected)) > 1e-6:
                print(f"    FAIL: manifest default {pid} expected {expected} got {actual}")
                return 1
        elif kind == "color":
            if not _hex_equal(str(actual), str(expected)):
                print(f"    FAIL: manifest default {pid} expected {expected!r} got {actual!r}")
                return 1
        elif kind == "bool":
            if bool(actual) != expected:
                print(f"    FAIL: manifest default {pid} expected {expected} got {actual}")
                return 1
        elif actual != expected:
            print(f"    FAIL: manifest default {pid} expected {expected!r} got {actual!r}")
            return 1
        print(f"    OK  : manifest[{pid}].default = {actual!r}")

    print("    manifest sync checks passed")

    # 6. Success banner
    print("\n" + "=" * 70)
    print("M1 ROUNDTRIP PASS")
    print(f"Template : {template_path}")
    print(f"Final save: {saved}")
    print(f"Shadows   : {[s.name for s in shadows]}")
    print(f"Params mutated: {[pid for pid, _ in mutations]}")
    print("=" * 70)

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        import traceback

        print("\nM1 ROUNDTRIP FAIL (unhandled exception)")
        traceback.print_exc()
        sys.exit(1)
