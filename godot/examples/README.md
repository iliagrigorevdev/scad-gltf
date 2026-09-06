# AI-Generated Godot Examples

This folder contains a collection of **all-in-one Node.js scripts**, each representing a complete, playable 3D Godot 4 game generated entirely by AI using the `scad-godot` CLI tool.

Instead of committing messy project folders, each example is bundled into a single, self-extracting JavaScript file. These scripts contain the generated OpenSCAD (`.scad`) 3D assets, Godot scripts (`.gd`), Godot scenes (`.tscn`), and the required `scad_importer` addon needed to parse the SCAD files directly in the engine.

## 🚀 How to Play the Examples

To test out an example, you need to extract it and open it in Godot 4. The Godot importer relies on the `scad-gltf` tools to compile the 3D OpenSCAD scripts into binary meshes.

Depending on your operating system and environment, there are two ways to handle this.

### Prerequisites

- **Node.js** installed on your system.
- **Godot 4.x** installed on your system.

### Step 1: Extract the Project

Open your terminal in this folder and execute the desired example script using Node.js:

```bash
node my_example_game.js
```

_The script will automatically create a new folder (e.g., `./my-example-game`) containing the full Godot project directory structure, saving all the assets and addon files to disk._

---

### Step 2: Compile Models & Open Godot

Choose the method that best fits your environment:

#### Option A: Standard Desktop (Global Install)

If you are on a standard Windows, macOS, or Linux desktop, the easiest way is to have the CLI globally installed. The Godot plugin will automatically find and use the `scad-convert` command.

1. Install the tool globally:
   ```bash
   npm install -g github:iliagrigorevdev/scad-gltf
   ```
2. Launch **Godot 4**.
3. Click **Import** in the Project Manager, browse to the generated folder, and select the `project.godot` file.
4. Click **Import & Edit**. The addon will automatically compile the `.scad` files in the background.

#### Option B: Termux / Android / Restricted Environments (Backend Server)

In some environments (like running Godot directly on an Android device via Termux), the Godot engine cannot easily execute globally installed NPM CLI binaries. To solve this, you can run `scad-serve` as a local backend server. The Godot importer will automatically detect it and use its REST API to convert the 3D models.

1. Open your terminal and navigate into the newly extracted project folder:
   ```bash
   cd my-example-game
   ```
2. Start the local server:
   ```bash
   npx -p github:iliagrigorevdev/scad-gltf scad-serve
   ```
   _(This starts a local backend server on port 3000)._
3. Leave the server running in the background.
4. Launch **Godot 4**, import the project, and open it. The `scad_importer` addon will ping your local `scad-serve` backend to compile the `.scad` files over HTTP.

---

### Step 3: Play the Game

Once the Godot Editor opens and finishes importing the 3D scenes:

- Press **F5** (or click the Play button in the top right) to run the game!

---

## 🛠️ How were these generated?

These files were created using this repository's built-in AI prompt pipeline. By running the `scad-godot` CLI command, the system instructs an LLM (like Claude, Gemini, or ChatGPT) to generate procedural OpenSCAD geometry, gameplay logic, and scene configurations, outputting them as a single JS extractor script.

If you want to generate your own games, run:

```bash
scad-godot "A simple 3D platformer where you control a rolling ball collecting coins"
```

_(See the main repository documentation for full details on generating your own AI projects)._
