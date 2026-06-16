package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	stdruntime "runtime"
	"strings"
	"sync"
	"time"

	"moblend-studio/internal/moblendlog"
	"moblend-studio/internal/store"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct holds the Wails context and engine supervisor state.
type App struct {
	ctx context.Context

	// Engine supervision (M3)
	engineCmd    *exec.Cmd
	engineCtx    context.Context
	engineMu     sync.Mutex
	engineCancel context.CancelFunc

	// Simple in-memory + persisted recents (paths to .mo.blend)
	recents []string

	// Last known broker base (overridable via config in future)
	brokerBase string

	// Whether we are the process that started the current broker (so we are responsible for stopping it)
	ownedEngine bool

	// M3a persistence
	studioDB *store.StudioDB
	logDB    *store.LogDB
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		brokerBase: "http://127.0.0.1:8000",
		recents:    []string{},
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods. We also auto-start the engine (M3).
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	a.initPersistence()

	// Best-effort: start the headless broker on launch so the rest of the
	// app (Suite Manager, editor) has something to talk to.
	// Users can also control it explicitly from the Suite Manager screen.
	_ = a.StartEngine("")

	// File drops: EnableFileDrop + frontend runtime.OnFileDrop → CopyToAssetSandbox binding.
}

// shutdown is wired from main.go OnShutdown to guarantee we don't leave
// orphaned Blender processes when the user closes the Studio window.
func (a *App) shutdown(ctx context.Context) {
	_ = a.StopEngine()
	if a.studioDB != nil {
		_ = a.studioDB.Close()
		a.studioDB = nil
	}
	if a.logDB != nil {
		_ = a.logDB.Close()
		a.logDB = nil
	}
}

// Greet is the original boilerplate (kept for minimal diff / tests).
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// -------------------------------------------------------------------
// Go bindings surface (see PRD 4 §12). React calls these via wailsjs.
// -------------------------------------------------------------------

// GetBrokerBaseURL returns the base URL the frontend should use for all
// REST + WS calls. Currently hardcoded to the single-broker localhost; can
// later read from ~/.moblend/config.json.
func (a *App) GetBrokerBaseURL() string {
	return a.brokerBase
}

// GetConfig reads (or creates) the canonical suite config at
// %USERPROFILE%\.moblend\config.json (Windows) / ~/.moblend/config.json.
func (a *App) GetConfig() (map[string]any, error) {
	path := a.configPath()
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// SetConfig merges the partial into the on-disk config and persists it.
func (a *App) SetConfig(partial map[string]any) error {
	if partial == nil {
		partial = map[string]any{}
	}
	path := a.configPath()
	_ = os.MkdirAll(filepath.Dir(path), 0o755)

	existing, _ := a.GetConfig()
	for k, v := range partial {
		existing[k] = v
	}
	b, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func (a *App) moblendHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".moblend")
}

func (a *App) configPath() string {
	return filepath.Join(a.moblendHomeDir(), "config.json")
}

func (a *App) initPersistence() {
	home := a.moblendHomeDir()
	studio, err := store.OpenStudio(home)
	if err != nil {
		a.emitPersistenceWarning("studio.db unavailable: " + err.Error())
		return
	}
	logs, err := store.OpenSuiteLogs(home)
	if err != nil {
		_ = studio.Close()
		a.emitPersistenceWarning("suite_logs.db unavailable: " + err.Error())
		return
	}
	a.studioDB = studio
	a.logDB = logs
	moblendlog.SetBackend(logs)

	if recents, err := studio.ListRecents(10); err == nil {
		paths := make([]string, 0, len(recents))
		for _, r := range recents {
			paths = append(paths, r.Path)
		}
		a.recents = paths
	}

	_ = moblendlog.Append("studio", "info", "studio.start", "Mo.Blend Studio started", map[string]any{
		"home": home,
	})
}

func (a *App) emitPersistenceWarning(msg string) {
	if a.ctx != nil {
		wailsruntime.LogError(a.ctx, msg)
		wailsruntime.EventsEmit(a.ctx, "moblend:persistence:warning", msg)
	}
}

// PickMoBlendFile opens a native file dialog filtered to .mo.blend and returns
// the selected absolute path (or empty string on cancel).
func (a *App) PickMoBlendFile() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app context not ready")
	}
	opts := wailsruntime.OpenDialogOptions{
		Title: "Open Mo.Blend Template",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Mo.Blend Templates (*.mo.blend)", Pattern: "*.mo.blend"},
			{DisplayName: "All Files", Pattern: "*.*"},
		},
	}
	return wailsruntime.OpenFileDialog(a.ctx, opts)
}

