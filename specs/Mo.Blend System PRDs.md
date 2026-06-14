# **Mo.Blend Ecosystem: Master Product Requirements Document**

## **Executive Summary & Architectural Overview**

The Mo.Blend ecosystem is a paradigm-shifting approach to motion graphics creation. Traditional tools like Adobe After Effects or standard Blender are incredibly powerful, but their steep learning curves, node-heavy interfaces, and complex keyframe timelines alienate casual users, marketers, broadcasters, and emerging AI agents.

Mo.Blend solves this by strictly decoupling the **Compute Engine** from the **User Interface**. By utilizing a locked-down, headless Blender instance as an invisible rendering backend, Mo.Blend enables front-end clients—ranging from lightning-fast desktop apps to chat-based LLM agents—to drive complex 3D animations using only simple, predefined parameters (like text strings, colors, and durations). The ecosystem relies on a robust, Git-based template registry to supply these parametric files (.mo.blend), ensuring high-quality, standardized output across all platforms.

## **Target Platforms**

| Platform | Priority | Notes |
|----------|----------|-------|
| **Windows** (x64) | Primary | All v1 development and CI targets Windows first (WebView2, Wails, Blender headless). |
| **Linux** (x64) | Secondary | Parity as needed; validate WebKit/GPU Eevee paths on target distros. |
| **macOS** (Apple Silicon) | Secondary | Parity as needed; universal/arm64 builds when desktop MVP is stable on Windows. |

Cross-platform APIs (REST, binary WebSocket on `127.0.0.1:8000`) are identical; platform-specific work is confined to process orchestration, paths, and Wails packaging.

## **Repository Map**

The Mo.Blend ecosystem spans one core monorepo and two external repositories:

| Repository | PRD(s) | Relationship |
|------------|--------|--------------|
| `MoBlend_Studio` (this repo) | 1–6 | Python/Go monorepo: headless engine, API broker, Wails desktop, OBS and Sentinel clients |
| `moblend-registry` | 7 | Separate GitOps template CDN; clients consume via `index.json` raw URLs |
| `MoBlend_TemplateInspector` | 8 | Separate Blender addon repo for template authors; publishes to the registry |

```
MoBlend_Studio/
├── engine/          # Python: bootstrap, moblend engine, FastAPI broker (PRD 1–3)
├── desktop/         # Wails app: Go backend + frontend/ (PRD 4)
├── clients/
│   ├── obs/         # PRD 5 — static HTML/JS for OBS CEF dock
│   └── sentinel/    # PRD 6 — placeholder; placement TBD
├── specs/
├── scripts/
└── ROADMAP.md
```

## **PRD 1: Blender Headless Integration (The Base Compute)**

**Objective:** Leverage official Blender distributions purely as a headless rendering and geometry node calculation engine, without any UI overhead. This layer represents the absolute bottom of the stack, responsible for raw mathematical computation and pixel generation.

**Core Features & Deep Dive:**

* **Headless Bootstrapping & CLI Invocation:** Executed entirely via the command-line interface. A standard invocation looks like blender \--background \--factory-startup \--python moblend\_engine.py.  
  * *Consequence of \--factory-startup:* This flag is absolutely critical. It prevents Blender from loading the host machine's startup.blend file or any user-installed add-ons. This guarantees that a .mo.blend template will render identically on a user's local Mac, a Windows streaming PC, or a Linux Kubernetes pod, eliminating the "it works on my machine" class of errors.  
* **Viewport Rendering via Eevee Next:** The system completely bypasses the computationally expensive Cycles path-tracer. Eevee Next provides real-time rasterization, utilizing the host machine's GPU to calculate frames instantly without ever spawning an OS-level window (X11/Wayland/Quartz).  
* **Graceful Termination & Signal Handling:** The process actively listens for OS-level interrupts (e.g., SIGINT, SIGTERM).  
  * *Implementation Detail:* When a kill signal is received, the script intercepts it, halts the render queue, and forces an emergency state dump to crash\_recovery.mo.blend. This ensures that even if the host machine forces a reboot, the user's unsaved parameter tweaks are preserved on disk.

**Technical Constraints & Hardware Implications:**

* **Unmodified Binaries:** The system must strictly use standard, unmodified Blender binaries downloaded directly from the Blender Foundation. We will *not* maintain a custom C++ fork. This ensures users benefit immediately from upstream performance patches and security updates.  
* **Thread Purging:** Must explicitly disable all auto-save and UI-related background threads native to standard Blender. Blender's internal undo-history buffer must also be heavily constrained or disabled to prevent RAM bloat during long-running sessions.

