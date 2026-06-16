package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var logMigrations = []migration{
	{
		version: 1,
		sql: `
CREATE TABLE IF NOT EXISTS log_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	ts TEXT NOT NULL,
	level TEXT NOT NULL,
	component TEXT NOT NULL,
	event TEXT NOT NULL,
	message TEXT NOT NULL,
	context_json TEXT NOT NULL DEFAULT '{}'
);`,
	},
}

// LogDB wraps suite_logs.db (cross-suite append-only events).
type LogDB struct {
	db *sql.DB
}

// OpenSuiteLogs opens (or creates) suite_logs.db under homeDir and runs migrations.
func OpenSuiteLogs(homeDir string) (*LogDB, error) {
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(homeDir, "suite_logs.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if err := applyPragmas(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	l := &LogDB{db: db}
	if err := l.Migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return l, nil
}

// Close releases the database handle.
func (l *LogDB) Close() error {
	if l == nil || l.db == nil {
		return nil
	}
	return l.db.Close()
}

// Migrate applies pending log schema versions.
func (l *LogDB) Migrate() error {
	return applyMigrations(l.db, logMigrations)
}

// Append inserts one log event row.
func (l *LogDB) Append(component, level, event, message string, ctx map[string]any) error {
	if component == "" || level == "" || event == "" {
		return fmt.Errorf("component, level, and event are required")
	}
	ctxJSON := "{}"
	if ctx != nil {
		b, err := json.Marshal(ctx)
		if err != nil {
			return err
		}
		ctxJSON = string(b)
	}
	ts := time.Now().UTC().Format(time.RFC3339)
	_, err := l.db.Exec(
		`INSERT INTO log_events (ts, level, component, event, message, context_json)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		ts, level, component, event, message, ctxJSON,
	)
	return err
}

// Tail returns log events at or after since, optionally filtered by component.
func (l *LogDB) Tail(since time.Time, component string, limit int) ([]LogEvent, error) {
	if limit <= 0 {
		limit = 100
	}
	sinceISO := since.UTC().Format(time.RFC3339)

	var rows *sql.Rows
	var err error
	if component != "" {
		rows, err = l.db.Query(
			`SELECT id, ts, level, component, event, message, context_json
			 FROM log_events
			 WHERE ts >= ? AND component = ?
			 ORDER BY ts ASC, id ASC
			 LIMIT ?`,
			sinceISO, component, limit,
		)
	} else {
		rows, err = l.db.Query(
			`SELECT id, ts, level, component, event, message, context_json
			 FROM log_events
			 WHERE ts >= ?
			 ORDER BY ts ASC, id ASC
			 LIMIT ?`,
			sinceISO, limit,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LogEvent
	for rows.Next() {
		var ev LogEvent
		var ts string
		if err := rows.Scan(&ev.ID, &ts, &ev.Level, &ev.Component, &ev.Event, &ev.Message, &ev.ContextJSON); err != nil {
			return nil, err
		}
		t, err := time.Parse(time.RFC3339, ts)
		if err != nil {
			t = time.Time{}
		}
		ev.TS = t
		out = append(out, ev)
	}
	return out, rows.Err()
}