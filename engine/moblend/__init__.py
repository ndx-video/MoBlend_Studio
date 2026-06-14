"""Mo.Blend Engine (M1+).

This package runs inside Blender's bundled Python via `blender --python`.
It provides the core in-process logic: manifest handling, parameter
mutation of Geometry/Material node sockets by stable identifier,
shadow backup rotation on save, and (later) slot timeline + asset ingest.
"""

from __future__ import annotations

from .engine import (
    get_current_manifest,
    is_dirty,
    load_template,
    save_project,
    set_parameter,
)

__version__ = "0.1.0"
__all__ = [
    "__version__",
    "load_template",
    "set_parameter",
    "save_project",
    "get_current_manifest",
    "is_dirty",
]
