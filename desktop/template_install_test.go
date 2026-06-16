package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"moblend-studio/internal/store"
)

func TestInstallTemplateBinaryDownloadsAndCaches(t *testing.T) {
	payload := []byte("fake-mo-blend-binary")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	home := t.TempDir()
	studio, err := store.OpenStudio(home)
	if err != nil {
		t.Fatal(err)
	}
	defer studio.Close()

	path, err := installTemplateBinary(home, studio, "parametric-cube-demo", server.URL, "1.0.0")
	if err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != string(payload) {
		t.Fatalf("unexpected file contents: %q", data)
	}

	row, err := studio.GetInstalledTemplate("parametric-cube-demo")
	if err != nil || row == nil {
		t.Fatalf("expected installed_templates row, got err=%v row=%+v", err, row)
	}
	if row.LocalPath != path || row.CatalogVersion != "1.0.0" {
		t.Fatalf("unexpected row: %+v", row)
	}

	// Version-aware cache hit should not re-download.
	server.Close()
	path2, err := installTemplateBinary(home, studio, "parametric-cube-demo", "http://127.0.0.1:1/should-not-be-called", "1.0.0")
	if err != nil {
		t.Fatal(err)
	}
	if path2 != path {
		t.Fatalf("expected cache hit path %q, got %q", path, path2)
	}
}

func TestInstallTemplateBinaryReDownloadsOnVersionChange(t *testing.T) {
	var downloads int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads++
		_, _ = w.Write([]byte("version-" + string(rune('0'+downloads))))
	}))
	defer server.Close()

	home := t.TempDir()
	studio, err := store.OpenStudio(home)
	if err != nil {
		t.Fatal(err)
	}
	defer studio.Close()

	if _, err := installTemplateBinary(home, studio, "demo", server.URL, "1.0.0"); err != nil {
		t.Fatal(err)
	}
	if _, err := installTemplateBinary(home, studio, "demo", server.URL, "1.1.0"); err != nil {
		t.Fatal(err)
	}
	if downloads != 2 {
		t.Fatalf("expected 2 downloads on version change, got %d", downloads)
	}

	target := templateTargetPath(filepath.Join(home, "templates"), "demo")
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "version-2" {
		t.Fatalf("expected updated file contents, got %q", data)
	}
}

func TestInstallTemplateBinaryRejectsOversizedDownload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chunk := make([]byte, 1024*1024)
		for written := 0; written < maxTemplateDownloadBytes+1; written += len(chunk) {
			n := len(chunk)
			if remain := (maxTemplateDownloadBytes + 1) - written; remain < n {
				n = remain
			}
			_, _ = w.Write(chunk[:n])
		}
	}))
	defer server.Close()

	home := t.TempDir()
	studio, err := store.OpenStudio(home)
	if err != nil {
		t.Fatal(err)
	}
	defer studio.Close()

	_, err = installTemplateBinary(home, studio, "too-big", server.URL, "1.0.0")
	if err == nil {
		t.Fatal("expected oversize download to fail")
	}
	if !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected size-limit error, got: %v", err)
	}

	target := templateTargetPath(filepath.Join(home, "templates"), "too-big")
	if _, statErr := os.Stat(target); statErr == nil {
		t.Fatal("oversize download should not leave a final .mo.blend file")
	}
}

func TestGetInstalledTemplatePathPrunesMissingFile(t *testing.T) {
	home := t.TempDir()
	studio, err := store.OpenStudio(home)
	if err != nil {
		t.Fatal(err)
	}
	defer studio.Close()

	missingPath := filepath.Join(home, "templates", "gone.mo.blend")
	if err := studio.UpsertInstalledTemplate("gone", missingPath, "1.0.0"); err != nil {
		t.Fatal(err)
	}

	app := &App{studioDB: studio}
	if path, ok := app.GetInstalledTemplatePath("gone"); ok || path != "" {
		t.Fatalf("expected missing file to return false, got path=%q ok=%v", path, ok)
	}

	row, err := studio.GetInstalledTemplate("gone")
	if err != nil {
		t.Fatal(err)
	}
	if row != nil {
		t.Fatalf("expected stale row pruned, got %+v", row)
	}
}