# OpenSCAD GLTF Integration for Rust Bevy

This folder contains resources and examples for integrating procedural OpenSCAD (`.scad`) 3D assets natively into the [Bevy](https://bevyengine.org/) game engine using the `scad-gltf` compiler.

Unlike Godot (which uses a native editor plugin), Bevy integration is achieved programmatically at compile-time using a custom `build.rs` script. This script automatically watches your `.scad` files and compiles them into binary `.glb` meshes in your `assets/models` folder before the game compiles and runs.

## 🛠️ How It Works

To use OpenSCAD files in your Bevy project, ensure you have the CLI compiler installed globally on your machine:

```bash
npm install -g scad-gltf
```

Then, add a `build.rs` script to the root of your Bevy project (next to `Cargo.toml`):

```rust
use std::process::Command;

fn main() {
    // Tell Cargo to re-run this script only if the 'scad' directory changes
    println!("cargo::rerun-if-changed=scad");

    // Ensure cross-platform compatibility for npm global binaries
    let cmd = if cfg!(target_os = "windows") {
        "scad-convert.cmd"
    } else {
        "scad-convert"
    };

    let status = Command::new(cmd)
        .args(["./scad", "./assets/models", "--cache"])
        .status()
        .expect("Failed to execute scad-convert. Is scad-gltf installed globally?");

    if !status.success() {
        panic!("scad-convert failed with status: {}", status);
    }
}
```

Now, any `.scad` files placed in your `scad/` directory will automatically be converted to `.glb` when you run `cargo build` or `cargo run`. They can then be loaded natively in Bevy via the Asset Server:

```rust
let my_model = asset_server.load("models/my_model.glb#Scene0");
```
