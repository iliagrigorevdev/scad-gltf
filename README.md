# SCAD GLTF

A powerful WebAssembly (WASM) build of a custom OpenSCAD fork that enables direct compilation of OpenSCAD (`.scad`) scripts to **glTF/GLB** formats natively in JavaScript (Node.js and Browser).

Unlike standard OpenSCAD, this custom engine supports **Physically Based Rendering (PBR)** materials, **Hierarchical Skeletal Animations**, and **Texture Baking**, making it a perfect bridge between procedural CAD generation and modern 3D web rendering engines (like Three.js or Babylon.js).

The C++ source code for this custom OpenSCAD version is included directly in this repository within the `openscad/` subfolder.

**✨ Launch Scadify:** Open the web editor and real-time 3D viewer: [https://iliagrigorevdev.github.io/scad-gltf/](https://iliagrigorevdev.github.io/scad-gltf/)

![Editor Screenshot](screenshot.png)

## Features

- **Direct SCAD to GLB conversion:** Compile geometry directly to web-ready binary glTF.
- **Extended PBR Material Support:** Native extensions to the OpenSCAD `color()` module supporting `metalness`, `roughness`, `transmission` (glass), `thickness`, `ior`, `attenuationColor`, `attenuationDistance`, `clearcoat`, `sheen`, `emissive`, `specular`, and `iridescence`, plus a `$asa` special variable for auto smooth shading.
- **Skeletal Animation:** Define animated armatures and bones directly within your `.scad` files.
- **True Skeletal Skinning:** Exports absolute world transforms and properly bound animation tracks.
- **Texture Baking:** Automatically generate UVs and bake high-poly details (colors, normals, ORM) onto low-poly meshes using the new `bake()` module.
- **Web Editor & Real-time Viewer (Scadify):** In-browser IDE with live WebAssembly compilation, GPU path tracing, animation timeline scrubbing, video/image export, URL sharing, and drag-and-drop.
- **LLM Friendly:** Includes a built-in modular prompt generator (`prompt.js` and Web UI) to help AI models (like Gemini, Claude, or ChatGPT) write compatible OpenSCAD scripts utilizing the new features.
- **Local API Server & Editor:** Bundled `scad-serve` CLI utility to manage local `.scad` files remotely via REST API with automatic `include`/`use` dependency resolution.
- **CLI Converter:** Bundled `scad-convert` CLI utility for single file and batch compiling `.scad` files with smart dependency hashing.
- **MCP Server for AI Agents:** Bundled `scad-mcp` server enables MCP clients to iteratively design, compile, and **visually inspect** 3D models via multi-angle headless rendering and animation frame evaluation.
- **AI Studio Extension:** Chrome extension to natively preview, prompt, take chat snapshots, open in Scadify, and locally save AI-generated 3D models directly inside Google AI Studio.

---

## ✨ Scadify Web Editor

The built-in web editor (**Scadify**) provides a full-featured development environment running entirely in the browser via WebAssembly:

- **Real-Time 3D Viewport:** Instant WebAssembly compilation with auto-rendering, camera auto-framing, wireframe view, grid/axes toggles, ACES Filmic tone mapping, and full-screen mode.
- **Photorealistic GPU Path Tracing:** Built-in hardware-accelerated path tracer with HDR environment lighting for realistic reflections, shadows, and glass refraction.
- **Interactive Animation Controls:** Multi-animation selector, playback controls (play/pause), and smooth timeline scrubbing for skeletal rigs.
- **Modular AI Prompt Generator:** Built-in UI with fine-grained feature toggles (Basic PBR, Auto Smooth, Animations, Extended PBR, Texture Baking) and persistent local settings to generate optimized prompts for LLMs.
- **Image & Video Capture:**
  - **📷 PNG Snapshots:** Export high-resolution renders with a single click.
  - **🎥 Video Recording:** Record animation loops directly to MP4/WebM. When Path Tracing is enabled, frames are rendered deterministically for jitter-free, ultra-high-quality animated video captures.
- **Compressed URL Sharing:** Share your designs instantly via URL hash using client-side raw Deflate compression with an optional **Minify Share** toggle to strip comments and whitespace. Integrates with the Web Share API on supported devices.
- **File Management & Drag and Drop:** Load local `.scad` files, drop any `.scad` script directly onto the viewport, download `.scad` source code, or export `.glb` binaries.
- **Automatic Model Naming:** Extracts model names automatically from `/* Model Name: ... */` header comments for file downloads and exports.
- **Local Workspace Sync:** Connect to `scad-serve` on localhost to load, edit, save, and delete `.scad` files with change detection and recursive dependency resolution (`include` / `use`).
- **PWA Support:** Installable as a Progressive Web App for desktop and mobile.

---

## Installation

This package is designed to be installed directly from GitHub.

**Option 1: Global Installation (Recommended for CLI usage)**
If you plan to use the `scad-convert`, `scad-serve`, or `scad-mcp` command-line tools anywhere on your system:

```bash
npm install -g github:iliagrigorevdev/scad-gltf
```

**Option 2: Local Installation (For Node.js / Web bundlers)**
If you are importing the package into a JavaScript project:

```bash
npm install github:iliagrigorevdev/scad-gltf
```

---

## Usage (JavaScript / Node.js)

The package provides a convenient `convert.js` wrapper to handle the Emscripten WASM lifecycle, virtual file system, and dependency resolution.

_Note: Because the underlying WASM loader was compiled for the web, it expects the modern `fetch()` API. In Node.js, we provide the path to the `.wasm` file and polyfill `fetch` so it can read local files from disk._

```javascript
import { convertScadToGltf } from "scad-gltf/convert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 1. Locate the WASM file inside node_modules
const wasmPath = path.resolve("node_modules/scad-gltf/src/ext/openscad.wasm");

// 2. Mock fetch to allow the WASM loader to read local files in Node.js
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
  try {
    // 3. Compile SCAD to a GLB Uint8Array
    const glbData = await convertScadToGltf(scadCode, {
      wasmUrl: `file://${wasmPath}`,
      binary: true, // true for binary .glb, false for .gltf
      variables: { size: 12 }, // Pass -D key=value parameters
      additionalFiles: {
        // Virtual files for include/use resolution
        "parts/handle.scad": "module handle() { cylinder(h=10, r=2); }",
      },
    });

    // Save to disk (or send to a client, load into Three.js, etc.)
    fs.writeFileSync("output.glb", glbData);
    console.log("Successfully compiled to output.glb!");
  } catch (error) {
    console.error("Compilation failed:", error);
  }
}