// GetRecentProjects returns the list of recently opened .mo.blend paths
// (most recent first). Persisted in studio.db (M3a).
func (a *App) GetRecentProjects() []string {
	return append([]string(nil), a.recents...)
}

// AddRecentProject inserts path at the front of recents (deduped, capped at 10)
// and persists to studio.db (M3a).
func (a *App) AddRecentProject(path string) {
	if path == "" {
		return
	}
	// Dedupe + move to front
	out := []string{path}
	for _, p := range a.recents {
		if p != path {
			out = append(out, p)
		}
	}
	if len(out) > 10 {
		out = out[:10]
	}
	a.recents = out

	if a.studioDB != nil {
		_ = a.studioDB.UpsertRecent(path, filepath.Base(path), "")
	}
	_ = moblendlog.Append("studio", "info", "project.open", "Recent project updated", map[string]any{
		"path": path,
	})
}

// StartEngine ensures a broker is running (re-uses existing if one is already healthy on the port).
// This prevents "port already in use" errors and allows attaching to a previous instance
// (e.g. one left running by scripts/dev.ps1 or a previous Wails session).
// After the broker is confirmed healthy we attempt to auto-load a default test template
// (the M1 synthetic in %TEMP%) if no explicit loadPath was given. This gives users a
// working studio immediately without manual file hunting on every launch.
func (a *App) StartEngine(loadPath string) error {
	a.engineMu.Lock()
	defer a.engineMu.Unlock()

	// Fast path: broker already responding (our previous run, dev.ps1, or external).
	// This is the main safeguard against port conflicts and repeated spawns.
	if a.isBrokerHealthy() {
		_ = moblendlog.Append("studio", "info", "engine.start", "Attached to running broker", map[string]any{
			"owned": false,
		})
		if loadPath != "" {
			_ = a.loadViaBroker(loadPath)
		} else {
			_ = a.maybeAutoLoadDefault()
		}
		return nil
	}

	// We don't own a live one and nothing is listening — time to spawn.
	blender := a.locateBlender()
	if blender == "" {
		return fmt.Errorf("could not locate Blender executable (checked PATH and common Program Files locations)")
	}

	if err := a.ensureBrokerDeps(blender); err != nil {
		// Non-fatal — user can fall back to scripts/dev.ps1
		_ = err
	}

	repoRoot := a.repoRootGuess()
	stub := filepath.Join(repoRoot, "engine", "bootstrap.py")

	args := []string{
		"--background",
		"--factory-startup",
		"--python", stub,
		"--", "--serve",
	}
	if loadPath != "" {
		args = append(args, "--load", loadPath)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, blender, args...)
	cmd.Dir = repoRoot

	if err := cmd.Start(); err != nil {
		cancel()
		_ = moblendlog.Append("studio", "error", "engine.start", "Failed to start Blender broker", map[string]any{
			"error": err.Error(),
		})
		return fmt.Errorf("failed to start Blender broker: %w", err)
	}

	_ = moblendlog.Append("studio", "info", "engine.start", "Spawned Blender broker", map[string]any{
		"owned": true,
	})

	a.engineCmd = cmd
	a.engineCtx = ctx
	a.engineCancel = cancel
	a.ownedEngine = true

	// Background poll so the rest of the app (and Suite Manager) can react quickly.
	go a.pollUntilHealthy(60 * time.Second)

	// Give the broker a moment then auto-load a default template for great first-run UX.
	// We do this even if the caller didn't pass a loadPath.
	go func() {
		time.Sleep(2 * time.Second)
		if loadPath != "" {
			_ = a.loadViaBroker(loadPath)
		} else {
			_ = a.maybeAutoLoadDefault()
		}
	}()

	return nil
}

