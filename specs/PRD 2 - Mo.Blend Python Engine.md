# **PRD 2: Mo.Blend Python Engine (The Brain)**

## **1\. Objective**

To act as the central logic controller operating entirely within Blender's memory space (bpy). This Python engine is the critical bridge between the high-speed, asynchronous network broker (PRD 3\) and the synchronous, single-threaded Blender runtime. It is strictly responsible for parsing .mo.blend templates, safely translating abstract API parameter requests into targeted Geometry Node mutations, orchestrating the slot-based timeline mathematics, and managing secure file I/O operations without triggering Blender's UI overhead.

## **2\. File I/O, Session State & Memory Management**

### **2.1 The .mo.blend Sandbox & State Tracking**

* **Extension Enforcement:** The engine strictly parses and loads only files possessing the .mo.blend extension. Attempts to load standard .blend files or external asset libraries directly via the project-load API will be rejected to maintain the sandbox boundary.  
* **In-Memory Session Lifecycle:** When a project is loaded, all data blocks reside in active RAM. The engine maintains an internal "dirty" state flag. Every parameter mutation flips this flag to true. External clients can poll the engine's state to determine if the user has unsaved changes.  
* **Garbage Collection (VRAM Optimization):** Because users iterate rapidly, changing text, colors, and images often, the engine must aggressively manage memory. Before any save or export operation, the engine runs a targeted purge (bpy.data.orphans\_purge()) to remove unlinked image data, unused fonts, and orphaned node groups, preventing the session memory footprint from bloating over time.

### **2.2 Incremental Backup & Crash Recovery System**

To protect against file corruption (e.g., sudden power loss during a disk write) without interrupting or pausing the user's creative workflow, the engine implements a silent rolling backup strategy.

* **Manual Save:** Triggered explicitly by the user, overwriting the canonical project.mo.blend. Flushes the dirty state flag to false.  
* **Periodic Save (Auto-Save):** Creates incremental shadow copies (e.g., project.mo.blend.01, project.mo.blend.02). The engine maintains a rolling buffer capped at a configurable maximum (e.g., max 5 backups).  
* **The Sanity Check & Auto-Recovery:** On project load, the engine reads the file header. If project.mo.blend fails the internal integrity check (e.g., unexpected EOF, missing JSON manifest, or presence of unauthorized Python driver scripts), the engine automatically scans the working directory and attempts to load the highest numbered valid shadow copy, emitting a recovery warning payload to the API broker to alert the user.

## **3\. JSON Manifest Parser & Node Mutator**

Every Mo.Blend template contains a strict, author-defined JSON schema embedded directly within the bpy.types.Scene custom properties (specifically stored at bpy.context.scene\['moblend\_manifest'\]).

* **Purpose:** This manifest acts as the immutable API contract for the template. It completely decouples the front-end UI and LLM agents from the underlying complexity of the Blender node graph. External clients do not need to know *how* a glow effect is wired; they only need to know it accepts a float between 0 and 5\.  
* **Expanded Schema Example:**  
  {  
    "version": "1.1",  
    "template\_id": "lower-third-ninja",  
    "parameters": \[  
      {  
        "id": "headline\_text",  
        "type": "string",  
        "ui\_group": "Typography",  
        "node\_target": "NodeGroup\_TextGen",  
        "socket\_index": 0,  
        "default": "Hello World"  
      },  
      {  
        "id": "primary\_color",  
        "type": "color\_rgba",  
        "ui\_group": "Style",  
        "node\_target": "Material\_Neon",  
        "socket\_index": 2,  
        "default": "\#00FFAA"  
      },  
      {  
        "id": "bloom\_intensity",  
        "type": "float",  
        "min": 0.0,  
        "max": 5.0,  
        "ui\_group": "Style",  
        "node\_target": "NodeGroup\_PostProcess",  
        "socket\_index": 1,  
        "default": 1.2  
      }  
    \]  
  }

* **Execution & Type Coercion:** When the engine receives an API command such as UpdateParameter(id="primary\_color", value="\#FF0000"), the process is heavily guarded:  
  1. **Lookup:** The engine searches the manifest for the id.  
  2. **Coercion:** It translates the high-level input into Blender's native format. For example, it converts the HEX string \#FF0000 into a linear RGB float array (1.0, 0.0, 0.0, 1.0).  
  3. **Mutation:** It locates the exact data block (bpy.data.node\_groups\["Material\_Neon"\]), targets the input socket (inputs\[2\]), and updates the default\_value.  
  4. **Graph Update:** It explicitly flags the Dependency Graph for an update (bpy.context.evaluated\_depsgraph\_get().update()) to ensure the viewport stream reflects the change on the very next frame.

## **4\. Slot-Based Timeline Manager**

To completely abstract traditional keyframes and dope sheets away from casual users, the engine implements an algorithmic "Slot" timeline system, driven entirely by Geometry Nodes.

* **Concept:** A user defines logical, sequential time blocks rather than placing individual keyframes (e.g., Slot 1: "Intro" from 0.0s to 2.0s; Slot 2: "Hold" from 2.0s to 5.0s).  
* **Blender Translation:** The Python engine does *not* insert, move, or delete bpy.types.Keyframe data. Traditional keyframes are fragile and difficult to re-time programmatically. Instead, it drives animations parametrically.  
* **The Normalized Time Driver:** The engine maintains a master "Time Controller" Geometry Node group.  
  * The engine passes the current scene frame (scene.frame\_current), the project frame rate (scene.render.fps), and the absolute start and end frames of the active slot into this controller.  
  * Inside the Geometry Node, math nodes calculate a **Normalized Time Output** (0.0 to 1.0).  
  * As the playhead moves through the slot's duration, this 0.0 \-\> 1.0 value is piped into animation curves and mix nodes, driving the intro/outro behaviors. If the API requests the "Intro" slot be lengthened from 2 seconds to 4 seconds, the engine simply updates the slot boundaries; the Geometry Nodes automatically stretch the interpolation, resulting in perfectly smooth, slowed-down animation without a single keyframe being touched.

## **5\. Dynamic Asset Ingestion & Deduplication**

The engine must securely and efficiently handle external binary assets requested by the API (images, videos, vector graphics, and custom fonts) to support highly customized marketing output.

* **Fetching & Ephemeral Caching:** Downloads URLs via secure HTTP streams to an ephemeral local cache directory (e.g., /tmp/moblend\_assets/).  
* **Strict Validation:** Prior to creating Blender data blocks, the engine verifies file signatures (magic numbers) to prevent disguised executables or malicious payloads from exploiting Blender's image parsers. Strict file size limits and dimension bounds are enforced to prevent VRAM overflow.  
* **Hash-Based Deduplication:** To prevent bloating the project file when the same logo is requested multiple times, the engine calculates an MD5/SHA-256 hash of the downloaded asset. If an image with that hash already exists in bpy.data.images, the engine reuses the existing data block rather than creating a duplicate.  
* **Injection Routing:** \* **Images/Video:** Creates or fetches the bpy.data.images data block and patches it into the designated Image Texture node defined in the manifest. For video files, it also configures the frame\_duration and use\_auto\_refresh flags.  
  * **Fonts:** Loads .ttf or .otf files into bpy.data.fonts and assigns the resulting font object directly to the target String to Curves geometry node, instantly updating the 3D typography in the viewport.