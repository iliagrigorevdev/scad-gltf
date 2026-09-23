#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Root project directory
const PROJECT_DIR = path.join(process.cwd(), "packman_3d");

// Helper to write files ensuring directories exist
function writeFile(filePath, content) {
  const fullPath = path.join(PROJECT_DIR, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content.trim() + "\n", "utf8");
  console.log(`Created: ${filePath}`);
}

console.log(`\nInitializing Packman 3D project in: ${PROJECT_DIR}\n`);
fs.mkdirSync(PROJECT_DIR, { recursive: true });

// =========================================================================
// 1. Cargo.toml (Bevy 0.15 with audio features)
// =========================================================================
writeFile(
  "Cargo.toml",
  `
[package]
name = "packman-3d"
version = "0.1.0"
edition = "2021"

[dependencies]
bevy = { version = "0.15", default-features = true, features = ["wav"] }
rand = "0.8"
`,
);

// =========================================================================
// 2. build.rs (EXACT specification from instructions)
// =========================================================================
writeFile(
  "build.rs",
  `
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
`,
);

// =========================================================================
// 3. OpenSCAD 3D Assets (Characters match tunnel width; Cyber Gate & Cherry)
// =========================================================================

// packman.scad: Animated chomping mouth, diameter 1.16
writeFile(
  "scad/packman.scad",
  `
$fn = 40;
$asa = 45;

anim_data = [
  ["Chomp", [
    ["MouthTop", [
      [0.00, [0, 0, 0], [0, 0, 0]],
      [0.18, [0, -32, 0], [0, 0, 0]],
      [0.36, [0, 0, 0], [0, 0, 0]]
    ]],
    ["MouthBottom", [
      [0.00, [0, 0, 0], [0, 0, 0]],
      [0.18, [0, 32, 0], [0, 0, 0]],
      [0.36, [0, 0, 0], [0, 0, 0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="BodyRoot", t=[0, 0, 0], r=[0, 0, 0]) {

    // Upper jaw & head (r=0.58 -> diameter 1.16)
    bone(name="MouthTop", t=[0, 0, 0], r=[0, 0, 0]) {
      color([1.0, 0.86, 0.05], roughness=0.25, metalness=0.05, specularIntensity=0.8, emissive=[0.12, 0.10, 0.0], emissiveIntensity=1.0, $asa=45) {
        intersection() {
          sphere(r=0.58);
          translate([-0.8, -0.8, 0.0])
            cube([1.6, 1.6, 0.9]);
        }
      }

      // Eye lenses
      color([0.05, 0.05, 0.08], roughness=0.15, metalness=0.1, specularIntensity=0.9, $asa=30) {
        translate([0.18, 0.36, 0.32])
          sphere(r=0.10, $fn=24);
        translate([0.18, -0.36, 0.32])
          sphere(r=0.10, $fn=24);
      }

      // Highlights
      color([1.0, 1.0, 1.0], roughness=0.1, metalness=0.0, emissive=[1.0, 1.0, 1.0], emissiveIntensity=2.0) {
        translate([0.23, 0.38, 0.36])
          sphere(r=0.032, $fn=16);
        translate([0.23, -0.34, 0.36])
          sphere(r=0.032, $fn=16);
      }
    }

    // Lower jaw
    bone(name="MouthBottom", t=[0, 0, 0], r=[0, 0, 0]) {
      color([1.0, 0.86, 0.05], roughness=0.25, metalness=0.05, specularIntensity=0.8, emissive=[0.12, 0.10, 0.0], emissiveIntensity=1.0, $asa=45) {
        intersection() {
          sphere(r=0.58);
          translate([-0.8, -0.8, -0.9])
            cube([1.6, 1.6, 0.9]);
        }
      }

      // Interior mouth lining
      color([0.75, 0.1, 0.1], roughness=0.5, metalness=0.0) {
        translate([0.08, 0.0, -0.03])
          cylinder(r=0.44, h=0.04, center=true, $fn=24);
      }
    }
  }
}
`,
);

// ghost_blinky.scad: Red Chaser Ghost ("Blinky") - diameter 1.16
writeFile(
  "scad/ghost_blinky.scad",
  `
$fn = 36;
$asa = 45;

anim_data = [
  ["Float", [
    ["GhostBody", [
      [0.00, [0, 0, 0], [0, 0, 0.00]],
      [0.35, [0, 0, 0], [0, 0, 0.06]],
      [0.70, [0, 0, 0], [0, 0, 0.00]]
    ]],
    ["GhostEyes", [
      [0.00, [0, 0, 0]],
      [0.35, [0, 0, 6]],
      [0.70, [0, 0, 0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="GhostRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    bone(name="GhostBody", t=[0, 0, 0], r=[0, 0, 0]) {
      color([0.95, 0.12, 0.12], roughness=0.25, metalness=0.08, emissive=[0.40, 0.05, 0.05], emissiveIntensity=1.5, $asa=45) {
        translate([0, 0, 0.22])
          sphere(r=0.56);
        translate([0, 0, -0.16])
          cylinder(r=0.56, h=0.38, center=false);
        for (i = [0:3]) {
          rotate([0, 0, i * 90 + 45])
            translate([0.35, 0.0, -0.24])
              cylinder(r1=0.16, r2=0.20, h=0.22, center=true, $fn=18);
        }
      }

      bone(name="GhostEyes", t=[0, 0, 0], r=[0, 0, 0]) {
        color([0.96, 0.96, 1.0], roughness=0.15, metalness=0.0, $asa=35) {
          translate([0.38, 0.20, 0.26])
            scale([0.22, 0.18, 0.24])
              sphere(r=1.0);
          translate([0.38, -0.20, 0.26])
            scale([0.22, 0.18, 0.24])
              sphere(r=1.0);
        }
        color([0.1, 0.25, 0.9], roughness=0.1, metalness=0.2, emissive=[0.05, 0.15, 0.6], emissiveIntensity=1.5) {
          translate([0.54, 0.20, 0.26])
            scale([0.11, 0.11, 0.14])
              sphere(r=1.0);
          translate([0.54, -0.20, 0.26])
            scale([0.11, 0.11, 0.14])
              sphere(r=1.0);
        }
      }
    }
  }
}
`,
);

// ghost_pinky.scad: Pink Ambusher Ghost ("Pinky") - diameter 1.16
writeFile(
  "scad/ghost_pinky.scad",
  `
$fn = 36;
$asa = 45;

anim_data = [
  ["Float", [
    ["GhostBody", [
      [0.00, [0, 0, 0], [0, 0, 0.00]],
      [0.35, [0, 0, 0], [0, 0, 0.06]],
      [0.70, [0, 0, 0], [0, 0, 0.00]]
    ]],
    ["GhostEyes", [
      [0.00, [0, 0, 0]],
      [0.35, [0, 0, 6]],
      [0.70, [0, 0, 0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="GhostRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    bone(name="GhostBody", t=[0, 0, 0], r=[0, 0, 0]) {
      color([1.0, 0.55, 0.78], roughness=0.25, metalness=0.08, emissive=[0.40, 0.12, 0.26], emissiveIntensity=1.5, $asa=45) {
        translate([0, 0, 0.22])
          sphere(r=0.56);
        translate([0, 0, -0.16])
          cylinder(r=0.56, h=0.38, center=false);
        for (i = [0:3]) {
          rotate([0, 0, i * 90 + 45])
            translate([0.35, 0.0, -0.24])
              cylinder(r1=0.16, r2=0.20, h=0.22, center=true, $fn=18);
        }
      }

      bone(name="GhostEyes", t=[0, 0, 0], r=[0, 0, 0]) {
        color([0.96, 0.96, 1.0], roughness=0.15, metalness=0.0, $asa=35) {
          translate([0.38, 0.20, 0.26])
            scale([0.22, 0.18, 0.24])
              sphere(r=1.0);
          translate([0.38, -0.20, 0.26])
            scale([0.22, 0.18, 0.24])
              sphere(r=1.0);
        }
        color([0.1, 0.25, 0.9], roughness=0.1, metalness=0.2, emissive=[0.05, 0.15, 0.6], emissiveIntensity=1.5) {
          translate([0.54, 0.20, 0.26])
            scale([0.11, 0.11, 0.14])
              sphere(r=1.0);
          translate([0.54, -0.20, 0.26])
            scale([0.11, 0.11, 0.14])
              sphere(r=1.0);
        }
      }
    }
  }
}
`,
);

// ghost_inky.scad: Cyan Flanker Ghost ("Inky") - diameter 1.16
writeFile(
  "scad/ghost_inky.scad",
  `
$fn = 36;
$asa = 45;

anim_data = [
  ["Float", [
    ["GhostBody", [
      [0.00, [0, 0, 0], [0, 0, 0.00]],
      [0.35, [0, 0, 0], [0, 0, 0.06]],
      [0.70, [0, 0, 0], [0, 0, 0.00]]
    ]],
    ["GhostEyes", [
      [0.00, [0, 0, 0]],
      [0.35, [0, 0, 6]],
      [0.70, [0, 0, 0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="GhostRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    bone(name="GhostBody", t=[0, 0, 0], r=[0, 0, 0]) {
      color([0.05, 0.88, 0.98], roughness=0.25, metalness=0.08, emissive=[0.02, 0.38, 0.45], emissiveIntensity=1.5, $asa=45) {
        translate([0, 0, 0.22])
          sphere(r=0.56);
        translate([0, 0, -0.16])
          cylinder(r=0.56, h=0.38, center=false);
        for (i = [0:3]) {
          rotate([0, 0, i * 90 + 45])
            translate([0.35, 0.0, -0.24])
              cylinder(r1=0.16, r2=0.20, h=0.22, center=true, $fn=18);
        }
      }

      bone(name="GhostEyes", t=[0, 0, 0], r=[0, 0, 0]) {
        color([0.96, 0.96, 1.0], roughness=0.15, metalness=0.0, $asa=35) {
          translate([0.38, 0.20, 0.26])
            scale([0.22, 0.18, 0.24])
              sphere(r=1.0);
          translate([0.38, -0.20, 0.26])
            scale([0.22, 0.18, 0.24])
              sphere(r=1.0);
        }
        color([0.1, 0.25, 0.9], roughness=0.1, metalness=0.2, emissive=[0.05, 0.15, 0.6], emissiveIntensity=1.5) {
          translate([0.54, 0.20, 0.26])
            scale([0.11, 0.11, 0.14])
              sphere(r=1.0);
          translate([0.54, -0.20, 0.26])
            scale([0.11, 0.11, 0.14])
              sphere(r=1.0);
        }
      }
    }
  }
}
`,
);

