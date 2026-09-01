# SCAD GLTF

A powerful WebAssembly (WASM) build of a custom OpenSCAD fork that enables direct compilation of OpenSCAD (`.scad`) scripts to **glTF/GLB** formats natively in JavaScript (Node.js and Browser).

Unlike standard OpenSCAD, this custom engine supports **Physically Based Rendering (PBR)** materials, **Hierarchical Skeletal Animations**, and **Texture Baking**, making it a perfect bridge between procedural CAD generation and modern 3D web rendering engines (like Three.js or Babylon.js).

The C++ source code for this custom OpenSCAD version is included directly in this repository within the `openscad/` subfolder.

**✨ Launch Scadify:** Open the web editor and real-time 3D viewer: [https://iliagrigorevdev.github.io/scad-gltf/](https://iliagrigorevdev.github.io/scad-gltf/)

![Editor Screenshot](screenshot.png)

## Features

- **Direct SCAD to GLB conversion:** Compile geometry directly to web-ready binary glTF.
- **Extended PBR Material Support:** Native extensions to the OpenSCAD `color()` module supporting `metalness`, `roughness`, `transmission` (glass), `clearcoat`, `sheen`, `ior`, `emissive`, `specular`, and `iridescence`, plus a `$asa` special variable for auto smooth shading.
- **Skeletal Animation:** Define animated armatures and bones directly within your `.scad` files.
- **True Skeletal Skinning:** Exports absolute world transforms and properly bound animation tracks.
- **Texture Baking:** Automatically generate UVs and bake high-poly details (colors, normals, ORM) onto low-poly meshes using the new `bake()` module.
- **Web Editor & Real-time Viewer (Scadify):** In-browser IDE with live WebAssembly compilation, GPU path tracing, animation timeline scrubbing, video/image export, URL sharing, and drag-and-drop.
- **LLM Friendly:** Includes a built-in prompt generator (`prompt.js` and Web UI) to help AI models (like Gemini, Claude, or ChatGPT) write compatible OpenSCAD scripts utilizing the new features.
- **Local API Server & Editor:** Bundled `scad-serve` CLI utility to manage local `.scad` files remotely via REST API with automatic `include`/`use` dependency resolution.
- **CLI Converter:** Bundled `scad-convert` CLI utility for batch compiling `.scad` files with smart dependency hashing.
- **MCP Server for AI Agents:** Bundled `scad-mcp` server enables MCP clients to iteratively design, compile, and **visually inspect** 3D models via multi-angle headless rendering.
- **AI Studio Extension:** Includes a Chrome extension to natively preview, prompt, and locally save AI-generated 3D models directly inside Google AI Studio.

---

## ✨ Scadify Web Editor

The built-in web editor (**Scadify**) provides a full-featured development environment running entirely in the browser via WebAssembly:

- **Real-Time 3D Viewport:** Instant WebAssembly compilation with auto-rendering, camera auto-framing, wireframe view, grid/axes toggles, and full-screen mode.
- **Photorealistic GPU Path Tracing:** Built-in hardware-accelerated path tracer with HDR environment lighting for realistic reflections, shadows, and glass refraction.
- **Interactive Animation Controls:** Full animation clip playback, pause, and smooth timeline scrubbing for skeletal rigs.
- **Image & Video Capture:**
  - **📷 PNG Snapshots:** Export high-resolution renders with a single click.
  - **🎥 Video Recording:** Record animation loops directly to MP4/WebM. When Path Tracing is enabled, frames are rendered deterministically for jitter-free, ultra-high-quality animated video captures.
- **Compressed URL Sharing:** Share your designs instantly via URL hash using client-side raw Deflate compression with an optional **Minify Share** toggle to strip comments and whitespace. Integrates with the Web Share API on supported devices.
- **Drag and Drop:** Drop any `.scad` file directly onto the viewer to load and render immediately.
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

The package provides a convenient `convert.js` wrapper to handle the Emscripten WASM lifecycle and virtual file system.

_Note: Because the underlying WASM loader was compiled for the web, it expects the modern `fetch()` API. In Node.js, we must provide the absolute path to the `.wasm` file and briefly polyfill `fetch` so it can read local files from disk._

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
  color("gold", metalness=1.0, roughness=0.2)
  sphere(r=10);
`;

async function buildModel() {
  try {
    // 3. Compile SCAD to a GLB Uint8Array
    const glbData = await convertScadToGltf(scadCode, {
      wasmUrl: `file://${wasmPath}`,
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

### Using in Web Bundlers (Webpack / Vite)

If you are using this in a browser, you don't need to mock `fetch`. You just need to provide the URL to the `.wasm` file so the bundler and Emscripten loader can fetch it over HTTP:

```javascript
// Import the WASM file URL (syntax depends on your bundler, e.g., Vite uses ?url)
import wasmUrl from "scad-gltf/openscad.wasm?url";
import { convertScadToGltf } from "scad-gltf/convert";

const scadCode = `cylinder(h=20, r=5);`;

const glbData = await convertScadToGltf(scadCode, { wasmUrl });
```

---

## Command Line Conversion (`scad-convert`)

The package includes a CLI utility to convert `.scad` files to `.glb` directly from your terminal. It supports single files or entire directories, and features a smart caching system to speed up build pipelines.

**Run the converter using one of these options:**

- **Option A: If installed globally**
  ```bash
  scad-convert <input.scad | input_dir> <output.glb | output_dir> [options_json] [--cache]
  ```
- **Option B: If installed as a local dependency**
  ```bash
  npx scad-convert <input.scad | input_dir> <output.glb | output_dir> [options_json] [--cache]
  ```
- **Option C: Run directly (No installation)**
  ```bash
  npx -p github:iliagrigorevdev/scad-gltf scad-convert <input.scad | input_dir> <output.glb | output_dir> [options_json] [--cache]
  ```

**Examples:**

- **Single File:**
  ```bash
  npx scad-convert model.scad model.glb
  ```
- **Directory Batch Conversion:**
  ```bash
  npx scad-convert ./src_models ./out_glbs
  ```
- **With Smart Caching (`--cache`):**
  Works similarly to Godot's asset pipeline. It generates a `.import` file containing a hash of the `.scad` content (including any resolved `include` or `use` dependencies) and compiler options. Subsequent runs will skip the conversion if no changes are detected.
  ```bash
  npx scad-convert ./src_models ./out_glbs --cache
  ```
- **With Options:**
  Pass custom compiler options as a JSON string (or Base64 encoded JSON).
  ```bash
  npx scad-convert model.scad model.glb '{"binary": false}'
  ```

---

## Local File Management & Web Editor (`scad-serve`)

If you are building a web IDE, a generative UI, or using the **AI Studio Extension**, you can use the `scad-serve` utility. It provides a REST API to manage local files and perform in-memory SCAD-to-GLB conversions. It also serves the built-in Editor UI.

It strictly operates **only** on the `.scad` files in the directory where the command is run.

**Start the server using one of these options:**

- **Option A: If installed globally**
  ```bash
  scad-serve
  ```
- **Option B: If installed as a local dependency**
  ```bash
  npx scad-serve
  ```
- **Option C: Run directly (No installation)**
  ```bash
  npx -p github:iliagrigorevdev/scad-gltf scad-serve
  ```

**Optional Arguments:**

- `--port 3000`: Set a custom port (default is 3000).

**Available Endpoints:**

- `GET /api/scads`
  - Lists all `.scad` files in the current working directory.
- `GET /api/scads/:filename`
  - Retrieves the text content of a specific `.scad` file.
- `POST /api/scads`
  - Creates or updates a `.scad` file on disk.
  - **Body Payload:** `{ "filename": "model.scad", "content": "cube(10);" }`
- `DELETE /api/scads/:filename`
  - Deletes a `.scad` file.
- `POST /api/convert`
  - **In-memory conversion:** Compiles raw SCAD string to GLB data without writing to the file system.
  - **Body Payload:** `{ "content": "sphere(r=10);" }`
  - **Response:** Binary GLB data (`model/gltf-binary`).

---

## 🧩 Google AI Studio Extension

This repository includes a Chrome/Chromium extension located in the [`/editor`](./editor) directory that brings native 3D rendering to [Google AI Studio](https://aistudio.google.com/).

When asking an LLM (like Gemini) to generate OpenSCAD code, the extension automatically detects the output and injects a **"Preview 3D"** button directly into the chat interface.

- **Instant Rendering:** Compiles and renders the AI's generated `.scad` code on-the-fly entirely in your browser using this WASM package and Three.js.
- **Seamless Iteration:** No need to copy-paste code to an external viewer; evaluate PBR materials and geometry generated by the AI instantly.
- **Smart Prompting:** Injects a "✨ SCAD" button into the AI Studio interface to instantly open the Prompt Generator modal. Configure your desired features (PBR, Animations, Baking) and securely insert the strict syntax rules into the chat.
- **Local Saving:** Features a built-in UI that seamlessly communicates with the `scad-serve` local backend to save models directly to your machine.

### Installation (Chrome / Edge / Brave)

Since this extension is actively being developed alongside the engine, it can be loaded locally using Developer Mode:

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
   - Enable **Developer mode** (usually a toggle in the top right corner).
   - Click the **Load unpacked** button.
   - Select the newly generated `dist/` folder located inside the `editor/` directory (e.g., `scad-gltf/editor/dist`).

### Usage

1. Open [Google AI Studio](https://aistudio.google.com/).
2. You will notice a new **"✨ SCAD"** button floating in the bottom-left corner. Click it to configure the engine features you want the AI to use and generate the system prompt context.
3. Once the AI generates standard OpenSCAD code block formatting, an **"👀 Preview 3D"** button will appear above the code. Click it to render a high-quality GLTF preview window immediately in the browser.

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

### 1. PBR Materials

The standard `color()` module has been extended with standard glTF PBR attributes:

```openscad
// You can set the default auto smooth angle globally
$asa = 30.0;

color(
    "white",
    roughness = 0.0,           // 0.0 (glossy) to 1.0 (matte)
    metalness = 1.0,           // 1.0 for metals, blocks light transmission
    transmission = 0.9,        // 0.0 to 1.0 for glass/water transparency (requires alpha=1.0)
    thickness = 2.0,           // Volume thickness for refraction
    ior = 1.5,                 // Index of refraction
    attenuationColor = [1.0, 1.0, 1.0], // Color of light passing through volume
    attenuationDistance = 0.0, // Distance light travels before fully tinted
    clearcoat = 1.0,           // Adds a clear reflective top layer (car paint/wet surfaces)
    clearcoatRoughness = 0.1,
    sheen = 1.0,               // Velvet/fabric rim lighting
    sheenColor = [1.0, 0.5, 0.5],
    sheenRoughness = 0.2,
    emissive = [0.0, 0.0, 0.0], // Glowing color
    emissiveIntensity = 1.0,    // Strength of the glow
    specularColor = [1.0, 1.0, 1.0], // Tint for specular highlights
    specularIntensity = 1.0,    // Strength of specular highlights
    iridescence = 0.0,          // Thin-film interference effect (soap bubble)
    iridescenceIOR = 1.3,
    $asa = 45.0                 // Generates smooth vertex normals below this angle threshold (overrides global $asa). Applies to surface shading only, not geometry polygon count. Do not pass $asa to geometry modules.
) {
    cylinder(h=10, r=5);
}
```

### 2. Skeletal Animations

You can now define hierarchical animated parts. Use the `armature` root module to define keyframes, and the `bone` module to define the physical moving parts.

```openscad
armature(animations = [
  ["Swing", [
    // Format: ["BoneName", [ [time_in_sec, [rot_x, y, z], [trans_x, y, z]], ... ]]
    ["Pendulum", [
      [0.0, [0, 0, 0], [0, 0, 0]],
      [1.0, [0, 45, 0], [0, 0, 0]],
      [2.0, [0, -45, 0], [0, 0, 0]],
      [3.0, [0, 0, 0], [0, 0, 0]]
    ]]
  ]]
]) {
    bone(name="Pendulum", t=[0, 0, 10], r=[0, 0, 0]) {
        color("silver", metalness=0.9, roughness=0.1)
        cylinder(h=10, r=1, center=false);
    }
}
```

### 3. Texture Baking

Project details from a high-resolution mesh onto a low-resolution mesh using the `bake()` module. This auto-generates UVs and can output solid colors, tangent-space normals, and ORM (Occlusion/Roughness/Metallic) textures.

```openscad
// Syntax: bake(colors=false, normals=false, orm=false, uvs=false, distance=2.0, bias=1e-4, dilation=2, resolution=512, msaa=2, index=0, rotate_uvs=true)
bake(colors=true, normals=true, resolution=1024) {
    color("white") sphere(r=10, $fn=100); // Child 1: High Poly (Source)
    color("white", roughness=0.5, $asa=45) sphere(r=10, $fn=20); // Child 2: Low Poly (Target)
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
const promptContext = generatePrompt(description);

// You can now pass this context string directly to an AI API
// or print it to the console to paste into Gemini.
console.log(promptContext);
```

---

### Workflow

Once connected, an AI assistant can use the server to execute the following loop:

1. **Retrieve Syntax Rules:** The assistant calls the `generate_prompt` tool to get the extended syntax rules for PBR materials, skeletal animations, and texture baking.
2. **Generate Code:** The assistant writes the `.scad` script to a local file based on your design request.
3. **Compile to 3D File:** The assistant calls the `convert_scad_to_glb` tool providing the input file path to compile it and save the resulting `.glb` model directly to your specified local directory.

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