buildModel();
```

### Compiler Options Reference

| Option            | Type      | Default     | Description                                                                                      |
| :---------------- | :-------- | :---------- | :----------------------------------------------------------------------------------------------- |
| `wasmUrl`         | `string`  | `undefined` | Absolute file URL or HTTP URL pointing to `openscad.wasm`.                                       |
| `binary`          | `boolean` | `true`      | When `true`, outputs binary GLB. When `false`, outputs glTF text/JSON.                           |
| `variables`       | `Object`  | `undefined` | Key-value pairs passed as `-D <key>=<value>` parameters to OpenSCAD.                             |
| `additionalFiles` | `Object`  | `{}`        | Map of relative virtual file paths to file contents for resolving `include <...>` / `use <...>`. |

### Using in Web Bundlers (Webpack / Vite)

In a browser or Vite project, you do not need to mock `fetch`. Just provide the bundled URL to the `.wasm` file:

```javascript
import wasmUrl from "scad-gltf/openscad.wasm?url";
import { convertScadToGltf } from "scad-gltf/convert";

const scadCode = `cylinder(h=20, r=5);`;

const glbData = await convertScadToGltf(scadCode, { wasmUrl });
```

---

## Command Line Conversion (`scad-convert`)

The package includes a CLI utility to convert `.scad` files to `.glb` directly from your terminal. It supports single files or entire directories, and features smart caching with dependency resolution to speed up build pipelines.

**Usage:**

```bash
scad-convert <input.scad | input_dir> <output.glb | output_dir> [options_json] [--cache]
```

**Examples:**

- **Single File:**
  ```bash
  scad-convert model.scad model.glb
  ```
- **Directory Batch Conversion:**
  ```bash
  scad-convert ./src_models ./out_glbs
  ```
- **With Smart Caching (`--cache`):**
  Generates a `.import` file containing a SHA-256 hash of the `.scad` file (including any recursively resolved `include` or `use` files) and compiler options. Subsequent runs skip recompilation if no changes are detected.
  ```bash
  scad-convert ./src_models ./out_glbs --cache
  ```
- **With Options:**
  Pass custom compiler options as a JSON string (or Base64 encoded JSON string):
  ```bash
  scad-convert model.scad model.glb '{"variables": {"size": 20}}'
  ```

---

## Local File Management & Web Editor (`scad-serve`)

`scad-serve` provides a local REST API to manage `.scad` files and perform in-memory SCAD-to-GLB conversions. It automatically builds and serves the Scadify Web Editor UI.

It operates strictly on the working directory where the command is executed.

**Start the server:**

```bash
scad-serve
```

**Available Endpoints:**

- `GET /api/scads`
  - Lists all `.scad` files in the current working directory.
- `GET /api/scads/:filename`
  - Retrieves the text content of a specific `.scad` file.
- `POST /api/scads`
  - Creates or updates a `.scad` file on disk.
  - **Body:** `{ "filename": "model.scad", "content": "cube(10);" }`
- `DELETE /api/scads/:filename`
  - Deletes a `.scad` file.
- `POST /api/convert`
  - In-memory compilation from SCAD string to GLB binary without touching the filesystem.
  - **Body:** `{ "content": "sphere(r=10);", "options": { "variables": { "r": 10 } } }`
  - **Response:** Binary GLB data (`model/gltf-binary`).

---

## 🧩 Google AI Studio Extension

This repository includes a Chrome/Chromium extension located in the [`/editor`](./editor) directory that brings native 3D rendering and visual iteration tools to [Google AI Studio](https://aistudio.google.com/).

When asking an LLM (like Gemini) to generate OpenSCAD code, the extension automatically detects the output and injects interactive controls directly into the chat interface:

- **Instant 3D Preview:** Injects a **"Preview 3D"** button on any OpenSCAD code block to compile and render the model in an embedded 3D viewer with grid, wireframe, and full-screen support.
- **Visual Chat Feedback (📷):** Click the snapshot button inside the 3D preview window to capture a PNG snapshot of the model and **automatically paste it into the AI Studio chat input**, allowing Gemini to visually evaluate and fix geometry.
- **Smart Prompt Injection:** Click the floating **"✨ SCAD"** button to open the configuration modal. Select your desired engine feature set (PBR, auto-smooth, animations, baking) to automatically generate and inject the prompt rules into your chat input.
- **Open in Scadify:** Click **"Edit"** in the preview window to immediately transfer the current script into the full standalone Scadify editor via compressed URL hash.
- **Local Workspace Saving:** Directly save and overwrite models to your local directory when running `scad-serve`.

### Installation (Chrome / Edge / Brave)

1. **Clone the repository** to your machine:
   ```bash
   git clone https://github.com/iliagrigorevdev/scad-gltf.git
   cd scad-gltf/editor
   ```
2. **Build the extension**:
   ```bash
   npm install
   npm run build
   ```
3. **Load the unpacked extension**:
   - Open your browser and navigate to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top right corner).
   - Click the **Load unpacked** button.
   - Select the `dist/` folder located inside the `editor/` directory (`scad-gltf/editor/dist`).

### Usage

1. Open [Google AI Studio](https://aistudio.google.com/).
2. Click the floating **"✨ SCAD"** button in the bottom-left corner to choose the features you want the AI to use and paste the prompt into the chat.
3. When the AI returns code, click **"Preview 3D"** above the code block.
4. Use the 📷 button in the preview window to send renders back to the AI for visual debugging or click **"Edit"** to open it in Scadify.

---

## 🤖 Model Context Protocol (MCP) Server

This package includes a native [MCP Server](https://modelcontextprotocol.io/) (`scad-mcp`) designed to give AI assistants **visual feedback** during the 3D modeling process.

Instead of generating code blindly, the AI can compile its script, render the 3D scene in a headless browser (Puppeteer + Three.js), and evaluate multi-angle snapshots to iteratively fix geometric or animation errors.

**Exposed MCP Tools:**

- `get_scad_prompt`: Injects the custom OpenSCAD syntax rules (PBR, animations, baking) into the AI's context.
- `render_scad_model`: Compiles the generated `.scad` code to GLB and returns base64 images from requested camera angles (front, back, left, right, top, bottom, isometric) and specific animation keyframes.

### Setup

If you installed the package globally, you can configure your MCP client to use the `scad-mcp` command directly.

**Example `config.json`:**

```json
{
  "mcpServers": {
    "scad-mcp": {
      "command": "scad-mcp",
      "args": []
    }
  }
}
```

---

## 🎮 Godot Engine Integration

This repository includes an official **Godot 4.x Importer Addon** located in the [`/godot`](./godot) directory.

The addon allows you to drag-and-drop `.scad` files directly into your Godot project. It uses this WASM compiler under the hood to transform scripts into 3D scenes automatically.

- **Features:** Supports PBR Materials and Skeletal Animations inside the Godot Editor.
- **License:** The Godot Addon is licensed under **MIT**.
- **Setup:** Simply copy the `addons/scad_importer` folder to your project and enable it in Project Settings.

---

## Extended OpenSCAD Syntax

This custom fork introduces new syntax not found in standard OpenSCAD.

### 1. PBR Materials & Smooth Shading

The standard `color()` module has been extended with standard glTF PBR attributes and auto smooth normals:

```openscad
// You can set the default auto smooth angle globally
$asa = 30.0;

