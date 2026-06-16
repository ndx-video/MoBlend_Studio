---
name: implement-m4c-go-install
description: Implement M4c Go template install bindings. Use for M4c, InstallTemplate, installed_templates.
paths:
  - "desktop/**/*.go"
  - "specs/M4*.md"
disable-model-invocation: true
---

# Implement M4c Go install

Execute the **one-shot prompt** in [specs/M4c - Go Template Install.md](../../../specs/M4c%20-%20Go%20Template%20Install.md) §7.

**Gates:** [ROADMAP.md § M4c](../../../ROADMAP.md#m4c--go-template-install) done-when.

**Prerequisite:** M4b complete.

**After implementation:**
1. `go test ./internal/store/...` from `desktop/`
2. Append `.progress/M004c.001.{descriptor}.md`