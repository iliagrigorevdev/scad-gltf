# OpenSCAD GLTF Importer for Godot 4

This folder contains the official Godot 4.x Editor plugin for natively importing OpenSCAD (`.scad`) files as 3D scenes.

By leveraging the `scad-gltf` compiler under the hood, this addon allows you to drag and drop procedural CAD files directly into your Godot project. It automatically compiles them into binary glTF (`.glb`) meshes, supporting advanced features like **PBR materials**, **hierarchical node animations**, and **texture baking**—all natively within the Godot editor.

## ✨ Features

- **Seamless Integration**: Drag and drop `.scad` files directly into the Godot FileSystem dock.
- **Advanced Materials**: Supports standard OpenSCAD plus custom extensions for roughness, metalness, transmission, emission, and more.
- **Hierarchical Node Animations**: Automatically parses `armature()` and `bone()` modules into Godot `Node3D` transform hierarchies animated via `AnimationPlayer` (rigid-body hierarchy animation, ideal for mechanical and articulated models).
- **Dependency Tracking**: Smart resolution of local `include` and `use` OpenSCAD dependencies.
- **Auto-Fallback Engine**: Attempts to use the high-performance CLI compiler (`scad-convert`) and seamlessly falls back to the HTTP backend (`scad-serve`) if running in a restricted environment.

---

## ⚙️ Prerequisites

Because OpenSCAD compilation is handled by our WebAssembly engine running in Node.js, your system must have the compiler installed.

1. **Install Node.js** on your system.
2. **Install the compiler tools globally:**
   ```bash
   npm install -g scad-gltf
   ```

---

## 📥 Installation

1. Copy the `addons/scad_importer` folder from this repository into your Godot project's `res://addons/` directory.
   _(If your project doesn't have an `addons` folder, create one)._
2. Open your Godot project.
3. Go to **Project > Project Settings > Plugins**.
4. Check the **Enable** box next to **OpenSCAD GLTF Importer**.

---

## 🛠️ How It Works (Two Modes)

When you import or reimport a `.scad` file, the plugin will attempt to compile it using one of two methods:

### 1. CLI Mode (Default)

The plugin will try to execute the `scad-convert` CLI command natively through your operating system. This requires the `scad-gltf` package to be installed globally (as shown in Prerequisites). This is the fastest and recommended method for Windows, macOS, and Linux desktops.

### 2. Server Fallback Mode (Termux / Android / Portable)

If the CLI command fails (e.g., Godot doesn't have permission to run shell commands, or you are running Godot on an Android device via Termux), the plugin will automatically fallback to **Server Mode**.

It will look for a local backend server running on `127.0.0.1:3000`. To use this mode:

1. Open your terminal in your project directory.
2. Run the server using `npx`:
   ```bash
   npx -p scad-gltf scad-serve
   ```
3. Leave the server running in the background. Godot will now send your `.scad` code to this local server, compile it in memory, and import the resulting 3D mesh.

---

## 📜 License

This Godot addon is licensed under the **MIT License**.
