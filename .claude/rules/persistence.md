---
paths:
  - "desktop/internal/store/**"
  - "engine/moblend/store.py"
  - "engine/moblend/log.py"
---

# M3a persistence

See [specs/M3a - Local Persistence & Logging.md](../../specs/M3a%20-%20Local%20Persistence%20%26%20Logging.md).

- `studio.db` — Go only; `broker.db` — Python only; `suite_logs.db` — append-only shared logs.
- WAL + `busy_timeout=5000` on every connection.
- Never store manifest truth, secrets, or frames in SQLite.
- Implement via `/implement-m3a-persistence` or spec §11 one-shot prompt.