# Mo.Blend Studio - Project Brief & Product Requirements

## 1. Vision & Goals
Mo.Blend Studio is a fast, lightweight motion-graphics editor designed for non-technical users such as marketers, broadcast operators, and digital signage managers. It aims to be the "Canva of motion graphics," removing the steep learning curve of tools like After Effects by replacing node graphs and keyframes with simple form-style controls and pre-made templates.

### Primary Objectives:
- **Democratize Motion Design**: Enable high-quality output without professional animation skills.
- **Speed-to-Market**: Reduce the time from template selection to final render for broadcast and signage.
- **System Reliability**: Maintain a high-performance render engine that remains invisible and easy to manage for the user.

---

## 2. Target Audience
- **Broadcast Operators**: Need quick overlays (lower thirds, score bugs) for live video.
- **Marketing Teams**: Creating social media stingers and promotional loops.
- **Signage Managers**: Managing content for restaurant menu boards and retail displays.

---

## 3. Core Features & User Flows

### A. Template Gallery (The Landing Experience)
- **Discoverability**: Search and filter by category (Lower Thirds, Tickers, Menu Boards).
- **Format Intelligence**: Filter by aspect ratio (16:9, 9:16) and transparency (Alpha) support.
- **Instant Preview**: Hover-to-play thumbnails to quickly assess animation style.

### B. The simplified Editor
- **Dynamic Parameter Inspector**: A "Customize" panel that generates UI controls (text inputs, color pickers, sliders) based on the selected template.
- **Slot-Based Timeline**: A high-level duration manager (Intro → Hold → Outro) instead of complex keyframe curves.
- **Live Viewport**: Real-time rendering with transparency checkerboard support.

### C. Export & Publishing
- **Smart Presets**: Format cards tailored to specific needs (e.g., "Transparent WebM for Broadcast").
- **Multi-Destination**: Direct export to file, OBS integration, or signage network.

### D. Suite Manager
- **Engine Transparency**: A health dashboard for the underlying Render Engine, Python environment, and API Broker.
- **Self-Healing**: Simple "Update" and "Repair" actions for technical components.

---

## 4. Design Principles
- **Professional Dark Mode**: Deep charcoal surfaces (#121317) with subtle elevation to minimize eye strain and focus on content.
- **Accentuated Intent**: Indigo-to-Violet gradient (#6C5CE7) used exclusively for primary actions (Export, Play, Active states).
- **Approachability**: Rounded corners (8-12px), clean sans-serif typography (Inter), and jargon-free language.
- **Pro-Tool Feel**: High-density layout that feels powerful but remains navigable via clear information hierarchy.

---

## 5. Technical Requirements
- **Headless Render Engine**: Integration with a headless version of Blender for backend rendering.
- **Python-Driven Templates**: Templates driven by Python scripts that map parameters to the UI inspector.
- **Alpha Channel Support**: Support for WebM and ProRes 4444 to enable transparent overlays.
- **Asset Pipeline**: Drag-and-drop support for PNG, MP4, and TTF files.
