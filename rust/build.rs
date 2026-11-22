// Version: 0.2
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;

fn collect_cached_glbs(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_cached_glbs(&path, out);
        } else if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.to_ascii_lowercase().ends_with(".glb") {
                    out.push(path);
                }
            }
        }
    }
}

fn copy_cached_glbs_to_assets() -> usize {
    let cache_root = Path::new("__scad_glbs");
    if !cache_root.is_dir() {
        return 0;
    }

    let scad_cache_dir = cache_root.join("scad");
    let source_root = if scad_cache_dir.is_dir() {
        scad_cache_dir.as_path()
    } else {
        cache_root
    };

    let mut cached_files = Vec::new();
    collect_cached_glbs(source_root, &mut cached_files);

    let out_dir = Path::new("assets").join("models");
    let mut copied = 0;

    for src_path in cached_files {
        let Ok(rel_path) = src_path.strip_prefix(source_root) else {
            continue;
        };
        let rel_str = rel_path.to_string_lossy();
        let lower = rel_str.to_ascii_lowercase();
        let target_rel = if lower.ends_with(".scad.glb") {
            format!("{}.glb", &rel_str[..rel_str.len() - ".scad.glb".len()])
        } else {
            rel_str.into_owned()
        };

        let dest_path = out_dir.join(target_rel);
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)
                .expect("Failed to create assets/models output directory");
        }
        fs::copy(&src_path, &dest_path).unwrap_or_else(|e| {
            panic!(
                "Failed to copy cached GLB {} to {}: {}",
                src_path.display(),
                dest_path.display(),
                e
            )
        });
        copied += 1;
    }

    copied
}

fn has_existing_glbs(dir: &Path) -> bool {
    let mut existing = Vec::new();
    collect_cached_glbs(dir, &mut existing);
    !existing.is_empty()
}

fn main() {
    // Tell Cargo to re-run this script if the 'scad' or cache directory changes
    println!("cargo::rerun-if-changed=scad");
    println!("cargo::rerun-if-changed=__scad_glbs");

    // Ensure cross-platform compatibility for npm global binaries
    let cmd = if cfg!(target_os = "windows") {
        "scad-gltf.cmd"
    } else {
        "scad-gltf"
    };

    match Command::new(cmd)
        .args(["convert", "./scad", "./assets/models", "--cache"])
        .status()
    {
        Ok(status) => {
            if !status.success() {
                panic!("scad-gltf convert failed with status: {}", status);
            }
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {
            let copied = copy_cached_glbs_to_assets();
            if copied > 0 {
                println!(
                    "cargo::warning=scad-gltf CLI not found; using {} cached GLB fallback model(s) from __scad_glbs.",
                    copied
                );
            } else if has_existing_glbs(Path::new("assets/models")) {
                println!(
                    "cargo::warning=scad-gltf CLI not found; using existing GLB models in assets/models."
                );
            } else {
                panic!(
                    "Failed to execute scad-gltf (not found) and no cached GLB models were found in __scad_glbs. Is scad-gltf installed globally?"
                );
            }
        }
        Err(err) => {
            panic!(
                "Failed to execute scad-gltf ({}). Is scad-gltf installed globally?",
                err
            );
        }
    }
}
