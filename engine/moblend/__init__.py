"""Mo.Blend Engine (M1+ / M2 broker support).

This package runs inside Blender's bundled Python via `blender --python`.
Core: manifest, param mutation by stable socket_identifier, shadows, render_frame (M2).
Broker (FastAPI/WS) lives in .server and is started via bootstrap --serve.
"""

from __future__ import annotations

from .engine import (
    get_current_manifest,
    is_dirty,
    load_template,
    render_frame,
    save_project,
    set_parameter,
)

__version__ = "0.2.0"
__all__ = [
    "__version__",
    "load_template",
    "set_parameter",
    "save_project",
    "render_frame",
    "get_current_manifest",
    "is_dirty",
]
