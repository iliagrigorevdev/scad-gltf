# AI-Generated Bevy Examples

This folder contains a collection of **all-in-one Node.js scripts**, each representing a complete, playable 3D Rust Bevy game generated entirely by AI using the `scad-bevy` CLI tool.

Instead of committing messy project folders, each example is bundled into a single, self-extracting JavaScript file. These scripts contain the generated OpenSCAD (`.scad`) 3D assets, Rust source code (`main.rs`), and the required `build.rs` and `Cargo.toml` configurations.

---

## 🚀 How to Play the Examples

To test out an example, you need to extract it and run it using Cargo.

### Prerequisites

- **Node.js** installed on your system.
- **Rust and Cargo** installed on your system.
- **scad-gltf** installed globally: `npm install -g scad-gltf`

### Step 1: Extract the Project

Open your terminal in this folder and execute the desired example script using Node.js:

```bash
node packman_3d.js
```

_The script will automatically create a new folder (e.g., `./packman_3d`) containing the full Bevy project directory structure, saving all the assets and Rust files to disk._

---

### Step 2: Compile & Play

Navigate into the newly extracted project folder and use Cargo to run the game:

```bash
cd packman_3d
cargo run
```

_The `build.rs` script will automatically invoke `scad-convert` to compile the OpenSCAD assets into `.glb` format before Bevy boots up._

---

## 🛠️ How were these generated?

These files were created using this repository's built-in AI prompt pipeline. By running the `scad-bevy` CLI command, the system instructs an LLM (like Claude, Gemini, or ChatGPT) to generate procedural OpenSCAD geometry, gameplay logic, and scene configurations, outputting them as a single JS extractor script.

If you want to generate your own games, run:

```bash
scad-bevy "A simple 3D platformer where you control a rolling ball collecting coins"
```

_(See the main repository documentation for full details on generating your own AI projects)._
