"""M3a persistence tests (host Python — no bpy required)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

_engine_root = Path(__file__).resolve().parents[1]
if str(_engine_root) not in sys.path:
    sys.path.insert(0, str(_engine_root))

from moblend import log as moblend_log
from moblend import store as moblend_store


class M3aStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_broker_db_migrate_and_export_job(self) -> None:
        db = moblend_store.open_broker_db(self.home)
        try:
            db.upsert_export_job("job-001", "queued")
            db.upsert_export_job("job-001", "running", output_path="/tmp/out.webm")
            row = db.conn.execute(
                "SELECT job_id, status, output_path FROM export_jobs WHERE job_id = ?",
                ("job-001",),
            ).fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[1], "running")
            self.assertEqual(row[2], "/tmp/out.webm")
        finally:
            db.close()

    def test_suite_logs_append_and_tail(self) -> None:
        db = moblend_log.open_suite_logs(self.home)
        try:
            moblend_log.set_default(db)
            moblend_log.append("broker", "info", "broker.start", "Broker listening", port=8000)
            since = (datetime.now(timezone.utc) - timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
            events = moblend_log.tail(since, component="broker", limit=10)
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["event"], "broker.start")
        finally:
            moblend_log.set_default(None)
            db.close()


if __name__ == "__main__":
    unittest.main()