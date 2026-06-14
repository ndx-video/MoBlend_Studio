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
  * *Action:* Downloads the asset to /tmp/moblend\_assets/. Creates a Blender Image/Vector data block. Plugs the data block into the node specified by param\_id in the manifest.

### **Timeline & Execution**

* engine.set\_slot(index: int, start\_time: float, end\_time: float, preset\_id: str \= None)  
  * *Action:* Updates the master time-driving Geometry Node, instructing it to run a specific animation preset during the specified time bounds.  
* engine.render\_frame(frame\_number: int) \-\> bytes  
  * *Action:* Forces an Eevee render update for the specific frame.  
  * *Returns:* Raw binary image data (JPEG or WebP).

## **2\. Network Broker API (REST & WebSocket)**

This is the server exposed on `127.0.0.1:8000` (or over the network when explicitly enabled) for Mo.Blend Studio (Wails), OBS panels, and Sentinel agents.

**Note:** The API contract is language-agnostic. The broker is implemented in Python (FastAPI inside Blender); clients may be HTML/JS (Wails webview, OBS, Sentinel) or any MCP-compliant agent. Viewport preview uses **binary WebSocket only** in v1; gRPC is not exposed to browser clients.

### **REST Endpoints (Control Plane)**

* **GET /api/v1/manifest**  
  * *Returns:* 200 OK with the JSON manifest of the currently loaded project.  
* **POST /api/v1/project/load**  
  * *Payload:* { "template\_path": "repo/lower-thirds-ninja.mo.blend" }  
* **PATCH /api/v1/parameters**  
  * *Payload:* { "updates": \[ { "id": "headline\_text", "value": "Live Now" } \] }  
  * *Response:* 200 OK (Indicates bpy successfully updated the graph).  
* **POST /api/v1/render/export**  
  * *Payload:* { "format": "webm", "transparent": true, "fps": 60, "resolution": \[1920, 1080\] }  
  * *Response:* 202 Accepted (Returns a job ID for polling).

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