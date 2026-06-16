package moblendlog

import "moblend-studio/internal/store"

// Backend appends suite log events. *store.LogDB satisfies this interface.
type Backend interface {
	Append(component, level, event, message string, ctx map[string]any) error
}

var defaultBackend Backend

// SetBackend configures the package-level log sink (typically *store.LogDB).
func SetBackend(b Backend) {
	defaultBackend = b
}

// Append writes a suite log event when a backend is configured.
func Append(component, level, event, message string, fields map[string]any) error {
	if defaultBackend == nil {
		return nil
	}
	return defaultBackend.Append(component, level, event, message, fields)
}

// Ensure store.LogDB implements Backend at compile time.
var _ Backend = (*store.LogDB)(nil)