## **PRD 2: Mo.Blend Python Engine (The Brain)**

**Objective:** The core Python runtime that lives inside Blender's memory space. It acts as the intelligent translator between external API requests and Blender's internal data structures (bpy).

**Core Features & Deep Dive:**

* **File I/O, Recovery & Shadow Backups:** Implements a highly resilient manual save and periodic incremental backup system.  
  * *The Rotation Strategy:* When autosave triggers, it writes to foo.mo.blend.01. The next save writes to .02, up to .05, before wrapping back to .01. If the main file is corrupted by a power loss during writing, the engine automatically falls back to the most recent shadow copy, alerting the user via the API broker.  
* **Strict JSON Manifest Parser:** The engine reads and writes a strict JSON schema embedded directly into the .mo.blend file's custom scene properties.  
  * *Implication:* This manifest is the "API Contract" for the template. It maps high-level concepts (e.g., "primary\_color") to specific node graph coordinates (e.g., NodeGroup("LowerThird\_Logic").inputs\[4\]). This abstraction layer ensures that frontend UI developers never need to know how the Geometry Nodes are actually wired.  
* **Slot-Based Timeline Manager:** Eradicates traditional keyframes. Translates user-defined "Slots" (e.g., "Intro: 0-2s", "Hold: 2-5s", "Outro: 5-6s") into absolute frame ranges.  
  * *Mathematical Translation:* The Python engine drives a master "Time Override" Geometry Node. Instead of nodes reading scene.frame\_current directly, they read from this master node, which handles the complex easing and time-remapping logic required to dynamically stretch or compress animations based on the slot durations requested by the user.  
* **Dynamic Asset Ingestion & Garbage Collection:** Receives image/video URLs, downloads them to a temp cache, and patches them into the Blender material graph.  
  * *Memory Management:* The engine must actively garbage-collect unused images. If a user swaps a logo 10 times, the engine must execute bpy.data.images.remove() on the 9 orphaned images to prevent VRAM exhaustion.

## **PRD 3: MCP & API Server (The Broker)**

**Objective:** Expose the Mo.Blend Python Engine to the outside world (Desktop UI, Agents, Web) via a standardized, ultra-low-latency interface and the Model Context Protocol (MCP).

**Core Features & Deep Dive:**

* **In-Process Hosting & Thread Safety:** Runs directly inside Blender on a local port (e.g., 8000).  
  * *The Threading Solution:* Because Blender's bpy API is strictly single-threaded and not thread-safe, the ASGI web server (e.g., FastAPI) must run on a background thread. It communicates with Blender via a thread-safe queue.Queue. A bpy.app.timers loop runs on Blender's main thread every 0.01 seconds, polling the queue, executing the API commands safely, and returning the results to the web server's async futures.  
* **High-Performance Canvas Streaming (Data Plane):** Provides a **binary WebSocket** endpoint on the FastAPI broker (`ws://127.0.0.1:8000/api/v1/viewport/stream`). All browser-based clients (Wails webview, OBS CEF, Sentinel) connect directly to this socket for viewport frames. gRPC is reserved for a future **service-to-service** Kubernetes render-farm path—not for human-facing preview clients.  
  * *Why Binary matters:* Streaming base64-encoded strings across local IPC inflates payloads by 33% and forces client-side CPU decoding. By piping raw, unencoded JPEG/WebP byte arrays directly from Eevee's framebuffer, the UI achieves 60fps local rendering with near-zero latency, creating an illusion that the user is running a native 3D application.  
* **Agentic Operations (MCP Inspection):** Exposes an /inspect endpoint that yields the schema. This allows an LLM to "see" exactly what variables (colors, text, toggles) it is allowed to prompt against.  
* **Control Execution:** Endpoints for UpdateParameter, AddSlot, ExportVideo, and SaveProject handle the standard application state management.

**Future Horizontal Scaling (Kubernetes Foreshadowing):**

While the beta targets local 1:1 deployments, the API's stateless design (relying on the .mo.blend file as the absolute source of truth) perfectly positions it for cloud-native orchestration. Future iterations will allow Kubernetes StatefulSets to spin up headless Blender pods on-demand, transforming Mo.Blend into a high-throughput, cluster-based render farm for remote agentic workflows.

