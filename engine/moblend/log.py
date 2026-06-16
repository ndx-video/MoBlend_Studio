"""Cross-suite append-only logging (M3a) — suite_logs.db."""

from __future__ import annotations

import json
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


_LOG_MIGRATIONS: dict[int, str] = {
    1: """
CREATE TABLE IF NOT EXISTS log_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    level TEXT NOT NULL,
    component TEXT NOT NULL,
    event TEXT NOT NULL,
    message TEXT NOT NULL,
    context_json TEXT NOT NULL DEFAULT '{}'
);
""",
}


@dataclass
class LogDB:
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
        for version, sql in sorted(_LOG_MIGRATIONS.items()):
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

    def append(
        self,
        component: str,
        level: str,
        event: str,
        message: str,
        **context: Any,
    ) -> None:
        ctx_json = json.dumps(context or {}, separators=(",", ":"), default=str)
        ts = _utc_now_iso()
        with self.conn:
            self.conn.execute(
                """INSERT INTO log_events (ts, level, component, event, message, context_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (ts, level, component, event, message, ctx_json),
            )

    def tail(
        self,
        since_iso: str,
        *,
        component: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        if component:
            rows = self.conn.execute(
                """SELECT id, ts, level, component, event, message, context_json
                   FROM log_events
                   WHERE ts >= ? AND component = ?
                   ORDER BY ts ASC, id ASC
                   LIMIT ?""",
                (since_iso, component, limit),
            ).fetchall()
        else:
            rows = self.conn.execute(
                """SELECT id, ts, level, component, event, message, context_json
                   FROM log_events
                   WHERE ts >= ?
                   ORDER BY ts ASC, id ASC
                   LIMIT ?""",
                (since_iso, limit),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    "id": row[0],
                    "ts": row[1],
                    "level": row[2],
                    "component": row[3],
                    "event": row[4],
                    "message": row[5],
                    "context_json": row[6],
                }
            )
        return out


_default_db: LogDB | None = None


def open_suite_logs(home_dir: Path | str | None = None) -> LogDB:
    home = Path(home_dir) if home_dir is not None else Path.home() / ".moblend"
    home.mkdir(parents=True, exist_ok=True)
    path = home / "suite_logs.db"
    conn = sqlite3.connect(str(path), timeout=5.0)
    _apply_pragmas(conn)
    db = LogDB(home_dir=home, conn=conn)
    db.migrate()
    return db


def set_default(db: LogDB | None) -> None:
    global _default_db
    _default_db = db


def append(
    component: str,
    level: str,
    event: str,
    message: str,
    **context: Any,
) -> None:
    if _default_db is None:
        return
    _default_db.append(component, level, event, message, **context)


def tail(
    since_iso: str,
    *,
    component: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    if _default_db is None:
        return []
    return _default_db.tail(since_iso, component=component, limit=limit)