// ghost_clyde.scad: Orange Patrol Ghost ("Clyde") - diameter 1.16
writeFile(
  "scad/ghost_clyde.scad",
  `
$fn = 36;
$asa = 45;

anim_data = [
  ["Float", [
    ["GhostBody", [
      [0.00, [0, 0, 0], [0, 0, 0.00]],
      [0.35, [0, 0, 0], [0, 0, 0.06]],
      [0.70, [0, 0, 0], [0, 0, 0.00]]
    ]],
    ["GhostEyes", [
      [0.00, [0, 0, 0]],
      [0.35, [0, 0, 6]],
      [0.70, [0, 0, 0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="GhostRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    bone(name="GhostBody", t=[0, 0, 0], r=[0, 0, 0]) {
      color([1.0, 0.62, 0.05], roughness=0.25, metalness=0.08, emissive=[0.42, 0.22, 0.02], emissiveIntensity=1.5, $asa=45) {
        translate([0, 0, 0.22])
          sphere(r=0.56);
        translate([0, 0, -0.16])
          cylinder(r=0.56, h=0.38, center=false);
        for (i = [0:3]) {
          rotate([0, 0, i * 90 + 45])
            translate([0.35, 0.0, -0.24])
              cylinder(r1=0.16, r2=0.20, h=0.22, center=true, $fn=18);
        }
      }

      bone(name="GhostEyes", t=[0, 0, 0], r=[0, 0, 0]) {
        color([0.96, 0.96, 1.0], roughness=0.15, metalness=0.0, $asa=35) {
          translate([0.38, 0.20, 0.26])
            scale([0.22, 0.18, 0.24])
              sphere(r=1.0);
          translate([0.38, -0.20, 0.26])
            scale([0.22, 0.18, 0.24])
              sphere(r=1.0);
        }
        color([0.1, 0.25, 0.9], roughness=0.1, metalness=0.2, emissive=[0.05, 0.15, 0.6], emissiveIntensity=1.5) {
          translate([0.54, 0.20, 0.26])
            scale([0.11, 0.11, 0.14])
              sphere(r=1.0);
          translate([0.54, -0.20, 0.26])
            scale([0.11, 0.11, 0.14])
              sphere(r=1.0);
        }
      }
    }
  }
}
`,
);

// ghost_frightened.scad: Vulnerable Electric Blue Ghost
writeFile(
  "scad/ghost_frightened.scad",
  `
$fn = 36;
$asa = 45;

anim_data = [
  ["Panic", [
    ["PanicBody", [
      [0.00, [0, 0, -5], [0, 0, 0.00]],
      [0.15, [0, 0, 5], [0, 0, 0.04]],
      [0.30, [0, 0, -5], [0, 0, 0.00]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="PanicRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    bone(name="PanicBody", t=[0, 0, 0], r=[0, 0, 0]) {
      color([0.12, 0.22, 0.85], roughness=0.25, metalness=0.08, emissive=[0.10, 0.25, 0.90], emissiveIntensity=2.2, $asa=45) {
        translate([0, 0, 0.22])
          sphere(r=0.56);
        translate([0, 0, -0.16])
          cylinder(r=0.56, h=0.38, center=false);
        for (i = [0:3]) {
          rotate([0, 0, i * 90 + 45])
            translate([0.35, 0.0, -0.24])
              cylinder(r1=0.16, r2=0.20, h=0.22, center=true, $fn=18);
        }
      }

      color([1.0, 0.92, 0.2], roughness=0.1, metalness=0.0, emissive=[1.0, 0.92, 0.2], emissiveIntensity=3.0) {
        translate([0.50, 0.16, 0.26])
          sphere(r=0.085);
        translate([0.50, -0.16, 0.26])
          sphere(r=0.085);
      }

      color([0.85, 0.95, 1.0], roughness=0.1, metalness=0.0, emissive=[0.85, 0.95, 1.0], emissiveIntensity=3.0) {
        translate([0.52, 0.0, 0.08])
          cube([0.06, 0.36, 0.05], center=true);
        translate([0.52, 0.12, 0.04])
          cube([0.06, 0.08, 0.08], center=true);
        translate([0.52, -0.12, 0.04])
          cube([0.06, 0.08, 0.08], center=true);
      }
    }
  }
}
`,
);

// ghost_flash.scad: Flashing White Warning Ghost
writeFile(
  "scad/ghost_flash.scad",
  `
$fn = 36;
$asa = 45;

anim_data = [
  ["Panic", [
    ["FlashBody", [
      [0.00, [0, 0, -5], [0, 0, 0.00]],
      [0.15, [0, 0, 5], [0, 0, 0.04]],
      [0.30, [0, 0, -5], [0, 0, 0.00]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="FlashRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    bone(name="FlashBody", t=[0, 0, 0], r=[0, 0, 0]) {
      color([0.95, 0.98, 1.0], roughness=0.2, metalness=0.08, emissive=[0.85, 0.92, 1.0], emissiveIntensity=2.6, $asa=45) {
        translate([0, 0, 0.22])
          sphere(r=0.56);
        translate([0, 0, -0.16])
          cylinder(r=0.56, h=0.38, center=false);
        for (i = [0:3]) {
          rotate([0, 0, i * 90 + 45])
            translate([0.35, 0.0, -0.24])
              cylinder(r1=0.16, r2=0.20, h=0.22, center=true, $fn=18);
        }
      }

      color([1.0, 0.15, 0.15], roughness=0.1, metalness=0.0, emissive=[1.0, 0.1, 0.1], emissiveIntensity=3.2) {
        translate([0.50, 0.16, 0.26])
          sphere(r=0.085);
        translate([0.50, -0.16, 0.26])
          sphere(r=0.085);
      }

      color([1.0, 0.15, 0.15], roughness=0.1, metalness=0.0, emissive=[1.0, 0.1, 0.1], emissiveIntensity=3.2) {
        translate([0.52, 0.0, 0.08])
          cube([0.06, 0.36, 0.05], center=true);
        translate([0.52, 0.12, 0.04])
          cube([0.06, 0.08, 0.08], center=true);
        translate([0.52, -0.12, 0.04])
          cube([0.06, 0.08, 0.08], center=true);
      }
    }
  }
}
`,
);

// ghost_eyes.scad: Eaten Ghost Floating Eyes
writeFile(
  "scad/ghost_eyes.scad",
  `
$fn = 28;
$asa = 35;

anim_data = [
  ["Look", [
    ["EyesRoot", [
      [0.00, [0, 0, 0], [0, 0, 0.00]],
      [0.25, [0, 0, 0], [0, 0, 0.05]],
      [0.50, [0, 0, 0], [0, 0, 0.00]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="EyesRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    color([0.96, 0.96, 1.0], roughness=0.15, metalness=0.0, $asa=35) {
      translate([0.22, 0.20, 0.26])
        scale([0.22, 0.18, 0.24])
          sphere(r=1.0);
      translate([0.22, -0.20, 0.26])
        scale([0.22, 0.18, 0.24])
          sphere(r=1.0);
    }
    color([0.1, 0.25, 0.95], roughness=0.1, metalness=0.2, emissive=[0.1, 0.35, 1.0], emissiveIntensity=2.0) {
      translate([0.40, 0.20, 0.26])
        scale([0.11, 0.11, 0.14])
          sphere(r=1.0);
      translate([0.40, -0.20, 0.26])
        scale([0.11, 0.11, 0.14])
          sphere(r=1.0);
    }
  }
}
`,
);

// gate.scad: Cyber Energy Barrier replacing the awkward flat pink stripe
writeFile(
  "scad/gate.scad",
  `
$fn = 24;
$asa = 45;

// Obsidian and chrome side mounting brackets
color([0.08, 0.11, 0.18], roughness=0.3, metalness=0.85, $asa=35) {
  translate([-0.54, 0, 0.15])
    cube([0.12, 0.22, 0.30], center=true);
  translate([0.54, 0, 0.15])
    cube([0.12, 0.22, 0.30], center=true);
}

// Glowing cyan energy field beam
color([0.0, 0.85, 1.0], roughness=0.1, metalness=0.1, emissive=[0.0, 0.85, 1.0], emissiveIntensity=3.2) {
  translate([0, 0, 0.18])
    cube([1.04, 0.06, 0.10], center=true);
  translate([0, 0, 0.10])
    cube([0.96, 0.04, 0.04], center=true);
}
`,
);

// pellet.scad: Food pellet
writeFile(
  "scad/pellet.scad",
  `
$fn = 20;
$asa = 45;

anim_data = [
  ["Spin", [
    ["Gem", [
      [0.0, [0, 0, 0], [0, 0, 0]],
      [0.5, [0, 0, 90], [0, 0, 0]],
      [1.0, [0, 0, 180], [0, 0, 0]],
      [1.5, [0, 0, 270], [0, 0, 0]],
      [2.0, [0, 0, 360], [0, 0, 0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="Gem", t=[0, 0, 0], r=[0, 0, 0]) {
    color([1.0, 0.88, 0.3], roughness=0.1, metalness=0.1, emissive=[1.0, 0.80, 0.15], emissiveIntensity=2.8, $asa=45) {
      sphere(r=0.12);
      cylinder(r=0.14, h=0.05, center=true);
    }
  }
}
`,
);

// power_pellet.scad: Energizer with gimbal rings
writeFile(
  "scad/power_pellet.scad",
  `
$fn = 28;
$asa = 45;

anim_data = [
  ["PowerSpin", [
    ["Core", [
      [0.0, [0, 0, 0], [0, 0, 0.00]],
      [0.5, [0, 0, 0], [0, 0, 0.04]],
      [1.0, [0, 0, 0], [0, 0, 0.00]]
    ]],
    ["OuterRing", [
      [0.0, [0, 0, 0], [0, 0, 0]],
      [0.5, [0, 90, 0], [0, 0, 0]],
      [1.0, [0, 180, 0], [0, 0, 0]],
      [1.5, [0, 270, 0], [0, 0, 0]],
      [2.0, [0, 360, 0], [0, 0, 0]]
    ]],
    ["InnerRing", [
      [0.0, [0, 0, 0], [0, 0, 0]],
      [0.5, [90, 0, 0], [0, 0, 0]],
      [1.0, [180, 0, 0], [0, 0, 0]],
      [1.5, [270, 0, 0], [0, 0, 0]],
      [2.0, [360, 0, 0], [0, 0, 0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="PowerRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    bone(name="Core", t=[0, 0, 0], r=[0, 0, 0]) {
      color([1.0, 1.0, 0.7], roughness=0.08, metalness=0.05, emissive=[1.0, 0.95, 0.4], emissiveIntensity=4.5, $asa=45) {
        sphere(r=0.25);
      }
    }

    bone(name="OuterRing", t=[0, 0, 0], r=[0, 0, 0]) {
      color([0.2, 0.8, 1.0], roughness=0.2, metalness=0.8, emissive=[0.0, 0.6, 1.0], emissiveIntensity=2.0) {
        difference() {
          cylinder(r=0.38, h=0.04, center=true);
          cylinder(r=0.32, h=0.06, center=true);
        }
      }
    }

    bone(name="InnerRing", t=[0, 0, 0], r=[0, 0, 0]) {
      color([1.0, 0.4, 0.1], roughness=0.2, metalness=0.8, emissive=[1.0, 0.3, 0.0], emissiveIntensity=2.0) {
        difference() {
          cylinder(r=0.30, h=0.03, center=true);
          cylinder(r=0.25, h=0.05, center=true);
        }
      }
    }
  }
}
`,
);

