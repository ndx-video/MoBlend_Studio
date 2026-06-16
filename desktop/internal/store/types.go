package store

import "time"

// RecentProject is a row from studio.db recent_projects.
type RecentProject struct {
	Path        string
	DisplayName string
	OpenedAt    time.Time
	TemplateID  string
}

// InstalledTemplate is a row from studio.db installed_templates.
type InstalledTemplate struct {
	TemplateID     string
	LocalPath      string
	CatalogVersion string
	InstalledAt    time.Time
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