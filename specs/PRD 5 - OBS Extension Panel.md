# **PRD 5: OBS Extension Panel (The Broadcaster)**

## **1\. Objective**

To provide an embedded, lightweight HTML/JS custom browser dock for **OBS Studio** that empowers live streamers and broadcast producers to generate, customize, and trigger high-quality 3D/Motion Graphics assets (lower-thirds, stingers, event alerts, and shoutouts) entirely on the fly.

Traditionally, live broadcasters are restricted to using pre-rendered, static video files (.webm or .mov) or flat, CSS-based web alerts. If a streamer wants a 3D metallic logo that dynamically extrudes a specific subscriber's name, they previously had to manually render it in After Effects—a process impossible during a live broadcast. The Mo.Blend OBS Extension abstracts the complex rendering pipeline, allowing a streamer to input text into a simple UI and immediately see a bespoke, broadcast-quality 3D asset appear seamlessly on their live stream.

## **2\. Core Architecture**

The extension is designed as a stateless web application executing securely inside OBS Studio's built-in browser engine (CEF \- Chromium Embedded Framework). Because OBS is already running CEF to power other web sources, this approach requires zero additional framework overhead (no Electron, Tauri, or Wails required), preserving precious CPU/RAM resources for the broadcaster's game or primary capture.

It acts as the intelligent bridge between two locally hosted services:

1. **The Mo.Blend API Broker (localhost:8000):** The engine defined in PRD 3\. It parses the .mo.blend templates, translates UI inputs into mathematical geometry node mutations, and orchestrates the headless Blender rendering pipeline.  
2. **The OBS WebSocket Server (v5.x, localhost:4455):** The native OBS protocol that allows external applications to manipulate the broadcast. It handles the injection, sizing, scene placement, and playback triggering of the final rendered media.

## **3\. Key Workflows & Features**

### **3.1 Template Browser & Caching**

* **Dynamic Catalog:** The panel queries the Mo.Blend API (`GET /api/v1/templates`) to fetch available broadcast-specific .mo.blend templates. These are categorized by broadcast utility (e.g., "Alerts", "Stingers/Transitions", "Lower-Thirds", "BRB Screens").  
* **Visual Thumbnails:** Templates are displayed as a compact visual grid optimized for the narrow vertical layout typical of OBS docks. To ensure instant loading, the panel relies on the lightweight .webp thumbnails generated for the official template library (`lib.moblend.dev` / PRD 7), caching them in the CEF local storage.

### **3.2 The Quick Edit UI**

* **Context-Aware Forms:** Upon selecting a template, the panel fetches its specific JSON manifest (`GET /api/v1/manifest`) and generates a minimal input form.  
* **Broadcast-Optimized Constraints:** Unlike the expansive Desktop Studio UI (PRD 4), this interface is ruthlessly optimized for speed during a live, high-pressure broadcast. Deep structural parameters are hidden. Only critical, highly variable inputs are exposed—such as a Shoutout\_Name text field, a Sub\_Tier dropdown, or a Primary\_Color picker to match a raiding channel's brand.

### **3.3 The "Render & Inject" Pipeline (Zero-Touch Delivery)**

This sequence represents the core magic of the extension. When the broadcaster clicks **"Generate & Play"**, the following automated pipeline executes:

1. **The Hash Check (Deduplication):** The panel hashes the requested parameters. If the streamer is triggering the exact same "Be Right Back" screen they used an hour ago, the panel skips rendering and instantly replays the existing cached file.  
2. **The Render Request:** The panel sends a `POST /api/v1/render/export` command to the Mo.Blend API.  
   * *Critical Parameter:* The request explicitly mandates format: "webm" and transparent: true. It also defines the target framerate (e.g., 60fps) to match the OBS canvas.  
