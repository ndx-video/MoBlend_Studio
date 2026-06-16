# M4c — Go Template Install

**Status:** Planned  
**Parent:** [M4 — Registry Integration](M4%20-%20Registry%20Integration.md)  
**Roadmap:** [ROADMAP.md § M4c](../ROADMAP.md#m4c--go-template-install)  
**Depends on:** [M4b](M4b%20-%20Broker%20Catalog%20Cache.md) (catalog entries include `download_url`, `version`)

## 1. Objective

Add Wails Go bindings to download and cache `.mo.blend` binaries from the library into `~/.moblend/templates/`, record install metadata in `studio.db` `installed_templates`, and skip re-download when `catalog_version` matches an existing on-disk file.

Go **never** parses `.mo.blend` — streaming and filesystem only (PRD 4 §2).

---

## 2. API surface (Wails bindings)

### `InstallTemplate(templateID, downloadURL, catalogVersion string) (string, error)`

Returns local absolute path on success.

**Algorithm:**
1. `templatesDir()` → `<moblend_home>/templates/` (mkdir if missing)
2. Target path: `{templatesDir}/{templateID}.mo.blend` (or preserve nested name if id has slashes — prefer flat `{template_id}.mo.blend`)
3. If `studio.db` row exists with same `catalog_version` and file exists and size > 0 → return path (cache hit)
4. `http.Get` with timeout (60s), `MaxBytesReader` cap 50MB (PRD 7 asset limit)
5. Write to temp file in same dir → atomic rename
6. `UpsertInstalledTemplate(templateID, localPath, catalogVersion)`
7. `moblendlog.Append("studio", "info", "template.install", ...)`

### `ListInstalledTemplates() ([]InstalledTemplate, error)`

Returns rows from `installed_templates` ordered by `installed_at` desc.

### `GetInstalledTemplatePath(templateID string) (string, bool)`

Lookup single install; `false` if not installed or file missing (prune stale row optional).

---

## 3. Store changes (`desktop/internal/store/studio.go`)

Add:

```go
func (s *StudioDB) UpsertInstalledTemplate(templateID, localPath, catalogVersion string) error
func (s *StudioDB) ListInstalledTemplates(limit int) ([]InstalledTemplate, error)
func (s *StudioDB) GetInstalledTemplate(templateID string) (*InstalledTemplate, error)
```

Type in `types.go`:

```go
type InstalledTemplate struct {
    TemplateID      string
    LocalPath       string
    CatalogVersion  string
    InstalledAt     time.Time
}
```

No schema migration needed — `installed_templates` table exists from M3a v1.

---

## 4. Wire `app.go`

- Bind methods on `App`
- On successful install, optionally `AddRecentProject(localPath)` — **defer to M4d** unless trivial
- Log install failures via `moblendlog.Append` + return error to frontend

Regenerate Wails bindings if project uses `wails generate` (check `desktop/` conventions).

---

## 5. Tests

**`desktop/internal/store/store_test.go`:**
- `UpsertInstalledTemplate` / `ListInstalledTemplates` round-trip

**Install integration test** (httptest):
- Spin local HTTP server serving bytes of a tiny file
- Call install logic with temp home dir
- Assert file on disk + DB row

---

## 6. Done when

- [ ] `UpsertInstalledTemplate`, `ListInstalledTemplates`, `GetInstalledTemplate` in store
- [ ] `InstallTemplate`, `ListInstalledTemplates`, `GetInstalledTemplatePath` in `app.go`
- [ ] Files land in `<moblend_home>/templates/`
- [ ] Version-aware skip re-download works
- [ ] `go test ./internal/store/...` passes (including new install tests)
- [ ] `desktop/AGENTS.md` updated
- [ ] Progress: `.progress/M004c.001.go-template-install.md`

**Out of scope:** Gallery UI, broker changes, loading template after install (M4d uses existing `loadProject`).

---

## 7. One-shot implementation prompt

### PROMPT START

Implement **M4c — Go Template Install** per [specs/M4c - Go Template Install.md](M4c%20-%20Go%20Template%20Install.md).

**Read first:** [M4 parent](M4%20-%20Registry%20Integration.md), `desktop/app.go`, `desktop/internal/store/studio.go`, [M3a spec](M3a%20-%20Local%20Persistence%20%26%20Logging.md), PRD 4 §7 (template fetch).

**Prerequisite:** M4b done (catalog entries have `download_url` + `version`).

**Constraints:**
- Go must NOT parse `.mo.blend`
- 50MB download cap
- Atomic write (temp → rename)
- Use existing `store` + `moblendlog` packages

**Deliverables:**
1. Store CRUD for `installed_templates`
2. Wails bindings in `app.go`
3. Unit tests in `store_test.go` (+ httptest install test)
4. Update `desktop/AGENTS.md`
5. Append `.progress/M004c.001.go-template-install.md`

**Verify:** `go test ./internal/store/...` from `desktop/`.

### PROMPT END