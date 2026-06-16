"""MCP tool implementations for moblend_* broker tools (PRD 3 §3.3)."""

from __future__ import annotations

import base64
import queue
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import catalog, engine
from .store import BrokerDB, moblend_home

BrokerTaskFactory = Callable[[str, dict[str, Any]], Any]
EnqueueFn = Callable[[Any], None]


@dataclass
class BrokerToolContext:
    enqueue: EnqueueFn
    task_factory: BrokerTaskFactory
    catalog_db: Callable[[], BrokerDB]


def _filter_templates(
    templates: list[dict[str, Any]],
    *,
    category: str | None,
    query: str | None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    q = (query or "").strip().lower()
    cat = (category or "").strip().lower()
    for entry in templates:
        if cat and str(entry.get("category", "")).lower() != cat:
            continue
        if q:
            hay = " ".join(
                str(entry.get(k, ""))
                for k in ("template_id", "name", "description", "category")
            ).lower()
            if q not in hay:
                continue
        out.append(entry)
    return out


def moblend_list_templates(
    ctx: BrokerToolContext,
    *,
    category: str | None = None,
    query: str | None = None,
) -> list[dict[str, Any]]:
    home = moblend_home()
    try:
        templates = catalog.fetch_catalog(home, ctx.catalog_db())
    except Exception:
        templates = catalog.load_cached_catalog(home)
    return _filter_templates(templates, category=category, query=query)


def _resolve_template_path(template_name: str) -> Path | None:
    """Resolve a catalog id/name to a local .mo.blend path."""
    needle = template_name.strip()
    home = moblend_home()
    templates_root = home / "templates"
    if templates_root.is_dir():
        for path in templates_root.rglob("*.mo.blend"):
            if path.stem == needle or needle in path.name:
                return path.resolve()

    # Dev fallback: sibling MoBlend_Lib checkout
    lib_root = Path(__file__).resolve().parents[3] / "MoBlend_Lib" / "templates"
    if lib_root.is_dir():
        for path in lib_root.rglob("*.mo.blend"):
            if path.stem == needle:
                return path.resolve()
    return None


def _run_task(ctx: BrokerToolContext, op: str, args: dict[str, Any], timeout: float = 30.0) -> Any:
    task = ctx.task_factory(op, args)
    try:
        ctx.enqueue(task)
    except queue.Full:
        raise RuntimeError("Action queue is full (backpressure)")
    task.event.wait(timeout=timeout)
    if task.exc:
        raise RuntimeError(str(task.exc))
    return task.result


def moblend_inspect_template(ctx: BrokerToolContext, *, template_name: str) -> dict[str, Any]:
    path = _resolve_template_path(template_name)
    if path is None:
        raise ValueError(f"Template not found locally: {template_name}")

    manifest = _run_task(ctx, "load_template", {"template_path": str(path)})
    if not isinstance(manifest, dict):
        raise RuntimeError("load_template did not return a manifest")

    params = []
    for p in manifest.get("parameters") or []:
        if isinstance(p, dict) and p.get("id"):
            params.append(
                {
                    "id": p["id"],
                    "type": p.get("type"),
                    "label": p.get("label"),
                    "default": p.get("default"),
                    "min": p.get("min"),
                    "max": p.get("max"),
                    "options": p.get("options"),
                }
            )

    return {
        "template_id": manifest.get("template_id"),
        "template_path": str(path),
        "parameters": params,
        "slots": manifest.get("slots") or [],
    }


def moblend_apply_parameters(ctx: BrokerToolContext, *, parameters: dict[str, Any]) -> dict[str, Any]:
    if not parameters:
        raise ValueError("parameters object is required")
    manifest = engine.get_current_manifest()
    if manifest is None:
        raise RuntimeError("No template loaded — call moblend_inspect_template first")

    applied: list[str] = []
    for param_id, value in parameters.items():
        _run_task(ctx, "set_parameter", {"id": param_id, "value": value}, timeout=15.0)
        applied.append(str(param_id))

    return {"status": "ok", "applied": applied}


def moblend_render_preview(
    ctx: BrokerToolContext,
    *,
    time_seconds: float = 0.0,
    resolution_scale: float = 1.0,
) -> dict[str, Any]:
    manifest = engine.get_current_manifest()
    if manifest is None:
        raise RuntimeError("No template loaded")

    fps = float(manifest.get("fps") or 24.0)
    frame_num = max(0, int(round(time_seconds * fps)))
    scale = max(0.1, min(1.0, float(resolution_scale)))
    width = max(64, int(1920 * scale))
    height = max(64, int(1080 * scale))

    data = _run_task(
        ctx,
        "render_frame",
        {"frame_number": frame_num, "width": width, "height": height, "format": "jpeg"},
        timeout=60.0,
    )
    if not isinstance(data, (bytes, bytearray)):
        raise RuntimeError("render_frame returned no image bytes")

    b64 = base64.b64encode(bytes(data)).decode("ascii")
    return {
        "frame_number": frame_num,
        "width": width,
        "height": height,
        "format": "jpeg",
        "image_base64": b64,
        "data_url": f"data:image/jpeg;base64,{b64}",
    }