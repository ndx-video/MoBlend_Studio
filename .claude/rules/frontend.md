---
paths:
  - "desktop/frontend/**/*.{ts,tsx,css}"
---

# Frontend (React + TypeScript)

- React + TypeScript under `desktop/frontend/`.
- Connect HTTP and WebSocket directly to `127.0.0.1:8000` — never through Go bindings.
- Debounce parameter PATCH requests.
- Drop stale WebSocket frame requests when scrubbing.
- Use `data-testid` attributes for E2E selectors.
- **Mandatory:** run `npm run test:e2e` from `desktop/frontend/` for all UI changes before claiming completion.
- Do not rely on manual `wails dev` testing alone.