# **PRD 4: Studio (Wails Desktop UI)**

## **1\. Objective**

To provide a blazing-fast, lightweight desktop application called **Mo.Blend Studio**, tailored for casual motion designers and marketers. The UI must completely hide the underlying Blender engine, presenting a highly constrained, Canva/CapCut-style interface driven entirely by pre-configured .mo.blend templates. Additionally, it serves as the centralized hub for managing the entire Mo.Blend software ecosystem.

## **2\. Core Architecture**

The desktop application will be built using **Wails v2**, combining a Go-based backend with a modern web frontend (React + TypeScript recommended).

* **The Go Backend:** Acts as a lightweight window manager, local filesystem bridge, and system process orchestrator. It handles drag-and-drop file operations, manages local configuration files, spawns/supervises the headless Blender+engine process tree, and streams template binaries from the registry CDN.  
* **The Web Frontend:** Implements the UI components and maintains a direct HTTP/WebSocket connection to the Mo.Blend API Server (PRD 3) running locally at localhost:8000.  
* **Zero Blender Coupling (Rendering & Data):** The desktop app must *never* attempt to read or parse .mo.blend files directly, mutate bpy state, or render frames locally. All template loading, parameter mutation, and viewport rendering must go through the API Broker at localhost:8000.  
* **Process Orchestration (Allowed):** The Go backend *may* spawn and supervise `blender --background --python ...` as the engine process tree (Suite Manager health checks, startup, and shutdown watchdog). This is lifecycle management, not direct rendering.

### **2.1 Target Platforms**

| Platform | Priority | Shell |
|----------|----------|-------|
| Windows (x64) | **Primary** | Wails + WebView2 — all v1 development and release builds target Windows first |
| Linux (x64) | Secondary | Wails + WebKitGTK — parity after Windows MVP |
| macOS (Apple Silicon) | Secondary | Wails + WebKit — arm64 builds when Windows MVP is stable |

The React frontend connects to `ws://127.0.0.1:8000` for viewport frames on all platforms. Go handles OS-specific process signals for the Blender watchdog (e.g. Windows job objects / Unix SIGTERM).

## **3\. Monorepo Integration**

Mo.Blend Studio lives in the `MoBlend_Studio` monorepo alongside the Python engine and web clients:

```
MoBlend_Studio/
├── engine/          # Python: bootstrap, moblend engine, FastAPI broker (PRD 1–3)
├── desktop/         # Wails app: Go backend + frontend/ (PRD 4)
├── clients/
│   ├── obs/         # PRD 5 — static HTML/JS for OBS CEF dock
│   └── sentinel/    # PRD 6 — placeholder; placement TBD
├── specs/
├── scripts/         # dev: start-engine, build-desktop
└── ROADMAP.md
```

Suite Manager paths resolve relative to the monorepo install during development, or from bundled resources in release builds.

## **4\. Mo.Blend Studio Suite Manager (The Hub)**

To remove guesswork and streamline user onboarding, Mo.Blend Studio includes a dedicated "Suite Manager" panel in the settings. This acts as a unified package manager for the entire ecosystem.

* **Component Tracking:** Visually tracks the installation status, version numbers, and local paths of all suite components:  
  * Official Blender Distribution (validates path and version compatibility).  
  * Mo.Blend Python Engine (PRD 2).  
  * API Broker / MCP Server (PRD 3).  
  * Official Template Library (`lib.moblend.dev`, PRD 7).  
* **Automated Setup:** Provides one-click installation or updating of the Python Engine and API Broker components from the monorepo (dev) or bundled release artifacts.  
* **Health Checks:** Runs diagnostic checks to ensure the headless Blender instance can be successfully launched and the API port (8000) is available.  
* **Component Explanations:** Includes clear, concise tooltips and documentation within the UI explaining what each component does, demystifying the architecture for casual users.

## **5\. UI/UX Paradigm: The "No Nodes" Policy**

To prevent UI complexity creep, the application enforces a strict parameter-only interface for project editing.

