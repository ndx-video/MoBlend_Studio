# **PRD 7: Mo.Blend Template Repository (The Registry) — Official Library at lib.moblend.dev**

## **1\. Objective**

To establish the official, centralized community library for .mo.blend templates at `lib.moblend.dev`. During the initial beta rollout, the library is powered by the separate `moblend-registry` Git repository (GitOps), allowing the community of technical artists and motion designers to contribute templates via standard Pull Requests. The project website, news, info, and documentation are at `moblend.dev`.

The registry serves as the single source of truth for the entire Mo.Blend ecosystem. It bridges the gap between advanced Blender node-architects and casual end-users. By providing a curated, safe, and easily indexable catalog, the Mo.Blend Studio UI, OBS extension, and Sentinel Kit UI can seamlessly fetch verified, production-ready motion graphics templates on demand. This ensures that users—whether human or AI agents—always have access to high-quality, standardized assets without needing to understand the underlying 3D software.

## **2\. Core Architecture (Beta / Launch Phase)**

During beta the official library at `lib.moblend.dev` is backed by a GitOps repository (`moblend-registry`). This deliberately avoids the overhead of a dedicated cloud web-platform from day one. The public library site (`lib.moblend.dev`) provides branded access, discovery, and (initially) links or direct delivery to the artifacts; the underlying source of truth and automation remains the Git repo. This lean approach prioritizes rapid iteration and community involvement.

* **Platform (backend):** Hosted on a public Git forge (e.g., GitHub, GitLab) as `moblend-registry`. This leverages existing infrastructure for identity management, issue tracking, and community discussion.  
* **Public face:** `lib.moblend.dev` — the official template library home for news of the library, browsing the catalog (via `index.json`), preview assets, and install links. In beta this may be a static site, GitHub Pages front, or lightweight redirector over the raw content.  
* **Decentralization Support:** Because the backend is just a Git repository, enterprise teams or studios can easily fork the structure to host their own private, internal registries for proprietary brand assets (and point their Mo.Blend clients at a private index URL).  
* **Structure:** A standardized directory tree in `moblend-registry` containing the .mo.blend binary files, their extracted JSON manifests, and rendered thumbnail previews.  
* **Delivery & CDN (beta):** Clients (Mo.Blend Studio, API Broker) fetch the catalog (`index.json`) and templates via configured URLs that ultimately resolve to the Git forge raw CDN (raw.githubusercontent.com or equivalent) or the `lib.moblend.dev` front in later beta. High availability via the forge's global edge-caching.

**Note:** The source registry lives in the separate `moblend-registry` repository. `lib.moblend.dev` is the public brand/home for the library it powers. This PRD describes the repo structure, CI, and how it feeds the public library; the `MoBlend_Studio` monorepo implements the client-side integration only.

## **3\. Repository Structure & Artifacts**

The Git repository must adhere to a strict, predictable file structure. This predictability is mandatory so that automated Continuous Integration (CI) systems can index it, and so that lightweight clients do not have to download the entire repository.

moblend-registry/  
├── templates/  
│   ├── lower-thirds/  
│   │   ├── lowerthird-ninja/  
│   │   │   ├── lowerthird-ninja.mo.blend      \# The actual Geometry Nodes payload  
│   │   │   ├── lowerthird-ninja.manifest.json \# Extracted JSON parameter schema  
│   │   │   └── lowerthird-ninja.webp          \# 720p animated preview loop (max 2MB)  
│   ├── transitions/  
│   │   ├── transition-glitch/  
│   │   │   ├── transition-glitch.mo.blend  
│   │   │   ├── transition-glitch.manifest.json  
│   │   │   └── transition-glitch.webp  
│   └── alerts/  
├── schemas/  
│   └── manifest-v1.schema.json                \# JSON Schema used for CI validation  
├── index.json                                 \# Auto-generated master catalog index  
└── README.md

### **3.1 The Artifacts Explained**

* **.mo.blend binary:** The core asset. This file must be optimized, with all unused data blocks (orphaned materials, unlinked node trees) purged to keep file sizes minimal.  
* **.manifest.json:** The crucial translation layer. It defines exactly which Geometry Node sockets are exposed, their human-readable labels, default values, and data types (e.g., color\_rgba, string, float). It also includes metadata like the author's name, version number, and a complexity score.  
* **.webp previews:** Animated WebP files are strictly required. They provide a lightweight, looping preview of the template in action. File sizes are capped (e.g., 2MB) to ensure the Mo.Blend Studio UI gallery loads instantly.

### **3.2 The index.json Master File**

To prevent the Mo.Blend Studio desktop app or the MCP agent from having to spider the repository via expensive API calls, a GitHub Action (or GitLab CI) runs automatically on every merge to the main branch.

* **Action:** The runner crawls the templates/ directory, validates and reads all manifest.json files, and compiles them into a single, flattened index.json at the root of the `moblend-registry` repository.  
* **Usage:** The Mo.Blend Studio UI and the Sentinel Agent fetch *only* this index.json file (via the broker or directly from the library endpoint at `lib.moblend.dev` / configured registry base) on startup. This single HTTP request populates the entire "Template Browser" gallery instantly, providing the UI with preview URLs, parameter requirements, and download paths without touching the heavy binary files. The public library at `lib.moblend.dev` may also surface the catalog for web visitors.

