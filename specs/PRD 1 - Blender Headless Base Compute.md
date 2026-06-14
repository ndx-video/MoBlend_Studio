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

### **2.2 Blender Version Baseline (Critical for Reproducibility)**

The "renders identically on every machine" guarantee depends on a pinned Blender version — the render engine, the Geometry Nodes feature set, and the node-tree interface (socket identifiers) all change between releases.

* **Minimum / target:** Blender **4.2 LTS** is the baseline (first release where the EEVEE rewrite formerly called "Eevee Next" is the default real-time engine). The engine targets the latest 4.2.x LTS patch and is validated against it.  
* **Pinning:** The exact tested Blender version is recorded in `<moblend_home>/config.json` and surfaced by the Suite Manager (PRD 4 §4). The Suite Manager refuses to launch an out-of-range binary and warns the user.  
* **Registry compatibility:** Templates declare a minimum Blender version in their manifest metadata; registry CI (PRD 7 §4) and the engine both check it before a template is used. Bumping the baseline is a deliberate, documented change — not implicit.  

> Note on naming: "Eevee Next" was the development name for the engine that shipped as the default EEVEE in 4.2+. Specs use "EEVEE (4.2+)" to avoid ambiguity; older "Eevee Next" references mean the same engine.

### **2.3 Security & Sandboxing (Critical)**

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
* **Emergency Dump:** Upon receiving a termination signal, the engine must immediately halt rendering and execute an emergency save to a fixed, predictable recovery location inside the Mo.Blend config directory — `<moblend_home>/recovery/crash_recovery.mo.blend` — never a bare relative path (whose location depends on the launch CWD). See §5 for how `<moblend_home>` resolves per platform.  
* **Process Orphaning:** Ensure the Blender process terminates cleanly if the parent process (e.g., Mo.Blend Studio / Wails app) unexpectedly dies (watchdog thread).

## **4\. Rendering Strategy**

### **4.1 EEVEE Configuration**

To provide the low-latency streaming required by Mo.Blend Studio (Wails), EEVEE (the 4.2+ real-time engine, see §2.2) is the exclusive render engine.

* Cycles rendering is disabled by default to prevent API timeout bottlenecks.  
* **Camera is template-defined, not forced orthographic.** The active camera (orthographic or perspective) is whatever the loaded `.mo.blend` template declares — many motion-graphics looks (extruded 3D logos, depth, parallax) require perspective. The engine renders through the template's active scene camera; it must not override projection. (Templates that want a flat 2.5D look simply ship an orthographic camera.)  
* The engine must support requesting RGBA transparent renders for the OBS extension.

### **5\. Configuration Management**

System-level configuration for the headless engine (custom Blender executable paths, maximum memory limits, port overrides) is stored in a single canonical config file inside the Mo.Blend home directory.

* **Canonical config file:** `<moblend_home>/config.json` (one file across the whole suite — see PRD 3 and PRD 4, which read the same file; there is no separate `server_config.json`).  
* **`<moblend_home>` resolution (platform-neutral):**  
  * Windows (primary): `%USERPROFILE%\.moblend\` (e.g. `C:\Users\<name>\.moblend\`).  
  * Linux/macOS: `~/.moblend/`.  
* **Editing:** Use any text editor for the platform (Notepad/VS Code on Windows; `vi`/`nano` on Linux/macOS). The file format is identical everywhere.