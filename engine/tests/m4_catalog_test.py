"""M4b catalog cache tests (host Python — no bpy required)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

_engine_root = Path(__file__).resolve().parents[1]
if str(_engine_root) not in sys.path:
    sys.path.insert(0, str(_engine_root))

from moblend import catalog
from moblend import log as moblend_log
from moblend import store as moblend_store

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "catalog_index.json"


class M4CatalogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.db = moblend_store.open_broker_db(self.home)
        self.log_db = moblend_log.open_suite_logs(self.home)
        moblend_log.set_default(self.log_db)

    def tearDown(self) -> None:
        moblend_log.set_default(None)
        self.log_db.close()
        self.db.close()
        self.tmp.cleanup()

    def _write_config(self, **overrides: object) -> None:
        config = {"catalogFixturePath": str(_FIXTURE)}
        config.update(overrides)
        (self.home / "config.json").write_text(json.dumps(config), encoding="utf-8")

    def test_resolve_registry_url(self) -> None:
        self.assertEqual(
            catalog.resolve_registry_url({"registryBaseUrl": "https://example.com/lib/"}),
            "https://example.com/lib/index.json",
        )
        self.assertEqual(
            catalog.resolve_registry_url({"registryBaseUrl": "https://example.com/index.json"}),
            "https://example.com/index.json",
        )
        self.assertEqual(
            catalog.resolve_registry_url({}),
            f"{catalog.DEFAULT_REGISTRY_BASE_URL}/index.json",
        )

    def test_fetch_catalog_writes_disk_and_db(self) -> None:
        self._write_config()
        templates = catalog.fetch_catalog(self.home, self.db, force=True)
        self.assertEqual(len(templates), 1)
        self.assertEqual(templates[0]["template_id"], "parametric-cube-demo")

        cache_path = catalog.catalog_cache_path(self.home)
        self.assertTrue(cache_path.is_file())
        on_disk = json.loads(cache_path.read_text(encoding="utf-8"))
        self.assertEqual(on_disk["version"], "1.0")
        self.assertEqual(len(on_disk["templates"]), 1)

        meta = self.db.get_catalog_cache()
        self.assertIsNotNone(meta)
        assert meta is not None
        self.assertEqual(meta["source_url"], f"fixture:{_FIXTURE}")
        self.assertTrue(meta["body_hash"])
        self.assertIsNotNone(meta["fetched_at"])

    def test_catalog_entry_shape(self) -> None:
        self._write_config()
        templates = catalog.fetch_catalog(self.home, self.db, force=True)
        catalog.validate_catalog_entries(templates)
        entry = templates[0]
        for key in (
            "template_id",
            "name",
            "category",
            "description",
            "version",
            "preview_url",
            "download_url",
        ):
            self.assertIn(key, entry)
            self.assertTrue(entry[key])

    def test_ttl_cache_hit_skips_refetch(self) -> None:
        self._write_config()
        catalog.fetch_catalog(self.home, self.db, force=True)
        with patch.object(catalog, "_read_fixture", side_effect=AssertionError("should not refetch")):
            templates = catalog.fetch_catalog(self.home, self.db, force=False)
        self.assertEqual(len(templates), 1)

    def test_stale_serve_on_fetch_failure(self) -> None:
        self._write_config()
        catalog.fetch_catalog(self.home, self.db, force=True)
        (self.home / "config.json").write_text(
            json.dumps({"registryBaseUrl": "https://example.invalid/lib"}),
            encoding="utf-8",
        )
        with patch.object(catalog, "_fetch_http", side_effect=OSError("network down")):
            templates = catalog.fetch_catalog(self.home, self.db, force=True)
        self.assertEqual(len(templates), 1)
        self.assertEqual(templates[0]["template_id"], "parametric-cube-demo")

    def test_no_cache_returns_empty_on_failure(self) -> None:
        self._write_config(catalogFixturePath=None, registryBaseUrl="https://example.invalid/lib")
        with patch.object(catalog, "_fetch_http", side_effect=OSError("network down")):
            templates = catalog.fetch_catalog(self.home, self.db, force=True)
        self.assertEqual(templates, [])

    def test_expired_ttl_refetches(self) -> None:
        self._write_config()
        stale_at = (datetime.now(timezone.utc) - timedelta(hours=48)).strftime("%Y-%m-%dT%H:%M:%SZ")
        raw = _FIXTURE.read_bytes()
        catalog._write_disk_cache(self.home, raw)
        self.db.upsert_catalog_cache(
            source_url=f"fixture:{_FIXTURE}",
            body_hash=catalog._body_hash(raw),
            fetched_at=stale_at,
        )
        templates = catalog.fetch_catalog(self.home, self.db, force=False)
        self.assertEqual(len(templates), 1)
        meta = self.db.get_catalog_cache()
        self.assertIsNotNone(meta)
        assert meta is not None
        self.assertGreater(meta["fetched_at"], stale_at)


if __name__ == "__main__":
    unittest.main()