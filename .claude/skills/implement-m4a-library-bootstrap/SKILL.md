---
name: implement-m4a-library-bootstrap
description: Bootstrap MoBlend_Lib template library (M4a). Use for M4a, library repo, index.json, build_index.py, parametric-cube-demo.
paths:
  - "../MoBlend_Lib/**"
  - "specs/M4*.md"
  - "specs/catalog.schema.json"
disable-model-invocation: true
---

# Implement M4a library bootstrap

Execute the **one-shot prompt** in [specs/M4a - Library Repository Bootstrap.md](../../../specs/M4a%20-%20Library%20Repository%20Bootstrap.md) §7 (PROMPT START … PROMPT END).

**Primary repo:** sibling `../MoBlend_Lib` (not `MoBlend_Studio` application code).

**Gates:** [ROADMAP.md § M4a](../../../ROADMAP.md#m4a--library-repository-bootstrap) done-when checklist.

**After implementation:**
1. `python scripts/build_index.py` from `MoBlend_Lib/`
2. Validate `index.json` against [catalog.schema.json](../../../specs/catalog.schema.json)
3. Append `MoBlend_Studio/.progress/M004a.001.{descriptor}.md` (progress lives in monorepo)
4. Push `MoBlend_Lib` if remote configured (raw Git URL must serve `index.json`)