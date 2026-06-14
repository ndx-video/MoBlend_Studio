# **PRD 1: Blender Headless Base Compute**

## **1\. Objective**

To utilize standard, unmodified Blender binaries as a robust, sandboxed background rendering and geometry processing engine for Mo.Blend. The integration must ensure maximum performance by eliminating UI overhead, securing the host system against malicious templates, and handling unexpected terminations gracefully.

### **1.1 Target Platforms**

| Platform | Priority | Blender invocation |
|----------|----------|-------------------|
| Windows (x64) | **Primary** | `blender.exe --background ...` — primary dev and CI target |
| Linux (x64) | Secondary | `blender --background ...` — validate per target distro/GPU |
| macOS (Apple Silicon) | Secondary | `Blender.app` CLI or bundled binary — arm64 builds when Windows MVP is stable |

Signal handling (SIGINT/SIGTERM) must be implemented on Unix; on Windows, handle `CTRL_BREAK_EVENT` / process termination from the Wails Go parent watchdog.

## **2\. System Architecture & Bootstrapping**

### **2.1 CLI Invocation**

Mo.Blend must not rely on a custom Blender fork. It must invoke standard Blender executable via the command line using strict flags.

* **Command Signature:** blender \--background \--factory-startup \--python moblend\_bootstrap.py \-- \--moblend-port 8000  
* **Flag Breakdown:**  
  * \--background (-b): Forces Blender to run without an X11/Wayland/Quartz UI.  
  * \--factory-startup: Prevents loading the user's local startup.blend or personal addons, ensuring a clean, predictable environment across all machines.  
  * \--python: Executes the primary Mo.Blend bootstrapper.  
  * \--: Passes remaining arguments directly to the Python script (e.g., port definitions, log levels).

### **2.2 Security & Sandboxing (Critical)**

Because .mo.blend files will be downloaded from a public Git registry, executing arbitrary Python within them is a massive security risk.

* **Auto-Execution:** The bootstrapper must ensure bpy.context.preferences.filepaths.use\_scripts\_auto\_execute \= False.  
* **Reliance on Geometry Nodes:** All template logic must be constrained to Geometry Nodes and Material Nodes. Templates containing Python driver scripts or custom UI scripts must be rejected by the registry and the engine.

## **3\. Lifecycle Management**

### **3.1 Startup Routine**

1. Initialize Headless Blender.  
2. Apply factory constraints (disable UI threads, set absolute viewport locking).  
3. Initialize the Mo.Blend Python Engine (PRD 2\) in memory.  
4. Open the HTTP/WebSocket API port.  
5. Await commands.

### **3.2 Graceful Termination & Crash Handling**

The background process must capture OS-level signals to prevent data loss.

* **Signal Catching:** Hook into SIGINT (Ctrl+C) and SIGTERM.  
* **Emergency Dump:** Upon receiving a termination signal, the engine must immediately halt rendering and execute an emergency save: bpy.ops.wm.save\_as\_mainfile(filepath="crash\_recovery.mo.blend").  
* **Process Orphaning:** Ensure the Blender process terminates cleanly if the parent process (e.g., Mo.Blend Studio / Wails app) unexpectedly dies (watchdog thread).

## **4\. Rendering Strategy**

### **4.1 Eevee Next Configuration**

To provide the low-latency streaming required by Mo.Blend Studio (Wails), Eevee Next is the exclusive render engine.

* Cycles rendering is disabled by default to prevent API timeout bottlenecks.  
* Viewport rendering must be locked to Orthographic Camera view.  
* The engine must support requesting RGBA transparent renders for the OBS extension.

### **5\. Configuration Management**

System-level configuration for the headless engine (like defining custom Blender executable paths or setting maximum memory limits) should be stored in standard config files. Users or admins configuring these environments directly on Linux/macOS servers should utilize vi \~/.moblend/config.json for manual adjustments.