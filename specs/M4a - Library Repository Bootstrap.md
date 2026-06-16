# M4a — Library Repository Bootstrap

**Status:** Planned  
**Parent:** [M4 — Registry Integration](M4%20-%20Registry%20Integration.md)  
**Roadmap:** [ROADMAP.md § M4a](../ROADMAP.md#m4a--library-repository-bootstrap)  
**Repo:** [`MoBlend_Lib`](../../MoBlend_Lib) (sibling to `MoBlend_Studio`)

## 1. Objective

Bootstrap the official template library Git repo with PRD 7 directory structure, canonical schemas, a `build_index.py` generator, and **at least one** real publishable template so M4b can fetch a valid `index.json`.

This slice touches **`MoBlend_Lib` primarily**. Copy or reference schemas from `MoBlend_Studio/specs/` — do not fork manifest semantics.

---

## 2. Target layout (`MoBlend_Lib`)

```
MoBlend_Lib/
├── AGENTS.md
├── README.md
├── index.json                    # generated — commit after build
├── schemas/
│   ├── catalog-v1.schema.json    # copy from MoBlend_Studio/specs/catalog.schema.json
│   └── manifest-v1.schema.json # copy from MoBlend_Studio/specs/manifest.schema.json
├── scripts/
│   └── build_index.py            # crawl templates/ → index.json
└── templates/
    └── demo/
        └── parametric-cube-demo/
            ├── parametric-cube-demo.mo.blend
            ├── parametric-cube-demo.manifest.json
            └── parametric-cube-demo.webp
```

Categories may expand later (`lower-thirds/`, `alerts/`, …). For v1 bootstrap, `demo/` is sufficient.

---

## 3. Bootstrap template (`parametric-cube-demo`)

**Source:** Reuse the M1 synthetic template from `MoBlend_Studio/engine/tests/m1_roundtrip.py` (generates `%TEMP%/m1_minimal_test.mo.blend`). Rename/rebrand for the library:

| Field | Value |
|-------|-------|
| `template_id` | `parametric-cube-demo` |
| `metadata.name` | Parametric Cube Demo |
| `metadata.category` | demo |
| `metadata.template_version` | `1.0.0` |
| `metadata.description` | Parametric cube with full scalar types — Studio integration demo |

**Artifacts:**
- `.mo.blend` — from M1 generator or copied from dev machine temp after `m1_roundtrip.py` run
- `.manifest.json` — extracted manifest matching [manifest.schema.json](manifest.schema.json)
- `.webp` — preview image (static WebP acceptable for bootstrap; note in README that animated loops are required for production templates per PRD 7)

**Security:** `use_scripts_auto_execute` must be disabled (M1 template already satisfies this).

---

## 4. `index.json` contract

Envelope per [catalog.schema.json](catalog.schema.json). Each entry must include absolute `preview_url` and `download_url` resolvable from `base_url`.

**Example `base_url` (beta):**
```
https://raw.githubusercontent.com/ndx-video/MoBlend_Lib/main
```

Entry paths are relative to repo root in the generator; emitted URLs must be absolute.

`GET /api/v1/templates` (M4b) returns **only** the `templates` array — `build_index.py` must produce entries compatible with that flattening.

---

## 5. `scripts/build_index.py`

Requirements:
- Walk `templates/**/` for `*.manifest.json` siblings
- Validate manifest against `schemas/manifest-v1.schema.json` (jsonschema if available; else structural checks)
- Emit `index.json` at repo root with `version`, `generated_at`, `base_url`, `templates[]`
- Include parameter summary (`id`, `type`, `label`) per entry
- Resolve `download_url`, `preview_url`, `manifest_url` from `base_url` + relative paths
- Exit non-zero on validation failure
- Runnable with host Python: `python scripts/build_index.py [--base-url URL]`

---

## 6. Done when

- [ ] `MoBlend_Lib` has directory structure, schemas, `build_index.py`, expanded `README.md`, `AGENTS.md`
- [ ] At least one template folder with all three artifacts committed (or LFS if >50MB — should not be)
- [ ] `index.json` generated and committed with one valid entry
- [ ] `python scripts/build_index.py` succeeds locally
- [ ] Progress file `.progress/M004a.001.library-bootstrap.md` in **MoBlend_Studio** (audit trail lives in monorepo)
- [ ] Optional: push `MoBlend_Lib` to remote so raw URL is fetchable

**Out of scope:** GitHub Actions CI, lib.moblend.dev DNS, MoBlend_Studio broker/Go/UI changes.

---

## 7. One-shot implementation prompt

Copy everything below into a fresh agent session for **M4a only**.

---

### PROMPT START

Implement **M4a — Library Repository Bootstrap** per [specs/M4a - Library Repository Bootstrap.md](M4a%20-%20Library%20Repository%20Bootstrap.md) in the sibling repo `../MoBlend_Lib`.

**Read first:** [M4 parent spec](M4%20-%20Registry%20Integration.md), [PRD 7](PRD%207%20-%20Template%20Repository.md) §3, [catalog.schema.json](catalog.schema.json), `MoBlend_Studio/engine/tests/m1_roundtrip.py`.

**Constraints:**
- Work primarily in `MoBlend_Lib/`; copy schemas from `MoBlend_Studio/specs/` (do not invent new manifest fields)
- Template binary must load in existing M3 Studio flow (`POST /project/load`)
- No MoBlend_Studio code changes except optional doc cross-links
- Commit binary artifacts to `MoBlend_Lib` (not MoBlend_Studio)

**Deliverables:**
1. Full `MoBlend_Lib` tree per spec §2
2. `parametric-cube-demo` template (generate via `m1_roundtrip.py`, extract manifest, add WebP preview)
3. `scripts/build_index.py` + committed `index.json`
4. `README.md` (install URL, how to add templates, run build_index) + `AGENTS.md`
5. Append `MoBlend_Studio/.progress/M004a.001.library-bootstrap.md`

**Verify:** `python scripts/build_index.py` from `MoBlend_Lib/`; manifest validates; `index.json` has one entry with absolute URLs.

When complete, summarize: raw Git URL for `index.json`, template_id, and file paths.

### PROMPT END