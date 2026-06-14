# **Mo.Blend API & Core Function Specification**

This document defines the strict communication contracts between the Mo.Blend Python Engine, the external UI/clients, and Agentic workflows (MCP).

## **1\. Internal Engine API (Python / bpy Wrappers)**

These are the native Python functions running inside the Headless Blender process. The Network/REST server calls these directly.

### **File & State Management**

* engine.load\_template(filepath: str) \-\> dict  
  * *Action:* Clears current bpy.data, loads the .mo.blend file, and parses the JSON manifest.  
  * *Returns:* The parsed JSON manifest.  
* engine.save\_project(filepath: str, incremental: bool \= True) \-\> str  
  * *Action:* Triggers bpy.ops.wm.save\_as\_mainfile. If incremental is true, manages the .01, .02 shadow backups.  
  * *Returns:* The path to the successfully saved file.

### **Parameter Mutation**

* engine.set\_parameter(param\_id: str, value: any) \-\> bool  
  * *Action:* Looks up param\_id in the manifest. Translates value to the expected Blender data type (e.g., hex color to RGBA float array). Mutates the target Geometry Node socket via bpy.  
* engine.ingest\_asset(param\_id: str, source\_url: str) \-\> bool  
  * *Action:* Downloads the asset to the platform temp cache (`%TEMP%\moblend_assets\` on Windows, `/tmp/moblend_assets/` on Linux/macOS; see PRD 2 §5). Creates a Blender Image/Vector data block. Plugs the data block into the node specified by param\_id in the manifest.

### **Timeline & Execution**

* engine.set\_slot(index: int, start\_time: float, end\_time: float, preset\_id: str \= None)  
  * *Action:* Updates the master time-driving Geometry Node, instructing it to run a specific animation preset during the specified time bounds.  
  * *`preset_id`:* Optional identifier of a named animation behavior declared by the template manifest under `slot_presets` (e.g. `"fade_in"`, `"slide_left"`). When `None`, the slot keeps its current/default preset and only its time bounds change. Unknown preset IDs are rejected.  
* engine.render\_frame(frame\_number: int) \-\> bytes  
  * *Action:* Forces an Eevee render update for the specific frame.  
  * *Returns:* Raw binary image data (JPEG or WebP).  
* engine.list\_templates() \-\> list\[dict\]  
  * *Action:* Returns the registry catalog by reading the cached `index.json` (see the Network Broker `GET /api/v1/templates` endpoint). This is a broker-level helper that does **not** touch `bpy`; it never downloads binaries, only catalog metadata.

## **2\. Network Broker API (REST & WebSocket)**

This is the server exposed on `127.0.0.1:8000` (or over the network when explicitly enabled) for Mo.Blend Studio (Wails), OBS panels, and Sentinel agents.

**Note:** The API contract is language-agnostic. The broker is implemented in Python (FastAPI inside Blender); clients may be HTML/JS (Wails webview, OBS, Sentinel) or any MCP-compliant agent. Viewport preview uses **binary WebSocket only** in v1; gRPC is not exposed to browser clients.

All request and response bodies are JSON. The manifest returned by `GET /api/v1/manifest` conforms to [`manifest.schema.json`](manifest.schema.json) (the canonical Mo.Blend manifest schema). Errors use the standard envelope defined below.

* **GET /api/v1/manifest**  
  * *Returns:* 200 OK with the JSON manifest of the currently loaded project (conforms to `manifest.schema.json`).  
* **POST /api/v1/project/load**  
  * *Payload:* { "template\_path": "repo/lower-thirds-ninja.mo.blend" }  
  * *Response:* 200 OK with the loaded manifest.  
* **POST /api/v1/project/save**  
  * *Payload:* { "incremental": true }  
  * *Action:* Flushes in-memory state to disk. When `incremental` is true, rotates the `.01`–`.05` shadow backups (see PRD 2 §2.2); when false, overwrites the canonical project file and clears the dirty flag.  
  * *Response:* `200 OK` with `{ "path": "...saved file path...", "dirty": false }`.  
* **PATCH /api/v1/parameters**  
  * *Payload:* { "updates": \[ { "id": "headline\_text", "value": "Live Now" } \] }  
  * *Response:* 200 OK (Indicates bpy successfully updated the graph).  
* **PATCH /api/v1/slots**  
  * *Payload:* { "slots": \[ { "index": 0, "start\_time": 0.0, "end\_time": 2.0, "preset\_id": "fade\_in" } \] }  
  * *Action:* Maps to `engine.set_slot` for each entry. `preset_id` is optional (see Internal Engine API). Times are seconds; the engine converts to frames via the project fps.  
  * *Response:* 200 OK.  
* **GET /api/v1/templates**  
  * *Action:* Returns the registry catalog (the broker's cached copy of the registry `index.json`). This is the **single authoritative listing** consumed by all clients (Wails gallery, OBS dropdowns) and by the `moblend_list_templates` MCP tool. The broker fetches/caches `index.json` from the configured registry URL; clients do not each re-implement registry crawling. (The Wails Go backend may still fetch `index.json` directly when streaming binaries to the local disk cache — that is an install/download concern, separate from this catalog read. See PRD 7 §5.)  
  * *Returns:* 200 OK with the flattened catalog array.  
* **POST /api/v1/render/export**  
  * *Payload:* { "format": "webm", "transparent": true, "fps": 60, "resolution": \[1920, 1080\] }  
  * *Response:* `202 Accepted` with `{ "job_id": "..." }`.  
* **GET /api/v1/render/status/{job\_id}**  
  * *Action:* Polled by clients to track an async export job kicked off by `render/export`.  
  * *Returns:* `200 OK` with a body of shape `{ "job_id": "...", "status": "queued|running|done|error", "progress": 0.0-1.0, "eta_seconds": number-or-null, "result_path": "absolute path when status=done, else null", "error": "message when status=error, else null" }`. The `result_path` is the absolute local path of the finished artifact, consumed by the OBS "Render & Inject" pipeline (PRD 5 §3.3).

### **Standard Error Envelope**

All non-2xx REST responses return a single, consistent JSON shape so clients can handle errors uniformly:

```jsonc
{
  "error": {
    "code": "string_machine_code",   // e.g. "validation_failed", "queue_full", "not_found"
    "message": "Human-readable description.",
    "details": { }                     // optional, endpoint-specific context
  }
}
```

| HTTP status | `error.code` | When |
|-------------|--------------|------|
| 404 Not Found | `not_found` | Unknown job ID, template, or parameter ID |
| 422 Unprocessable Entity | `validation_failed` | Payload fails manifest/type validation (see PRD 3 §3.1) |
| 429 Too Many Requests | `queue_full` | Action queue backpressure (see PRD 3 §2.1) |
| 503 Service Unavailable | `engine_unavailable` | Blender engine not yet ready or shutting down |

### **Viewport Stream (Data Plane — Binary WebSocket)**

* **Endpoint:** `WS /api/v1/viewport/stream` on the same host/port as REST (default `ws://127.0.0.1:8000/api/v1/viewport/stream`).
* **Transport:** Bidirectional WebSocket with **binary frames only** for viewport messages (see PRD 3 §3.2 for wire format).
* **Client → server:** REQUEST_FRAME (`0x01`) — frame number, width, height, format (JPEG/WebP), flags.
* **Server → client:** FRAME (`0x02`) — frame number, dimensions, format, payload length, compressed image bytes.
* **Server → client:** ERROR (`0xFF`) — UTF-8 error message.
* **Action:** Client requests a frame; server enqueues render on the Blender action queue; response carries Eevee output as JPEG (opaque) or WebP (alpha).
* **Rules:** Clients connect directly from the browser/webview. Do not proxy frames through Wails Go bindings. Drop stale frames when scrubbing.

### **Future: gRPC (Kubernetes workers only)**

* **Not used in v1.** Reserved for pod-to-pod render orchestration in a future horizontal-scaling deployment. Browser clients will always use REST + WebSocket.

## **3\. Model Context Protocol (MCP) Tools**

These tools are exposed to Sentinel/LLMs to allow autonomous video generation and modification.

### **Tool: moblend\_list\_templates**

* **Description:** Lists the templates available in the registry so the agent can choose one before inspecting it. Backed by `GET /api/v1/templates` (the broker's cached `index.json`); returns catalog metadata only — no binaries are downloaded.  
* **Parameters:**  
  * category (string, optional): Filter by registry category (e.g. `"lower-thirds"`, `"alerts"`, `"transitions"`).  
  * query (string, optional): Free-text match against template name/description/tags.  
* **Returns:** An array of catalog entries, each with `template_id`, `name`, `category`, `description`, `preview_url`, and the exposed parameter summary.

### **Tool: moblend\_inspect\_template**

* **Description:** Reads a .mo.blend template file and returns its manifest, explaining what parameters can be altered.  
* **Parameters:**  
  * template\_name (string, required): The name of the template in the registry.

### **Tool: moblend\_apply\_parameters**

* **Description:** Modifies the visual properties of the currently loaded template.  
* **Parameters:**  
  * parameters (object, required): Key-value pairs matching the IDs from the manifest. Example: {"primary\_color": "\#FF0055", "headline\_text": "Agent Generated"}.

### **Tool: moblend\_render\_preview**

* **Description:** Renders a still frame of the current state for the agent to analyze or show the user.  
* **Parameters:**  
  * time\_seconds (float, optional): The specific timestamp to render. Defaults to 0.0.  
  * resolution\_scale (float, optional): e.g., 0.5 for a faster, half-res preview.