3. **Headless Generation:** The Mo.Blend Python engine calculates the nodes and renders the frames via Eevee Next, utilizing the VP9 codec to preserve the alpha channel, writing the output to an ephemeral .webm file in a temporary directory.  
4. **Job Polling & Injection:** `render/export` returns `202 Accepted` with a `job_id`; the panel polls `GET /api/v1/render/status/{job_id}` until `status: "done"` and reads `result_path`. It then uses the obs-websocket-js library to manipulate the live broadcast:  
   * It checks if a dedicated "Mo.Blend Overlays" scene or group exists. If not, it creates one.  
   * It creates a new ffmpeg\_source (Media Source) or updates the existing one, ensuring properties like hw\_decode (Hardware Decoding) are enabled.  
   * It sets the source's local file path to the newly rendered .webm and forces the playback state to Restart.  
   * It manipulates the Scene Item Transform to ensure the graphic is perfectly aligned (e.g., anchoring a lower-third to the bottom-left of the 1080p canvas).

### **3.4 Auto-Cleanup & Disk Management**

* Because uncompressed or lightly-compressed 60fps WebM files with alpha channels can be massive, a 12-hour stream could easily exhaust a broadcaster's SSD.  
* The panel instructs the Mo.Blend API to actively garbage-collect. Once a media source finishes playing (detected via OBS WebSocket events), the underlying temporary .webm render file is deleted from the disk cache.

## **4\. Technical Constraints & Hardware Considerations**

* **Transparency Requirement:** Eevee Next must be strictly configured in the API engine to output RGBA data. If the background renders as solid black instead of transparent, it will entirely occlude the streamer's gameplay, ruining the broadcast.  
* **GPU Contention Management:** Streaming PCs are already under immense GPU load (handling heavy gaming, NVENC video encoding, and OBS compositing). Mo.Blend's Eevee Next renders must not cause the primary stream to drop frames. The API Broker must allow configuration to throttle Eevee's thread priority or limit its render speed (e.g., rendering a 5-second alert over the course of 15 seconds in the background before playing it) to protect the live broadcast's stability.  
* **Configuration & Portability:** Connection settings (API Port, OBS WebSocket Password, Mo.Blend bearer token, Target Scene names) are persisted in the CEF browser dock's `localStorage`.  
  * *Credential-storage caveat:* `localStorage` is **plaintext** and readable by any script running in the dock and by anyone with local disk access — it is not a secure secret store. Treat the OBS WebSocket password and the Mo.Blend bearer token as low-trust, machine-local secrets: prefer entering them per-session, scope/rotate them, and never commit a profile containing them. (A future hardening option is to proxy these through the host rather than persisting them in the dock.)  
  * *Dual-PC streaming setup:* The Mo.Blend headless engine can run on the gaming PC (stronger GPU) while the OBS panel runs on the streaming PC, communicating across the LAN. Because this crosses the loopback boundary, the engine **must** be launched with `--bind-public`, which makes the broker require a bearer token (see PRD 3 §4). The same token (and the remote origin in the CORS allowlist) must be configured in this panel; an unauthenticated LAN-exposed engine is not permitted.

## **5\. Future Expansion & Automation Ecosystem**

Because the entire architecture relies on the headless Mo.Blend REST API and the OBS WebSocket, the UI panel acts as a gateway to much deeper broadcast automation.

* **Chat Hook Integration (Twitch/YouTube):** The panel will integrate with Twitch EventSub or YouTube Live APIs.  
  * *Scenario:* A channel moderator types \!shoutout @user in the Twitch chat, or a viewer drops a 50-gift-sub bomb.  
  * *Execution:* The OBS panel intercepts this external event, automatically maps the user's name and avatar URL to the template parameters, fires the render command to the Mo.Blend API in the background, and plays the resulting 3D animation on stream without the broadcaster ever lifting their hands from their keyboard.  
* **Stream Deck / Macro Integration:** Broadcasters utilize hardware like the Elgato Stream Deck. Because Mo.Blend is API-first, users can configure Stream Deck buttons to send HTTP POST requests directly to the Mo.Blend Broker (bypassing the OBS panel UI entirely) to trigger specific, pre-configured 3D graphic renders instantly.  
* **Live Data Feeds:** Templates can be wired to accept live JSON data. A 3D "Hype Train" graphic could periodically poll the API to update its 3D extruded percentage meter in real-time, rendering and injecting seamless update loops.