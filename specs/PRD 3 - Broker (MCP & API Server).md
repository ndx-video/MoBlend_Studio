# **PRD 3: Broker (MCP & API Server)**

## **1\. Objective**

To serve as the highly performant, standardized communication layer between the Mo.Blend Python Engine (PRD 2\) and all external interfaces (including the Wails Desktop UI, OBS embedded panels, and Sentinel LLM Agents).

The Broker acts as a strict, headless API gateway. It intentionally isolates the fragile, single-threaded Blender C++ core from the chaotic nature of external network requests. By exposing a structured REST API for control commands, a low-latency binary stream for real-time viewport rendering, and a Model Context Protocol (MCP) interface for agentic operations, the Broker ensures that external clients never need to understand Blender's internal architecture to generate high-end motion graphics.

## **2\. Server Architecture & Thread Safety**

### **2.1 The Threading Problem & Solution (The Action Queue)**

Blender’s internal API (bpy) is strictly single-threaded and notoriously unforgiving; any attempt to mutate .blend data or trigger a render from a background thread will result in an immediate, hard segmentation fault. Standard asynchronous web servers run on background threads, making direct integration impossible. To solve this, the Broker implements a strict Producer-Consumer architecture:

* **The Web Thread (Producer):** Hosts the HTTP/WebSocket server (FastAPI + uvicorn) using an ASGI event loop. It receives incoming network requests, parses JSON payloads, validates them against the template manifest, and pushes a task object into a thread-safe Python queue.Queue. It then yields an asyncio.Future and waits.  
* **The Blender Timer (Consumer):** A specialized script utilizing bpy.app.timers runs continuously on Blender's main thread (e.g., executing every 0.01 seconds). It polls the Action Queue. If a task exists, it executes the command safely within the bpy context, updates the dependency graph, and resolves the awaiting asyncio.Future with the result.  
* **Backpressure Management:** If the queue exceeds a predefined capacity (e.g., due to a client sending hundreds of parameter updates per second without debouncing), the Web Thread immediately returns a 429 Too Many Requests HTTP status, preventing memory exhaustion and preserving Blender's stability.

### **2.2 Framework Selection & Lifecycle**

* **Core Framework:** FastAPI (running via the uvicorn ASGI server) is the mandated framework for the REST and WebSocket/SSE planes. It provides native async support, exceptionally low overhead, and automatically generates OpenAPI (Swagger) documentation, which is crucial for third-party developers building custom Mo.Blend integrations.  
* **Process Lifecycle:** The API Server is booted from within the moblend\_engine.py script immediately after Blender finishes its headless initialization.  
* **Port Binding & Config:** Defaults to localhost:8000. This is configurable via CLI arguments (--moblend-port) or the single canonical suite config file `<moblend_home>/config.json` (Windows `%USERPROFILE%\.moblend\config.json`, Linux/macOS `~/.moblend/config.json` — the same file the engine and desktop app read; see PRD 1 §5). There is no separate `server_config.json`.  

### **2.3 Future Horizontal Scaling (Kubernetes)**

While the beta architecture operates primarily as a 1:1 local instance (one UI attached to one local Blender process), the stateless nature of the REST API explicitly foreshadows cloud-native orchestration.

Because the entire state of a project is encapsulated in the .mo.blend file and requested assets, the Broker API contains zero local session state. Future iterations will support deployment via Kubernetes, utilizing StatefulSets to horizontally scale headless Blender pods on-demand. **Pod-to-pod orchestration may use gRPC** for typed worker RPC; **browser and Wails clients will continue to use REST + binary WebSocket** regardless of deployment topology.

## **3\. The Three Communication Planes**

### **3.1 Control Plane (REST API)**

The Control Plane handles standard application state, routing structured JSON payloads to the engine while enforcing strict schema validation.

* **State Management:** \* POST /api/v1/project/load: Swaps the active template environment.  
  * POST /api/v1/project/save: Flushes the current in-memory state to the local disk, managing the incremental .01, .02 shadow backups.  
