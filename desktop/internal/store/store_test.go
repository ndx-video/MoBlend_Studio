package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStudioMigrateAndRecentsRoundTrip(t *testing.T) {
	dir := t.TempDir()

	cfg := map[string]any{
		"recentProjects": []string{`C:\projects\alpha.mo.blend`, `C:\projects\beta.mo.blend`},
	} // index 0 = most recent
	b, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(filepath.Join(dir, "config.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}

	studio, err := OpenStudio(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer studio.Close()

	recents, err := studio.ListRecents(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(recents) != 2 {
		t.Fatalf("expected 2 imported recents, got %d", len(recents))
	}
	if recents[0].Path != `C:\projects\alpha.mo.blend` {
		t.Fatalf("import should preserve config order (alpha first): %+v", recents)
	}

	// recentProjects removed from config after import
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	var after map[string]any
	if err := json.Unmarshal(data, &after); err != nil {
		t.Fatal(err)
	}
	if _, ok := after["recentProjects"]; ok {
		t.Fatal("recentProjects should be removed from config.json after import")
	}

	if err := studio.UpsertRecent(`C:\projects\gamma.mo.blend`, "Gamma", "tpl-1"); err != nil {
		t.Fatal(err)
	}
	recents, err = studio.ListRecents(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(recents) != 3 {
		t.Fatalf("expected 3 recents after upsert, got %d: %+v", len(recents), recents)
	}
	var gamma *RecentProject
	for i := range recents {
		if recents[i].Path == `C:\projects\gamma.mo.blend` {
			gamma = &recents[i]
			break
		}
	}
	if gamma == nil || gamma.DisplayName != "Gamma" || gamma.TemplateID != "tpl-1" {
		t.Fatalf("gamma recent not found or wrong fields: %+v", recents)
	}
}

func TestStudioRecentsPruneToTen(t *testing.T) {
	dir := t.TempDir()
	studio, err := OpenStudio(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer studio.Close()

	for i := 0; i < 12; i++ {
		path := filepath.Join(dir, fmt.Sprintf("project_%02d.mo.blend", i))
		if err := studio.UpsertRecent(path, fmt.Sprintf("P%d", i), ""); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := studio.db.QueryRow(`SELECT COUNT(*) FROM recent_projects`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 10 {
		t.Fatalf("expected 10 rows after prune, got %d", count)
	}
}

func TestStudioAssetIndexUpsert(t *testing.T) {
	dir := t.TempDir()
	studio, err := OpenStudio(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer studio.Close()

	if err := studio.UpsertAssetIndex("abc123", "/sandbox/asset_abc.png", "photo.png", "image/png", 1024); err != nil {
		t.Fatal(err)
	}
	if err := studio.UpsertAssetIndex("abc123", "/sandbox/asset_abc.png", "photo2.png", "image/png", 2048); err != nil {
		t.Fatal(err)
	}
}

func TestLogAppendAndTail(t *testing.T) {
	dir := t.TempDir()
	logs, err := OpenSuiteLogs(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer logs.Close()

	since := time.Now().UTC().Add(-time.Minute)
	if err := logs.Append("studio", "info", "studio.start", "Studio launched", map[string]any{"pid": 1}); err != nil {
		t.Fatal(err)
	}
	if err := logs.Append("broker", "debug", "broker.health", "ok", nil); err != nil {
		t.Fatal(err)
	}

	events, err := logs.Tail(since, "studio", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Event != "studio.start" {
		t.Fatalf("unexpected tail result: %+v", events)
	}

	all, err := logs.Tail(since, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 log events, got %d", len(all))
	}
}