// StopEngine terminates the supervised Blender process tree.
// We only kill the process if we are the owner (we started it). This allows
// safe "attach" semantics when a previous instance (or dev.ps1) is already running.
func (a *App) StopEngine() error {
	a.engineMu.Lock()
	defer a.engineMu.Unlock()

	if !a.ownedEngine {
		// We didn't start it — do not kill it.
		a.engineCmd = nil
		a.engineCancel = nil
		_ = moblendlog.Append("studio", "info", "engine.stop", "Skipped stop (broker not owned)", nil)
		return nil
	}

	if a.engineCancel != nil {
		a.engineCancel()
	}
	if a.engineCmd != nil && a.engineCmd.Process != nil {
		pid := a.engineCmd.Process.Pid
		_ = a.killProcessTree(pid)
		a.engineCmd = nil
	}
	a.ownedEngine = false
	_ = moblendlog.Append("studio", "info", "engine.stop", "Stopped owned Blender broker", nil)
	return nil
}

// EngineHealth performs a quick GET /api/v1/health against the broker and
// returns a small DTO. The frontend can also call the URL directly.
func (a *App) EngineHealth() (map[string]any, error) {
	url := a.brokerBase + "/api/v1/health"
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return map[string]any{"status": "unreachable", "error": err.Error()}, nil
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out == nil {
		out = map[string]any{}
	}
	out["http_status"] = resp.StatusCode
	if resp.StatusCode >= 200 && resp.StatusCode < 500 {
		if _, ok := out["status"]; !ok {
			out["status"] = "ok"
		}
	}
	return out, nil
}

// assetSandboxDir returns ~/.moblend/assets (created on demand by callers).
func (a *App) assetSandboxDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".moblend", "assets"), nil
}

// ListAssetSandbox returns absolute paths of files in the user asset sandbox.
func (a *App) ListAssetSandbox() ([]string, error) {
	sandbox, err := a.assetSandboxDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(sandbox)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		out = append(out, filepath.Join(sandbox, e.Name()))
	}
	return out, nil
}

// PickAssetFile opens a native file dialog filtered by asset kind
// ("image", "video", or "font"). Returns empty string on cancel.
func (a *App) PickAssetFile(kind string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("app context not ready")
	}
	var filters []wailsruntime.FileFilter
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "image":
		filters = []wailsruntime.FileFilter{
			{DisplayName: "Images", Pattern: "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.tiff;*.tif"},
		}
	case "video":
		filters = []wailsruntime.FileFilter{
			{DisplayName: "Video", Pattern: "*.mp4;*.mov;*.avi;*.mkv;*.webm"},
		}
	case "font":
		filters = []wailsruntime.FileFilter{
			{DisplayName: "Fonts", Pattern: "*.ttf;*.otf;*.woff;*.woff2"},
		}
	default:
		filters = []wailsruntime.FileFilter{
			{DisplayName: "All Files", Pattern: "*.*"},
		}
	}
	opts := wailsruntime.OpenDialogOptions{
		Title:   "Choose asset file",
		Filters: filters,
	}
	return wailsruntime.OpenFileDialog(a.ctx, opts)
}

// InstallTemplate downloads and caches a .mo.blend binary from the library
// into ~/.moblend/templates/. Skips re-download when catalog_version matches
// an existing on-disk file. Go never parses the binary.
func (a *App) InstallTemplate(templateID, downloadURL, catalogVersion string) (string, error) {
	return installTemplateBinary(a.moblendHomeDir(), a.studioDB, templateID, downloadURL, catalogVersion)
}

// ListInstalledTemplates returns installed template rows from studio.db
// (most recently installed first).
func (a *App) ListInstalledTemplates() ([]store.InstalledTemplate, error) {
	if a.studioDB == nil {
		return nil, fmt.Errorf("studio.db unavailable")
	}
	return a.studioDB.ListInstalledTemplates(0)
}

// GetInstalledTemplatePath returns the local path for an installed template,
// or ("", false) when not installed or the file is missing.
func (a *App) GetInstalledTemplatePath(templateID string) (string, bool) {
	if a.studioDB == nil || templateID == "" {
		return "", false
	}
	row, err := a.studioDB.GetInstalledTemplate(templateID)
	if err != nil || row == nil {
		return "", false
	}
	info, statErr := os.Stat(row.LocalPath)
	if statErr != nil || info.Size() == 0 {
		_ = a.studioDB.DeleteInstalledTemplate(templateID)
		return "", false
	}
	return row.LocalPath, true
}

