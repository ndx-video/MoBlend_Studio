# M4d — Gallery UI and Suite Manager

**Status:** Planned  
**Parent:** [M4 — Registry Integration](M4%20-%20Registry%20Integration.md)  
**Roadmap:** [ROADMAP.md § M4d](../ROADMAP.md#m4d--gallery-ui-and-suite-manager)  
**Depends on:** [M4b](M4b%20-%20Broker%20Catalog%20Cache.md), [M4c](M4c%20-%20Go%20Template%20Install.md)

## 1. Objective

Replace the Home gallery placeholder with live catalog cards from `GET /api/v1/templates`, wire Install → `InstallTemplate` → `POST /project/load` → editor, show install state, and add Suite Manager catalog diagnostics. Completes ROADMAP M4 done-when.

---

## 2. Home gallery (`/`)

### 2.1 Data flow

1. On mount: `fetch(`${brokerBase}/api/v1/templates`)` 
2. Merge with `ListInstalledTemplates()` from Go (installed badge / skip install)
3. Render grid per [stitch screen_home](../stitch/screen_home/) — **MVP scope:**
   - Preview image (`preview_url`)
   - Name, category tag
   - **Install** (if not installed) or **Open** (if installed)
   - Keep existing M1 default card + "Open local .mo.blend" card

### 2.2 Install + open flow

```
User clicks Install
  → go.InstallTemplate(entry.template_id, entry.download_url, entry.version)
  → go.AddRecentProject(localPath)
  → ensureBroker() + loadProject(localPath)
  → navigate /editor
```

Errors → status bar + `moblend` event if persistence warning pattern exists.

### 2.3 Placeholder removal

Remove "coming in M4" copy in `App.tsx` Home screen.

Optional stretch (not required for done-when): category filter chips from stitch-prompt.txt.

---

## 3. Suite Manager (`/settings/suite`)

Add **Official Template Library** row:
- `registryBaseUrl` from `GetConfig()`
- Catalog entry count (from last gallery fetch or dedicated broker call)
- Last fetch time — expose via new Go binding `GetCatalogStatus()` **or** broker `GET /api/v1/templates` response headers / small `GET /api/v1/templates/status` (prefer minimal: read from broker health extension or config only in M4d MVP)
- **Refresh catalog** button → `POST /api/v1/templates/refresh` (M4b) then reload gallery state
- Offline message when catalog empty and fetch failed

---

## 4. E2E tests

**`desktop/frontend/e2e/m4-gallery.spec.ts`:**
- Extend `fixtures/mocks.ts`:
  - `GET /api/v1/templates` → one catalog entry
  - `InstallTemplate` mock returns `C:\Users\Test\.moblend\templates\parametric-cube-demo.mo.blend`
- Test: gallery shows catalog card with preview alt text / name
- Test: Install → editor viewport visible

Tag live registry tests `@live-registry` (excluded from default `npm run test:e2e` like `@live-broker`).

---

## 5. Done when (closes M4)

- [ ] Home gallery renders catalog entries from broker
- [ ] Install streams via Go and opens editor successfully
- [ ] Suite Manager shows library connection status
- [ ] `npm run test:e2e` passes (32+ tests including new m4-gallery)
- [ ] ROADMAP M4 marked ✅ Complete; **Current focus** → M5
- [ ] Progress: `.progress/M004d.001.gallery-suite-manager.md` + `.progress/M004.001.m4-milestone-complete.md` (or single complete entry)

**Out of scope:** Full Stitch search/filter/aspect chips, MCP tools, OBS client.

---

## 6. One-shot implementation prompt

### PROMPT START

Implement **M4d — Gallery UI and Suite Manager** per [specs/M4d - Gallery UI and Suite Manager.md](M4d%20-%20Gallery%20UI%20and%20Suite%20Manager.md).

**Read first:** [M4 parent](M4%20-%20Registry%20Integration.md), `desktop/frontend/src/App.tsx` (Home), Suite Manager section, `e2e/fixtures/mocks.ts`, PRD 4 §6 / §9 screen_home.

**Prerequisites:** M4b + M4c complete.

**Constraints:**
- React → broker for catalog; React → Go for install; React → broker for load
- Run `npm run test:e2e` before claiming done
- Match existing Stitch token styling in App.tsx

**Deliverables:**
1. Gallery UI with install/open flow
2. Suite Manager catalog status + refresh
3. `e2e/m4-gallery.spec.ts` + mock updates
4. Mark [ROADMAP.md](../ROADMAP.md) M4 ✅ Complete
5. Append `.progress/M004d.001.gallery-suite-manager.md`

**Verify:** `cd desktop/frontend && npm run test:e2e`

### PROMPT END