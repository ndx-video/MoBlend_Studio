package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"moblend-studio/internal/moblendlog"
	"moblend-studio/internal/store"
)

const maxTemplateDownloadBytes = 50 * 1024 * 1024 // PRD 7 asset limit

func templatesDirFromHome(homeDir string) (string, error) {
	dir := filepath.Join(homeDir, "templates")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func templateTargetPath(templatesDir, templateID string) string {
	safeID := strings.ReplaceAll(strings.TrimSpace(templateID), "/", "_")
	return filepath.Join(templatesDir, safeID+".mo.blend")
}

func installTemplateBinary(homeDir string, db *store.StudioDB, templateID, downloadURL, catalogVersion string) (string, error) {
	templateID = strings.TrimSpace(templateID)
	downloadURL = strings.TrimSpace(downloadURL)
	catalogVersion = strings.TrimSpace(catalogVersion)
	if templateID == "" {
		return "", fmt.Errorf("templateID is required")
	}
	if downloadURL == "" {
		return "", fmt.Errorf("downloadURL is required")
	}
	if db == nil {
		return "", fmt.Errorf("studio.db unavailable")
	}

	templatesDir, err := templatesDirFromHome(homeDir)
	if err != nil {
		return "", err
	}
	target := templateTargetPath(templatesDir, templateID)

	if existing, err := db.GetInstalledTemplate(templateID); err == nil && existing != nil {
		if existing.CatalogVersion == catalogVersion {
			if info, statErr := os.Stat(existing.LocalPath); statErr == nil && info.Size() > 0 {
				return existing.LocalPath, nil
			}
		}
	}

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(downloadURL)
	if err != nil {
		_ = moblendlog.Append("studio", "error", "template.install", "Template download failed", map[string]any{
			"template_id": templateID,
			"error":       err.Error(),
		})
		return "", fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_ = moblendlog.Append("studio", "error", "template.install", "Template download returned non-success status", map[string]any{
			"template_id":  templateID,
			"http_status":  resp.StatusCode,
			"download_url": downloadURL,
		})
		return "", fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	limited := io.LimitReader(resp.Body, maxTemplateDownloadBytes+1)
	tmp, err := os.CreateTemp(templatesDir, ".install-*.tmp")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}

	n, err := io.Copy(tmp, limited)
	if err != nil {
		cleanup()
		_ = moblendlog.Append("studio", "error", "template.install", "Template download write failed", map[string]any{
			"template_id": templateID,
			"error":       err.Error(),
		})
		return "", fmt.Errorf("write failed: %w", err)
	}
	if n == 0 {
		cleanup()
		return "", fmt.Errorf("download returned empty file")
	}
	if n > maxTemplateDownloadBytes {
		cleanup()
		return "", fmt.Errorf("download exceeds %d byte limit", maxTemplateDownloadBytes)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return "", err
	}

	if err := os.Rename(tmpPath, target); err != nil {
		cleanup()
		return "", err
	}

	if err := db.UpsertInstalledTemplate(templateID, target, catalogVersion); err != nil {
		return "", err
	}

	_ = moblendlog.Append("studio", "info", "template.install", "Template installed", map[string]any{
		"template_id":      templateID,
		"catalog_version":  catalogVersion,
		"local_path":       target,
		"bytes":            n,
		"download_url":     downloadURL,
	})

	return target, nil
}