## **4\. Contribution Workflow (PR-Driven)**

To ensure quality, performance, and absolute security, community contributions must pass through a strict Pull Request review process before becoming available to end-users.

1. **Authoring:** A technical creator uses standard Blender (or the Mo.Blend Template Inspector addon in the separate `MoBlend_TemplateInspector` repo — PRD 8) to build a .mo.blend file, carefully designing the Geometry Nodes to be robust, and defining its JSON manifest.  
2. **Submission:** The creator forks the `moblend-registry` repository, adds their template folder to the appropriate category, and opens a Pull Request. The PR template requires them to confirm render times and attach their WebP preview. Upon merge the new template becomes available in the official library at `lib.moblend.dev`.  
3. **Automated CI/CD Checks:**  
   * **Security AST Scan:** A headless Python script runs in the CI pipeline to parse the .mo.blend file *without* executing it or opening Blender. It verifies that the use\_scripts\_auto\_execute flag is disabled and performs an Abstract Syntax Tree (AST) scan for embedded Python text blocks or malicious driver scripts to prevent arbitrary code execution on user machines.  
   * **Manifest Validation:** The CI runner checks the attached .manifest.json against the canonical manifest schema (`manifest-v1.schema.json` in the registry, kept in sync with [`specs/manifest.schema.json`](manifest.schema.json) in `MoBlend_Studio`) to ensure no required fields are missing, that parameter `type` values are from the canonical set, and that socket bindings use stable `socket_identifier` values (not positional indices).  
   * **Blender Compatibility Check:** The manifest must declare a minimum Blender version in its metadata, and CI verifies it is within the supported baseline (Blender 4.2 LTS+, see PRD 1 §2.2). This prevents templates authored against incompatible Blender releases from shipping to clients.  
   * **Asset Size Check:** Rejects the PR if the .mo.blend exceeds 50MB or the .webp exceeds 2MB, enforcing optimization.  
4. **Human Review:** Core maintainers review the PR. They verify the aesthetic quality, ensure the node graph is organized (for future maintainability), and confirm that the parameters exposed are actually useful for a casual user.  
5. **Merge:** Upon approval and merge, the CI action rebuilds index.json and the update is reflected at `lib.moblend.dev` (and consumed by all clients), instantly making the new template live across the entire global ecosystem.

## **5\. Client Integration**

The public library (`lib.moblend.dev`) and its backing GitOps registry act as a static, headless CDN for clients. Client applications interact efficiently and securely (the configured base URL for the library/catalog is used by the broker and Studio).

* **Mo.Blend Studio (Wails):** The "Suite Manager" (defined in PRD 4\) pings the library/registry URL (e.g. `lib.moblend.dev/index.json` or the backing raw URL) on launch to load the catalog. When a user clicks "Install" on a template from the official library, the Go backend streams the .mo.blend binary file (resolved via the index) directly to the local machine's \~/.moblend/templates/ directory. The UI handles local caching so redownloads are unnecessary unless the template version bumps.  
* **OBS Extension Panel:** The lightweight HTML panel fetches the catalog (index.json) from the library to populate its stinger/alert selection dropdowns. It relies on the local API broker to actually download the selected template before rendering it to the live stream.  
* **Sentinel Kit UI (MCP):** When the LLM executes the moblend\_list\_templates tool, the API Broker fetches the catalog (index.json) from the official library. The LLM can read the descriptions and parameter lists to intelligently decide which template fits the user's prompt (e.g., choosing a "corporate-lower-third" vs a "neon-gaming-alert") without downloading any visual assets.

## **6\. Future Vision (Post-Beta)**

As the Mo.Blend ecosystem scales and the library of templates grows from hundreds to thousands, the Git-based backend will be complemented (or succeeded) by a dedicated cloud platform whose public face is the official library at `lib.moblend.dev`.

* **Web Portal (at lib.moblend.dev):** A searchable frontend web UI (similar to Docker Hub, npmjs.com, or Unreal Engine Marketplace) allowing users to search by tags, preview interactive WebGL animations, and view creator profiles — this becomes the canonical home of the template library.  
* **User Accounts & Reputation:** Creators will be able to publish under their own namespaces (e.g., @ethan-robbins/neon-pack). A reputation system with verified badges will highlight trusted, high-quality technical artists.  
* **Semantic Versioning (SemVer):** Strict versioning for templates. If a creator updates a template in a way that breaks existing parameter mappings (e.g., removing the primary\_color input), it will be marked as a major version bump (v2.0.0). Clients will pin to major versions to ensure old user projects never break unexpectedly.  
* **Monetization & Licensing:** Support for premium, paid .mo.blend templates directly within the ecosystem. The library/registry will handle license generation, allowing professional motion designers to sell their node setups while the local Mo.Blend API broker handles DRM validation before rendering.  
* **Analytics & Telemetry:** Aggregated (opt-in) data on which templates are downloaded and rendered the most. This data will be used to guide community bounties, showing creators exactly what types of templates the user base is demanding.  
* **Project site integration:** `moblend.dev` (news, documentation, ecosystem info) will link deeply into the library at `lib.moblend.dev`.