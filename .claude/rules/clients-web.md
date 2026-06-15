---
paths:
  - "clients/**/*.{html,js,css}"
---

# OBS / Sentinel web clients

- Static HTML/JS in CEF — no build toolchain required for M5/M6.
- Connect HTTP and binary WebSocket directly to `127.0.0.1:8000`.
- **No gRPC** for viewport preview.
- JPEG for opaque previews; WebP when alpha is required.