color(
    "white",
    roughness = 0.0,                    // 0.0 (glossy) to 1.0 (matte)
    metalness = 1.0,                    // 1.0 for metals, blocks light transmission
    transmission = 0.9,                 // 0.0 to 1.0 for glass/water transparency (requires alpha=1.0)
    thickness = 2.0,                    // Volume thickness for refraction
    ior = 1.5,                          // Index of refraction (Water: ~1.33, Glass: ~1.5, Diamond: ~2.4)
    attenuationColor = [1.0, 1.0, 1.0], // Tint of light passing through volume
    attenuationDistance = 0.0,          // Distance light travels before fully tinted
    clearcoat = 1.0,                    // Reflective top clearcoat layer (car paint/varnish)
    clearcoatRoughness = 0.1,
    sheen = 1.0,                        // Microfiber backscattering (cloth/velvet rim light)
    sheenColor = [1.0, 0.5, 0.5],
    sheenRoughness = 0.2,
    emissive = [0.0, 0.0, 0.0],          // Glowing color (RGB vector)
    emissiveIntensity = 1.0,             // Multiplier for emissive glow
    specularColor = [1.0, 1.0, 1.0],     // Tint for specular reflections
    specularIntensity = 1.0,             // Strength of specular reflections
    iridescence = 0.0,                   // Thin-film interference (soap bubbles, oil sheen)
    iridescenceIOR = 1.3,
    $asa = 45.0                          // Generates smooth vertex normals below this angle threshold.
                                         // Surface shading only; does NOT alter polygon count.
) {
    cylinder(h=10, r=5);
}
```

### 2. Skeletal Animations

Define hierarchical armatures, resting positions, and keyframe animations:

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

### 3. Texture Baking

Project details from a high-resolution mesh onto a low-resolution mesh using the `bake()` module. This auto-generates UVs and can output solid colors, tangent-space normals, and ORM (Occlusion/Roughness/Metallic) textures.

```openscad
// Two-child syntax: projects Child 1 (High Poly) onto Child 2 (Low Poly)
bake(
    colors = true,       // Project and bake base color
    normals = true,      // Bake tangent-space normal map
    orm = false,         // Bake Occlusion/Roughness/Metallic map
    resolution = 1024,   // Output texture resolution
    distance = 2.0,      // Max raycast distance
    bias = 1e-4,         // Raycast origin offset
    dilation = 2,        // Pixel padding around UV islands
    msaa = 2,            // Anti-aliasing level (supersampling)
    index = 0,           // Atlas group index (meshes sharing an index share the same atlas)
    rotate_uvs = true    // Allow UV island rotation for optimal packing
) {
    color("white") sphere(r=10, $fn=100);                         // Child 1: High Poly Source
    color("white", roughness=0.5, $asa=45) sphere(r=10, $fn=20);  // Child 2: Low Poly Target
}

