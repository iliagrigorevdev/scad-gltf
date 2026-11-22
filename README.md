# SCAD GLTF

A WebAssembly (WASM) build of a custom OpenSCAD fork that compiles OpenSCAD (`.scad`) scripts directly to **glTF/GLB** in the browser and Node.js.

Unlike standard OpenSCAD, this engine supports **Physically Based Rendering (PBR)** materials, **Hierarchical Node Animations**, **Skeletal Skinning & Mesh Deformation**, **Texture Baking**, and **Scene Lights**, making it a bridge between procedural CAD and modern 3D engines (Three.js, Babylon.js, Godot 4, Bevy, wgpu, and Unreal Engine 5).

The C++ source code for this custom OpenSCAD fork is included in the `openscad/` subfolder.

**✨ Launch Scadify (Web Editor & 3D Viewer):** [https://iliagrigorevdev.github.io/scad-gltf/](https://iliagrigorevdev.github.io/scad-gltf/)

**🎮 Godot AI-Generated Examples:** [https://iliagrigorevdev.github.io/scad-godot/](https://iliagrigorevdev.github.io/scad-godot/)

![Editor Screenshot](https://raw.githubusercontent.com/iliagrigorevdev/scad-gltf/main/screenshot.png)

## Choose Your Workflow

| Workflow                                                  | Best For                                                                                                                                                      | Setup Required             |
| :-------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------- |
| **[Scadify Web Editor](#1-scadify-web-editor)**           | Interactive modeling, AI prompt generation, visual previewing, playing/exporting Godot 4 `.md` games, and sharing 3D links                                    | None (runs in browser)     |
| **[`scad-gltf` CLI](#2-scad-gltf-cli)**                   | Batch `.scad` conversion, local workspace syncing (`serve`), automated AI generation (`gen`), MCP visual feedback (`mcp`), and packing/playing `.md` projects | `npm install -g scad-gltf` |
| **[JavaScript / Node.js API](#3-javascript--nodejs-api)** | Embedding SCAD compilation, prompt generation, or Markdown project utilities in Node.js scripts or Vite/Webpack apps                                          | `npm install scad-gltf`    |

## Features

- **Direct SCAD to GLB conversion:** Compile geometry directly to web-ready binary glTF.
- **Extended PBR Material Support:** Extensions to OpenSCAD's `color()` module supporting `name` (glTF material name for engine shader/material lookup), `metalness`, `roughness`, `transmission`, `thickness`, `ior`, `attenuationColor`, `attenuationDistance`, `clearcoat`, `sheen`, `emissive`, `specularColor`/`specularIntensity`, `iridescence`, `unlit`, `colormap`, and `$asa` auto-smooth shading.
- **Hierarchical Node Animation & Skeletal Skinning:**
  - **Rigid Parenting:** Define articulated hierarchies, animated cameras, and keyframe animations via `armature()` and `bone()`.
  - **Smooth Skinning / Soft-Body Deformation:** Bind meshes to multiple bones using `skin()` with procedural 3D vertex weight functions.
- **Texture Baking:** Auto-generate UVs and bake high-poly details (colors, tangent-space normals, ORM) or procedural `colormap` functions onto low-poly meshes via `bake()`.
- **Scene Lighting:** Add directional, point, and spot lights directly inside your model hierarchy via `light()`.
- **Scadify Web Editor:** Browser-based IDE with live WASM compilation, GPU path tracing, animation timeline & video recording, multi-file Markdown editing, local IndexedDB version history + 3D/code diffing and client-side Godot 4 playback/export.
- **AI Studio Extension:** Chrome extension to natively preview, prompt, take chat snapshots, open in Scadify, and locally save AI-generated 3D models directly inside Google AI Studio.
- **CLI, REST Server & MCP Server:** Complete command-line toolkit (`convert`, `serve`, `gen`, `play`, `extract`, `pack`, `mcp`) for local automation and AI agent visual feedback loops.

---

## 1. Scadify Web Editor

**Scadify** is the fastest way to get started—no installation or build tools required. Everything compiles locally in your browser via WebAssembly.

### Quick Start in the Browser

1. Open [Scadify](https://iliagrigorevdev.github.io/scad-gltf/).
2. Write OpenSCAD code in the left editor (or drag and drop any `.scad` or `.md` file onto the window).
3. Inspect the live 3D render on the right, toggle **Path Tracing** for photorealistic lighting/glass, or scrub animations.
4. Export your result as **⬇ GLTF** (`.glb`), **⬇ 3MF** (`.3mf`), **⬇ SCAD**, **⬇ MD**, **⬇ Project ZIP** (`.zip` with cached `.glb` models), **📷 Image** (`.png`), **🎥 Video** (`.mp4`/`.webm`), or **🔗 Share** a compressed link.

### Scadify Features

- **Real-Time 3D Viewport & GPU Path Tracing:** Live WebAssembly compilation with auto-render, auto-framing camera, wireframe, grid/axes, bloom, scene light toggle, glTF camera selector, expand mode (`⛶`), and hardware-accelerated path tracing with custom `.hdr` environment map drag-and-drop.
- **Animation & Media Capture:** Multi-clip selector, play/pause, timeline scrubber, **📷 PNG snapshots**, and **🎥 MP4/WebM video recording** (renders deterministically frame-by-frame when Path Tracing is active).
- **AI Prompt Generator Tab:** Choose a target profile (**OpenSCAD Model**, **Godot 4 Project**, **Vite Web 3D Project**, **Rust Bevy Project**, **Rust wgpu Project**, **Unreal Engine 5 Project**), toggle PBR/animation/baking rules, reset to profile defaults (**↺ Reset**), copy complete prompts with bundled engine templates (`addons/scad_importer`, `build.rs`, `Plugins/ScadImporter`), or click **🩹 Copy Refinement Prompt** (available when editing a multi-file Markdown bundle) to copy the full project alongside patch-formatting rules and an optional refinement request.
- **Multi-File Markdown Editing & Interactive Patching:** Edit single-file `### filepath` Markdown bundles with block highlighting, a cursor-synced file dropdown featuring **📑 All (.md)** plus grouped **SCAD Models** and **Other Files** (automatically compiling `.scad` blocks as you select or move the cursor into them), per-file/full-document **📋 Copy**, **📥 Paste** (shown for empty or plain `.scad` editors to replace content from clipboard), **🩹 Patch** (shown for Markdown bundles to open an interactive patcher supporting **Patch Matching & Add New**, **Replace Single File**, and **Replace Entire Document** modes; auto-reads the clipboard, accepts dropped `.md`/`.patch` files, resolves missing/swapped root folder prefixes, supports `<<<<<<< SEARCH` / `>>>>>>> REPLACE` hunks, `(DELETE)` headings or `<!-- DELETE -->` / `// DELETE` / `# DELETE` markers, per-file checkboxes, path remapping, and live diff previews, plus a post-patch banner with file jump pills, **↩ Undo**, and **🔍 Diff**), and **⬇ MD** / **⬇ SCAD** / **⬇ Project ZIP** downloads.
- **Local Storage & Version Comparison:**
  - Automatically saves the active workspace draft in `localStorage` and stores named local models and up to 50 auto-snapshots per model in `IndexedDB`.
  - Toggle **Auto Save Versions**, start a fresh draft (**➕ New**, auto-snapshotting current work first), delete models (**Delete**) or individual snapshots (**🗑**), create manual snapshots with notes (**📌 Save Version**), restore earlier versions (**↩ Restore**), and automatically match/deduplicate models opened via **📁 Load**, drag-and-drop, `?file=`, `#...` links, or `scad-gltf serve`.
  - Click **🔍 Compare** to diff across any saved local model or the active draft (**A (Base)** vs **B (Compare)**, including **Current Editor** and **Latest Saved**), swap sides (**⇄**), or restore directly (**↩ Restore A** / **↩ Restore B**). Inspect **Side-by-Side / Unified Code Diffs** (with **Full file** toggle and per-file `[=]`/`[~]`/`[+]`/`[-]` filtering for Markdown bundles) and **3D Visual Comparisons** (Side-by-Side Synced Camera or Red/Green Overlay with `.scad` file selector, **Wireframe**, and **🎯 Fit Camera**).
- **In-Browser Godot 4 Playback & Export:** Paste, drop, or open a `.md` Godot 4 project (`project.godot` + `.scad` + `.gd`/`.tscn`) to compile all `.scad` models to `.glb` in the browser, generate `.godot/global_script_class_cache.cfg` for `class_name` GDScripts, configure WebGL2 (`gl_compatibility`), inject a runtime `.scad`/`.glb`/image loader (`res://__scad_glbs/`), pack an in-memory `.pck`, and run it with **🎮 Play Godot** (includes **🔄 Restart**, **⏹ Stop**, **📋 Logs** with **Copy**/**Clear**, **📷** PNG screenshot capture, **⛶** expand mode, **⬇ Web ZIP** standalone HTML5 export, and **⬇ Project ZIP** source export bundling `addons/scad_importer/` and precompiled `__scad_glbs/*.glb` assets).
- **Native Project Build & Launch (UE5, Rust, Godot 4 via Local Backend):** Open or paste a Markdown project to enable **🎮 Run UE** (`.uproject`), **🦀 Run Rust** (`Cargo.toml`), or **🖥 Run Godot** (`project.godot`, alongside the in-browser **🎮 Play Godot** WebAssembly player). Clicking a Run button connects to `scad-gltf serve`, injects any missing fallback templates/addons (`Plugins/ScadImporter`, `build.rs`, `addons/scad_importer`), precompiles `.scad` assets to `__scad_glbs/*.glb`, runs the native build/import step (`Build` / `cargo build` / `godot --headless --editor --quit`), and launches the application/editor with a live log panel (**🔄 Restart**, **⏹ Stop**, **Copy Logs**, and **Clear**).
- **Multi-Engine Project ZIP Export & Offline CLI Fallback:** Click **⬇ Project ZIP** on any `### filepath` Markdown project (Godot 4, Unreal Engine 5, Rust Bevy/wgpu, Vite Web, or generic multi-file `.scad` bundles) to export a `.zip` archive containing precompiled `__scad_glbs/*.glb` models. When the `scad-gltf` CLI is not installed locally, the bundled Godot addon (`addons/scad_importer/scad_importer.gd`), Unreal Engine plugin (`Plugins/ScadImporter/Source/ScadImporter/Private/ScadImportFactory.cpp`), and Rust `build.rs` script automatically fall back to the cached `.glb` models (and **⬇ Project ZIP** automatically injects missing or upgrades legacy UE/Rust fallback templates).
- **URL Loading, Sharing & Embed Mode:** Load a self-contained `.scad` or `.md` file directly via URL parameter (`?file=<url>`), live-load `#...` links on `hashchange`, or click **🔗 Share** to compress the project into the URL hash (`#c...`, using the native Web Share sheet when available or copying to clipboard). Enable **Embed Share** (`?embed=1`) to share a chromeless full-viewport link that hides editor UI and auto-starts Godot games.
- **Optional Local Sync & PWA:** Connect the **SCAD Serve Backend** panel (`http://localhost:3000`) to `scad-gltf serve` to read, save, and delete files on your local disk with automatic `include`/`use` dependency resolution. Installable as a Progressive Web App (PWA).

### Workflow: Generating & Refining Godot 4 Projects (Scadify + AI Studio)

Scadify supports an end-to-end browser workflow for generating, running, patching, and sharing single-file `.md` Godot 4 projects with Google AI Studio:

1. **Generate the Godot 4 Prompt in Scadify:**
   - Open Scadify and switch to the **AI Prompt Generator** tab.
   - Set **Profile** to **Godot 4 Project** (optionally adjust feature toggles like PBR, Animations, or Baking, or click **↺ Reset** to restore profile defaults).
   - Enter a description of your game or 3D scene in the description box.
   - Click **📋 Copy Prompt to Clipboard** to copy the full prompt (including OpenSCAD PBR/animation syntax rules, Godot 4 coordinate and GDScript conventions, and the bundled `addons/scad_importer/*` files).

2. **Paste the Prompt in Google AI Studio & Copy the Generated `.md` Output:**
   - Open [Google AI Studio](https://aistudio.google.com/), paste the prompt into the chat input, and run the model.
   - When the model finishes generating the single-file Markdown response (formatted with `### <project_name>/...` headers and fenced code blocks), copy the generated Markdown content to your clipboard. _(Make sure to copy the raw Markdown output so `### filepath` headers and ` ``` ` code fences are preserved.)_

3. **Paste the `.md` Project into Scadify:**
   - Switch back to the **SCAD Editor** tab in Scadify.
   - Paste the copied Markdown content directly into the main editor area (`Ctrl+V` / `Cmd+V`, or `Ctrl+A` / `Cmd+A` first if replacing existing text).
   - Once `project.godot` is detected inside the Markdown bundle, Scadify automatically derives the project name in the **Name** field, highlights each file block, populates the file selector dropdown (**SCAD Models** and **Other Files**), and enables the Godot toolbar buttons.
   - Select any `.scad` file in the dropdown (or click inside its block) to preview its 3D model, or click **🎮 Play Godot** to compile all `.scad` assets to `.glb`, pack an in-memory `.pck`, and run the project directly in the browser.

4. **Refine the Godot Project in AI Studio & Apply Changes in Scadify:**
   - Prompt follow-up changes or bug fixes in Google AI Studio—or switch to Scadify's **AI Prompt Generator** tab, optionally type your change request, and click **🩹 Copy Refinement Prompt** to copy the full `.md` project alongside patch-formatting rules (ideal for starting a fresh chat or keeping the AI aligned with your latest edits). _(Tip: While testing in Scadify, you can also open **📋 Logs** and click **Copy** to share Godot runtime errors, click **📷** to capture a screenshot, or select a specific file in Scadify's file dropdown and click **📋 Copy** to share just that file.)_
   - Copy the AI's updated Markdown response to your clipboard, then apply it in Scadify based on what was generated:
     - **Full Project Regenerated:** If AI Studio returned the entire project again, select all text in the Scadify editor (`Ctrl+A` / `Cmd+A`) and paste (`Ctrl+V` / `Cmd+V`) to replace the whole `.md` document (or use **🩹 Patch** in **Replace Entire Document** mode).
     - **Changed / New Files Only (Patch):** If AI Studio returned only modified/added `### filepath` blocks, `<<<<<<< SEARCH` / `>>>>>>> REPLACE` hunks, or a single raw file's code, **do not overwrite the whole editor**. Instead, click **🩹 Patch**:
       - **🩹 Patch** automatically reads your clipboard (or lets you paste with `Ctrl+V` / `Cmd+V` or drop a `.md`/`.patch` file), automatically resolves missing or mismatched root-folder prefixes (e.g., `scripts/player.gd` → `my_game/scripts/player.gd`), applies `SEARCH/REPLACE` hunks, and appends new files under the project root.
       - When the clipboard contains raw file code without `### filepath` headers, **🩹 Patch** switches to **Replace Single File** targeting the currently selected file (or lets you pick any target file from the dropdown).
       - Review live diffs, toggle per-file checkboxes, edit target paths, or handle `(DELETE)` entries, then click **Apply** (`Ctrl+Enter` / `Cmd+Enter`) to apply and inspect the patch summary bar with clickable file pills, **↩ Undo**, and **🔍 Diff**.
       - Scadify automatically saves a `"Before patch"` / `"Before replace"` snapshot in **Local Storage & Versions** before applying and re-renders modified `.scad` assets automatically when **Auto Render** is enabled.
   - Click **🎮 Play Godot** (or **🔄 Restart** if the player is already open) to test your updated project, and use **⬇ Web ZIP** or **⬇ Project ZIP** when ready to export.

5. **Share Your Created Game with Friends (Embed Mode):**
   - Enable the **Embed Share** checkbox beneath the editor toolbar, then click **🔗 Share**.
   - Scadify compresses the entire `.md` project into the URL hash and appends `?embed=1` to the link (copying it to your clipboard or opening your device's native share sheet).
   - When friends open that link, Scadify hides the editor, toolbars, and log panels and **automatically launches your Godot game fullscreen** right in their browser—no downloads or setup required. _(Leave **Embed Share** unchecked if you want to share an editable link with the full Scadify IDE instead.)_

### Google AI Studio Chrome Extension

The Chrome/Chromium extension in [`editor/`](./editor) integrates directly into [Google AI Studio](https://aistudio.google.com/):

- **Preview 3D Button:** Adds a **Preview 3D** button onto `openscad`/`scad` code blocks to render an interactive 3D preview right inside the chat (complete with Grid, Wireframe, Bloom, custom Lights toggle, glTF Camera selector, Animation play/pause/clip/timeline controls, Fullscreen `⛶`, automatic `/* Model Name: ... */` filename detection, and `include`/`use` dependency resolution from `scad-gltf serve`).
- **Visual Feedback Snapshot (`📷`):** Captures a PNG render of the preview and pastes it straight into the AI Studio chat input so the model can inspect and fix geometry.
- **Floating Prompt Generator (`✨ SCAD`):** Opens the profile/feature prompt modal, optionally connects to `scad-gltf serve` to include an existing local `.scad` model as reference, and inserts + copies the generated prompt.
- **Edit in Scadify & Local Save:** Click **Edit** to open the model in Scadify via compressed URL hash, or **Save** to write to `scad-gltf serve` (falls back to downloading `.scad` if no local server is running).

**Installation (Chrome / Edge / Brave):**

```bash
git clone https://github.com/iliagrigorevdev/scad-gltf.git
cd scad-gltf/editor
npm install
npm run build
```

Then open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, and select `scad-gltf/editor/dist`.

---

## 2. `scad-gltf` CLI

Install the CLI globally to convert `.scad` files on disk, run a local server for Scadify/AI Studio, automate AI generation, or integrate with MCP clients:

```bash
npm install -g scad-gltf
```

### Command Overview

| Command                                              | Purpose                                                                                                                 |
| :--------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `scad-gltf convert <in> <out> [options] [--cache]`   | Convert a `.scad` file or directory to `.glb`, `.gltf`, `.3mf`, `.stl`, `.obj`, `.svg`, etc.                            |
| `scad-gltf serve [--port <port>] [--ue-root <path>]` | Start the local REST API, serve the Scadify Web Editor for the current working directory, and optionally set `UE_ROOT`. |
| `scad-gltf gen <type> "<desc>" [options]`            | Generate prompts (clipboard) or run an automated AI + MCP visual iteration loop.                                        |
| `scad-gltf play <project.md>`                        | Unpack, build, and launch a Markdown project (`godot`, `web`, `bevy`, `wgpu`, `ue`) in a temp dir.                      |
| `scad-gltf extract <project.md> [dir]`               | Unpack a single-file Markdown project to disk.                                                                          |
| `scad-gltf pack <dir> [output.md]`                   | Pack an existing local project directory into a single `### filepath` Markdown file.                                    |
| `scad-gltf mcp`                                      | Start the stdio Model Context Protocol (MCP) server for AI assistants.                                                  |

### Converting Files (`scad-gltf convert`)

Convert single files or entire directories with recursive `include`/`use` dependency hashing when `--cache` is passed:

```bash
scad-gltf convert <input.scad | input_dir> <output_file | output_dir> [options_json] [--cache]
```

**Examples:**

```bash
# Single file conversion (supported: glb, gltf, 3mf, stl, obj, off, wrl, csg, svg)
scad-gltf convert model.scad model.glb
scad-gltf convert model.scad model.stl

# Batch directory conversion
scad-gltf convert ./src_models ./out_glbs
scad-gltf convert ./src_models ./out_stls '{"format": "stl"}'

# Smart caching (writes .import SHA-256 hashes of source + recursive include/use deps)
scad-gltf convert ./src_models ./out_glbs --cache

# Pass OpenSCAD -D variables (JSON or Base64-encoded JSON)
scad-gltf convert model.scad model.glb '{"variables": {"size": 20}}'
```

### Local Workspace Server & Editor (`scad-gltf serve`)

Starts a local HTTP server (default port `3000`) serving the Scadify Web Editor and exposing REST endpoints scoped strictly to the current working directory. Pass `--ue-root <path>` (or set `UE_ROOT`) for UE5 projects and optionally `--godot-bin <path>` (or set `GODOT_BIN`) for native Godot launches:

```bash
scad-gltf serve [--port <port>] [--ue-root <path>] [--godot-bin <path>]
```

**Endpoints:**

- `GET /api/scads` — List all `.scad` and `.md` files in the working directory.
- `GET /api/scads/:filename` — Read a `.scad` or `.md` file.
- `POST /api/scads` — Create or update a file (`{ "filename": "model.scad", "content": "cube(10);" }`; defaults to `.scad` if no `.scad`/`.md` extension is given).
- `DELETE /api/scads/:filename` — Delete a `.scad` or `.md` file.
- `POST /api/convert` — In-memory SCAD-to-GLB compilation (`{ "content": "sphere(r=10);", "options": { "variables": { "r": 10 }, "additionalFiles": { "lib.scad": "..." } } }`), returning `model/gltf-binary`.
- `POST /api/:type/run` (`ue`, `rust`, `godot`) — Extracts a Markdown project (`{ "markdown": "..." }`) to a temporary directory, injects fallback templates/addons (`Plugins/ScadImporter`, `build.rs`, `addons/scad_importer`), precompiles `.scad` files to `__scad_glbs/*.glb`, runs the build/import phase (`Build` / `cargo build` / `godot --headless --editor --quit`), and launches the native Unreal Editor, Rust binary (`cargo run`), or Godot Engine.
- `GET /api/:type/status` (`ue`, `rust`, `godot`) — Returns the active runner status (`idle`, `building`, `running`, `stopped`, `error`) and incremental log output (`?since=<offset>`).
- `POST /api/:type/stop` (`ue`, `rust`, `godot`) — Terminates any active build or application process tree for that runner type and cleans up its temporary directory.

### Automated AI Generation (`scad-gltf gen`)

Generates a tailored prompt (`scad`, `godot`, `web`, `bevy`, `wgpu`, or `ue`) and copies it to your clipboard—or, when `OPENAI_BASE_URL` / `OPENAI_API_KEY` (or JSON equivalents) are provided, runs an automated loop using `scad-gltf mcp` for multi-angle visual inspection and human-in-the-loop feedback before saving the final file (`<model_name>.scad` / `generated_model.scad`, or `generate_<type>_project.md`).

```bash
# Clipboard mode (copies system prompt + request to paste into any LLM)
scad-gltf gen godot "A third-person 3D robot platformer"

# Automated mode with OpenAI
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-4o"
scad-gltf gen bevy "A 3D spaceship shooter game"

# Automated mode with Google Gemini (OpenAI-compatible endpoint)
export OPENAI_API_KEY="AIzaSy..."
export OPENAI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
export OPENAI_MODEL="gemini-2.5-flash"
scad-gltf gen godot "A fast-paced 3D hovercraft racing game"

# Automated mode with a local OpenAI-compatible server (e.g. llama.cpp)
export OPENAI_BASE_URL="http://127.0.0.1:8080/v1"
export OPENAI_MODEL="llama-3"
scad-gltf gen web "A 3D configurator app"

# Inline JSON options + existing local .scad context files (or pipe description via STDIN)
scad-gltf gen godot "A game using the provided player model" '{"scadFiles": ["./player.scad"], "openaiBaseUrl": "http://127.0.0.1:8080/v1", "openaiModel": "llama-3"}'
```

**Automated Loop Behavior:**

- **Automatic Vision Fallback:** If the target API rejects image inputs, `scad-gltf gen` automatically strips images, sets `return_images: false` on MCP tool calls, and retries in text-only mode.
- **Live Preview & Feedback:** Before prompting `Are you happy with this result?`, `scad` mode launches a background `scad-gltf serve` instance and prints `#c...` browser preview links, `godot` launches Godot, `web` runs `npm install && npm run dev`, and `bevy`/`wgpu` runs `cargo run`.
- **Incremental Patching:** When providing follow-up feedback on multi-file projects, the AI outputs Markdown patches (`SEARCH/REPLACE` hunks and modified/added/deleted files), which are validated and applied to the previous project state automatically.

### Playing, Extracting & Packing Projects (`play`, `extract`, `pack`)

- **Play in an isolated temporary directory** (auto-cleans up on exit; auto-downloads headless Godot if `godot` is not on `PATH`; requires `UE_ROOT` for Unreal Engine 5):
  ```bash
  scad-gltf play generate_godot_project.md
  ```
- **Extract to disk** (`### filepath` blocks written to current directory or target folder):
  ```bash
  scad-gltf extract generate_godot_project.md
  scad-gltf extract generate_godot_project.md ./my_new_game
  ```
- **Pack an existing directory** into a single `.md` project (automatically skips binaries, whitespace paths, and build/cache folders like `.git`, `node_modules`, `target`, `.godot`, `dist`, `Binaries`, `Intermediate`, `Saved`):
  ```bash
  scad-gltf pack ./my_game_dir
  scad-gltf pack ./my_game_dir ./my_game.md
  ```

### MCP Server for AI Agents (`scad-gltf mcp`)

Configure any [Model Context Protocol](https://modelcontextprotocol.io/) client to run `scad-gltf mcp` so AI assistants can retrieve syntax rules, compile `.scad` models, inspect multi-angle headless renders, and test Godot/Rust/UE projects.

**Example MCP `config.json`:**

```json
{
  "mcpServers": {
    "scad-gltf": {
      "command": "scad-gltf",
      "args": ["mcp"]
    }
  }
}
```

**Exposed MCP Tools:**

- `get_project_prompt`: Returns syntax rules and project guidelines for `scad`, `bevy`, `wgpu`, `web`, `godot`, or `ue`, with optional `options` feature toggles and `scadFiles` paths.
- `render_scad_model`: Compiles `.scad` code to GLB and returns base64 PNG renders from requested angles (`front`, `back`, `left`, `right`, `top`, `bottom`, `isometric`; defaults to `["front", "top", "isometric"]`) at `animation_time` / `animation_index`, supporting `dependencies` (`{ [relativePath]: scadCode }`) and `return_images: false`.
- `generate_scad_preview_link`: Creates a compressed Scadify URL (`https://iliagrigorevdev.github.io/scad-gltf/#c...`) for interactive browser inspection.
- `test_godot_project`: Extracts a Markdown Godot 4 project, imports assets headlessly, runs for `run_time` seconds (default `5.0`), and returns logs + screenshot (uses `xvfb-run` on Linux).
- `compile_rust_project`: Extracts a Markdown Rust (`bevy` or `wgpu`) project and runs `cargo check` (2-minute timeout).
- `compile_ue_project`: Extracts a Markdown UE5 project and builds it with Unreal Build Tool (4-minute timeout; requires `UE_ROOT`).

**Typical AI Agent Workflow:**

1. Assistant calls `get_project_prompt` to load the extended syntax and project rules.
2. Assistant writes `.scad` (or full project) code and calls `render_scad_model` (and `test_godot_project` / `compile_rust_project` / `compile_ue_project`) to visually inspect renders and compiler/runtime logs, fixing issues before presenting the final output.

### Environment Variables

| Variable          | Description                                                                                                                                                                                    |
| :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENAI_BASE_URL` | Base URL of an OpenAI-compatible `/chat/completions` endpoint for `scad-gltf gen`.                                                                                                             |
| `OPENAI_API_KEY`  | Optional Bearer API key for `scad-gltf gen`.                                                                                                                                                   |
| `OPENAI_MODEL`    | Model name sent in `scad-gltf gen` requests.                                                                                                                                                   |
| `VERBOSE`         | When set (or pass `--verbose` / `-v`), prints full AI reasoning logs during `scad-gltf gen`.                                                                                                   |
| `UE_ROOT`         | Path to your Unreal Engine installation folder (required for `compile_ue_project`, `scad-gltf play` on UE5 projects, and UE5 builds in `scad-gltf serve`; can also be passed via `--ue-root`). |
| `GODOT_BIN`       | Optional path to a Godot executable used by `getGodotBin()` / `scad-gltf serve` (falls back to `godot` on `PATH` or auto-downloads into `.godot-bin/`; can also be passed via `--godot-bin`).  |

---

## 3. JavaScript / Node.js API

Install the package locally in your project:

```bash
npm install scad-gltf
```

### Compiling OpenSCAD (`scad-gltf/convert`)

#### Node.js

Because the Emscripten WASM loader expects the standard `fetch()` API, Node.js scripts should point `wasmUrl` to `openscad.wasm` and polyfill `fetch` for `file://` URLs:

```javascript
import {
  convertScad,
  convertScadToGltf,
  convertScadTo3MF,
  SUPPORTED_EXTENSIONS,
} from "scad-gltf/convert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const wasmPath = path.resolve("node_modules/scad-gltf/ext/openscad.wasm");

global.fetch = async (url) => {
  const normalizedPath = url.toString().startsWith("file://")
    ? fileURLToPath(url.toString())
    : url.toString();

  const buffer = fs.readFileSync(normalizedPath);
  return new Response(buffer, {
    status: 200,
    headers: { "Content-Type": "application/wasm" },
  });
};

const scadCode = `
  include <parts/handle.scad>
  color("gold", metalness=1.0, roughness=0.2)
  sphere(r=size);
`;

async function buildModel() {
  // 1. Compile SCAD to a binary GLB Uint8Array
  const glbData = await convertScadToGltf(scadCode, {
    wasmUrl: `file://${wasmPath}`,
    binary: true,
    variables: { size: 12 },
    additionalFiles: {
      "parts/handle.scad": "module handle() { cylinder(h=10, r=2); }",
    },
  });
  fs.writeFileSync("output.glb", glbData);

  // 2. Compile to 3MF for 3D printing
  const threeMfData = await convertScadTo3MF(scadCode, {
    wasmUrl: `file://${wasmPath}`,
    lazyUnion: true,
    variables: { size: 12 },
    additionalFiles: {
      "parts/handle.scad": "module handle() { cylinder(h=10, r=2); }",
    },
  });
  fs.writeFileSync("output.3mf", threeMfData);

  // 3. Compile to any supported format (stl, obj, svg, off, wrl, csg, gltf, glb, 3mf)
  console.log("Supported formats:", [...SUPPORTED_EXTENSIONS]);
  const stlData = await convertScad(scadCode, "stl", {
    wasmUrl: `file://${wasmPath}`,
    variables: { size: 12 },
    additionalFiles: {
      "parts/handle.scad": "module handle() { cylinder(h=10, r=2); }",
    },
  });
  fs.writeFileSync("output.stl", stlData);
}

buildModel();
```

#### Compiler Options Reference

| Option            | Type      | Default     | Description                                                                                      |
| :---------------- | :-------- | :---------- | :----------------------------------------------------------------------------------------------- |
| `wasmUrl`         | `string`  | `undefined` | Absolute file URL or HTTP URL pointing to `openscad.wasm`.                                       |
| `binary`          | `boolean` | `true`      | When `true`, outputs binary GLB. When `false`, outputs glTF JSON.                                |
| `variables`       | `Object`  | `undefined` | Key-value pairs passed as `-D <key>=<value>` parameters to OpenSCAD.                             |
| `lazyUnion`       | `boolean` | `false`     | Enables OpenSCAD `--enable=lazy-union` optimization.                                             |
| `additionalFiles` | `Object`  | `{}`        | Map of relative virtual file paths to file contents for resolving `include <...>` / `use <...>`. |

#### Web Bundlers (Vite / Webpack)

In browser builds, you do not need to mock `fetch`—import the WASM asset URL directly:

```javascript
import wasmUrl from "scad-gltf/openscad.wasm?url";
import { convertScadToGltf } from "scad-gltf/convert";

const scadCode = `cylinder(h=20, r=5);`;
const glbData = await convertScadToGltf(scadCode, { wasmUrl });
```

### AI Prompt Generation (`scad-gltf/prompt`)

Use `generatePrompt` for standalone OpenSCAD rules, `buildProfilePrompt` for complete target-engine prompts (`"scad"`, `"godot"`, `"web"`, `"bevy"`, `"wgpu"`, `"ue"`), or `buildRefinementPrompt` / `getRefinementPatchRules` for incremental patch follow-ups:

```javascript
import {
  generatePrompt,
  buildProfilePrompt,
  buildRefinementPrompt,
  getRefinementPatchRules,
  PROMPT_PROFILES,
  getPromptProfile,
  getEditorPromptProfiles,
} from "scad-gltf/prompt";

const description =
  "a futuristic robot arm with flexible rubber joints and glowing metallic plating, animated to bend";

const promptContext = generatePrompt(description, {
  basic: true, // Metalness and roughness
  materialName: true, // color(..., name="...") material naming rules (defaults to `basic`)
  transmission: true, // Glass, transmission, ior, thickness
  clearcoat: true, // Clearcoat layers
  sheen: true, // Fabric sheen
  emissive: true, // Glow parameters
  specular: true, // Specular overrides
  iridescence: true, // Thin-film interference
  unlit: true, // Shadeless unlit material rules
  colormap: false, // Procedural colormap() & bake() atlas rules
  autoSmoothAngle: true, // $asa rules
  animation: true, // Armature, bone & skinning syntax
  lights: false, // Light rules
  bakeColors: false, // Texture baking flags
  bakeNormals: false,
  bakeOrm: false,
  bakeUvs: false,
  lazyUnion: false, // Document --enable=lazy-union behavior
  modelName: true, // Include /* Model Name: ... */ output instruction
});

const projectPrompt = buildProfilePrompt("godot", {
  task: "A third-person 3D robot platformer with animated collectibles",
  promptOptions: { animation: true, emissive: true },
});

const refinementPrompt = buildRefinementPrompt({
  projectContent: existingMarkdownBundle,
  refinementRequest: "Increase wheel radius and add headlights",
});
```

### Markdown & SCAD Utilities (`scad-gltf/utils`)

Environment-agnostic helpers (browser and Node.js) for working with `.scad` files, `### filepath` Markdown bundles, and incremental Markdown patches:

- **Extraction & Serialization:**
  - `extractFilesFromMarkdown(mdContent)` — Parses `### filepath` blocks (with fallback for single OpenSCAD code blocks).
  - `packFilesToMarkdown(files)` — Serializes a `{ [filepath]: content }` map into a single Markdown bundle.
  - `extractRootFolderFromMarkdownFiles(files)` — Returns the shared top-level folder name when all files in a bundle live under one root directory.
  - `extractModelNameFromScad(scadCode)` — Extracts and sanitizes `/* Model Name: ... */`.
  - `extractScadDependencies(scadCode)` — Finds relative paths imported via `include` or `use`.
- **Path & Fence Helpers:**
  - `normalizeRepoPath(filePath)`, `isScadFilePath(filePath)`, `getMarkdownLangFromPath(filepath)` — Path normalization, `.scad` checks, and Markdown fence language mapping.
  - `normalizeMarkdownHeaderPath(rawPath)`, `parseMarkdownFileHeader(line)` — Header path parsing and formatting cleanup (`**...**`, `` `...` ``).
  - `getSafeFenceForContent(content)`, `parseFenceOpen(line)`, `isFenceClose(line, fenceChar, fenceLen)` — Fence-safe backtick/tilde parsing and generation.
- **Markdown Patching:**
  - `replaceFileInMarkdown(mdContent, targetPath, newFileContent)` / `removeFileFromMarkdown(mdContent, targetPath)` — In-place replacement or removal of file blocks in a Markdown bundle.
  - `parseSearchReplaceBlocks(content)` / `applySearchReplaceHunks(originalContent, hunks)` — Parses and applies `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` hunks.
  - `parseMarkdownPatchEntries(rawPatchText)`, `resolveMarkdownPatchTarget(existingPaths, incomingPath, rootFolder)`, `evaluatePatchEntryAgainstFiles(entry, targetPath, existingFilesMap, remappedFrom)` — Parses patch headings (including `(DELETE)` and `<!-- DELETE -->`) and resolves root-prefix remapping.
  - `analyzeMarkdownPatch(existingMd, patchText, options)` / `applyMarkdownPatchPlan(existingMd, planItems)` — Computes a full patch plan with diff/error metadata and applies selected items cleanly.

---

## 4. Extended OpenSCAD Syntax

This custom fork introduces syntax extensions not found in standard OpenSCAD.

### PBR Materials, Procedural Colormaps & Smooth Shading

The `color()` module accepts glTF PBR attributes, procedural `colormap` functions, and `$asa` auto-smooth shading:

```openscad
// Set default auto smooth angle globally (surface normals only; does not change polygon count)
$asa = 30.0;

color(
    "white",
    name = "my_material",               // Optional glTF material name (e.g., Godot resource_name)
    roughness = 0.0,                    // 0.0 (glossy) to 1.0 (matte)
    metalness = 1.0,                    // 1.0 for metals, blocks light transmission
    transmission = 0.9,                 // 0.0 to 1.0 for glass/water (requires alpha=1.0)
    thickness = 2.0,                    // Volume thickness for refraction
    ior = 1.5,                          // Index of refraction (Water: ~1.33, Glass: ~1.5, Diamond: ~2.4)
    attenuationColor = [1.0, 1.0, 1.0], // Tint of light passing through volume
    attenuationDistance = 0.0,          // Distance light travels before fully tinted
    clearcoat = 1.0,                    // Reflective top clearcoat layer
    clearcoatRoughness = 0.1,
    sheen = 1.0,                        // Microfiber backscattering (cloth/velvet)
    sheenColor = [1.0, 0.5, 0.5],
    sheenRoughness = 0.2,
    emissive = [0.0, 0.0, 0.0],         // Glowing color (RGB vector)
    emissiveIntensity = 1.0,            // Multiplier for emissive glow
    specularColor = [1.0, 1.0, 1.0],    // Tint for specular reflections
    specularIntensity = 1.0,            // Strength of specular reflections
    iridescence = 0.0,                  // Thin-film interference
    iridescenceIOR = 1.3,
    unlit = false,                      // Shadeless material unaffected by lighting
    colormap = function(x, y, z) [0.5, 0.5, 0.5, 1.0], // Procedural 3D->RGBA surface texture
    $asa = 45.0                         // Smooth vertex normals below angle threshold
) {
    cylinder(h=10, r=5);
}
```

#### Procedural `colormap` Functions

Because OpenSCAD separates function and variable namespaces, passing a function name directly (e.g. `colormap=my_func`) evaluates to `undef`. Always wrap custom functions in a function literal:

```openscad
function pattern(x, y, z) = [sin(x * 10) / 2 + 0.5, cos(y * 10) / 2 + 0.5, 0.5, 1.0];

// Auto-unwraps and bakes into a 256x256 texture by default; wrap in bake() to customize
bake(resolution=512) {
  color("white", colormap=function(x, y, z) pattern(x, y, z))
    cube([10, 10, 10]);
}
```

### Hierarchical Node Animations & Skeletal Skinning

#### Rigid Parenting

Meshes placed directly inside a `bone()` module attach rigidly to that bone's transform:

```openscad
anim_data = [
  ["Swing", [
    // Format: ["BoneName", [ [time_in_sec, [rot_x, y, z], [trans_x, y, z]], ... ]]
    ["Pendulum", [
      [0.0, [0, 0, 0],   [0, 0, 10]],
      [1.0, [0, 45, 0],  [0, 0, 10]],
      [2.0, [0, -45, 0], [0, 0, 10]],
      [3.0, [0, 0, 0],   [0, 0, 10]]
    ]]
  ]]
];

armature(animations = anim_data) {
    bone(name="Pendulum", t=[0, 0, 10], r=[0, 0, 0]) {
        color("silver", metalness=0.9, roughness=0.1)
        cylinder(h=10, r=1, center=false);
    }
}
```

**Keyframe & Camera Rules:**

- **Rotation Subdivision:** Due to glTF quaternion shortest-path interpolation, never rotate more than 90° between consecutive keyframes (split 360° rotations into 90° steps: `0`, `90`, `180`, `270`, `360`).
- **Absolute Local Keyframes:** Keyframe translations and rotations are absolute in local space and replace resting `t` and `r` during playback (omitted translation defaults to resting `t`).
- **Animated Cameras:** Naming a bone `"Camera"` or `"camera"` exports an animated glTF camera looking forward along `+Y` with `+Z` up (supports `"Camera1"`, `"Camera_fov60"`, `"Camera_ortho_mag10"`; part names like `"CameraMount"` are ignored).

#### Skeletal Skinning (Smooth Mesh Deformation)

Place `skin()` directly inside `armature()` (outside the `bone()` hierarchy) with a `function(x, y, z)` returning bone weights (auto-normalized and capped to the 4 strongest bones):

```openscad
anim_data = [
  ["Bend", [
    ["TopBone", [
      [0.0, [0, 0, 0]],
      [1.0, [0, 45, 0]],
      [2.0, [0, 0, 0]]
    ]]
  ]]
];

armature(animations = anim_data) {
  skin(bones=["BottomBone", "TopBone"], weights=function(x, y, z) [1.0 - (z / 10), z / 10]) {
    color([0.2, 0.6, 1.0]) cylinder(h=10, r=2, $fn=32);
  }

  bone(name="BottomBone", t=[0, 0, 0], r=[0, 0, 0]) {
    color("gray") cube([8, 8, 2], center=true);
    bone(name="TopBone", t=[0, 0, 10], r=[0, 0, 0]) {}
  }
}
```

### Texture Baking

```openscad
// Two-child syntax: projects Child 1 (High Poly) onto Child 2 (Low Poly)
bake(
    colors = true,       // Project and bake base color
    normals = true,      // Bake tangent-space normal map
    orm = false,         // Bake Occlusion/Roughness/Metallic map
    resolution = 1024,   // Output texture resolution (default: 256)
    distance = 2.0,      // Max raycast distance
    bias = 1e-4,         // Raycast origin offset
    dilation = 2,        // Pixel padding around UV islands
    msaa = 2,            // Anti-aliasing supersampling level
    index = 0,           // Atlas group index (index > 0 shares atlas across meshes)
    rotate_uvs = true    // Allow UV island rotation for tighter packing
) {
    color("white") sphere(r=10, $fn=100);                         // Child 1: High Poly
    color("white", roughness=0.5, $asa=45) sphere(r=10, $fn=20);  // Child 2: Low Poly
}

// Single-child syntax: generate UV coordinates & tangents (or configure colormap atlas)
bake(resolution=512, index=1) {
    color("gold", metalness=1.0) cube([10, 10, 10]);
}
```

### Scene Lighting

Add `"directional"`, `"point"`, or `"spot"` glTF lights (`directional` and `spot` shine along `-Z` by default; directional lights use Lux, while point/spot lights use Candelas with inverse-square falloff):

```openscad
translate([0, 0, 50]) rotate([0, 30, 0])
  light(type="spot", color=[1, 0.8, 0.8], intensity=5000.0, range=0.0, innerConeAngle=15.0, outerConeAngle=30.0)
    color("gray") cylinder(h=2, r=1, center=true);
```

---

## 5. Development

### Building for WebAssembly

If you modify the C++ code in `openscad/`, rebuild the WASM binaries using the Docker Emscripten wrapper:

```bash
cd openscad
./scripts/wasm-base-docker-run.sh emcmake cmake -B build-web -DCMAKE_BUILD_TYPE=Release -DEXPERIMENTAL=1
./scripts/wasm-base-docker-run.sh cmake --build build-web -j2
cp build-web/openscad.js ../ext/
cp build-web/openscad.wasm ../ext/
```

### Updating the OpenSCAD Subtree

```bash
git status
git remote add openscad https://github.com/openscad/openscad.git   # if not already added
git subtree pull --prefix=openscad openscad master --squash
# Resolve any merge conflicts, then:
git add .
git commit
```

### Godot Web Runtime & Headless Setup

Playing `.md` Godot projects in Scadify uses Godot's single-threaded Web export libraries (`godot.js` and `godot.wasm` from `web_nothreads_release.zip`) placed in `editor/public/godot/`. They are installed automatically via `predev` / `prebuild` in `editor/`, or manually:

```bash
cd editor
npm run setup:godot
```

For `scad-gltf play` and `test_godot_project`, if `godot` is not on `PATH`, `scad-gltf` automatically downloads the Godot binary into `.godot-bin/`. On headless Linux, `test_godot_project` requires `xvfb`:

```bash
sudo apt-get install xvfb
```

---

## Architecture & Credits

- **Core Engine:** Built on a custom fork of [OpenSCAD](https://openscad.org/) (source in `openscad/`).
- **glTF Export:** Uses [tinygltf](https://github.com/syoyo/tinygltf).
- **Godot Web Runtime:** In-browser `.md` project playback uses the [Godot Engine](https://godotengine.org/).
- **UV Unwrapping:** Texture baking uses [xatlas](https://github.com/jpcy/xatlas).
- **Path Tracing:** Scadify uses [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer).
- **Environment Map (HDR):** [Aristea Wreck Puresky](https://polyhaven.com/a/aristea_wreck_puresky) by **Jarod Guest** via [Poly Haven](https://polyhaven.com/) ([CC0](https://polyhaven.com/license)).
- **License:** See `LICENSE` (GPL-2.0 or later, inheriting from standard OpenSCAD).
