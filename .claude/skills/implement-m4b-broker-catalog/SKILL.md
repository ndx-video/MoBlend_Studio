---
name: implement-m4b-broker-catalog
description: Implement M4b broker catalog cache. Use for M4b, GET /api/v1/templates, catalog.py, registryBaseUrl.
paths:
  - "engine/**/*.py"
  - "specs/M4*.md"
  - "specs/catalog.schema.json"
disable-model-invocation: true
---

# Implement M4b broker catalog

Execute the **one-shot prompt** in [specs/M4b - Broker Catalog Cache.md](../../../specs/M4b%20-%20Broker%20Catalog%20Cache.md) §7.

**Gates:** [ROADMAP.md § M4b](../../../ROADMAP.md#m4b--broker-catalog-cache) done-when.

**Prerequisite:** M4a complete (or use `engine/tests/fixtures/catalog_index.json`).

**After implementation:**
1. `python -m engine.tests.m4_catalog_test` from repo root
2. `/engine-verify` if other engine files touched
3. Append `.progress/M004b.001.{descriptor}.md`