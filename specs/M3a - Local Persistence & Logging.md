# M3a — Local Persistence & Suite Logging

**Status:** Implemented (v1 complete — see `.progress/M003a.002`–`M003a.003`)  
**Roadmap:** [ROADMAP.md § M3a](../ROADMAP.md#m3a--local-persistence--logging)  
**Placement:** After M3 Desktop MVP, before M4 Registry Integration

## 1. Objective

Establish proactive SQLite persistence and cross-suite logging **patterns** under `<moblend_home>/`. Schemas may be minimal in v1; the goal is decoupled component databases, a shared observability database, thin language wrappers, and agent-visible conventions so M4+ features have an obvious place for local indexes without ad hoc JSON blobs.

**Not in scope for M3a:** A dedicated logging micro-daemon, HTTP log ingest, or replacing `config.json`.

---

## 2. Design principles

| Principle | Rule |
|-----------|------|
| **Authoritative sources** | `.mo.blend` files, `config.json`, and filesystem blobs (`assets/`, `templates/`) remain source of truth |
| **DBs are indexes/cache** | SQLite stores metadata, job rows, install maps — never manifest truth or render pixels |
| **One writer per operational DB** | `studio.db` ← Studio Go only; `broker.db` ← broker Python only |
| **Shared logging exception** | `suite_logs.db` is the one cross-component file; append-only event rows |
| **No logging daemon (v1)** | Direct multi-writer to `suite_logs.db` with WAL + `busy_timeout`; design `Log()` API so HTTP ingest or `moblend-logd` can swap in later |
| **Localhost only** | All DB paths under `<moblend_home>/`; no network exposure |

---

## 3. `<moblend_home>` layout (after M3a)

```
<moblend_home>/                    # Windows: %USERPROFILE%\.moblend\
├── config.json                    # unchanged — human-editable suite settings
├── studio.db                      # Studio Go — metadata index
├── broker.db                      # Broker Python — job/cache index
├── suite_logs.db                  # cross-suite append-only events
├── assets/                        # binary sandbox (unchanged)
└── templates/                     # installed .mo.blend binaries (M4; dir may exist empty)
```

Path resolution must match PRD 1 §5 / PRD 4 §7 (`~/.moblend` on all platforms).

---

## 4. Database ownership

### 4.1 `studio.db` (Studio Go)

**Writer:** `desktop/` Go backend only.

| Table | Purpose (v1) |
|-------|----------------|
| `schema_migrations` | version integer, applied_at |
| `recent_projects` | path (PK), display_name, opened_at (ISO8601), template_id nullable |
| `asset_index` | content_hash (PK), sandbox_path, original_name, mime, size_bytes, imported_at |
| `installed_templates` | template_id (PK), local_path, catalog_version, installed_at — **stub rows OK** until M4 |

**Migrate from today:** Replace `recentProjects` array in `config.json` with `recent_projects` table. On first open, import existing `config.json` `recentProjects` if present, then stop writing that key.

### 4.2 `broker.db` (Broker Python)

**Writer:** `engine/moblend/` broker process only.

| Table | Purpose (v1) |
|-------|----------------|
| `schema_migrations` | version, applied_at |
| `export_jobs` | job_id (PK), status, created_at, updated_at, output_path nullable, error nullable |
| `catalog_cache` | id=1 singleton row: fetched_at, etag, source_url, body_hash — **stub until M4** |

Do **not** store bpy session state, manifest JSON, or viewport frames.

### 4.3 `suite_logs.db` (cross-suite)

**Writers:** Studio Go and broker Python (v1 direct SQLite). Future: OBS/Sentinel via Studio HTTP ingest.

| Table | Purpose (v1) |
|-------|----------------|
| `schema_migrations` | version, applied_at |
| `log_events` | id, ts (ISO8601 UTC), level, component, event, message, context_json |

**`component` values:** `studio`, `broker`, `engine` (reserved), `export` (optional).

**Never log:** bearer tokens, OBS passwords, full manifest payloads.

**SQLite pragmas on open (all three DBs):**

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA foreign_keys=ON;
```

---

## 5. API surface (thin wrappers)

### 5.1 Go — `desktop/internal/store/`

```
store.OpenStudio(homeDir) (*StudioDB, error)
store.OpenSuiteLogs(homeDir) (*LogDB, error)

StudioDB.UpsertRecent(path, displayName, templateID)
StudioDB.ListRecents(limit int) ([]RecentProject, error)
StudioDB.UpsertAssetIndex(...)
StudioDB.Migrate() error

LogDB.Append(component, level, event, message string, ctx map[string]any) error
LogDB.Tail(since time.Time, component string, limit int) ([]LogEvent, error)
```

Use `modernc.org/sqlite` (pure Go) or `github.com/mattn/go-sqlite3` — match existing `desktop/go.mod` patterns; prefer pure Go for Windows builds without CGO if already the project norm.

Package-level helper:

```go
moblendlog.Append(ctx, component, level, event, message, fields map[string]any)
```

Backend interface so v2 can switch to HTTP ingest without changing call sites.

### 5.2 Python — `engine/moblend/store.py` + `engine/moblend/log.py`

```python
open_broker_db(home_dir: Path) -> BrokerDB
open_suite_logs(home_dir: Path) -> LogDB

BrokerDB.upsert_export_job(...)
BrokerDB.migrate()

log.append(component, level, event, message, **context)
log.tail(since_iso, component=None, limit=100)
```

Stdlib `sqlite3` only — runs inside Blender's bundled Python.

### 5.3 Shared event schema

```json
{
  "ts": "2026-06-15T12:00:00Z",
  "level": "info|warn|error|debug",
  "component": "studio|broker|engine|export",
  "event": "engine.start|broker.health|project.open",
  "message": "human-readable one-liner",
  "context_json": "{\"correlation_id\":\"...\",\"path\":\"...\"}"
}
```

---

## 6. Integration call sites (minimum v1)

| Location | Action |
|----------|--------|
| `desktop/app.go` `startup` | Open DBs, migrate, load recents from `studio.db`, log `studio.start` |
| `desktop/app.go` `AddRecentProject` | Upsert `recent_projects` + log `project.open` |
| `desktop/app.go` `CopyToAssetSandbox` | Upsert `asset_index` after dedupe copy |
| `desktop/app.go` `StartEngine` / `StopEngine` | Log `engine.start` / `engine.stop` with success/error |
| Broker `bootstrap.py --serve` startup | Open `broker.db` + `suite_logs.db`, migrate, log `broker.start` |
| Broker health handler | Log `broker.health` at debug (throttled — max 1/min) |
| Export job create/update (when present) | Write `export_jobs` rows |

**Suite Manager (future UI):** Read `log_events` via Go `LogDB.Tail` — no UI required in M3a if tail API exists.

---

## 7. Migrations

- Each DB has `schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT)`.
- v1 schema version = `1`.
- Migration functions are numbered; `Migrate()` applies pending versions idempotently.
- Agents adding tables **must** bump version and add a new migration — never edit applied migrations.

---

## 8. Testing

| Test | Location |
|------|----------|
| Go store open/migrate/recents round-trip | `desktop/internal/store/store_test.go` |
| Go log append/tail | same package |
| Python store migrate + log append | `engine/tests/m3a_store_test.py` (host Python imports `moblend.store` / `moblend.log`) |
| E2E regression | Existing Playwright suite must pass; recents still work via Go bindings |

Use temp directories for all DB tests — never touch user `~/.moblend`.

---

## 9. Agent rules (mandatory after M3a)

When adding persistent local state:

1. **Human-editable cross-suite setting** → `config.json`
2. **Binary asset** → `assets/` or `templates/` on disk
3. **Studio UI metadata** → `studio.db`
4. **Broker job/cache metadata** → `broker.db`
5. **Diagnostic / audit trail** → `suite_logs.db` via `log.append()`
6. **Never** put manifest truth or render output in SQLite

Do not add a logging daemon unless ROADMAP explicitly adds M3b or a future observability milestone.

---

## 10. Future (document only — do not implement in M3a)

| Phase | Change |
|-------|--------|
| M3a+ ingest | Studio Go `POST /internal/log` on secondary localhost port; sole SQLite writer for logs |
| Headless-only runs | Optional `moblend-logd` when broker runs without Studio |
| M4a–M4d | Populate `installed_templates` + `catalog_cache` from `index.json` — see [M4 — Registry Integration](M4%20-%20Registry%20Integration.md) |
| Retention | Prune `log_events` older than N days (configurable in `config.json`) |

---

## 11. One-shot implementation prompt

Copy everything below this line into a fresh agent session to implement M3a in one pass.

---

### PROMPT START

Implement **M3a — Local Persistence & Suite Logging** for MoBlend_Studio per [specs/M3a - Local Persistence & Logging.md](M3a%20-%20Local%20Persistence%20%26%20Logging.md) and [ROADMAP.md § M3a](../ROADMAP.md#m3a--local-persistence--logging).

**Read first:** ROADMAP M3a done-when, this spec §2–§8, `desktop/app.go` (recents/config), broker startup in `engine/bootstrap.py`, [AGENTS.md](../AGENTS.md), [desktop/AGENTS.md](../desktop/AGENTS.md), [engine/AGENTS.md](../engine/AGENTS.md).

**Architecture constraints (do not violate):**
- Single broker port `127.0.0.1:8000` for REST/WS/MCP — do **not** add log ingest HTTP in M3a
- `config.json` stays for cross-suite settings; migrate `recentProjects` out of it
- Go never parses `.mo.blend`; DBs hold metadata only
- Three SQLite files under `<moblend_home>/`: `studio.db`, `broker.db`, `suite_logs.db`
- WAL + `busy_timeout=5000` on every DB connection
- No logging micro-daemon

**Deliverables:**

1. **`desktop/internal/store/`** — Go package: studio DB schema v1, suite_logs schema v1, migrations, `Append`/`Tail` for logs, recents CRUD, asset_index upsert. Wire into `app.go` (startup migrate, recents, logging on engine lifecycle and project open, asset index on sandbox copy).

2. **`engine/moblend/store.py`** + **`engine/moblend/log.py`** — Python broker DB + shared log append. Wire into broker serve path (startup migrate, `broker.start` log, throttled health debug log). Stub `export_jobs` insert if export endpoints exist.

3. **One-time import** — If `config.json` contains `recentProjects`, import into `studio.db` on first migrate then omit persisting that key going forward.

4. **Tests** — `desktop/internal/store/store_test.go`; `engine/tests/m3a_store_test.py` (runnable with host `python -m engine.tests.m3a_store_test`).

5. **Docs** — Append progress file `M003a.001.persistence-scaffold.md` per [.progress/README.md](../.progress/README.md). Do not edit prior progress files.

6. **Verification** — `go test ./internal/store/...` from `desktop/`; Python test passes; `cd desktop/frontend && npm run test:e2e` if any binding behavior changed (recents).

**Schema v1:** Exactly as spec §4 tables. Keep migrations minimal.

**Log call sites (minimum):** `studio.start`, `engine.start`, `engine.stop`, `project.open`, `broker.start`, `broker.health` (throttled).

**Out of scope:** Suite Manager log UI, M4 gallery tables with real data, log daemon, HTTP ingest, pruning/retention jobs.

**Style:** Smallest correct diff; match existing Go/Python patterns; type hints in Python; no new runtime deps beyond SQLite driver already acceptable in Go module.

When complete, summarize: files touched, how to run tests, and example paths to the three `.db` files on Windows.

### PROMPT END