// wall.scad: Cyber Maze Wall block (1.16 x 1.16 x 0.90)
writeFile(
  "scad/wall.scad",
  `
$fn = 24;
$asa = 35;

color([0.08, 0.11, 0.18], roughness=0.3, metalness=0.85, $asa=35) {
  translate([0, 0, 0.44])
    cube([1.16, 1.16, 0.88], center=true);
}

color([0.0, 0.85, 1.0], roughness=0.1, metalness=0.1, emissive=[0.0, 0.85, 1.0], emissiveIntensity=3.5) {
  translate([0, 0, 0.89])
    difference() {
      cube([1.18, 1.18, 0.05], center=true);
      cube([0.98, 0.98, 0.08], center=true);
    }
  translate([0, 0, 0.88])
    cylinder(r=0.16, h=0.06, center=true);
}

color([0.85, 0.90, 0.95], roughness=0.1, metalness=0.95) {
  for (dx = [-0.52, 0.52]) {
    for (dy = [-0.52, 0.52]) {
      translate([dx, dy, 0.44])
        cylinder(r=0.045, h=0.90, center=true);
    }
  }
}
`,
);

// cherry.scad: Bonus Arcade Fruit (diameter 0.45, shiny cherries with stems & leaf)
writeFile(
  "scad/cherry.scad",
  `
$fn = 28;
$asa = 45;

anim_data = [
  ["Float", [
    ["CherryRoot", [
      [0.0, [0, 0, 0], [0, 0, 0.0]],
      [0.4, [0, 0, 15], [0, 0, 0.06]],
      [0.8, [0, 0, 0], [0, 0, 0.0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="CherryRoot", t=[0, 0, 0], r=[0, 0, 0]) {
    color([0.95, 0.05, 0.15], roughness=0.12, metalness=0.05, specularIntensity=1.5, emissive=[0.30, 0.0, 0.05], emissiveIntensity=1.2, $asa=45) {
      translate([-0.16, 0.0, 0.18])
        sphere(r=0.18);
      translate([0.16, 0.06, 0.18])
        sphere(r=0.18);
    }
    color([0.45, 0.28, 0.12], roughness=0.6, metalness=0.0) {
      translate([-0.08, 0.01, 0.36])
        rotate([0, 20, 0])
          cylinder(r=0.022, h=0.28, center=true);
      translate([0.08, 0.04, 0.36])
        rotate([0, -20, 0])
          cylinder(r=0.022, h=0.28, center=true);
    }
    color([0.1, 0.85, 0.2], roughness=0.3, metalness=0.0, emissive=[0.02, 0.3, 0.05], emissiveIntensity=1.5, $asa=35) {
      translate([0.06, 0.04, 0.48])
        rotate([15, 30, 25])
          scale([0.14, 0.07, 0.03])
            sphere(r=1.0);
    }
  }
}
`,
);

