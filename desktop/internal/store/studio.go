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

var studioMigrations = []migration{
	{
		version: 1,
		sql: `
CREATE TABLE IF NOT EXISTS recent_projects (
	path TEXT PRIMARY KEY,
	display_name TEXT NOT NULL,
	opened_at TEXT NOT NULL,
	template_id TEXT
);
CREATE TABLE IF NOT EXISTS asset_index (
	content_hash TEXT PRIMARY KEY,
	sandbox_path TEXT NOT NULL,
	original_name TEXT NOT NULL,
	mime TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS installed_templates (
	template_id TEXT PRIMARY KEY,
	local_path TEXT NOT NULL,
	catalog_version TEXT NOT NULL,
	installed_at TEXT NOT NULL
);`,
	},
}

// StudioDB wraps studio.db (Studio Go metadata index).
type StudioDB struct {
	homeDir string
	db      *sql.DB
}

// OpenStudio opens (or creates) studio.db under homeDir and runs migrations.
func OpenStudio(homeDir string) (*StudioDB, error) {
	if err := os.MkdirAll(homeDir, 0o755); err != nil {
		return nil, err
	}
	path := filepath.Join(homeDir, "studio.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if err := applyPragmas(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	s := &StudioDB{homeDir: homeDir, db: db}
	if err := s.Migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Close releases the database handle.
func (s *StudioDB) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// Migrate applies pending schema versions and one-time config.json recents import.
func (s *StudioDB) Migrate() error {
	if err := applyMigrations(s.db, studioMigrations); err != nil {
		return err
	}
	return s.importRecentsFromConfig()
}

func (s *StudioDB) importRecentsFromConfig() error {
	cfgPath := filepath.Join(s.homeDir, "config.json")
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil
	}
	raw, ok := cfg["recentProjects"]
	if !ok {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok || len(arr) == 0 {
		return nil
	}

	base := time.Now().UTC()
	for i, item := range arr {
		path, ok := item.(string)
		if !ok || path == "" {
			continue
		}
		display := filepath.Base(path)
		// Preserve config order: index 0 = most recent (stagger opened_at by 1s per slot).
		opened := base.Add(-time.Duration(i) * time.Second).Format(time.RFC3339)
		_, _ = s.db.Exec(
			`INSERT OR IGNORE INTO recent_projects (path, display_name, opened_at, template_id)
			 VALUES (?, ?, ?, NULL)`,
			path, display, opened,
		)
	}

	delete(cfg, "recentProjects")
	b, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cfgPath, b, 0o644)
}

// UpsertRecent inserts or updates a recent project row (most recent wins on opened_at).
func (s *StudioDB) UpsertRecent(path, displayName, templateID string) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}
	if displayName == "" {
		displayName = filepath.Base(path)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	var tid any
	if templateID != "" {
		tid = templateID
	}
	_, err := s.db.Exec(
		`INSERT INTO recent_projects (path, display_name, opened_at, template_id)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET
		   display_name = excluded.display_name,
		   opened_at = excluded.opened_at,
		   template_id = excluded.template_id`,
		path, displayName, now, tid,
	)
	if err != nil {
		return err
	}
	return s.pruneRecents(10)
}

func (s *StudioDB) pruneRecents(keep int) error {
	if keep <= 0 {
		keep = 10
	}
	_, err := s.db.Exec(
		`DELETE FROM recent_projects
		 WHERE path NOT IN (
		   SELECT path FROM recent_projects ORDER BY opened_at DESC LIMIT ?
		 )`,
		keep,
	)
	return err
}

// ListRecents returns recent projects ordered by opened_at descending.
func (s *StudioDB) ListRecents(limit int) ([]RecentProject, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.db.Query(
		`SELECT path, display_name, opened_at, COALESCE(template_id, '')
		 FROM recent_projects
		 ORDER BY opened_at DESC
		 LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []RecentProject
	for rows.Next() {
		var rp RecentProject
		var opened string
		if err := rows.Scan(&rp.Path, &rp.DisplayName, &opened, &rp.TemplateID); err != nil {
			return nil, err
		}
		t, err := time.Parse(time.RFC3339, opened)
		if err != nil {
			t = time.Time{}
		}
		rp.OpenedAt = t
		out = append(out, rp)
	}
	return out, rows.Err()
}

// UpsertInstalledTemplate records or updates an installed template row.
func (s *StudioDB) UpsertInstalledTemplate(templateID, localPath, catalogVersion string) error {
	if templateID == "" || localPath == "" {
		return fmt.Errorf("templateID and localPath are required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(
		`INSERT INTO installed_templates (template_id, local_path, catalog_version, installed_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(template_id) DO UPDATE SET
		   local_path = excluded.local_path,
		   catalog_version = excluded.catalog_version,
		   installed_at = excluded.installed_at`,
		templateID, localPath, catalogVersion, now,
	)
	return err
}

// ListInstalledTemplates returns installed templates ordered by installed_at descending.
func (s *StudioDB) ListInstalledTemplates(limit int) ([]InstalledTemplate, error) {
	query := `SELECT template_id, local_path, catalog_version, installed_at
		 FROM installed_templates
		 ORDER BY installed_at DESC`
	args := []any{}
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []InstalledTemplate
	for rows.Next() {
		var it InstalledTemplate
		var installed string
		if err := rows.Scan(&it.TemplateID, &it.LocalPath, &it.CatalogVersion, &installed); err != nil {
			return nil, err
		}
		t, err := time.Parse(time.RFC3339, installed)
		if err != nil {
			t = time.Time{}
		}
		it.InstalledAt = t
		out = append(out, it)
	}
	return out, rows.Err()
}

// GetInstalledTemplate returns a single installed template row, or nil if missing.
func (s *StudioDB) GetInstalledTemplate(templateID string) (*InstalledTemplate, error) {
	if templateID == "" {
		return nil, fmt.Errorf("templateID is required")
	}
	row := s.db.QueryRow(
		`SELECT template_id, local_path, catalog_version, installed_at
		 FROM installed_templates
		 WHERE template_id = ?`,
		templateID,
	)
	var it InstalledTemplate
	var installed string
	if err := row.Scan(&it.TemplateID, &it.LocalPath, &it.CatalogVersion, &installed); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	t, err := time.Parse(time.RFC3339, installed)
	if err != nil {
		t = time.Time{}
	}
	it.InstalledAt = t
	return &it, nil
}

// DeleteInstalledTemplate removes an installed template row.
func (s *StudioDB) DeleteInstalledTemplate(templateID string) error {
	if templateID == "" {
		return fmt.Errorf("templateID is required")
	}
	_, err := s.db.Exec(`DELETE FROM installed_templates WHERE template_id = ?`, templateID)
	return err
}

// UpsertAssetIndex records a sandbox asset metadata row.
func (s *StudioDB) UpsertAssetIndex(contentHash, sandboxPath, originalName, mime string, sizeBytes int64) error {
	if contentHash == "" || sandboxPath == "" {
		return fmt.Errorf("contentHash and sandboxPath are required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(
		`INSERT INTO asset_index (content_hash, sandbox_path, original_name, mime, size_bytes, imported_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(content_hash) DO UPDATE SET
		   sandbox_path = excluded.sandbox_path,
		   original_name = excluded.original_name,
		   mime = excluded.mime,
		   size_bytes = excluded.size_bytes,
		   imported_at = excluded.imported_at`,
		contentHash, sandboxPath, originalName, mime, sizeBytes, now,
	)
	return err
}