* Users cannot see, add, or wire nodes.  
* Users cannot see traditional animation keyframes or dope sheets.  
* The entire interface is dynamically generated based on the GET /manifest response from the loaded template.

## **6\. Key Application Components**

### **6.1 The Live Viewport (Data Plane)**

* **Technology:** An HTML5 \<canvas\> element (potentially hardware-accelerated via WebGL).  
* **Data Flow:** The React frontend opens a **binary WebSocket** directly to `ws://127.0.0.1:8000/api/v1/viewport/stream` (not through Go bindings—Wails base64-encodes bound byte arrays).  
* **Rendering:** Receives raw JPEG/WebP byte arrays per PRD 3 wire format and paints them to the canvas at 30/60fps via `createImageBitmap` or equivalent.  
* **Interaction:** Includes basic playback controls (Play, Pause, Scrub) which send REQUEST_FRAME binary messages back over the WebSocket.

### **6.2 Dynamic Parameter Grid (Control Plane)**

* **Generation:** When a project is loaded, the UI parses the JSON manifest and auto-generates the inspector panel.  
* **Component Mapping:** The manifest `type` values are the canonical set defined in [`manifest.schema.json`](manifest.schema.json); the inspector maps each to a control:  
  * "type": "string" \-\> single-line Text Input; "type": "text" \-\> multi-line Text Area.  
  * "type": "color\_rgba" \-\> Color Picker.  
  * "type": "float" / "int" with "min"/"max" \-\> Slider; without bounds \-\> numeric input.  
  * "type": "bool" \-\> Toggle/Checkbox.  
  * "type": "enum", "options": \["Neon", "Flat"\] \-\> Dropdown.  
  * "type": "image" / "video" / "font" \-\> Asset picker (drag-drop + file dialog) routed through the §6.4 sandbox ingestion flow.  
* **Throttling:** Fast-changing UI elements (like dragging a slider) must be debounced/throttled before sending PATCH /parameters requests to prevent flooding the Blender Action Queue.

### **6.3 Slot-Based Timeline**

* **Concept:** A horizontal, block-based timeline track.  
* **Behavior:** Users drag edges of "Slots" to change their duration (e.g., making the "Intro" block last 3 seconds instead of 2).  
* **Translation:** The UI translates these UI blocks into absolute start/end timestamps and sends them via the API to the Python Engine, which calculates the required geometry node math under the hood.

### **6.4 Asset Manager & Local Ingestion**

* **Drag-and-Drop:** Users can drop .png, .mp4, or .ttf files directly into the Wails window.  
* **Processing Flow:** 1\. Go backend (`OnFileDrop`) intercepts the file and copies it to a secure local sandbox (e.g., \~/.moblend/assets/), hashing the file to prevent duplicates.  
  2\. Go generates a local file:// URI.  
  3\. The UI sends a PATCH /parameters request with the local URI to the API Broker.  
  4\. The Broker ingests the file into the active Blender session's memory.

## **7\. System Configuration & Security**

* **Config Files:** Advanced configuration (pointing the UI to a remote Mo.Blend cluster instead of localhost, or setting memory limits) is handled via the single canonical suite config file `<moblend_home>/config.json` — Windows `%USERPROFILE%\.moblend\config.json` (primary), Linux/macOS `~/.moblend/config.json`. This is the same file the engine and broker read (see PRD 1 §5 and PRD 3 §2.2). Edit it with any platform-appropriate text editor (Notepad/VS Code on Windows; `vi`/`nano` on Linux/macOS).  
* **Process Watchdog:** If the Mo.Blend Studio app closes unexpectedly, the Go backend must send a kill signal to the local Mo.Blend headless process to prevent orphaned Blender instances from consuming system RAM in the background. Go `os/exec` and signal handling are responsible for monitoring this lifecycle.  
* **Template Library Fetch:** When a user installs a template from the official library (`lib.moblend.dev` / PRD 7 registry), the Go backend streams the .mo.blend binary via `http.Get` to `~/.moblend/templates/`.
