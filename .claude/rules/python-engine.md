---
paths:
  - "engine/**/*.py"
---

# Python engine / broker

- `engine/` package; type hints; minimal dependencies.
- Run inside Blender's bundled Python for production — not host Python.
- Network handlers enqueue to `queue.Queue`; `bpy.app.timers` runs bpy on main thread.
- Validate manifest types before queueing.
- Frame format: JPEG opaque, WebP with alpha.
- No external runtime image libs beyond Blender.