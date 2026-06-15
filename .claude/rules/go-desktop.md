---
paths:
  - "desktop/**/*.go"
---

# Go / Wails desktop backend

- Wails v2 patterns in `desktop/` module.
- Use `os/exec` for Blender lifecycle on Windows first.
- Go may spawn/supervise Blender but must **never** parse `.mo.blend` or render frames locally.
- Do **not** proxy viewport frames through Wails bindings.
- Go backend changes require full `wails dev` restart (not hot-reload).