## **PRD 4: Wails Desktop UI (Mo.Blend Studio)**

**Objective:** A lightweight, blazing-fast desktop application built for casual motion designers. It completely obfuscates the underlying Blender engine, presenting a highly constrained, CapCut-style interface driven entirely by pre-configured templates.

**Core Features & Deep Dive:**

* **Mo.Blend Studio Suite Manager (The Hub):** Acts as a unified package manager for the ecosystem. It visually tracks the installation status, versions, and local paths of the Blender binary, the Python Engine, and the API Broker.  
  * *User Experience:* It provides one-click installations and runs health diagnostics (e.g., checking if port 8000 is blocked by another app), completely demystifying the complex backend architecture for non-technical users.  
* **Live Viewport Canvas:** An HTML5 \<canvas\> element (hardware-accelerated via WebGL) that paints the raw binary image stream piped from the API Broker.  
* **Dynamic Parameter Grid (The "No Nodes" Policy):** The UI is fundamentally a form-renderer. When a project loads, the frontend parses the JSON manifest and auto-generates the inspector panel.  
  * *Mapping Examples:* A manifest type of "string" yields a text input. "color\_rgba" yields a native color picker. "float" yields a slider.  
  * *Throttling Strategy:* To prevent flooding the Blender Action Queue and crashing the IPC pipe, fast-changing UI events (like scrubbing a timeline or dragging a color hue slider) are heavily debounced on the frontend before dispatching the PATCH /parameters HTTP request.  
* **Slot-Based Timeline Editor:** A horizontal, block-based UI track. Users visually drag the edges of "Slots" to change animation durations. The UI computes the absolute start/end timestamps and sends them to the engine.  
* **Asset Manager & Sandbox Bridging:** Drag-and-drop support for local images or .ttf fonts.  
  * *Security Implementation:* The Go backend intercepts dropped files via Wails `OnFileDrop`, copies them to a strict local sandbox (\~/.moblend/assets/), and hashes the file to prevent duplicates. It then passes a safe, normalized file:// URI to the API Broker.

## **PRD 5: OBS Extension Panel (The Broadcaster)**

**Objective:** An embedded HTML/JS dock inside OBS Studio that empowers live streamers to generate, customize, and trigger high-quality 3D alerts, stingers, and lower-thirds on the fly.

**Core Features & Deep Dive:**

* **Native CEF Integration:** Because OBS natively embeds the Chromium Embedded Framework (CEF) to power its Custom Browser Docks, this extension requires no heavy desktop framework. It is a lightweight web application that runs inside the broadcaster's existing OBS memory footprint.  
* **Streamlined "Quick Edit" UI:** Upon fetching the template catalog (GET /templates) and selecting an asset, the panel generates an ultra-minimal input form. Optimized for live-broadcast scenarios, it exposes only the most critical fields (e.g., Shoutout\_Name) while hiding deep structural parameters.  
* **The "Render & Inject" Pipeline (Zero-Touch Broadcasting):**  
  1. The panel sends a POST /render/export command, explicitly requesting RGBA (transparent) formatting.  
  2. The Mo.Blend API renders the asset in the background using Eevee Next to a temporary .webm file (utilizing the VP9 codec to support alpha channels).  
  3. Upon completion, the panel leverages the local obs-websocket-js library to automatically create a "Media Source" in the active OBS Scene, inject the .webm path, and trigger immediate playback.  
* **Auto-Cleanup & Optimization:** The panel instructs the API to aggressively delete temporary .webm files after playback completes, preventing hard drive bloat during marathon 12-hour streams.

## **PRD 6: Sentinel Kit UI (The Agent Workspace)**

**Objective:** A specialized, highly interactive chat-and-canvas interface where users can generate, iterate, and refine high-quality motion graphics purely through natural language. By acting as a sophisticated MCP (Model Context Protocol) Client, the Sentinel Kit UI empowers an LLM to autonomously act as a virtual technical artist.

**Core Features & Deep Dive:**

* **Hybrid Networking Architecture:**  
  * *The Control Plane (REST/SSE):* All agentic tool calling, chat history, and state synchronization occur over standard HTTP. This strict adherence to the MCP specification ensures seamless integration with any compliant LLM ecosystem.  
  * *The Data Plane (Binary WebSocket):* When the LLM requests a visual update, the resulting unencoded JPEG/WebP byte arrays bypass the text-based chat stream entirely. They are piped over the viewport WebSocket directly into the browser's memory, allowing the canvas to paint the 3D viewport instantly without suffering the massive latency of base64 string decoding.  
