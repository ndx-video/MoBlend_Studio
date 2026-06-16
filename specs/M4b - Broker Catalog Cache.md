# M4b — Broker Catalog Cache

**Status:** Planned  
**Parent:** [M4 — Registry Integration](M4%20-%20Registry%20Integration.md)  
**Roadmap:** [ROADMAP.md § M4b](../ROADMAP.md#m4b--broker-catalog-cache)  
**Depends on:** [M4a](M4a%20-%20Library%20Repository%20Bootstrap.md) (`index.json` exists locally or on raw Git)

## 1. Objective

Replace the `GET /api/v1/templates` stub with a real catalog service: fetch `index.json` from `registryBaseUrl`, cache on disk under `<moblend_home>/catalog/`, record metadata in `broker.db` `catalog_cache`, and serve the flattened `templates` array to clients.

---

## 2. Design

### 2.1 Fetch policy

| Mode | When |
|------|------|
| **HTTP fetch** | Default: `{registryBaseUrl}/index.json` (trim trailing slash; append `/index.json` if base has no path) |
| **Fixture override** | `config.json` `catalogFixturePath` set → copy/read local file (dev offline) |
| **Stale serve** | Network error → return last cached `catalog/index.json` if present |
| **TTL refresh** | Re-fetch when `catalogRefreshHours` elapsed (default 24) or `?refresh=1` |

Use `If-None-Match` / `ETag` when the origin supports it; store `etag` in `catalog_cache`.

### 2.2 Storage split (M3a rule)

| What | Where |
|------|-------|
| JSON body | `<moblend_home>/catalog/index.json` |
| Metadata | `broker.db` `catalog_cache` singleton: `fetched_at`, `etag`, `source_url`, `body_hash` |

Compute `body_hash` as SHA-256 hex of raw response bytes.

### 2.3 Response shape

`GET /api/v1/templates` → `200 OK` with JSON array of catalog entries (the `templates` field from index envelope).

Optional: `POST /api/v1/templates/refresh` → force re-fetch (Suite Manager M4d); return same array.

On total failure (no cache): `200 OK` with `[]` and log `catalog.fetch_failed` — or `503` with error envelope if you prefer strictness (document choice in progress file).

---

## 3. New module

**`engine/moblend/catalog.py`**

```python
def resolve_registry_url(config: dict) -> str: ...
def fetch_catalog(home: Path, broker_db: BrokerDB, *, force: bool = False) -> list[dict]: ...
def load_cached_catalog(home: Path) -> list[dict]: ...
```

Read `config.json` from `<moblend_home>/config.json` (same path as PRD 4 §7).

Wire into `engine/moblend/server.py` `list_templates()` handler.

Log events: `catalog.fetch_ok`, `catalog.fetch_failed`, `catalog.cache_hit` via `moblend.log`.

---

## 4. `config.json` keys

Document defaults in code and [M4 parent spec](M4%20-%20Registry%20Integration.md) §5:

```json
{
  "registryBaseUrl": "https://raw.githubusercontent.com/ndx-video/MoBlend_Lib/main",
  "catalogRefreshHours": 24
}
```

`catalogFixturePath`: optional absolute path to `index.json` for CI/dev without network.

---

## 5. Tests

**`engine/tests/m4_catalog_test.py`** (host Python):
- Temp `<moblend_home>` with fixture `index.json`
- `catalogFixturePath` or mock HTTP
- Assert `fetch_catalog` writes disk cache + updates `catalog_cache` row
- Assert flattened array shape matches [catalog.schema.json](catalog.schema.json) entries
- Stale-serve when fetch fails

**Fixture:** `engine/tests/fixtures/catalog_index.json` — minimal one-entry catalog copied from M4a output or hand-authored.

---

## 6. Done when

- [ ] `engine/moblend/catalog.py` implemented and wired
- [ ] `GET /api/v1/templates` returns real data (fixture or live URL)
- [ ] `<moblend_home>/catalog/index.json` written on fetch
- [ ] `broker.db` `catalog_cache` populated
- [ ] `engine/tests/m4_catalog_test.py` passes
- [ ] `engine/AGENTS.md` updated (catalog module note)
- [ ] Progress: `.progress/M004b.001.broker-catalog.md`

**Out of scope:** Go install, gallery UI, MCP `moblend_list_templates` (trivial follow-up), Suite Manager refresh button (M4d).

---

## 7. One-shot implementation prompt

### PROMPT START

Implement **M4b — Broker Catalog Cache** per [specs/M4b - Broker Catalog Cache.md](M4b%20-%20Broker%20Catalog%20Cache.md).

**Read first:** [M4 parent](M4%20-%20Registry%20Integration.md), [M3a spec](M3a%20-%20Local%20Persistence%20%26%20Logging.md) §2–§4, `engine/moblend/server.py` (stub endpoint), `engine/moblend/store.py`, [catalog.schema.json](catalog.schema.json), [API spec §2](Mo.Blend%20API%20&%20Function%20Spec.md).

**Prerequisite:** M4a complete — use `engine/tests/fixtures/catalog_index.json` if remote URL unavailable.

**Constraints:**
- Single broker port `127.0.0.1:8000`
- Catalog JSON body on disk, not in SQLite
- WAL + busy_timeout on broker.db (existing)
- No new pip deps unless `jsonschema` already in vendor (prefer stdlib + manual validation)

**Deliverables:**
1. `engine/moblend/catalog.py`
2. Wire `list_templates()` in `server.py`; optional `POST /api/v1/templates/refresh`
3. `engine/tests/fixtures/catalog_index.json` + `engine/tests/m4_catalog_test.py`
4. Update `engine/AGENTS.md`
5. Append `.progress/M004b.001.broker-catalog.md`

**Verify:** `python -m engine.tests.m4_catalog_test` from repo root.

### PROMPT END