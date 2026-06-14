# **PRD 6: Sentinel Kit UI (The Agent Workspace)**

## **1\. Objective**

To provide a specialized, highly interactive chat-and-canvas interface where users can generate, iterate, and refine high-quality motion graphics purely through natural language. By acting as a sophisticated MCP (Model Context Protocol) Client, the Sentinel Kit UI empowers an LLM (such as Sentinel's internal agent) to autonomously act as a virtual technical artist.

The agent queries available .mo.blend templates, maps semantic user requests to strict mathematical parameters, and orchestrates headless Blender renders behind the scenes. This UI bridges the gap between creative ideation and technical execution, allowing marketers, streamers, and casual designers to conjure complex 3D animations without ever seeing a node graph or keyframe timeline.

**Deployment:** The Sentinel Kit UI will live under `clients/sentinel/` in the `MoBlend_Studio` monorepo. Exact packaging (standalone web app vs. Wails route/tab) is TBD — see [ROADMAP.md](../ROADMAP.md) milestone M6.

## **2\. Core Architecture & Hybrid Networking**

The Sentinel Kit UI is fundamentally an AI chat application augmented with a high-performance, rich media canvas. To satisfy both the standardized requirements of agentic communication and the high-throughput demands of video rendering, the UI employs a **Hybrid Networking Architecture**.

### **2.1 The Control Plane (REST / SSE)**

* **MCP Compliance:** All agentic tool calling, chat history synchronization, and state management occur over standard HTTP and Server-Sent Events (SSE). This ensures strict compliance with the Model Context Protocol, allowing the UI to seamlessly integrate with standard LLM ecosystems.  
* **Tool Execution Loop:** The UI hosts the LLM context and manages the back-and-forth execution loop. When the LLM decides to mutate a .mo.blend project, it sends standard JSON-RPC HTTP requests to the Mo.Blend API Broker (PRD 3).

### **2.2 The Data Plane (Binary WebSocket)**

* **Zero-Latency Canvas:** Because streaming raw video frames via base64-encoded text over SSE is highly inefficient, the UI embeds an HTML5 \<canvas\> that opens a dedicated binary WebSocket to `ws://127.0.0.1:8000/api/v1/viewport/stream` on the Mo.Blend broker (same endpoint as Studio and OBS).  
* **Direct Memory Painting:** When the LLM calls the moblend\_render\_preview tool, still-frame previews may use REST; live canvas updates use unencoded JPEG/WebP byte arrays over the viewport WebSocket, bypassing the text-based chat stream entirely.

### **2.3 State Synchronization Engine**

* The UI must maintain a dual-state architecture: the "conversational chat history" and the "current Mo.Blend JSON manifest state."  
* The UI ensures the LLM always has the exact, up-to-date visual configuration of the active project injected into its system prompt. This prevents the agent from hallucinating current parameter values and eliminates the need for redundant moblend\_inspect\_template calls during rapid iteration.

## **3\. Key Workflows & Features**

### **3.1 Prompt-to-Project (Discovery & Initialization)**

This workflow handles the initial creation of an asset from a blank slate.

* **Action:** The user types: *"I need a cyberpunk-style lower third for my tech review video. My name is Alex, and my handle is @TechAlex. Make it glow."*  
* **LLM Execution Cascade:**  
  1. **Discovery:** The LLM evaluates the request and calls moblend\_list\_templates.  
  2. **Inspection:** It identifies "LowerThirds-Cyberpunk" as the best match and calls moblend\_inspect\_template to read its specific JSON schema.  
  3. **Mapping & Inference:** The LLM maps "Alex" to headline\_text and "@TechAlex" to sub\_text. Recognizing the "glow" request, it infers a color palette and sets primary\_color to a high-intensity neon blue or pink, and pushes bloom\_intensity to 1.5.  
  4. **Execution:** It fires moblend\_apply\_parameters to lock in the state, followed immediately by moblend\_render\_preview.  
* **UI Result:** The chat interface displays a concise summary of the LLM's thought process and parameter choices, followed by a live, inline WebSocket-powered video preview of the generated graphic.

### **3.2 Iterative Refinement & Delta Updates**

The true power of the Sentinel UI lies in its ability to tweak existing states without regenerating the entire prompt.

* **Action:** The user replies: *"That looks great, but make the font much thicker, change the glow to neon green, and make the whole animation last 5 seconds instead of 3."*  
* **LLM Execution:** Because the LLM retains the context of the current JSON state, it does not start over. It surgically calls moblend\_apply\_parameters passing *only* the delta changes (e.g., {"primary\_color": "\#00FF00", "font\_weight": "Black", "slot\_1\_duration": 5.0}).  
* **UI Result:** The headless Blender engine only recalculates the altered nodes. The canvas updates near-instantly with the new frame, providing a real-time collaborative editing experience.

### **3.3 The "Under the Hood" State Inspector**

To build user trust and demystify the AI's actions, the UI features a transparent state viewer.

* **Inline JSON Diff:** Alongside every AI message, a collapsible side-panel (or an inline diff view) shows exactly which .mo.blend parameters the LLM adjusted and their previous values.  
* **Educational Bridge:** This visual feedback loop teaches casual users how the underlying templates actually work. It provides a seamless transition path: users can start by "prompting" the AI in the Sentinel Kit UI, learn the parameters, and eventually confidently use the manual sliders in the Mo.Blend Studio desktop app (PRD 4).

## **4\. Technical Constraints & Security**

### **4.1 Strict MCP Adherence**

All communication between the LLM and the Mo.Blend rendering engine must occur exclusively over the standardized MCP tool schema defined in PRD 3\. There are no proprietary backdoors or hidden APIs, ensuring that any MCP-compliant agent can theoretically drive the UI.

### **4.2 Context Window Management (Token Economy)**

Continuous iteration on a complex template with dozens of parameters can rapidly consume an LLM's context window.

* **Smart Truncation:** The Sentinel UI must actively manage the chat history. Older JSON manifest inspections and large parameter dumps from previous turns must be intelligently summarized or truncated, preserving only the *current* active state and the user's conversational intent.

### **4.3 Local Asset Sandboxing & SSRF Prevention**

If a user prompts: *"Put the Apple logo in the corner,"* the LLM might attempt to fetch an image from the web.

* **Sandboxed Handoff:** The UI must not allow the LLM to write arbitrary files to the disk. The LLM must pass the target URL to the Mo.Blend API's dedicated ingest\_asset endpoint.  
* **Security Checks:** The API Broker will independently perform MIME-type validation, size limit enforcement, and Server-Side Request Forgery (SSRF) checks before allowing the external asset into the local Blender instance.

## **5\. Future Expansion**

### **5.1 Multi-Modal Visual Analysis**

Future iterations will leverage advanced Vision-Language Models (VLMs). A user could upload a screenshot of their Premiere Pro timeline or a frame of their raw video. The VLM would analyze the screenshot's color grading, lighting, and spatial composition, automatically selecting a template and tuning its parameters (colors, drop shadows, positioning) to perfectly composite into the user's specific scene.

### **5.2 Audio-Driven Orchestration**

Integration with audio transcription agents. The user uploads a voiceover track; the LLM analyzes the transcript, identifies key emphasis points, and automatically generates and times lower-thirds or pop-up graphics to match the spoken words perfectly across a multi-slot timeline.

### **5.3 Cross-Platform Agent Handoff**

Because the Mo.Blend ecosystem is highly interconnected via the API Broker, the Sentinel Kit UI could seamlessly hand off completed assets to other tools. For example, a streamer could finalize a graphic in the chat UI, and simply tell the agent: *"Push this to OBS."* The agent would trigger the Mo.Blend API to render the WebM, and simultaneously call an OBS WebSocket tool to inject the new media source directly into the broadcaster's live scene.