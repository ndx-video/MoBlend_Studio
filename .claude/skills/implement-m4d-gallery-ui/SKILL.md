---
name: implement-m4d-gallery-ui
description: Implement M4d gallery UI and Suite Manager catalog status. Use for M4d, template gallery, registry integration UI.
paths:
  - "desktop/frontend/**"
  - "desktop/app.go"
  - "specs/M4*.md"
disable-model-invocation: true
---

# Implement M4d gallery UI

Execute the **one-shot prompt** in [specs/M4d - Gallery UI and Suite Manager.md](../../../specs/M4d%20-%20Gallery%20UI%20and%20Suite%20Manager.md) §6.

**Gates:** [ROADMAP.md § M4d](../../../ROADMAP.md#m4d--gallery-ui-and-suite-manager) and full M4 done-when.

**Prerequisites:** M4b + M4c complete.

**After implementation:**
1. `/desktop-e2e-verify` or `cd desktop/frontend && npm run test:e2e`
2. Mark M4 ✅ Complete on [ROADMAP.md](../../../ROADMAP.md)
3. Append `.progress/M004d.001.{descriptor}.md`