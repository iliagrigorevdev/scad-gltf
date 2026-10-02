use std::process::Command;

fn main() {
    // Tell Cargo to re-run this script only if the 'scad' directory changes
    println!("cargo::rerun-if-changed=scad");

    // Ensure cross-platform compatibility for npm global binaries
    let cmd = if cfg!(target_os = "windows") {
        "scad-gltf.cmd"
    } else {
        "scad-gltf"
    };

    let status = Command::new(cmd)
        .args(["convert", "./scad", "./assets/models", "--cache"])
        .status()
        .expect("Failed to execute scad-gltf. Is scad-gltf installed globally?");

    if !status.success() {
        panic!("scad-gltf convert failed with status: {}", status);
    }
}