// CopyToAssetSandbox copies the given local files into the secure user
// sandbox (%USERPROFILE%\.moblend\assets on Windows) with SHA-256 content
// deduplication. Returns the final sandbox paths.
func (a *App) CopyToAssetSandbox(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	sandbox, err := a.assetSandboxDir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(sandbox, 0o755); err != nil {
		return nil, err
	}

	var out []string
	for _, src := range paths {
		if src == "" {
			continue
		}
		final, meta, err := a.copyOneDeduped(src, sandbox)
		if err != nil {
			// Continue with others; surface the first error at end if needed
			continue
		}
		if a.studioDB != nil && meta != nil {
			_ = a.studioDB.UpsertAssetIndex(
				meta.contentHash,
				final,
				meta.originalName,
				meta.mime,
				meta.sizeBytes,
			)
		}
		out = append(out, final)
	}
	return out, nil
}

// -------------------------------------------------------------------
// Internal helpers (Blender discovery, spawn, kill, dedupe copy)
// -------------------------------------------------------------------

func (a *App) locateBlender() string {
	candidates := []string{
		"blender",
		"blender.exe",
	}

	// Windows Program Files scan (primary dev target)
	if stdruntime.GOOS == "windows" {
		base := `C:\Program Files\Blender Foundation`
		if fi, err := os.Stat(base); err == nil && fi.IsDir() {
			_ = filepath.WalkDir(base, func(path string, d fs.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				name := strings.ToLower(d.Name())
				if !d.IsDir() && (name == "blender.exe" || name == "blender-launcher.exe") {
					candidates = append(candidates, path)
				}
				return nil
			})
		}
		// Common explicit 5.1/4.2 locations (dev.ps1 parity)
		for _, ver := range []string{"Blender 5.1", "Blender 4.2", "Blender 4.3"} {
			p := filepath.Join(base, ver, "blender.exe")
			candidates = append(candidates, p)
		}
	}

	// Also try PATH via LookPath
	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil && p != "" {
			return p
		}
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func (a *App) ensureBrokerDeps(blenderExe string) error {
	// Probe Blender's python (same heuristic as dev.ps1)
	blenderPy := ""
	probe := exec.Command(blenderExe, "--background", "--factory-startup", "--python-expr", "import sys; print(sys.executable)")
	out, _ := probe.Output()
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasSuffix(line, ".exe") || strings.HasSuffix(line, "python") {
			if _, err := os.Stat(line); err == nil {
				blenderPy = line
				break
			}
		}
	}
	if blenderPy == "" {
		// Fallback guesses
		dir := filepath.Dir(blenderExe)
		for _, cand := range []string{
			filepath.Join(dir, "python", "python.exe"),
			filepath.Join(dir, "python", "bin", "python.exe"),
		} {
			if _, err := os.Stat(cand); err == nil {
				blenderPy = cand
				break
			}
		}
	}
	if blenderPy == "" {
		return fmt.Errorf("could not locate Blender's bundled python for pip install")
	}

	repoRoot := a.repoRootGuess()
	vendor := filepath.Join(repoRoot, "engine", "vendor")
	_ = os.MkdirAll(vendor, 0o755)

	// pip install --target (quiet)
	cmd := exec.Command(blenderPy, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--upgrade", "--target", vendor, "fastapi", "uvicorn[standard]")
	cmd.Env = append(os.Environ(), "PYTHONNOUSERSITE=1")
	_ = cmd.Run() // best effort; non-fatal for now

	return nil
}

func (a *App) repoRootGuess() string {
	// When running via wails the CWD is usually the repo root or desktop/.
	// Walk upward looking for engine/bootstrap.py or go.mod.
	dir, _ := os.Getwd()
	for i := 0; i < 6; i++ {
		if _, err := os.Stat(filepath.Join(dir, "engine", "bootstrap.py")); err == nil {
			return dir
		}
		if _, err := os.Stat(filepath.Join(dir, "desktop", "go.mod")); err == nil {
			// We are inside desktop/; go up one
			return filepath.Dir(dir)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "."
}

func (a *App) pollUntilHealthy(timeout time.Duration) {
	deadline := time.Now().Add(timeout)
	url := a.brokerBase + "/api/v1/health"
	for time.Now().Before(deadline) {
		resp, err := http.Get(url)
		if err == nil && resp.StatusCode < 500 {
			resp.Body.Close()
			wailsruntime.EventsEmit(a.ctx, "moblend:engine:healthy", true)
			return
		}
		if resp != nil {
			resp.Body.Close()
		}
		time.Sleep(800 * time.Millisecond)
	}
	wailsruntime.EventsEmit(a.ctx, "moblend:engine:healthy", false)
}

func (a *App) killProcessTree(pid int) error {
	if pid <= 0 {
		return nil
	}
	if stdruntime.GOOS == "windows" {
		// taskkill the whole tree
		_ = exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid)).Run()
		return nil
	}
	// Unix: kill the pgid if possible, else direct
	proc, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	_ = proc.Kill()
	return nil
}

type assetCopyMeta struct {
	contentHash  string
	originalName string
	mime         string
	sizeBytes    int64
}

func (a *App) copyOneDeduped(src, sandbox string) (string, *assetCopyMeta, error) {
	f, err := os.Open(src)
	if err != nil {
		return "", nil, err
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return "", nil, err
	}

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", nil, err
	}
	fullHash := hex.EncodeToString(h.Sum(nil))
	short := fullHash[:16]

	ext := filepath.Ext(src)
	if ext == "" {
		ext = ".bin"
	}
	dstName := fmt.Sprintf("asset_%s%s", short, ext)
	dst := filepath.Join(sandbox, dstName)

	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		buf := make([]byte, 512)
		if _, err := f.Seek(0, 0); err == nil {
			if n, _ := f.Read(buf); n > 0 {
				mimeType = http.DetectContentType(buf[:n])
			}
		}
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	meta := &assetCopyMeta{
		contentHash:  fullHash,
		originalName: filepath.Base(src),
		mime:         mimeType,
		sizeBytes:    info.Size(),
	}

	// Idempotent copy
	if _, err := os.Stat(dst); err == nil {
		return dst, meta, nil
	}
	// Rewind and copy
	if _, err := f.Seek(0, 0); err != nil {
		return "", nil, err
	}
	out, err := os.Create(dst)
	if err != nil {
		return "", nil, err
	}
	defer out.Close()
	if _, err := io.Copy(out, f); err != nil {
		return "", nil, err
	}
	return dst, meta, nil
}