// Single-child syntax: Generate UV coordinates & tangents for a mesh without a high-poly source
bake(uvs=true) {
    color("gold", metalness=1.0) cube([10, 10, 10]);
}
```

---

## AI Integration (`prompt.js`)

Because LLMs (like Gemini or Claude) only know standard OpenSCAD syntax up to their training cutoff, we've included a helper function to generate LLM prompts. This injects the rules for PBR, animations, and baking directly into your prompt context.

**Usage:**

```javascript
import { generatePrompt } from "scad-gltf/prompt";

const description =
  "a futuristic glass sword with a glowing metallic handle, animated to spin 360 degrees";
const promptContext = generatePrompt(description, {
  basic: true, // Metalness and roughness
  transmission: true, // Glass, transmission, ior, thickness
  clearcoat: true, // Clearcoat layers
  sheen: true, // Fabric sheen
  emissive: true, // Glow parameters
  specular: true, // Specular overrides
  iridescence: true, // Thin-film interference
  autoSmoothAngle: true, // $asa rules
  animation: true, // Armature & bone syntax
  bakeColors: false, // Texture baking flags
  bakeNormals: false,
  bakeOrm: false,
  bakeUvs: false,
});

// You can now pass this context string directly to an AI API
// or print it to the console to paste into Gemini.
console.log(promptContext);
```

---

### Workflow

Once connected, an AI assistant can use the server to execute the following loop:

1. **Retrieve Syntax Rules:** The assistant calls the `get_scad_prompt` tool to get the extended syntax rules for PBR materials, skeletal animations, and texture baking.
2. **Generate Code:** The assistant writes the `.scad` script based on your design request.
3. **Compile & Visually Inspect:** The assistant calls the `render_scad_model` tool to inspect rendered multi-angle frames and keyframes, fixing any errors before final export.

---

## Development

### Building for WebAssembly

If you modify the C++ code inside the `openscad/` directory, you will need to recompile the WebAssembly engine. The OpenSCAD subtree provides a convenient Docker wrapper to handle the Emscripten toolchain automatically. Ensure you have Docker installed and running.

1. **Navigate to the `openscad` directory:**
   ```bash
   cd openscad
   ```
2. **Configure the build using the Docker script:**
   ```bash
   ./scripts/wasm-base-docker-run.sh emcmake cmake -B build-web -DCMAKE_BUILD_TYPE=Release -DEXPERIMENTAL=1
   ```
3. **Compile the WASM binaries:**
   ```bash
   ./scripts/wasm-base-docker-run.sh cmake --build build-web -j2
   ```
4. **Copy the compiled artifacts back to the JavaScript extension:**
   ```bash
   cp build-web/openscad.js ../src/ext/
   cp build-web/openscad.wasm ../src/ext/
   ```

### Updating the OpenSCAD Subtree

This repository includes a custom fork of OpenSCAD in the `openscad/` subfolder using Git Subtree. If you need to pull upstream updates from the official OpenSCAD repository and merge them with our custom modifications, follow these steps:

1. **Ensure your working tree is clean:**
   ```bash
   git status
   ```
2. **Make sure the upstream remote is added** (you can check with `git remote -v`). If not, add it:
   ```bash
   git remote add openscad https://github.com/openscad/openscad.git
   ```
3. **Pull and merge the upstream changes:**
   ```bash
   git subtree pull --prefix=openscad openscad master --squash
   ```
   _(Note: `--squash` is highly recommended as it prevents the main repository's history from being flooded with thousands of upstream OpenSCAD commits)._
4. **Resolve any merge conflicts:**
   Because we have modified the C++ engine locally within the subfolder, conflicts are expected. Open the conflicting files, resolve the markers, and complete the merge:
   ```bash
   git add .
   git commit
   ```

---

## Architecture & Credits

- **Core Engine:** Built on a custom fork of [OpenSCAD](https://openscad.org/) (source included in the `openscad/` directory).
- **glTF Export:** Export mechanics utilize the [tinygltf](https://github.com/syoyo/tinygltf) library.
- **UV Unwrapping:** Texture baking utilizes the [xatlas](https://github.com/jpcy/xatlas) library for automatic UV parameterization.
- **Path Tracing:** The web editor utilizes [three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer) for high-quality real-time rendering.
- **Environment Map (HDR)**: [Aristea Wreck Puresky](https://polyhaven.com/a/aristea_wreck_puresky) by **Jarod Guest** via [Poly Haven](https://polyhaven.com/). Licensed under [CC0](https://polyhaven.com/license).
- **License:** See the `LICENSE` file (GPL-2.0 or later, inheriting from standard OpenSCAD).