* **Prompt-to-Project Workflow:**  
  * *Example Trace:* User says, "Make a neon tech review lower third for @TechAlex." The LLM calls moblend\_list\_templates, selects "LowerThirds-Cyberpunk", inspects the manifest, maps the handle to sub\_text, infers a neon color palette (primary\_color: \#00FFFF), and calls moblend\_apply\_parameters. The UI immediately streams the result to the canvas.  
* **Iterative Refinement & Delta Updates:** When the user replies "Make it green instead," the LLM relies on its active context window containing the current JSON state. It surgically pushes a delta update ({"primary\_color": "\#00FF00"}) via the API, preventing a full, destructive regeneration of the scene.  
* **Token Economy & Context Management:** Continuous iteration on templates with dozens of parameters will quickly exhaust an LLM's context window. The UI employs a smart-truncation sliding window, stripping out stale JSON manifests and old parameter dumps, preserving only the *current* active state and the user's overarching creative intent.  
* **State Inspector (Educational Bridge):** An inline JSON diff viewer sits alongside the chat. This transparently shows the user exactly which sliders the AI moved, building trust and teaching casual users how the underlying templates actually function.

## **PRD 7: Mo.Blend Template Repository (The Registry)**

**Objective:** To establish the official, centralized community library for .mo.blend templates. The registry bridges the gap between advanced technical artists (who build complex node graphs) and casual end-users or AI agents (who simply want to generate content).

**Core Features (Beta / Launch Phase):**

* **GitOps Architecture:** Operates entirely as a formalized public Git repository (e.g., GitHub or GitLab). This lean approach prioritizes rapid iteration, relies on proven infrastructure for version control, and allows enterprise studios to easily fork the structure for private, proprietary registries.  
* **Strict Directory & Artifact Schema:** Every template must contain exactly three files:  
  1. \[name\].mo.blend: The optimized binary Blender file.  
  2. \[name\].manifest.json: The translation layer defining exposed parameters.  
  3. \[name\].webp: A lightweight (sub-2MB), looping animated preview.  
* **Automated Master Indexing (index.json):** A CI runner (e.g., GitHub Actions) triggers on every merge to the main branch. It crawls the repository, validates all manifests, and compiles a flattened index.json catalog. Clients fetch *only* this lightweight JSON file on startup, preventing massive API overhead when loading the UI gallery.  
* **PR-Driven Contributions & Automated Security:**  
  * *Security AST Scan:* Because arbitrary Python execution inside .blend files is a severe vulnerability, a headless CI script parses the submitted .mo.blend binary *without executing it*. It enforces the use\_scripts\_auto\_execute \= False flag and performs an Abstract Syntax Tree (AST) scan to flag and block any embedded Python driver scripts.  
  * *Asset Optimization Checks:* Automatically rejects PRs if the .mo.blend exceeds 50MB, enforcing lean geometry and preventing repository bloat.  
* **Direct Edge Fetching:** Client applications bypass complex backend APIs by pulling templates directly from the Git repository's raw CDN links (raw.githubusercontent.com). The Mo.Blend Studio Go backend streams the binary directly to the local disk cache.

**Future Vision (Post-Beta):**

As the ecosystem scales, the Git-backed registry will evolve into a dedicated cloud platform. This will introduce a searchable web portal with interactive WebGL previews, creator namespaces (e.g., @motion-ninja/corporate-pack), semantic versioning to guarantee backward compatibility, and DRM/Monetization support for professional motion designers to sell premium templates.

## **PRD 8: Mo.Blend Template Inspector (External — Blender Addon)**

**Objective:** A native Blender addon for advanced creators and template authors. It validates manifests, previews the casual-user experience, and packages templates for submission to the registry.

**Repository:** `MoBlend_TemplateInspector` (separate repo; not yet created). See the External Repositories table above.

**Summary:** The addon provides manifest generation/validation from Geometry Node sockets, a mock Mo.Blend Desktop UX sandbox inside Blender, and a one-click publish prep pipeline (sanitization, size optimization, .zip packaging). Full specification will live in that repository when development begins. This track is parallel to the core monorepo and does not block M0–M3.