* **Manifest Delivery (GET /api/v1/manifest):** Allows external clients to dynamically generate their UI. Mo.Blend Studio (Wails) uses this to paint its property inspector, ensuring the UI always perfectly matches the specific parameters exposed by the loaded template. The returned document conforms to the canonical [`manifest.schema.json`](manifest.schema.json).  
* **Template Catalog (GET /api/v1/templates):** Returns the broker's cached copy of the official library catalog (`index.json` from `moblend-registry` backing `lib.moblend.dev`) — the single authoritative listing consumed by all clients and the `moblend_list_templates` MCP tool. See the [API & Function Spec §2](Mo.Blend%20API%20%26%20Function%20Spec.md) and PRD 7 §5 for the library-fetch ownership split.  
* **Timeline (PATCH /api/v1/slots):** Updates slot time bounds and optional `preset_id` values; maps to `engine.set_slot`.  
* **Parameter Mutation (PATCH /api/v1/parameters):** Accepts an array of delta changes.  
  * *Pre-flight Validation:* Before the payload ever reaches the Blender Action Queue, FastAPI validates the data types against the JSON manifest. If a client attempts to pass a string "blue" to a parameter expecting a color\_rgba float array, the Broker rejects it immediately with a 422 Unprocessable Entity, protecting the engine.  
* **Async Task Handoff (POST /api/v1/render/export):** Kicks off heavy, multi-frame video rendering jobs. Because rendering a 10-second animation can take minutes, this endpoint immediately returns a 202 Accepted alongside a unique job\_id. Clients then poll GET /api/v1/render/status/{job\_id} to receive live progress percentages and estimated time remaining.

### **3.2 Data Plane (Low-Latency Viewport)**

The Data Plane handles the real-time visual feedback loop for Mo.Blend Studio (Wails), OBS panels, and Sentinel. It uses a **binary WebSocket** on the same FastAPI/uvicorn server as the REST control plane. gRPC is **not** used for viewport preview—browser engines (Wails WebView2/WebKit, OBS CEF) cannot speak native gRPC without a grpc-web proxy, and Wails Go→JS bindings base64-encode binary payloads, making them unsuitable for frame streaming.

**Why WebSocket, not gRPC (v1):**

* Native bidirectional binary support in all target clients without extra proxies.
* Single process/port (`127.0.0.1:8000`) alongside REST and MCP.
* JPEG still frames decode and paint immediately on `<canvas>` with minimal latency.
* gRPC remains an option later for **Kubernetes worker-to-worker** RPC only.

**Endpoint:** `WS /api/v1/viewport/stream`

**Protocol & Transport:** Persistent WebSocket; all messages are **binary frames** (not JSON text frames).

**Client → server (frame request)** — 13-byte header, little-endian:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 | `msg_type` = `0x01` (REQUEST_FRAME) |
| 1 | 4 | `frame_number` (uint32) |
| 5 | 2 | `width` (uint16) |
| 7 | 2 | `height` (uint16) |
| 9 | 1 | `format` — `0`=JPEG, `1`=WebP |
| 10 | 1 | `flags` — bit0: drop if stale (scrubbing) |
| 11 | 1 | `protocol_version` — wire-format version, currently `1` |
| 12 | 1 | reserved |

**Server → client (frame response)** — variable length:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 1 | `msg_type` = `0x02` (FRAME) |
| 1 | 4 | `frame_number` (uint32) |
| 5 | 2 | `width` (uint16) |
| 7 | 2 | `height` (uint16) |
| 9 | 1 | `format` — `0`=JPEG, `1`=WebP |
| 10 | 4 | `payload_length` (uint32) |
| 14 | N | compressed image bytes |

**Server → client (error)** — `msg_type` = `0xFF`, followed by uint16 UTF-8 error code length and message.

**Protocol versioning:** The `protocol_version` byte in REQUEST_FRAME lets the wire format evolve in lock-step with the REST `/api/v1` surface. The current version is `1`. If a client sends a `protocol_version` the broker does not support, the broker replies with an ERROR (`0xFF`) message rather than guessing. Reserved header bytes default to `0`.

**Frame addressing (`frame_number` vs `time_seconds`):** The binary protocol addresses frames by absolute `frame_number` (uint32). The MCP `moblend_render_preview` tool accepts `time_seconds` (float) for agent convenience; the broker converts it to a frame via `frame = round(time_seconds × project_fps)` before enqueueing. There is one canonical frame index; seconds are a convenience input only.

**Execution Flow:**

1. Client opens WebSocket to `ws://127.0.0.1:8000/api/v1/viewport/stream`.
2. Client sends a binary REQUEST_FRAME message.
3. The Web Thread enqueues a render task; the Blender Timer executes Eevee Next on the main thread.
4. The engine compresses the framebuffer to JPEG (opaque Studio preview) or WebP (alpha for OBS).
5. Server sends a binary FRAME message; client paints via `createImageBitmap` or `Blob` + `drawImage` on `<canvas>`.
6. On scrub/rapid requests, client sets the drop-if-stale flag; server may skip superseded queued frames.

**Client connection rules:**

