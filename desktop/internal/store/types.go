package store

import "time"

// RecentProject is a row from studio.db recent_projects.
type RecentProject struct {
	Path        string
	DisplayName string
	OpenedAt    time.Time
	TemplateID  string
}

// LogEvent is a row from suite_logs.db log_events.
type LogEvent struct {
	ID          int64
	TS          time.Time
	Level       string
	Component   string
	Event       string
	Message     string
	ContextJSON string
}