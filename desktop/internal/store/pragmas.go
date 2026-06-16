package store

import "database/sql"

func applyPragmas(db *sql.DB) error {
	for _, stmt := range []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=5000",
		"PRAGMA foreign_keys=ON",
	} {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}