* Wails **frontend** connects directly to the broker WebSocket—**not** via Go bindings (avoid base64 IPC overhead).
* Target **30 fps** locally; **60 fps** when Eevee and encode keep up.
* Disable WebSocket permessage-deflate for localhost (CPU cost outweighs benefit on loopback).

**Strict Avoidance of Base64:** Streaming frames as base64 strings inflates payloads by ~33% and forces decode on the client CPU. Binary WebSocket frames go straight to canvas decode paths.

### **3.3 Agent Plane (Model Context Protocol)**

This plane implements the standardized MCP JSON-RPC specification, allowing advanced LLMs (like Sentinel) to interact with Mo.Blend seamlessly as autonomous technical artists.

* **Transport Layer:** Utilizes Server-Sent Events (SSE) over HTTP for remote agents, or standard input/output (stdio) if the agent wrapper is running locally alongside the server.  
* **Exposed Tools & LLM Strategy:**  
  * moblend\_list\_templates: Lists templates from the official library at `lib.moblend.dev` (backed by `GET /api/v1/templates` — the cached `index.json` from `moblend-registry`) so the agent can pick one before inspecting it. Returns catalog metadata only; no binaries are downloaded. See the full tool contract in the [API & Function Spec §3](Mo.Blend%20API%20%26%20Function%20Spec.md).  
  * moblend\_inspect\_template: Yields the schema of available parameters (conforms to [`manifest.schema.json`](manifest.schema.json)). The LLM must call this to understand the mathematical boundaries and options of the active graphic before attempting edits.  
  * moblend\_apply\_parameters: Safely applies LLM-generated parameter changes. The LLM is instructed to only send *delta updates* (parameters that differ from the current state) to conserve token usage and execution time.  
  * moblend\_render\_preview: Triggers a still render and returns a temporary local URL or a compressed image payload. This allows the LLM's associated Vision-Language Model to "see" its work and self-correct alignment or color-clashing issues autonomously.

## **4\. Security & CORS Constraints**

Because the Mo.Blend API has the power to write files (renders) and download external assets to the local machine, its security posture must be airtight.

* **Local-First Default:** The uvicorn server must bind strictly to 127.0.0.1 by default. Exposing the server beyond loopback (for remote network access such as the OBS dual-PC setup in PRD 5 §4) requires an explicit CLI flag override (`--bind-public`) and will trigger a prominent terminal warning.  
* **Authentication (required for any non-loopback bind):** When the server is loopback-only, no token is required (the OS already isolates the socket to the local user). The moment `--bind-public` is used, the broker **must** require a bearer token on every REST request and as a query/subprotocol token on the viewport WebSocket:  
  * A shared secret is generated (or read from `<moblend_home>/config.json`) at startup and printed once to the operator's console.  
  * Requests without a valid `Authorization: Bearer <token>` header are rejected with `401`. WebSocket upgrades without the token are refused.  
  * This closes the gap where the PRD 5 dual-PC scenario would otherwise expose a fully unauthenticated file-writing, asset-downloading engine to the LAN. The same token must be configured in the OBS panel (see PRD 5 §4).  
* **CORS Policies:** Cross-Origin Resource Sharing is strictly enforced. The API will outright reject browser preflight requests unless they originate from explicitly whitelisted domains. By default, only local UI origins (e.g., `http://wails.localhost` for Wails production builds, `http://localhost:<dev-port>` for Wails development, and local OBS panel domains) are permitted. When `--bind-public` is set, the operator must explicitly add the remote panel origin to the allowlist; wildcard (`*`) origins are never permitted.  
* **Asset Validation & SSRF Prevention:** Endpoints that accept external URLs (like downloading a user's logo for ingestion into a graphic) are prime targets for Server-Side Request Forgery (SSRF). The broker must:  
  * Enforce strict MIME-type sniffing (magic-number validation) before and after download to ensure the file is actually an image, video, or font — not a disguised payload.  
  * Enforce strict file-size limits (e.g., max 10MB) to prevent denial-of-service via massive downloads.  
  * **Block requests to non-public hosts:** resolve the target hostname and reject any address in loopback (`127.0.0.0/8`, `::1`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), link-local (`169.254.0.0/16`, `fe80::/10`), and cloud metadata ranges (notably `169.254.169.254`). Apply this check to the initial URL **and** to every hop.  
  * **Disallow following redirects to blocked hosts** — re-validate the destination of each 3xx redirect against the rules above (a public URL that 302-redirects to `169.254.169.254` must be refused).  
  * Quarantine downloads to a temporary directory (see PRD 2 §5) and wipe them on session exit.
