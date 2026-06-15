---
name: desktop-e2e-verify
description: Run Playwright E2E suite for desktop frontend changes. Use before claiming any React/GUI work is complete.
paths:
  - "desktop/frontend/**/*.{ts,tsx,css}"
disable-model-invocation: true
---

# Desktop E2E verification

Required for all changes under `desktop/frontend/src/`. See [desktop/README.md](../../../desktop/README.md#automated-e2e-testing-required-for-gui-work).

## Steps

1. `cd desktop/frontend`
2. Run `npm run test:e2e` (headless default).
3. On failure: inspect `test-results/` screenshots and traces; fix and re-run.
4. For visual debugging: `npm run test:e2e:ui` or `npm run test:e2e:headed`.
5. Report pass/fail with any failing spec names.

## Notes

- Playwright auto-starts Vite via `webServer` config.
- Mocks for Wails bindings and broker APIs live in `desktop/frontend/e2e/mocks.ts`.
- Go backend changes still require `wails dev` restart — E2E mocks broker/Go for UI-only work.