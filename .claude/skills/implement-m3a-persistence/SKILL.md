---
name: implement-m3a-persistence
description: Implement M3a local SQLite persistence and suite logging. Use when asked to implement M3a, studio.db, broker.db, suite_logs.db, or local persistence scaffold.
paths:
  - "desktop/**/*.go"
  - "engine/**/*.py"
  - "specs/M3a*.md"
disable-model-invocation: true
---

# Implement M3a persistence

Execute the **one-shot prompt** in [specs/M3a - Local Persistence & Logging.md](../../../specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md) §11 (PROMPT START … PROMPT END).

**Gates:** [ROADMAP.md § M3a](../../../ROADMAP.md#m3a--local-persistence--logging) done-when checklist.

**After implementation:**
1. `go test ./internal/store/...` from `desktop/`
2. `python -m engine.tests.m3a_store_test` from repo root
3. `npm run test:e2e` in `desktop/frontend/` if recents/bindings changed
4. Append `.progress/M003a.001.{descriptor}.md` (next index if not first)