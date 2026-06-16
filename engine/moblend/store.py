"""Mo.Blend broker SQLite store (M3a).

broker.db holds export job rows and catalog cache metadata only.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")


_BROKER_MIGRATIONS: dict[int, str] = {
    1: """
CREATE TABLE IF NOT EXISTS export_jobs (
    job_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    output_path TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS catalog_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at TEXT,
    etag TEXT,
    source_url TEXT,
    body_hash TEXT
);
""",
}


@dataclass
class BrokerDB:
    """Thin wrapper around broker.db."""

    home_dir: Path
    conn: sqlite3.Connection

    def close(self) -> None:
        self.conn.close()

    def migrate(self) -> None:
        self.conn.execute(
            """CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )"""
        )
        for version, sql in sorted(_BROKER_MIGRATIONS.items()):
            row = self.conn.execute(
                "SELECT 1 FROM schema_migrations WHERE version = ?", (version,)
            ).fetchone()
            if row:
                continue
            with self.conn:
                self.conn.executescript(sql)
                self.conn.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                    (version, _utc_now_iso()),
                )

    def get_catalog_cache(self) -> dict[str, Any] | None:
        row = self.conn.execute(
            "SELECT fetched_at, etag, source_url, body_hash FROM catalog_cache WHERE id = 1"
        ).fetchone()
        if row is None:
            return None
        return {
            "fetched_at": row[0],
            "etag": row[1],
            "source_url": row[2],
            "body_hash": row[3],
        }

    def upsert_catalog_cache(
        self,
        *,
        source_url: str,
        body_hash: str,
        etag: str | None = None,
        fetched_at: str | None = None,
    ) -> None:
        now = fetched_at or _utc_now_iso()
        with self.conn:
            self.conn.execute(
                """INSERT INTO catalog_cache (id, fetched_at, etag, source_url, body_hash)
                   VALUES (1, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     fetched_at = excluded.fetched_at,
                     etag = excluded.etag,
                     source_url = excluded.source_url,
                     body_hash = excluded.body_hash""",
                (now, etag, source_url, body_hash),
            )

    def upsert_export_job(
        self,
        job_id: str,
        status: str,
        *,
        output_path: str | None = None,
        error: str | None = None,
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> None:
        now = _utc_now_iso()
        created = created_at or now
        updated = updated_at or now
        with self.conn:
            self.conn.execute(
                """INSERT INTO export_jobs (job_id, status, created_at, updated_at, output_path, error)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(job_id) DO UPDATE SET
                     status = excluded.status,
                     updated_at = excluded.updated_at,
                     output_path = excluded.output_path,
                     error = excluded.error""",
                (job_id, status, created, updated, output_path, error),
            )


def moblend_home() -> Path:
    return Path.home() / ".moblend"


def open_broker_db(home_dir: Path | str | None = None) -> BrokerDB:
    home = Path(home_dir) if home_dir is not None else moblend_home()
    home.mkdir(parents=True, exist_ok=True)
    path = home / "broker.db"
    # REST/MCP handlers run on uvicorn threads; bpy timer uses the same DB.
    conn = sqlite3.connect(str(path), timeout=5.0, check_same_thread=False)
    _apply_pragmas(conn)
    db = BrokerDB(home_dir=home, conn=conn)
    db.migrate()
    return db