// -------------------------------------------------------------------
// Broker liveness + smart auto-load helpers (initiative improvements for M3 UX)
// -------------------------------------------------------------------

// isBrokerHealthy does a fast probe. Used to detect a running broker from
// a previous session / dev.ps1 without trying to spawn and hitting port conflicts.
func (a *App) isBrokerHealthy() bool {
	url := a.brokerBase + "/api/v1/health"
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 500
}

// defaultTemplatePath returns the well-known M1 synthetic test file if it exists.
// This is the file created by engine/tests/m1_roundtrip.py (and scripts/dev.ps1).
func (a *App) defaultTemplatePath() string {
	tmp := os.TempDir()
	cand := filepath.Join(tmp, "m1_minimal_test.mo.blend")
	if _, err := os.Stat(cand); err == nil {
		return cand
	}
	return ""
}

// maybeAutoLoadDefault is called after we have a healthy broker. It loads the
// M1 test template so the user sees a live editor + parameters on first launch.
func (a *App) maybeAutoLoadDefault() error {
	p := a.defaultTemplatePath()
	if p == "" {
		return nil
	}
	return a.loadViaBroker(p)
}

// loadViaBroker performs a fire-and-forget POST /project/load against the broker.
// Used both for explicit loadPath and for the default auto-load on startup.
func (a *App) loadViaBroker(path string) error {
	url := a.brokerBase + "/api/v1/project/load"
	body := map[string]string{"template_path": path}
	b, _ := json.Marshal(body)
	_, err := http.Post(url, "application/json", bytes.NewReader(b))
	return err
}

// GetDefaultTemplatePath exposes the location of the auto-loadable test template
// to the frontend (useful for "Load default" buttons and status messages).
func (a *App) GetDefaultTemplatePath() string {
	return a.defaultTemplatePath()
}

// Reload forces a full reload of the frontend (useful for debugging CSS/JS changes
// without killing the whole wails dev process).
func (a *App) Reload() {
	wailsruntime.WindowReload(a.ctx)
}

// OpenDevTools is a best-effort hook for developers. In the Wails WebView2
// environment, full Chrome DevTools are best used by opening the Vite dev server
// URL (http://localhost:5173 during `wails dev`) directly in a real Chrome window (F12).
// This method can be called from the frontend on F12 for convenience.
func (a *App) OpenDevTools() {
	// Log to the webview console and emit an event the frontend can listen to.
	println("[wails] OpenDevTools requested - for full frontend debugging, open http://localhost:5173 in Chrome and press F12")
	wailsruntime.EventsEmit(a.ctx, "moblend:devtools:requested")
}