// =========================================================================
// 4. Rust Bevy Application Logic (src/main.rs)
// =========================================================================
writeFile(
  "src/main.rs",
  `
use bevy::audio::Volume;
use bevy::prelude::*;
use rand::Rng;
use std::f32::consts::PI;
use std::fs;
use std::path::Path;

const SAMPLE_RATE: u32 = 44100;

// =========================================================================
// Procedural Audio Synthesizer (Generates 16-bit PCM RIFF WAV in memory)
// =========================================================================

fn write_wav_file(path: &str, samples: &[i16], sample_rate: u32) {
    let mut data = Vec::with_capacity(44 + samples.len() * 2);
    // RIFF Header
    data.extend_from_slice(b"RIFF");
    let file_size = 36u32 + (samples.len() * 2) as u32;
    data.extend_from_slice(&file_size.to_le_bytes());
    data.extend_from_slice(b"WAVE");

    // fmt Chunk
    data.extend_from_slice(b"fmt ");
    data.extend_from_slice(&16u32.to_le_bytes());
    data.extend_from_slice(&1u16.to_le_bytes());
    data.extend_from_slice(&1u16.to_le_bytes());
    data.extend_from_slice(&sample_rate.to_le_bytes());
    let byte_rate = sample_rate * 2;
    data.extend_from_slice(&byte_rate.to_le_bytes());
    data.extend_from_slice(&2u16.to_le_bytes());
    data.extend_from_slice(&16u16.to_le_bytes());

    // data Chunk
    data.extend_from_slice(b"data");
    let data_len = (samples.len() * 2) as u32;
    data.extend_from_slice(&data_len.to_le_bytes());
    for &sample in samples {
        data.extend_from_slice(&sample.to_le_bytes());
    }

    if let Err(e) = fs::write(path, &data) {
        eprintln!("Failed writing procedural audio {}: {}", path, e);
    }
}

fn sine(phase: f32) -> f32 {
    phase.sin()
}

fn square(phase: f32, duty: f32) -> f32 {
    let t = (phase / (2.0 * PI)).fract();
    let norm = if t < 0.0 { t + 1.0 } else { t };
    if norm < duty { 1.0 } else { -1.0 }
}

fn triangle(phase: f32) -> f32 {
    let t = (phase / (2.0 * PI)).fract();
    let norm = if t < 0.0 { t + 1.0 } else { t };
    2.0 * (2.0 * (norm - (norm + 0.5).floor())).abs() - 1.0
}

fn generate_procedural_sounds() {
    let dir = Path::new("assets/audio");
    let _ = fs::create_dir_all(dir);

    // 1. Waka 0 (Opening Chomp Sweep 220Hz -> 480Hz)
    {
        let dur = 0.085;
        let total = (dur * SAMPLE_RATE as f32) as usize;
        let mut samples = Vec::with_capacity(total);
        let mut phase = 0.0f32;
        for i in 0..total {
            let t = i as f32 / SAMPLE_RATE as f32;
            let frac = t / dur;
            let freq = 220.0 + (480.0 - 220.0) * frac;
            phase += 2.0 * PI * freq / SAMPLE_RATE as f32;
            let env = (frac / 0.15).min(1.0) * (1.0 - frac).max(0.0);
            let val = 0.5 * square(phase, 0.45) + 0.5 * triangle(phase);
            samples.push((val * env * 14000.0) as i16);
        }
        write_wav_file("assets/audio/waka_0.wav", &samples, SAMPLE_RATE);
    }

    // 2. Waka 1 (Closing Chomp Sweep 480Hz -> 190Hz)
    {
        let dur = 0.085;
        let total = (dur * SAMPLE_RATE as f32) as usize;
        let mut samples = Vec::with_capacity(total);
        let mut phase = 0.0f32;
        for i in 0..total {
            let t = i as f32 / SAMPLE_RATE as f32;
            let frac = t / dur;
            let freq = 480.0 - (480.0 - 190.0) * frac;
            phase += 2.0 * PI * freq / SAMPLE_RATE as f32;
            let env = (frac / 0.15).min(1.0) * (1.0 - frac).max(0.0);
            let val = 0.5 * square(phase, 0.45) + 0.5 * triangle(phase);
            samples.push((val * env * 14000.0) as i16);
        }
        write_wav_file("assets/audio/waka_1.wav", &samples, SAMPLE_RATE);
    }

    // 3. Power Pellet (Low Energetic Hum)
    {
        let dur = 0.25;
        let total = (dur * SAMPLE_RATE as f32) as usize;
        let mut samples = Vec::with_capacity(total);
        let mut phase = 0.0f32;
        for i in 0..total {
            let t = i as f32 / SAMPLE_RATE as f32;
            let freq = 80.0 + 40.0 * (2.0 * PI * 12.0 * t).sin();
            phase += 2.0 * PI * freq / SAMPLE_RATE as f32;
            let val = triangle(phase);
            samples.push((val * 16000.0) as i16);
        }
        write_wav_file("assets/audio/power_pellet.wav", &samples, SAMPLE_RATE);
    }

    // 4. Eat Ghost (Upward Staccato Fanfare Arpeggio)
    {
        let notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
        let note_dur = 0.07;
        let total = (note_dur * notes.len() as f32 * SAMPLE_RATE as f32) as usize;
        let mut samples = Vec::with_capacity(total);
        for &freq in &notes {
            let mut phase = 0.0f32;
            let note_samples = (note_dur * SAMPLE_RATE as f32) as usize;
            for i in 0..note_samples {
                let frac = i as f32 / note_samples as f32;
                phase += 2.0 * PI * freq / SAMPLE_RATE as f32;
                let env = (1.0 - frac).powf(1.4);
                let val = 0.6 * square(phase, 0.35) + 0.4 * sine(phase);
                samples.push((val * env * 18000.0) as i16);
            }
        }
        write_wav_file("assets/audio/eat_ghost.wav", &samples, SAMPLE_RATE);
    }

    // 5. Death Sound (Classic Descending Step Sweep)
    {
        let steps = 14;
        let step_dur = 0.08;
        let mut samples = Vec::new();
        for s in 0..steps {
            let freq = 820.0 * (0.86f32).powi(s as i32);
            let mut phase = 0.0f32;
            let count = (step_dur * SAMPLE_RATE as f32) as usize;
            for i in 0..count {
                let t = i as f32 / count as f32;
                let pitch = freq * (1.0 - t * 0.15);
                phase += 2.0 * PI * pitch / SAMPLE_RATE as f32;
                let env = 1.0 - t * 0.5;
                let val = square(phase, 0.5);
                samples.push((val * env * 15000.0) as i16);
            }
        }
        write_wav_file("assets/audio/death.wav", &samples, SAMPLE_RATE);
    }

    // 6. Bonus Fruit Eaten (Two-Tone Bright Chime)
    {
        let freqs = [880.0, 1320.0];
        let durs = [0.12, 0.20];
        let mut samples = Vec::new();
        for (&freq, &dur) in freqs.iter().zip(durs.iter()) {
            let count = (dur * SAMPLE_RATE as f32) as usize;
            let mut phase = 0.0f32;
            for i in 0..count {
                let t = i as f32 / count as f32;
                phase += 2.0 * PI * freq / SAMPLE_RATE as f32;
                let env = (1.0 - t).powf(1.2);
                let val = 0.7 * sine(phase) + 0.3 * sine(phase * 2.0);
                samples.push((val * env * 19000.0) as i16);
            }
        }
        write_wav_file("assets/audio/fruit.wav", &samples, SAMPLE_RATE);
    }

    // 7. Intro Melody Fanfare
    {
        let melody = [
            (493.88, 0.12), (987.77, 0.12), (739.99, 0.12), (622.25, 0.12),
            (987.77, 0.12), (739.99, 0.16), (622.25, 0.22),
            (523.25, 0.12), (1046.50, 0.12), (783.99, 0.12), (659.25, 0.12),
            (1046.50, 0.12), (783.99, 0.16), (659.25, 0.22),
            (493.88, 0.12), (987.77, 0.12), (739.99, 0.12), (622.25, 0.12),
            (987.77, 0.12), (739.99, 0.16), (622.25, 0.22),
            (622.25, 0.08), (659.25, 0.08), (698.46, 0.08), (739.99, 0.08),
            (783.99, 0.08), (830.61, 0.08), (880.00, 0.08), (987.77, 0.35),
        ];
        let mut samples = Vec::new();
        for (freq, dur) in melody {
            let count = (dur * SAMPLE_RATE as f32) as usize;
            let mut phase = 0.0f32;
            for i in 0..count {
                let frac = i as f32 / count as f32;
                phase += 2.0 * PI * freq / SAMPLE_RATE as f32;
                let env = (1.0 - frac * 0.25).min(1.0);
                let val = square(phase, 0.25);
                samples.push((val * env * 14000.0) as i16);
            }
        }
        write_wav_file("assets/audio/game_start.wav", &samples, SAMPLE_RATE);
    }
}

// =========================================================================
// Maze Grid Definition & Navigation Constants
// Row 7 column 10 is clear corridor ' ' for Blinky to spawn cleanly outside house!
// Row 8 column 10 is the Cyber Gate 'D'.
// =========================================================================

const MAP_WIDTH: usize = 21;
const MAP_HEIGHT: usize = 21;
const CELL_SIZE: f32 = 1.2;

const MAZE_TILES: [&str; 21] = [
    "WWWWWWWWWWWWWWWWWWWWW", // 0
    "WO........W........OW", // 1
    "W.WWW.WWW.W.WWW.WWW.W", // 2
    "W.WWW.WWW.W.WWW.WWW.W", // 3
    "W...................W", // 4
    "W.WWW.W.WWWWW.W.WWW.W", // 5
    "W.....W...W...W.....W", // 6
    "WWWWW.WWW   WWW.WWWWW", // 7: Open corridor across columns 9, 10, 11 (Blinky starts at 7, 10!)
    "    W.W WWDWW W.W    ", // 8: Top of ghost house; Cyber Gate 'D' at index 10
    "WWWWW.W GGGGG W.WWWWW", // 9: Inside Ghost House
    "     .  GGGGG  .     ", // 10: Tunnel row & Ghost House center
    "WWWWW.W GGGGG W.WWWWW", // 11: Inside Ghost House
    "    W.W WWWWW W.W    ", // 12: Bottom wall of Ghost House
    "WWWWW.W       W.WWWWW", // 13: Corridor beneath Ghost House (Cherry spawns at 13, 10!)
    "W.........W.........W", // 14
    "W.WWW.WWW.W.WWW.WWW.W", // 15
    "WO..W.....P.....W..OW", // 16: Pacman start at (16, 10)
    "WWW.W.W.WWWWW.W.W.WWW", // 17
    "W.....W...W...W.....W", // 18
    "W.WWWWWWW.W.WWWWWWW.W", // 19
    "WWWWWWWWWWWWWWWWWWWWW", // 20
];

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Direction {
    None,
    Up,
    Down,
    Left,
    Right,
}

impl Direction {
    fn offset(&self) -> (i32, i32) {
        match self {
            Direction::None => (0, 0),
            Direction::Up => (-1, 0),
            Direction::Down => (1, 0),
            Direction::Left => (0, -1),
            Direction::Right => (0, 1),
        }
    }

    fn opposite(&self) -> Direction {
        match self {
            Direction::Up => Direction::Down,
            Direction::Down => Direction::Up,
            Direction::Left => Direction::Right,
            Direction::Right => Direction::Left,
            Direction::None => Direction::None,
        }
    }

    fn to_rotation_y(&self) -> f32 {
        match self {
            Direction::Right => 0.0,
            Direction::Down => -PI * 0.5,
            Direction::Left => PI,
            Direction::Up => PI * 0.5,
            Direction::None => 0.0,
        }
    }
}

fn grid_to_world(row: usize, col: usize) -> Vec3 {
    let half_w = (MAP_WIDTH as f32 - 1.0) / 2.0;
    let half_h = (MAP_HEIGHT as f32 - 1.0) / 2.0;
    Vec3::new(
        (col as f32 - half_w) * CELL_SIZE,
        0.0,
        (row as f32 - half_h) * CELL_SIZE,
    )
}

fn is_wall(row: usize, col: usize) -> bool {
    if row >= MAP_HEIGHT || col >= MAP_WIDTH {
        return true;
    }
    let ch = MAZE_TILES[row].as_bytes()[col];
    ch == b'W'
}

// =========================================================================
// Game Components & Resources
// =========================================================================

#[derive(Component, Clone)]
struct AutoPlaySceneAnimation {
    clip: Handle<AnimationClip>,
}

#[derive(Component)]
struct Pacman {
    grid_pos: (usize, usize),
    next_tile: (usize, usize),
    progress: f32,
    speed: f32,
    current_dir: Direction,
    queued_dir: Direction,
    chomp_flip: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GhostType {
    Blinky,
    Pinky,
    Inky,
    Clyde,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GhostState {
    InHouse,
    Chase,
    Scatter,
    Frightened,
    Eaten,
}

#[derive(Component)]
struct Ghost {
    identity: GhostType,
    state: GhostState,
    grid_pos: (usize, usize),
    next_tile: (usize, usize),
    progress: f32,
    current_dir: Direction,
    home_corner: (usize, usize),
    house_timer: f32,
}

#[derive(Component)]
struct GhostLight {
    base_color: Color,
}

#[derive(Component)]
struct NormalVisual;

#[derive(Component)]
struct FrightenedVisual;

#[derive(Component)]
struct FlashVisual;

#[derive(Component)]
struct EyesVisual;

#[derive(Component)]
struct Pellet {
    is_power: bool,
    seed: f32,
}

#[derive(Component)]
struct CherryFruit {
    timer: f32,
}

#[derive(Component)]
struct FloatingText {
    lifetime: f32,
}

#[derive(Component)]
struct ScoreText;

#[derive(Component)]
struct LivesText;

#[derive(Component)]
struct BannerText;

#[derive(Component)]
struct MainCamera;

enum CameraMode {
    Isometric,
    TopDown,
    Follow,
}

#[derive(Resource)]
struct AudioLibrary {
    waka_0: Handle<AudioSource>,
    waka_1: Handle<AudioSource>,
    power_pellet: Handle<AudioSource>,
    eat_ghost: Handle<AudioSource>,
    death: Handle<AudioSource>,
    fruit: Handle<AudioSource>,
    game_start: Handle<AudioSource>,
}

#[derive(PartialEq, Eq)]
enum GamePhase {
    Ready,
    Playing,
    PacmanDying,
    GameOver,
    Victory,
}

#[derive(Resource)]
struct GameManager {
    score: u32,
    high_score: u32,
    lives: u32,
    level: u32,
    pellets_remaining: usize,
    phase: GamePhase,
    phase_timer: f32,
    frightened_timer: f32,
    ghost_kill_streak: u32,
    scatter_cycle_timer: f32,
    is_scatter_mode: bool,
    camera_mode: CameraMode,
    fruit_respawn_timer: f32,
}

// =========================================================================
// Initialization Systems
// =========================================================================

fn setup_game(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut meshes: ResMut<Assets<Mesh>>,
) {
    // 1. Audio Library
    let audio_lib = AudioLibrary {
        waka_0: asset_server.load("audio/waka_0.wav"),
        waka_1: asset_server.load("audio/waka_1.wav"),
        power_pellet: asset_server.load("audio/power_pellet.wav"),
        eat_ghost: asset_server.load("audio/eat_ghost.wav"),
        death: asset_server.load("audio/death.wav"),
        fruit: asset_server.load("audio/fruit.wav"),
        game_start: asset_server.load("audio/game_start.wav"),
    };

    commands.spawn((
        AudioPlayer(audio_lib.game_start.clone()),
        PlaybackSettings::DESPAWN.with_volume(Volume::new(0.65)),
    ));
    commands.insert_resource(audio_lib);

    // 2. Camera Setup
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(0.0, 25.0, 15.0).looking_at(Vec3::new(0.0, 0.0, 0.8), Dir3::Y),
        MainCamera,
    ));

    // 3. Directional Key Light & Ambient
    commands.spawn((
        DirectionalLight {
            illuminance: 2400.0,
            shadows_enabled: true,
            ..default()
        },
        Transform::from_rotation(Quat::from_euler(EulerRot::XYZ, -1.05, 0.4, 0.0)),
    ));

    // 4. Labyrinth Floor (Deep Navy Reflective Grid)
    let floor_mat = materials.add(StandardMaterial {
        base_color: Color::srgb(0.02, 0.03, 0.06),
        perceptual_roughness: 0.25,
        metallic: 0.8,
        ..default()
    });
    commands.spawn((
        Mesh3d(meshes.add(Plane3d::default().mesh().size(32.0, 32.0))),
        MeshMaterial3d(floor_mat),
        Transform::from_xyz(0.0, -0.05, 0.0),
    ));

    // 5. Build Maze Layout: Walls and Cyber Gate
    for (r, row_str) in MAZE_TILES.iter().enumerate() {
        for (c, &tile_byte) in row_str.as_bytes().iter().enumerate() {
            let world = grid_to_world(r, c);

            match tile_byte {
                b'W' => {
                    commands.spawn((
                        SceneRoot(asset_server.load("models/wall.glb#Scene0")),
                        Transform::from_xyz(world.x, 0.0, world.z),
                    ));
                }
                b'D' => {
                    // Cyber Gate energy barrier (replaces the awkward pink stripe!)
                    commands.spawn((
                        SceneRoot(asset_server.load("models/gate.glb#Scene0")),
                        Transform::from_xyz(world.x, 0.0, world.z),
                    ));
                }
                _ => {}
            }
        }
    }

    // Spawn all collectible pellets
    let total_pellets = spawn_field_pellets(&mut commands, &asset_server);

    // Spawn initial bonus Cherry beneath the Ghost House at (13, 10)
    spawn_bonus_cherry(&mut commands, &asset_server);

    // 6. Spawn Pacman (scaled to 1.16 diameter, perfectly matching the 1.24 tunnel)
    // Equipped with warm dynamic yellow aura light matching classic arcade illumination
    let pacman_start = grid_to_world(16, 10);
    commands
        .spawn((
            Pacman {
                grid_pos: (16, 10),
                next_tile: (16, 10),
                progress: 1.0,
                speed: 3.2, // Tuned for comfortable, classic arcade pacing
                current_dir: Direction::None,
                queued_dir: Direction::None,
                chomp_flip: false,
            },
            AutoPlaySceneAnimation {
                clip: asset_server.load("models/packman.glb#Animation0"),
            },
            SceneRoot(asset_server.load("models/packman.glb#Scene0")),
            Transform::from_xyz(pacman_start.x, 0.50, pacman_start.z),
        ))
        .with_child((
            PointLight {
                color: Color::srgb(1.0, 0.9, 0.2),
                intensity: 75_000.0,
                range: 5.5,
                shadows_enabled: false,
                ..default()
            },
            Transform::from_xyz(0.0, 0.45, 0.0),
        ));

    // 7. Spawn the 4 Iconic Ghosts (diameter 1.16) with individual aura lights
    // Blinky starts cleanly at (7, 10) in the open corridor directly outside the gate!
    spawn_ghost(&mut commands, &asset_server, GhostType::Blinky, (7, 10), GhostState::Scatter, 0.0);
    // Pinky, Inky, Clyde inside the Ghost House at row 10
    spawn_ghost(&mut commands, &asset_server, GhostType::Pinky, (10, 10), GhostState::InHouse, 2.0);
    spawn_ghost(&mut commands, &asset_server, GhostType::Inky, (10, 9), GhostState::InHouse, 4.0);
    spawn_ghost(&mut commands, &asset_server, GhostType::Clyde, (10, 11), GhostState::InHouse, 6.0);

    // 8. Arcade HUD UI
    commands.spawn((
        Text::new("SCORE: 000000"),
        TextFont { font_size: 24.0, ..default() },
        TextColor(Color::srgb(1.0, 0.9, 0.2)),
        Node {
            position_type: PositionType::Absolute,
            top: Val::Px(16.0),
            left: Val::Px(24.0),
            ..default()
        },
        ScoreText,
    ));

    commands.spawn((
        Text::new("LIVES: 3  |  LEVEL: 1  |  [C: CAM] [R: RESET]"),
        TextFont { font_size: 24.0, ..default() },
        TextColor(Color::srgb(0.2, 0.9, 1.0)),
        Node {
            position_type: PositionType::Absolute,
            top: Val::Px(16.0),
            right: Val::Px(24.0),
            ..default()
        },
        LivesText,
    ));

    commands.spawn((
        Text::new("READY!"),
        TextFont { font_size: 40.0, ..default() },
        TextColor(Color::srgb(1.0, 0.85, 0.1)),
        Node {
            position_type: PositionType::Absolute,
            bottom: Val::Px(24.0),
            left: Val::Percent(38.0),
            ..default()
        },
        BannerText,
    ));

    commands.insert_resource(GameManager {
        score: 0,
        high_score: 10000,
        lives: 3,
        level: 1,
        pellets_remaining: total_pellets,
        phase: GamePhase::Ready,
        phase_timer: 3.5,
        frightened_timer: 0.0,
        ghost_kill_streak: 200,
        scatter_cycle_timer: 7.0,
        is_scatter_mode: true,
        camera_mode: CameraMode::Isometric,
        fruit_respawn_timer: 0.0,
    });
}

fn spawn_field_pellets(commands: &mut Commands, asset_server: &Res<AssetServer>) -> usize {
    let mut total_pellets = 0;
    for (r, row_str) in MAZE_TILES.iter().enumerate() {
        for (c, &tile_byte) in row_str.as_bytes().iter().enumerate() {
            let world = grid_to_world(r, c);

            match tile_byte {
                b'.' => {
                    commands.spawn((
                        Pellet { is_power: false, seed: (r * 31 + c) as f32 },
                        AutoPlaySceneAnimation {
                            clip: asset_server.load("models/pellet.glb#Animation0"),
                        },
                        SceneRoot(asset_server.load("models/pellet.glb#Scene0")),
                        Transform::from_xyz(world.x, 0.25, world.z),
                    ));
                    total_pellets += 1;
                }
                b'O' => {
                    commands.spawn((
                        Pellet { is_power: true, seed: (r * 31 + c) as f32 },
                        AutoPlaySceneAnimation {
                            clip: asset_server.load("models/power_pellet.glb#Animation0"),
                        },
                        SceneRoot(asset_server.load("models/power_pellet.glb#Scene0")),
                        Transform::from_xyz(world.x, 0.35, world.z),
                    ));
                    total_pellets += 1;
                }
                _ => {}
            }
        }
    }
    total_pellets
}

fn spawn_bonus_cherry(commands: &mut Commands, asset_server: &Res<AssetServer>) {
    let fruit_pos = grid_to_world(13, 10);
    commands.spawn((
        CherryFruit { timer: 20.0 },
        AutoPlaySceneAnimation {
            clip: asset_server.load("models/cherry.glb#Animation0"),
        },
        SceneRoot(asset_server.load("models/cherry.glb#Scene0")),
        Transform::from_xyz(fruit_pos.x, 0.38, fruit_pos.z),
    ));
}

fn spawn_ghost(
    commands: &mut Commands,
    asset_server: &Res<AssetServer>,
    gtype: GhostType,
    pos: (usize, usize),
    state: GhostState,
    exit_delay: f32,
) {
    let (model_path, anim_path, home, light_color) = match gtype {
        GhostType::Blinky => (
            "models/ghost_blinky.glb#Scene0",
            "models/ghost_blinky.glb#Animation0",
            (0, MAP_WIDTH - 1),
            Color::srgb(1.0, 0.2, 0.2),
        ),
        GhostType::Pinky => (
            "models/ghost_pinky.glb#Scene0",
            "models/ghost_pinky.glb#Animation0",
            (0, 0),
            Color::srgb(1.0, 0.4, 0.7),
        ),
        GhostType::Inky => (
            "models/ghost_inky.glb#Scene0",
            "models/ghost_inky.glb#Animation0",
            (MAP_HEIGHT - 1, MAP_WIDTH - 1),
            Color::srgb(0.1, 0.8, 1.0),
        ),
        GhostType::Clyde => (
            "models/ghost_clyde.glb#Scene0",
            "models/ghost_clyde.glb#Animation0",
            (MAP_HEIGHT - 1, 0),
            Color::srgb(1.0, 0.6, 0.1),
        ),
    };

    let world = grid_to_world(pos.0, pos.1);

    commands
        .spawn((
            Ghost {
                identity: gtype,
                state,
                grid_pos: pos,
                next_tile: pos,
                progress: 1.0,
                current_dir: Direction::None,
                home_corner: home,
                house_timer: exit_delay,
            },
            Transform::from_xyz(world.x, 0.50, world.z),
            Visibility::default(),
        ))
        .with_children(|parent| {
            // 1. Normal colored visual (diameter 1.16)
            parent.spawn((
                NormalVisual,
                AutoPlaySceneAnimation {
                    clip: asset_server.load(anim_path),
                },
                SceneRoot(asset_server.load(model_path)),
                Transform::IDENTITY,
                Visibility::Inherited,
            ));

            // 2. Frightened electric blue visual
            parent.spawn((
                FrightenedVisual,
                AutoPlaySceneAnimation {
                    clip: asset_server.load("models/ghost_frightened.glb#Animation0"),
                },
                SceneRoot(asset_server.load("models/ghost_frightened.glb#Scene0")),
                Transform::IDENTITY,
                Visibility::Hidden,
            ));

            // 3. Frightened flashing warning visual
            parent.spawn((
                FlashVisual,
                AutoPlaySceneAnimation {
                    clip: asset_server.load("models/ghost_flash.glb#Animation0"),
                },
                SceneRoot(asset_server.load("models/ghost_flash.glb#Scene0")),
                Transform::IDENTITY,
                Visibility::Hidden,
            ));

            // 4. Eaten floating eyes visual
            parent.spawn((
                EyesVisual,
                AutoPlaySceneAnimation {
                    clip: asset_server.load("models/ghost_eyes.glb#Animation0"),
                },
                SceneRoot(asset_server.load("models/ghost_eyes.glb#Scene0")),
                Transform::IDENTITY,
                Visibility::Hidden,
            ));

            // 5. Dynamic character aura point light
            parent.spawn((
                GhostLight {
                    base_color: light_color,
                },
                PointLight {
                    color: light_color,
                    intensity: 45_000.0,
                    range: 4.5,
                    shadows_enabled: false,
                    ..default()
                },
                Transform::from_xyz(0.0, 0.40, 0.0),
            ));
        });
}

// =========================================================================
// Animation & Visual State Systems
// =========================================================================

// Connects Bevy 0.15's AnimationPlayer to glTF AnimationClips via AnimationGraph
fn play_scene_animations(
    mut commands: Commands,
    mut players: Query<(Entity, &mut AnimationPlayer), Without<AnimationGraphHandle>>,
    parents: Query<&Parent>,
    animations: Query<&AutoPlaySceneAnimation>,
    mut graphs: ResMut<Assets<AnimationGraph>>,
) {
    for (player_entity, mut player) in players.iter_mut() {
        let mut curr = player_entity;
        loop {
            if let Ok(auto_anim) = animations.get(curr) {
                let (graph, node_index) = AnimationGraph::from_clip(auto_anim.clip.clone());
                let graph_handle = graphs.add(graph);
                commands.entity(player_entity).insert(AnimationGraphHandle(graph_handle));
                player.play(node_index).repeat();
                break;
            }
            if let Ok(parent) = parents.get(curr) {
                curr = parent.get();
            } else {
                break;
            }
        }
    }
}

// Procedural spinning and hovering for gems, fruit, and energized gyro rings
fn procedural_animations(
    time: Res<Time>,
    mut pellet_query: Query<(&Pellet, &mut Transform), Without<Pacman>>,
    mut fruit_query: Query<&mut Transform, (With<CherryFruit>, Without<Pellet>, Without<Pacman>)>,
) {
    let t = time.elapsed_secs();
    for (pellet, mut transform) in pellet_query.iter_mut() {
        if pellet.is_power {
            let pulse = 1.0 + (t * 5.0 + pellet.seed).sin() * 0.10;
            transform.scale = Vec3::splat(pulse);
            transform.rotate_y(time.delta_secs() * 2.0);
            transform.translation.y = 0.35 + (t * 3.0 + pellet.seed).sin() * 0.03;
        } else {
            transform.rotate_y(time.delta_secs() * 2.5);
            transform.translation.y = 0.25 + (t * 3.5 + pellet.seed).sin() * 0.02;
        }
    }

    for mut f_tf in fruit_query.iter_mut() {
        f_tf.rotate_y(time.delta_secs() * 1.8);
        f_tf.translation.y = 0.38 + (t * 3.0).sin() * 0.04;
    }
}

// Manages dynamic ghost color and aura lighting changes: Normal -> Frightened Blue -> Warning Flash -> Eaten Eyes
fn ghost_visual_system(
    time: Res<Time>,
    gm: Res<GameManager>,
    ghost_query: Query<(&Ghost, &Children)>,
    mut vis_query: Query<&mut Visibility>,
    mut light_query: Query<(&GhostLight, &mut PointLight)>,
    normal_q: Query<Entity, With<NormalVisual>>,
    fright_q: Query<Entity, With<FrightenedVisual>>,
    flash_q: Query<Entity, With<FlashVisual>>,
    eyes_q: Query<Entity, With<EyesVisual>>,
) {
    let flash_state = (time.elapsed_secs() * 8.0).sin() > 0.0;

    for (ghost, children) in ghost_query.iter() {
        let is_frightened = ghost.state == GhostState::Frightened;
        let is_eaten = ghost.state == GhostState::Eaten;
        let is_warning = is_frightened && gm.frightened_timer < 2.5;

        for &child in children.iter() {
            // Update mesh visibility layers
            if let Ok(mut vis) = vis_query.get_mut(child) {
                if normal_q.get(child).is_ok() {
                    *vis = if !is_frightened && !is_eaten {
                        Visibility::Inherited
                    } else {
                        Visibility::Hidden
                    };
                } else if fright_q.get(child).is_ok() {
                    *vis = if is_frightened && (!is_warning || !flash_state) {
                        Visibility::Inherited
                    } else {
                        Visibility::Hidden
                    };
                } else if flash_q.get(child).is_ok() {
                    *vis = if is_frightened && is_warning && flash_state {
                        Visibility::Inherited
                    } else {
                        Visibility::Hidden
                    };
                } else if eyes_q.get(child).is_ok() {
                    *vis = if is_eaten {
                        Visibility::Inherited
                    } else {
                        Visibility::Hidden
                    };
                }
            }

            // Dynamically update ghost aura point light
            if let Ok((ghost_light, mut pl)) = light_query.get_mut(child) {
                if is_eaten {
                    pl.color = Color::srgb(0.2, 0.5, 1.0);
                    pl.intensity = 16_000.0;
                } else if is_frightened {
                    if is_warning && flash_state {
                        pl.color = Color::srgb(1.0, 1.0, 1.0);
                        pl.intensity = 55_000.0;
                    } else {
                        pl.color = Color::srgb(0.15, 0.35, 1.0);
                        pl.intensity = 40_000.0;
                    }
                } else {
                    pl.color = ghost_light.base_color;
                    pl.intensity = 45_000.0;
                }
            }
        }
    }
}

// =========================================================================
// Gameplay Systems
// =========================================================================

fn player_input_system(
    keyboard_input: Res<ButtonInput<KeyCode>>,
    mut pacman_query: Query<&mut Pacman>,
    mut gm: ResMut<GameManager>,
) {
    let mut dir_input = Direction::None;
    if keyboard_input.pressed(KeyCode::ArrowUp) || keyboard_input.pressed(KeyCode::KeyW) {
        dir_input = Direction::Up;
    } else if keyboard_input.pressed(KeyCode::ArrowDown) || keyboard_input.pressed(KeyCode::KeyS) {
        dir_input = Direction::Down;
    } else if keyboard_input.pressed(KeyCode::ArrowLeft) || keyboard_input.pressed(KeyCode::KeyA) {
        dir_input = Direction::Left;
    } else if keyboard_input.pressed(KeyCode::ArrowRight) || keyboard_input.pressed(KeyCode::KeyD) {
        dir_input = Direction::Right;
    }

    if let Ok(mut pacman) = pacman_query.get_single_mut() {
        if dir_input != Direction::None {
            pacman.queued_dir = dir_input;
            if dir_input == pacman.current_dir.opposite() {
                pacman.current_dir = dir_input;
                let tmp = pacman.grid_pos;
                pacman.grid_pos = pacman.next_tile;
                pacman.next_tile = tmp;
                pacman.progress = (1.0 - pacman.progress).clamp(0.0, 1.0);
            }
        }
    }

    if keyboard_input.just_pressed(KeyCode::KeyC) {
        gm.camera_mode = match gm.camera_mode {
            CameraMode::Isometric => CameraMode::TopDown,
            CameraMode::TopDown => CameraMode::Follow,
            CameraMode::Follow => CameraMode::Isometric,
        };
    }
}

fn pacman_movement_system(
    time: Res<Time>,
    mut pacman_query: Query<(&mut Pacman, &mut Transform)>,
    gm: Res<GameManager>,
) {
    if gm.phase != GamePhase::Playing {
        return;
    }

    let delta = time.delta_secs();

    for (mut pacman, mut transform) in pacman_query.iter_mut() {
        if pacman.progress >= 1.0 {
            pacman.grid_pos = pacman.next_tile;

            // Seamless Tunnel Wrap-Around on row 10
            if pacman.grid_pos.0 == 10 {
                if pacman.grid_pos.1 == 0 && pacman.current_dir == Direction::Left {
                    pacman.grid_pos = (10, MAP_WIDTH - 1);
                    pacman.next_tile = (10, MAP_WIDTH - 2);
                    pacman.progress = 0.0;
                    continue;
                } else if pacman.grid_pos.1 == MAP_WIDTH - 1 && pacman.current_dir == Direction::Right {
                    pacman.grid_pos = (10, 0);
                    pacman.next_tile = (10, 1);
                    pacman.progress = 0.0;
                    continue;
                }
            }

            if pacman.queued_dir != Direction::None {
                let off = pacman.queued_dir.offset();
                let tr = pacman.grid_pos.0 as i32 + off.0;
                let tc = pacman.grid_pos.1 as i32 + off.1;
                if tr >= 0 && tr < MAP_HEIGHT as i32 && tc >= 0 && tc < MAP_WIDTH as i32 {
                    if !is_wall(tr as usize, tc as usize) {
                        pacman.current_dir = pacman.queued_dir;
                    }
                }
            }

            if pacman.current_dir != Direction::None {
                let off = pacman.current_dir.offset();
                let tr = pacman.grid_pos.0 as i32 + off.0;
                let tc = pacman.grid_pos.1 as i32 + off.1;
                if tr >= 0 && tr < MAP_HEIGHT as i32 && tc >= 0 && tc < MAP_WIDTH as i32 {
                    if !is_wall(tr as usize, tc as usize) {
                        pacman.next_tile = (tr as usize, tc as usize);
                        pacman.progress = 0.0;
                    } else {
                        pacman.current_dir = Direction::None;
                    }
                }
            }
        }

        if pacman.progress < 1.0 {
            pacman.progress = (pacman.progress + delta * pacman.speed).min(1.0);
            let from = grid_to_world(pacman.grid_pos.0, pacman.grid_pos.1);
            let to = grid_to_world(pacman.next_tile.0, pacman.next_tile.1);
            let curr = from.lerp(to, pacman.progress);
            transform.translation.x = curr.x;
            transform.translation.z = curr.z;

            let target_rot = pacman.current_dir.to_rotation_y();
            transform.rotation = Quat::from_rotation_y(target_rot);
        }
    }
}

fn ghost_ai_system(
    time: Res<Time>,
    mut ghost_query: Query<(&mut Ghost, &mut Transform)>,
    pacman_query: Query<(&Pacman, &Transform), Without<Ghost>>,
    mut gm: ResMut<GameManager>,
) {
    if gm.phase != GamePhase::Playing {
        return;
    }

    let delta = time.delta_secs();

    if gm.frightened_timer > 0.0 {
        gm.frightened_timer = (gm.frightened_timer - delta).max(0.0);
        if gm.frightened_timer == 0.0 {
            for (mut ghost, _) in ghost_query.iter_mut() {
                if ghost.state == GhostState::Frightened {
                    ghost.state = if gm.is_scatter_mode {
                        GhostState::Scatter
                    } else {
                        GhostState::Chase
                    };
                }
            }
        }
    } else {
        gm.scatter_cycle_timer -= delta;
        if gm.scatter_cycle_timer <= 0.0 {
            gm.is_scatter_mode = !gm.is_scatter_mode;
            gm.scatter_cycle_timer = if gm.is_scatter_mode { 7.0 } else { 20.0 };
            for (mut ghost, _) in ghost_query.iter_mut() {
                if ghost.state == GhostState::Chase || ghost.state == GhostState::Scatter {
                    ghost.state = if gm.is_scatter_mode {
                        GhostState::Scatter
                    } else {
                        GhostState::Chase
                    };
                }
            }
        }
    }

    let pacman_pos = pacman_query.get_single().map(|(p, _)| (p.grid_pos, p.current_dir)).unwrap_or(((16, 10), Direction::None));
    let mut rng = rand::thread_rng();

    for (mut ghost, mut transform) in ghost_query.iter_mut() {
        if ghost.state == GhostState::InHouse {
            ghost.house_timer -= delta;
            if ghost.house_timer <= 0.0 {
                // Exit smoothly through the cyber gate into corridor (7, 10)
                ghost.grid_pos = (7, 10);
                ghost.next_tile = (7, 10);
                ghost.progress = 1.0;
                ghost.state = GhostState::Chase;
            } else {
                continue;
            }
        }

        // Tuned balanced movement speeds: comfortable, classic arcade pacing
        let speed = match ghost.state {
            GhostState::Eaten => 5.2,
            GhostState::Frightened => 1.8,
            _ => 2.8 + (gm.level as f32 * 0.15),
        };

        if ghost.progress >= 1.0 {
            ghost.grid_pos = ghost.next_tile;

            // Tunnel Wrap-Around on row 10
            if ghost.grid_pos.0 == 10 {
                if ghost.grid_pos.1 == 0 && ghost.current_dir == Direction::Left {
                    ghost.grid_pos = (10, MAP_WIDTH - 1);
                    ghost.next_tile = (10, MAP_WIDTH - 2);
                    ghost.progress = 0.0;
                } else if ghost.grid_pos.1 == MAP_WIDTH - 1 && ghost.current_dir == Direction::Right {
                    ghost.grid_pos = (10, 0);
                    ghost.next_tile = (10, 1);
                    ghost.progress = 0.0;
                }
            }

            if ghost.state == GhostState::Eaten && ghost.grid_pos == (7, 10) {
                ghost.state = GhostState::Chase;
            }

            let target = match ghost.state {
                GhostState::Eaten => (7, 10),
                GhostState::Scatter => ghost.home_corner,
                GhostState::Frightened => (rng.gen_range(0..MAP_HEIGHT), rng.gen_range(0..MAP_WIDTH)),
                GhostState::Chase => match ghost.identity {
                    GhostType::Blinky => pacman_pos.0,
                    GhostType::Pinky => {
                        let off = pacman_pos.1.offset();
                        (
                            (pacman_pos.0.0 as i32 + off.0 * 4).clamp(0, MAP_HEIGHT as i32 - 1) as usize,
                            (pacman_pos.0.1 as i32 + off.1 * 4).clamp(0, MAP_WIDTH as i32 - 1) as usize,
                        )
                    }
                    GhostType::Inky => {
                        let off = pacman_pos.1.offset();
                        (
                            (pacman_pos.0.0 as i32 + off.0 * 2).clamp(0, MAP_HEIGHT as i32 - 1) as usize,
                            (pacman_pos.0.1 as i32 + off.1 * 2).clamp(0, MAP_WIDTH as i32 - 1) as usize,
                        )
                    }
                    GhostType::Clyde => {
                        let dr = ghost.grid_pos.0 as f32 - pacman_pos.0.0 as f32;
                        let dc = ghost.grid_pos.1 as f32 - pacman_pos.0.1 as f32;
                        if (dr * dr + dc * dc).sqrt() > 6.0 {
                            pacman_pos.0
                        } else {
                            ghost.home_corner
                        }
                    }
                },
                GhostState::InHouse => (7, 10),
            };

            let candidates = [Direction::Up, Direction::Down, Direction::Left, Direction::Right];
            let mut best_dir = Direction::None;
            let mut best_dist = f32::MAX;

            for &dir in &candidates {
                if dir == ghost.current_dir.opposite() && ghost.state != GhostState::Frightened {
                    continue;
                }
                let off = dir.offset();
                let nr = ghost.grid_pos.0 as i32 + off.0;
                let nc = ghost.grid_pos.1 as i32 + off.1;
                if nr >= 0 && nr < MAP_HEIGHT as i32 && nc >= 0 && nc < MAP_WIDTH as i32 {
                    if !is_wall(nr as usize, nc as usize) {
                        let dr = nr as f32 - target.0 as f32;
                        let dc = nc as f32 - target.1 as f32;
                        let dist = dr * dr + dc * dc;
                        if dist < best_dist {
                            best_dist = dist;
                            best_dir = dir;
                        }
                    }
                }
            }

            if best_dir != Direction::None {
                ghost.current_dir = best_dir;
                let off = best_dir.offset();
                ghost.next_tile = (
                    (ghost.grid_pos.0 as i32 + off.0) as usize,
                    (ghost.grid_pos.1 as i32 + off.1) as usize,
                );
                ghost.progress = 0.0;
            }
        }

        if ghost.progress < 1.0 {
            ghost.progress = (ghost.progress + delta * speed).min(1.0);
            let from = grid_to_world(ghost.grid_pos.0, ghost.grid_pos.1);
            let to = grid_to_world(ghost.next_tile.0, ghost.next_tile.1);
            let curr = from.lerp(to, ghost.progress);
            transform.translation.x = curr.x;
            transform.translation.z = curr.z;

            if ghost.current_dir != Direction::None {
                let target_rot = ghost.current_dir.to_rotation_y();
                transform.rotation = Quat::from_rotation_y(target_rot);
            }
        }
    }
}

fn pellet_collection_system(
    mut commands: Commands,
    mut pacman_query: Query<(&mut Pacman, &Transform)>,
    pellet_query: Query<(Entity, &Pellet, &Transform)>,
    mut ghost_query: Query<&mut Ghost>,
    mut gm: ResMut<GameManager>,
    audio_lib: Res<AudioLibrary>,
) {
    if gm.phase != GamePhase::Playing {
        return;
    }

    let Ok((mut pacman, pac_tf)) = pacman_query.get_single_mut() else { return; };

    for (p_ent, pellet, p_tf) in pellet_query.iter() {
        let dist = pac_tf.translation.distance(p_tf.translation);
        if dist < 0.65 {
            commands.entity(p_ent).despawn_recursive();
            gm.pellets_remaining = gm.pellets_remaining.saturating_sub(1);

            if pellet.is_power {
                gm.score += 50;
                gm.frightened_timer = 7.0;
                gm.ghost_kill_streak = 200;

                for mut ghost in ghost_query.iter_mut() {
                    if ghost.state != GhostState::InHouse && ghost.state != GhostState::Eaten {
                        ghost.state = GhostState::Frightened;
                    }
                }

                commands.spawn((
                    AudioPlayer(audio_lib.power_pellet.clone()),
                    PlaybackSettings::DESPAWN.with_volume(Volume::new(0.6)),
                ));
            } else {
                gm.score += 10;
                pacman.chomp_flip = !pacman.chomp_flip;
                let sound = if pacman.chomp_flip {
                    audio_lib.waka_0.clone()
                } else {
                    audio_lib.waka_1.clone()
                };
                commands.spawn((
                    AudioPlayer(sound),
                    PlaybackSettings::DESPAWN.with_volume(Volume::new(0.4)),
                ));
            }

            if gm.pellets_remaining == 0 {
                gm.phase = GamePhase::Victory;
                gm.phase_timer = 3.0;
            }
        }
    }
}

fn ghost_collision_system(
    mut commands: Commands,
    pacman_query: Query<&Transform, With<Pacman>>,
    mut ghost_query: Query<(&mut Ghost, &Transform)>,
    mut gm: ResMut<GameManager>,
    audio_lib: Res<AudioLibrary>,
) {
    if gm.phase != GamePhase::Playing {
        return;
    }

    let Ok(pac_tf) = pacman_query.get_single() else { return; };

    for (mut ghost, g_tf) in ghost_query.iter_mut() {
        let dist = pac_tf.translation.distance(g_tf.translation);
        if dist < 0.75 {
            if ghost.state == GhostState::Frightened {
                ghost.state = GhostState::Eaten;
                let award = gm.ghost_kill_streak;
                gm.score += award;
                gm.ghost_kill_streak *= 2;

                commands.spawn((
                    AudioPlayer(audio_lib.eat_ghost.clone()),
                    PlaybackSettings::DESPAWN.with_volume(Volume::new(0.7)),
                ));

                commands.spawn((
                    FloatingText { lifetime: 1.2 },
                    Text::new(format!("+{}", award)),
                    TextFont { font_size: 28.0, ..default() },
                    TextColor(Color::srgb(0.2, 1.0, 0.4)),
                    Node {
                        position_type: PositionType::Absolute,
                        top: Val::Percent(45.0),
                        left: Val::Percent(50.0),
                        ..default()
                    },
                ));
            } else if ghost.state == GhostState::Chase || ghost.state == GhostState::Scatter {
                gm.phase = GamePhase::PacmanDying;
                gm.phase_timer = 2.0;

                commands.spawn((
                    AudioPlayer(audio_lib.death.clone()),
                    PlaybackSettings::DESPAWN.with_volume(Volume::new(0.75)),
                ));
                break;
            }
        }
    }
}

// Cherry fruit bonus collection and cyclic re-spawning
fn fruit_system(
    mut commands: Commands,
    time: Res<Time>,
    pacman_query: Query<&Transform, With<Pacman>>,
    mut fruit_query: Query<(Entity, &mut CherryFruit, &Transform)>,
    mut gm: ResMut<GameManager>,
    audio_lib: Res<AudioLibrary>,
    asset_server: Res<AssetServer>,
) {
    let delta = time.delta_secs();
    let Ok(pac_tf) = pacman_query.get_single() else { return; };

    let mut fruit_count = 0;
    for (f_ent, mut fruit, f_tf) in fruit_query.iter_mut() {
        fruit_count += 1;
        fruit.timer -= delta;
        if fruit.timer <= 0.0 {
            commands.entity(f_ent).despawn_recursive();
            gm.fruit_respawn_timer = 15.0;
            continue;
        }

        if pac_tf.translation.distance(f_tf.translation) < 0.85 {
            gm.score += 100;
            commands.entity(f_ent).despawn_recursive();
            gm.fruit_respawn_timer = 20.0;

            commands.spawn((
                AudioPlayer(audio_lib.fruit.clone()),
                PlaybackSettings::DESPAWN.with_volume(Volume::new(0.65)),
            ));

            commands.spawn((
                FloatingText { lifetime: 1.2 },
                Text::new("+100"),
                TextFont { font_size: 28.0, ..default() },
                TextColor(Color::srgb(1.0, 0.4, 0.7)),
                Node {
                    position_type: PositionType::Absolute,
                    top: Val::Percent(45.0),
                    left: Val::Percent(50.0),
                    ..default()
                },
            ));
        }
    }

    // Cyclic re-spawning: when cherry is eaten or expires, a new one appears after cooldown
    if fruit_count == 0 && gm.phase == GamePhase::Playing {
        gm.fruit_respawn_timer -= delta;
        if gm.fruit_respawn_timer <= 0.0 {
            spawn_bonus_cherry(&mut commands, &asset_server);
            gm.fruit_respawn_timer = 25.0;
        }
    }
}

fn floating_text_system(
    mut commands: Commands,
    time: Res<Time>,
    mut text_query: Query<(Entity, &mut FloatingText)>,
) {
    let delta = time.delta_secs();
    for (entity, mut float_txt) in text_query.iter_mut() {
        float_txt.lifetime -= delta;
        if float_txt.lifetime <= 0.0 {
            commands.entity(entity).despawn_recursive();
        }
    }
}

fn camera_follow_system(
    mut camera_query: Query<&mut Transform, (With<MainCamera>, Without<Pacman>)>,
    pacman_query: Query<&Transform, With<Pacman>>,
    gm: Res<GameManager>,
) {
    let Ok(pac_tf) = pacman_query.get_single() else { return; };
    let Ok(mut cam_tf) = camera_query.get_single_mut() else { return; };

    match gm.camera_mode {
        CameraMode::Isometric => {
            let target = Vec3::new(0.0, 24.0, 16.0);
            cam_tf.translation = cam_tf.translation.lerp(target, 0.08);
            cam_tf.look_at(Vec3::new(0.0, 0.0, 0.5), Dir3::Y);
        }
        CameraMode::TopDown => {
            let target = Vec3::new(0.0, 28.0, 0.001);
            cam_tf.translation = cam_tf.translation.lerp(target, 0.08);
            cam_tf.look_at(Vec3::ZERO, Dir3::NEG_Z);
        }
        CameraMode::Follow => {
            let target = pac_tf.translation + Vec3::new(0.0, 8.5, 7.0);
            cam_tf.translation = cam_tf.translation.lerp(target, 0.12);
            cam_tf.look_at(pac_tf.translation + Vec3::new(0.0, 0.5, 0.0), Dir3::Y);
        }
    }
}

// Complete field & characters reset to pristine initial state
fn reset_field_and_characters(
    commands: &mut Commands,
    asset_server: &Res<AssetServer>,
    pellet_query: &Query<Entity, With<Pellet>>,
    fruit_query: &Query<Entity, With<CherryFruit>>,
    pacman_query: &mut Query<(&mut Pacman, &mut Transform)>,
    ghost_query: &mut Query<(&mut Ghost, &mut Transform), Without<Pacman>>,
) -> usize {
    // 1. Despawn any existing pellets and fruit
    for entity in pellet_query.iter() {
        commands.entity(entity).despawn_recursive();
    }
    for entity in fruit_query.iter() {
        commands.entity(entity).despawn_recursive();
    }

    // 2. Respawn the complete maze pellet field
    let total = spawn_field_pellets(commands, asset_server);

    // 3. Respawn the bonus Cherry fruit at (13, 10)
    spawn_bonus_cherry(commands, asset_server);

    // 4. Reset Pacman to initial spawn position and state
    if let Ok((mut pacman, mut p_tf)) = pacman_query.get_single_mut() {
        pacman.grid_pos = (16, 10);
        pacman.next_tile = (16, 10);
        pacman.progress = 1.0;
        pacman.current_dir = Direction::None;
        pacman.queued_dir = Direction::None;
        pacman.chomp_flip = false;
        let world = grid_to_world(16, 10);
        p_tf.translation = Vec3::new(world.x, 0.50, world.z);
        p_tf.rotation = Quat::IDENTITY;
    }

    // 5. Reset all Ghosts to initial home positions and states
    // Blinky at (7, 10), Pinky at (10, 10), Inky at (10, 9), Clyde at (10, 11)
    for (mut ghost, mut g_tf) in ghost_query.iter_mut() {
        let (start_pos, state, delay) = match ghost.identity {
            GhostType::Blinky => ((7, 10), GhostState::Scatter, 0.0),
            GhostType::Pinky => ((10, 10), GhostState::InHouse, 2.0),
            GhostType::Inky => ((10, 9), GhostState::InHouse, 4.0),
            GhostType::Clyde => ((10, 11), GhostState::InHouse, 6.0),
        };
        ghost.grid_pos = start_pos;
        ghost.next_tile = start_pos;
        ghost.progress = 1.0;
        ghost.state = state;
        ghost.current_dir = Direction::None;
        ghost.house_timer = delay;
        let world = grid_to_world(start_pos.0, start_pos.1);
        g_tf.translation = Vec3::new(world.x, 0.50, world.z);
        g_tf.rotation = Quat::IDENTITY;
    }

    total
}

fn game_state_manager_system(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    time: Res<Time>,
    mut gm: ResMut<GameManager>,
    mut pacman_query: Query<(&mut Pacman, &mut Transform)>,
    mut ghost_query: Query<(&mut Ghost, &mut Transform), Without<Pacman>>,
    pellet_query: Query<Entity, With<Pellet>>,
    fruit_query: Query<Entity, With<CherryFruit>>,
    mut banner_query: Query<(&mut Text, &mut Visibility), With<BannerText>>,
    keyboard_input: Res<ButtonInput<KeyCode>>,
) {
    let delta = time.delta_secs();

    if gm.score > gm.high_score {
        gm.high_score = gm.score;
    }

    // Hotkey 'R' for instant full reset at any time
    if keyboard_input.just_pressed(KeyCode::KeyR) {
        gm.score = 0;
        gm.lives = 3;
        gm.level = 1;
        gm.phase = GamePhase::Ready;
        gm.phase_timer = 2.0;
        gm.frightened_timer = 0.0;
        gm.fruit_respawn_timer = 0.0;
        gm.pellets_remaining = reset_field_and_characters(
            &mut commands,
            &asset_server,
            &pellet_query,
            &fruit_query,
            &mut pacman_query,
            &mut ghost_query,
        );
        return;
    }

    let Ok((mut banner_text, mut banner_vis)) = banner_query.get_single_mut() else { return; };

    match gm.phase {
        GamePhase::Ready => {
            *banner_vis = Visibility::Visible;
            banner_text.0 = "READY!".to_string();
            gm.phase_timer -= delta;
            if gm.phase_timer <= 0.0 {
                gm.phase = GamePhase::Playing;
                *banner_vis = Visibility::Hidden;
            }
        }
        GamePhase::Playing => {
            *banner_vis = Visibility::Hidden;
        }
        GamePhase::PacmanDying => {
            *banner_vis = Visibility::Visible;
            banner_text.0 = "OUCH!".to_string();
            gm.phase_timer -= delta;
            if gm.phase_timer <= 0.0 {
                if gm.lives > 1 {
                    gm.lives -= 1;
                    gm.phase = GamePhase::Ready;
                    gm.phase_timer = 2.0;
                    gm.frightened_timer = 0.0;

                    // Reposition characters to initial starting locations
                    if let Ok((mut pac, mut p_tf)) = pacman_query.get_single_mut() {
                        pac.grid_pos = (16, 10);
                        pac.next_tile = (16, 10);
                        pac.progress = 1.0;
                        pac.current_dir = Direction::None;
                        pac.queued_dir = Direction::None;
                        let world = grid_to_world(16, 10);
                        p_tf.translation = Vec3::new(world.x, 0.50, world.z);
                        p_tf.rotation = Quat::IDENTITY;
                    }

                    for (mut ghost, mut g_tf) in ghost_query.iter_mut() {
                        let (start_pos, state, delay) = match ghost.identity {
                            GhostType::Blinky => ((7, 10), GhostState::Scatter, 0.0),
                            GhostType::Pinky => ((10, 10), GhostState::InHouse, 2.0),
                            GhostType::Inky => ((10, 9), GhostState::InHouse, 4.0),
                            GhostType::Clyde => ((10, 11), GhostState::InHouse, 6.0),
                        };
                        ghost.grid_pos = start_pos;
                        ghost.next_tile = start_pos;
                        ghost.progress = 1.0;
                        ghost.state = state;
                        ghost.current_dir = Direction::None;
                        ghost.house_timer = delay;
                        let world = grid_to_world(start_pos.0, start_pos.1);
                        g_tf.translation = Vec3::new(world.x, 0.50, world.z);
                        g_tf.rotation = Quat::IDENTITY;
                    }
                } else {
                    gm.lives = 0;
                    gm.phase = GamePhase::GameOver;
                }
            }
        }
        GamePhase::GameOver => {
            *banner_vis = Visibility::Visible;
            banner_text.0 = "GAME OVER - PRESS SPACE TO RETRY".to_string();
            if keyboard_input.just_pressed(KeyCode::Space) {
                gm.score = 0;
                gm.lives = 3;
                gm.level = 1;
                gm.phase = GamePhase::Ready;
                gm.phase_timer = 2.0;
                gm.frightened_timer = 0.0;
                gm.fruit_respawn_timer = 0.0;
                // Full field and characters reset
                gm.pellets_remaining = reset_field_and_characters(
                    &mut commands,
                    &asset_server,
                    &pellet_query,
                    &fruit_query,
                    &mut pacman_query,
                    &mut ghost_query,
                );
            }
        }
        GamePhase::Victory => {
            *banner_vis = Visibility::Visible;
            banner_text.0 = "STAGE CLEARED!".to_string();
            gm.phase_timer -= delta;
            if gm.phase_timer <= 0.0 {
                gm.level += 1;
                gm.phase = GamePhase::Ready;
                gm.phase_timer = 2.0;
                gm.frightened_timer = 0.0;
                gm.fruit_respawn_timer = 0.0;
                // Respawn new field pellets and fresh cherry for next level
                gm.pellets_remaining = reset_field_and_characters(
                    &mut commands,
                    &asset_server,
                    &pellet_query,
                    &fruit_query,
                    &mut pacman_query,
                    &mut ghost_query,
                );
            }
        }
    }
}

fn hud_update_system(
    gm: Res<GameManager>,
    mut score_query: Query<&mut Text, (With<ScoreText>, Without<LivesText>)>,
    mut lives_query: Query<&mut Text, (With<LivesText>, Without<ScoreText>)>,
) {
    if let Ok(mut score_text) = score_query.get_single_mut() {
        score_text.0 = format!("SCORE: {:06}   HIGH: {:06}", gm.score, gm.high_score);
    }
    if let Ok(mut lives_text) = lives_query.get_single_mut() {
        lives_text.0 = format!("LIVES: {}   LEVEL: {}   [C: CAM] [R: RESET]", gm.lives, gm.level);
    }
}

// =========================================================================
// Main Entrypoint
// =========================================================================

fn main() {
    // 1. Synthesize procedural sound assets on launch
    generate_procedural_sounds();

    // 2. Launch Bevy Game Engine
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "PAC-MAN 3D // Cyber Maze Edition".into(),
                resolution: (1280.0_f32, 768.0_f32).into(),
                resizable: true,
                ..default()
            }),
            ..default()
        }))
        .insert_resource(AmbientLight {
            color: Color::srgb(0.08, 0.10, 0.22),
            brightness: 260.0,
        })
        .add_systems(Startup, setup_game)
        .add_systems(
            Update,
            (
                player_input_system,
                pacman_movement_system,
                ghost_ai_system,
                ghost_visual_system,
                pellet_collection_system,
                ghost_collision_system,
                fruit_system,
                floating_text_system,
                camera_follow_system,
                game_state_manager_system,
                hud_update_system,
                play_scene_animations,
                procedural_animations,
            ),
        )
        .run();
}
`,
);

console.log("\n======================================================");
console.log('Project "packman-3d" successfully configured!');
console.log("Features & Fixes:");
console.log(
  "  1. Cherry is spawned at the start beneath the Ghost House and cyclically re-spawns",
);
console.log(
  "  2. Ghost start positions corrected: Blinky starts in open corridor (7, 10)",
);
console.log("  3. Procedural 3D Cyber Energy Gate energy barrier");
console.log(
  "  4. Full field & character reset on retry, stage clear, or [R] key",
);
console.log(
  "  5. Character point lights added to Pacman and all Ghosts with dynamic aura adaptation",
);
console.log("======================================================\n");
console.log("To run the game:");
console.log("  cd packman_3d");
console.log("  cargo run\n");
