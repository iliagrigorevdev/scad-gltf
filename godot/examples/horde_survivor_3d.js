const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(process.cwd(), "horde_survivor_3d");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeFile(relPath, content) {
  const fullPath = path.join(ROOT_DIR, relPath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content.trimStart(), "utf-8");
  console.log(`[Created] ${relPath}`);
}

console.log(
  `Generating Horde Survivor 3D (Refined Models & Fast Grid Physics) in: ${ROOT_DIR}`,
);
ensureDir(ROOT_DIR);

// =========================================================================
// 1. REFINED OPENSCAD 3D PROCEDURAL ASSETS
// (OpenSCAD +X Right -> Godot +X, +Y Forward -> Godot -Z, +Z Up -> Godot +Y)
// =========================================================================

// assets/player.scad (Stylized Paladin Knight)
writeFile(
  "assets/player.scad",
  `
$fn = 24;
$asa = 35.0;

anim_data = [
  ["Walk", [
    ["Root", [
      [0.0, [0, 0, 0], [0, 0, 0]],
      [0.2, [2, 0, 2], [0, 0, 0.12]],
      [0.4, [0, 0, 0], [0, 0, 0]],
      [0.6, [-2, 0, -2], [0, 0, 0.12]],
      [0.8, [0, 0, 0], [0, 0, 0]]
    ]],
    ["LegL", [
      [0.0, [-26, 0, 0], [-0.65, 0, 1.5]],
      [0.2, [0, 0, 0], [-0.65, 0, 1.65]],
      [0.4, [26, 0, 0], [-0.65, 0, 1.5]],
      [0.6, [0, 0, 0], [-0.65, 0, 1.65]],
      [0.8, [-26, 0, 0], [-0.65, 0, 1.5]]
    ]],
    ["LegR", [
      [0.0, [26, 0, 0], [0.65, 0, 1.5]],
      [0.2, [0, 0, 0], [0.65, 0, 1.65]],
      [0.4, [-26, 0, 0], [0.65, 0, 1.5]],
      [0.6, [0, 0, 0], [0.65, 0, 1.65]],
      [0.8, [26, 0, 0], [0.65, 0, 1.5]]
    ]],
    ["ArmL", [
      [0.0, [15, 0, -5], [-1.4, 0, 2.9]],
      [0.4, [-15, 0, -5], [-1.4, 0, 2.9]],
      [0.8, [15, 0, -5], [-1.4, 0, 2.9]]
    ]],
    ["ArmR", [
      [0.0, [-22, 0, 5], [1.4, 0, 2.9]],
      [0.4, [22, 0, 5], [1.4, 0, 2.9]],
      [0.8, [-22, 0, 5], [1.4, 0, 2.9]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="Root", t=[0, 0, 0], r=[0, 0, 0]) {
    // Torso / Cuirass
    translate([0, 0, 2.3]) {
      // Main steel chestplate
      color([0.3, 0.34, 0.42], metalness=0.9, roughness=0.25)
        cube([1.7, 1.2, 1.5], center=true);

      // Gold pectoral trim (+Y forward)
      translate([0, 0.61, 0.25])
        color([0.92, 0.75, 0.15], metalness=0.95, roughness=0.2, emissive=[0.3, 0.2, 0.0], emissiveIntensity=1.0)
          cube([1.1, 0.08, 0.35], center=true);

      // Mana belt & buckle
      translate([0, 0, -0.65]) {
        color([0.18, 0.15, 0.12], metalness=0.2, roughness=0.8)
          cube([1.74, 1.24, 0.3], center=true);
        translate([0, 0.63, 0])
          color([0.0, 0.85, 1.0], metalness=0.1, roughness=0.2, emissive=[0.0, 0.85, 1.0], emissiveIntensity=3.0)
            cube([0.5, 0.08, 0.32], center=true);
      }
    }

    // Great Helmet
    translate([0, 0, 3.5]) {
      color([0.32, 0.36, 0.45], metalness=0.9, roughness=0.2)
        cube([1.25, 1.25, 1.25], center=true);

      // Helmet visor slit plate
      translate([0, 0.64, 0.05])
        color([0.2, 0.22, 0.28], metalness=0.95, roughness=0.15)
          cube([1.1, 0.06, 0.4], center=true);

      // Glowing Cyan Visor Line
      translate([0, 0.68, 0.05])
        color([0.0, 0.95, 1.0], metalness=0.0, roughness=0.1, emissive=[0.0, 0.95, 1.0], emissiveIntensity=4.0)
          cube([0.9, 0.04, 0.16], center=true);

      // Royal Plume crest flowing along -Y
      translate([0, -0.2, 0.85])
        color([0.85, 0.12, 0.18], metalness=0.1, roughness=0.7)
          cube([0.25, 1.3, 0.55], center=true);
    }

    // Left Leg
    bone(name="LegL", t=[-0.65, 0, 1.5], r=[0, 0, 0]) {
      color([0.25, 0.28, 0.35], metalness=0.85, roughness=0.35) {
        translate([0, 0, -0.75])
          cube([0.5, 0.65, 1.5], center=true);
        // Sabaton (boot tip +Y)
        translate([0, 0.18, -1.35])
          cube([0.52, 0.8, 0.3], center=true);
      }
    }

    // Right Leg
    bone(name="LegR", t=[0.65, 0, 1.5], r=[0, 0, 0]) {
      color([0.25, 0.28, 0.35], metalness=0.85, roughness=0.35) {
        translate([0, 0, -0.75])
          cube([0.5, 0.65, 1.5], center=true);
        // Sabaton
        translate([0, 0.18, -1.35])
          cube([0.52, 0.8, 0.3], center=true);
      }
    }

    // Left Arm (Shield Arm)
    bone(name="ArmL", t=[-1.4, 0, 2.9], r=[0, 0, 0]) {
      // Shoulder pauldron
      translate([-0.1, 0, 0.1])
        color([0.35, 0.4, 0.5], metalness=0.9, roughness=0.25)
          cube([0.7, 0.85, 0.5], center=true);
      // Arm
      translate([0, 0, -0.65])
        color([0.25, 0.28, 0.35], metalness=0.8, roughness=0.4)
          cube([0.45, 0.45, 1.3], center=true);

      // Medieval Kite Shield mounted on forearm
      translate([-0.35, 0.35, -0.5]) {
        // Dark blue steel body
        color([0.15, 0.25, 0.5], metalness=0.7, roughness=0.3)
          cube([0.16, 1.0, 1.6], center=true);
        // Gold rim
        translate([-0.09, 0, 0])
          color([0.92, 0.75, 0.15], metalness=0.95, roughness=0.2, emissive=[0.3, 0.2, 0.0], emissiveIntensity=1.0) {
            cube([0.04, 0.9, 0.18], center=true);
            cube([0.04, 0.2, 1.4], center=true);
          }
      }
    }

    // Right Arm (Sword Arm)
    bone(name="ArmR", t=[1.4, 0, 2.9], r=[0, 0, 0]) {
      // Shoulder pauldron
      translate([0.1, 0, 0.1])
        color([0.35, 0.4, 0.5], metalness=0.9, roughness=0.25)
          cube([0.7, 0.85, 0.5], center=true);

      // Arm
      translate([0, 0, -0.65])
        color([0.25, 0.28, 0.35], metalness=0.8, roughness=0.4)
          cube([0.45, 0.45, 1.3], center=true);

      // Broadsword held in hand, angled forward (+Y) and up (+Z)
      translate([0.05, 0.3, -1.05])
      rotate([-45, 0, 0]) {
        // Pommel
        translate([0, 0, -0.36])
          color([0.9, 0.75, 0.15], metalness=0.95, roughness=0.25)
            sphere(r=0.13);

        // Grip / Handle
        translate([0, 0, -0.16])
          color([0.2, 0.16, 0.12], metalness=0.1, roughness=0.8)
            cube([0.14, 0.14, 0.32], center=true);

        // Crossguard
        translate([0, 0, 0.04])
          color([0.9, 0.75, 0.15], metalness=0.95, roughness=0.25)
            cube([0.85, 0.2, 0.12], center=true);

        // Steel Blade
        translate([0, 0, 1.1]) {
          color([0.9, 0.95, 1.0], metalness=0.98, roughness=0.12)
            cube([0.08, 0.32, 2.0], center=true);

          // Glowing runic fuller
          color([0.0, 0.85, 1.0], metalness=0.0, roughness=0.1, emissive=[0.0, 0.85, 1.0], emissiveIntensity=2.5)
            cube([0.1, 0.1, 1.5], center=true);
        }
      }
    }
  }
}
`,
);

// assets/enemy_walker.scad (Terrifying Zombie with sunken eye sockets and ragged clothes)
writeFile(
  "assets/enemy_walker.scad",
  `
$fn = 20;
$asa = 30.0;

anim_data = [
  ["Walk", [
    ["Torso", [
      [0.0, [12, 0, 3], [0, 0, 1.8]],
      [0.3, [14, 0, -3], [0, 0, 1.95]],
      [0.6, [12, 0, 3], [0, 0, 1.8]]
    ]],
    ["LegL", [
      [0.0, [-28, 0, 0], [-0.55, 0, 1.4]],
      [0.3, [28, 0, 0], [-0.55, 0, 1.4]],
      [0.6, [-28, 0, 0], [-0.55, 0, 1.4]]
    ]],
    ["LegR", [
      [0.0, [28, 0, 0], [0.55, 0, 1.4]],
      [0.3, [-28, 0, 0], [0.55, 0, 1.4]],
      [0.6, [28, 0, 0], [0.55, 0, 1.4]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="Torso", t=[0, 0, 1.8], r=[12, 0, 0]) {
    // Decaying Green Flesh
    color([0.22, 0.38, 0.26], metalness=0.1, roughness=0.85)
      cube([1.3, 0.95, 1.4], center=true);

    // Ripped dark tunic
    translate([0, 0, -0.25])
      color([0.18, 0.16, 0.15], metalness=0.05, roughness=0.9)
        cube([1.35, 1.0, 0.7], center=true);

    // Exposed Decayed Ribs (+Y front)
    translate([0, 0.5, 0.05])
      color([0.8, 0.8, 0.75], metalness=0.1, roughness=0.6) {
        cube([0.8, 0.08, 0.1], center=true);
        translate([0, 0, -0.2])
          cube([0.7, 0.08, 0.1], center=true);
      }

    // Zombie Head
    translate([0, 0.35, 1.1]) {
      // Skull
      color([0.25, 0.42, 0.28], metalness=0.1, roughness=0.85)
        cube([1.05, 1.05, 1.05], center=true);

      // Sunken Eye Sockets (Dark recessed boxes)
      translate([-0.28, 0.53, 0.1])
        color([0.06, 0.06, 0.06], roughness=1.0)
          cube([0.3, 0.08, 0.3], center=true);
      translate([0.28, 0.53, 0.1])
        color([0.06, 0.06, 0.06], roughness=1.0)
          cube([0.3, 0.08, 0.3], center=true);

      // Glowing Necrotic Crimson Pupils inside sockets
      translate([-0.28, 0.56, 0.1])
        color([1.0, 0.1, 0.1], metalness=0.0, roughness=0.1, emissive=[1.0, 0.05, 0.05], emissiveIntensity=4.0)
          sphere(r=0.1);
      translate([0.28, 0.56, 0.1])
        color([1.0, 0.1, 0.1], metalness=0.0, roughness=0.1, emissive=[1.0, 0.05, 0.05], emissiveIntensity=4.0)
          sphere(r=0.1);

      // Slack Decaying Jaw & Teeth
      translate([0, 0.42, -0.38]) {
        color([0.2, 0.34, 0.22], roughness=0.9)
          cube([0.85, 0.7, 0.35], center=true);
        // Jagged teeth
        translate([0, 0.35, 0.1])
          color([0.85, 0.85, 0.8], roughness=0.5)
            cube([0.65, 0.06, 0.12], center=true);
      }
    }

    // Outstretched Grasping Arms (+Y forward)
    translate([-0.95, 0.75, 0.3]) {
      color([0.22, 0.38, 0.26], roughness=0.85)
        cube([0.35, 1.4, 0.35], center=true);
      // Claws
      translate([0, 0.75, -0.05])
        color([0.15, 0.15, 0.15], roughness=0.6)
          cube([0.32, 0.2, 0.15], center=true);
    }
    translate([0.95, 0.75, 0.3]) {
      color([0.22, 0.38, 0.26], roughness=0.85)
        cube([0.35, 1.4, 0.35], center=true);
      translate([0, 0.75, -0.05])
        color([0.15, 0.15, 0.15], roughness=0.6)
          cube([0.32, 0.2, 0.15], center=true);
    }
  }

  // Tattered Legs (Feet at Z = 0)
  bone(name="LegL", t=[-0.55, 0, 1.4], r=[0, 0, 0]) {
    color([0.18, 0.16, 0.15], roughness=0.9)
      translate([0, 0, -0.7])
        cube([0.48, 0.55, 1.4], center=true);
  }

  bone(name="LegR", t=[0.55, 0, 1.4], r=[0, 0, 0]) {
    color([0.18, 0.16, 0.15], roughness=0.9)
      translate([0, 0, -0.7])
        cube([0.48, 0.55, 1.4], center=true);
  }
}
`,
);

// assets/enemy_swarmer.scad (Vampiric Bat with swept organic wings)
writeFile(
  "assets/enemy_swarmer.scad",
  `
$fn = 18;
$asa = 30.0;

anim_data = [
  ["Fly", [
    ["Body", [
      [0.0, [0, 0, 0], [0, 0, 1.3]],
      [0.2, [4, 0, 0], [0, 0, 1.5]],
      [0.4, [0, 0, 0], [0, 0, 1.3]]
    ]],
    ["WingL", [
      [0.0, [0, -35, 0], [-0.5, 0, 1.3]],
      [0.2, [0, 32, 0], [-0.5, 0, 1.3]],
      [0.4, [0, -35, 0], [-0.5, 0, 1.3]]
    ]],
    ["WingR", [
      [0.0, [0, 35, 0], [0.5, 0, 1.3]],
      [0.2, [0, -32, 0], [0.5, 0, 1.3]],
      [0.4, [0, 35, 0], [0.5, 0, 1.3]]
    ]]
  ]]
];

module bat_wing() {
  rotate([6, -8, -4]) {
    // Swept Scalloped Leather Membrane
    color([0.48, 0.15, 0.34], metalness=0.1, roughness=0.7)
      linear_extrude(height=0.028, center=true)
        polygon([
          [0.0, 0.0],
          [0.85, 0.08],
          [1.65, 0.04],
          [2.45, -0.12],
          // Scallop 1 (outer tip to middle finger)
          [2.30, -0.30],
          [2.12, -0.42],
          [1.98, -0.52],
          [1.88, -0.70],
          // Scallop 2 (middle finger to inner finger)
          [1.70, -0.58],
          [1.52, -0.50],
          [1.34, -0.56],
          [1.20, -0.72],
          // Scallop 3 (inner finger to body root)
          [0.95, -0.58],
          [0.65, -0.48],
          [0.35, -0.40],
          [0.05, -0.30]
        ]);

    // Skeletal Wing Bones (Upper arm, forearm, and radiating finger ribs)
    color([0.32, 0.14, 0.28], metalness=0.3, roughness=0.5) {
      // Upper arm
      hull() {
        sphere(r=0.065);
        translate([0.85, 0.08, 0]) sphere(r=0.055);
      }
      // Forearm
      hull() {
        translate([0.85, 0.08, 0]) sphere(r=0.055);
        translate([1.65, 0.04, 0]) sphere(r=0.048);
      }
      // Finger 1 (Outer wing strut to tip)
      hull() {
        translate([1.65, 0.04, 0]) sphere(r=0.045);
        translate([2.45, -0.12, 0]) sphere(r=0.015);
      }
      // Finger 2 (Middle rib)
      hull() {
        translate([1.65, 0.04, 0]) sphere(r=0.04);
        translate([1.88, -0.70, 0]) sphere(r=0.015);
      }
      // Finger 3 (Inner rib)
      hull() {
        translate([1.65, 0.04, 0]) sphere(r=0.035);
        translate([1.20, -0.72, 0]) sphere(r=0.015);
      }
      // Skeletal Knuckles
      translate([0.85, 0.08, 0]) sphere(r=0.065);
      translate([1.65, 0.04, 0]) sphere(r=0.058);
    }

    // Elbow Thumb Claw
    translate([0.85, 0.11, 0.03])
      rotate([-30, 15, 15])
        color([0.18, 0.10, 0.18], metalness=0.4, roughness=0.3)
          cylinder(h=0.16, r1=0.035, r2=0.005, center=true);
  }
}

armature(animations=anim_data) {
  bone(name="Body", t=[0, 0, 1.3], r=[0, 0, 0]) {
    // Sleek Vampiric Bat Head & Body
    color([0.22, 0.12, 0.28], metalness=0.2, roughness=0.6)
      sphere(r=0.65);

    // Pointed Bat Ears
    translate([-0.3, 0.05, 0.65])
      rotate([10, -15, 0])
        color([0.35, 0.15, 0.38], metalness=0.1, roughness=0.7)
          cylinder(h=0.7, r1=0.22, r2=0.03, center=true);
    translate([0.3, 0.05, 0.65])
      rotate([10, 15, 0])
        color([0.35, 0.15, 0.38], metalness=0.1, roughness=0.7)
          cylinder(h=0.7, r1=0.22, r2=0.03, center=true);

    // Glowing Golden Eyes (+Y forward)
    translate([-0.24, 0.52, 0.15])
      color([1.0, 0.85, 0.0], metalness=0.0, roughness=0.1, emissive=[1.0, 0.85, 0.0], emissiveIntensity=3.5)
        sphere(r=0.14);
    translate([0.24, 0.52, 0.15])
      color([1.0, 0.85, 0.0], metalness=0.0, roughness=0.1, emissive=[1.0, 0.85, 0.0], emissiveIntensity=3.5)
        sphere(r=0.14);

    // Vampire Fangs
    translate([-0.15, 0.58, -0.20])
      rotate([15, 0, 0])
        color([0.95, 0.95, 0.95], roughness=0.3)
          cylinder(h=0.32, r1=0.01, r2=0.06, center=true);
    translate([0.15, 0.58, -0.20])
      rotate([15, 0, 0])
        color([0.95, 0.95, 0.95], roughness=0.3)
          cylinder(h=0.32, r1=0.01, r2=0.06, center=true);
  }

  // Left Wing
  bone(name="WingL", t=[-0.5, 0, 1.3], r=[0, 0, 0]) {
    mirror([1, 0, 0])
      bat_wing();
  }

  // Right Wing
  bone(name="WingR", t=[0.5, 0, 1.3], r=[0, 0, 0]) {
    bat_wing();
  }
}
`,
);

// assets/enemy_brute.scad (Heavy Armored Boss with FORWARD spikes and Spiked War Maul)
writeFile(
  "assets/enemy_brute.scad",
  `
$fn = 24;
$asa = 35.0;

anim_data = [
  ["Walk", [
    ["Torso", [
      [0.0, [0, 3, 0], [0, 0, 2.2]],
      [0.4, [0, -3, 0], [0, 0, 2.4]],
      [0.8, [0, 3, 0], [0, 0, 2.2]]
    ]],
    ["ClubArm", [
      [0.0, [-20, 0, 0], [2.1, 0, 2.8]],
      [0.4, [25, 0, 0], [2.1, 0, 2.8]],
      [0.8, [-20, 0, 0], [2.1, 0, 2.8]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="Torso", t=[0, 0, 2.2], r=[0, 0, 0]) {
    // Heavy Muscular Body
    color([0.35, 0.2, 0.16], metalness=0.1, roughness=0.8)
      cube([2.5, 1.9, 2.2], center=true);

    // Heavy Iron Breastplate
    translate([0, 0.85, 0.1]) {
      color([0.18, 0.2, 0.24], metalness=0.9, roughness=0.25)
        cube([2.2, 0.35, 1.8], center=true);

      // CRITICAL FIX: Spikes point FORWARD (+Y) out of the chest armor, NOT UP!
      translate([-0.6, 0.2, 0.3])
        rotate([-90, 0, 0])
          color([1.0, 0.45, 0.1], metalness=0.8, roughness=0.2, emissive=[0.8, 0.25, 0.0], emissiveIntensity=2.0)
            cylinder(h=0.85, r1=0.28, r2=0.0);

      translate([0.6, 0.2, 0.3])
        rotate([-90, 0, 0])
          color([1.0, 0.45, 0.1], metalness=0.8, roughness=0.2, emissive=[0.8, 0.25, 0.0], emissiveIntensity=2.0)
            cylinder(h=0.85, r1=0.28, r2=0.0);
    }

    // Heavy Spiked Pauldron on Left Shoulder
    translate([-1.6, 0, 0.9]) {
      color([0.2, 0.22, 0.28], metalness=0.9, roughness=0.25)
        cube([0.9, 1.1, 0.7], center=true);
      // Pauldron Spike pointing up/out
      translate([-0.2, 0, 0.4])
        rotate([0, -25, 0])
          color([0.8, 0.8, 0.8], metalness=0.9, roughness=0.2)
            cylinder(h=0.7, r1=0.2, r2=0.0);
    }

    // Demonic Horned Head
    translate([0, 0.35, 1.7]) {
      color([0.28, 0.15, 0.12], metalness=0.1, roughness=0.85)
        cube([1.35, 1.35, 1.35], center=true);

      // Curved Demonic Horns
      translate([-0.8, -0.05, 0.5])
        rotate([15, -30, 0])
          color([0.12, 0.12, 0.12], metalness=0.6, roughness=0.4)
            cylinder(h=1.3, r1=0.3, r2=0.04);

      translate([0.8, -0.05, 0.5])
        rotate([15, 30, 0])
          color([0.12, 0.12, 0.12], metalness=0.6, roughness=0.4)
            cylinder(h=1.3, r1=0.3, r2=0.04);

      // Crimson Slit Visor (+Y forward)
      translate([0, 0.7, 0.1])
        color([1.0, 0.1, 0.0], metalness=0.0, roughness=0.1, emissive=[1.0, 0.1, 0.0], emissiveIntensity=4.5)
          cube([0.9, 0.08, 0.25], center=true);
    }

    // Heavy Plated Legs (Bottom of boots at Z = 0)
    translate([-0.75, 0, -1.6])
      color([0.2, 0.22, 0.26], metalness=0.8, roughness=0.35)
        cube([0.85, 1.1, 1.2], center=true);
    translate([0.75, 0, -1.6])
      color([0.2, 0.22, 0.26], metalness=0.8, roughness=0.35)
        cube([0.85, 1.1, 1.2], center=true);

    // Left Arm
    translate([-1.6, 0.2, 0.1])
      color([0.35, 0.2, 0.16], roughness=0.8)
        cube([0.75, 0.75, 1.6], center=true);
  }

  // Right Arm wielding giant Spiked War Maul
  bone(name="ClubArm", t=[2.1, 0, 2.8], r=[0, 0, 0]) {
    color([0.35, 0.2, 0.16], roughness=0.8)
      cube([0.75, 0.75, 1.5], center=true);

    // Maul Handle
    translate([0, 0.5, -0.4]) {
      color([0.25, 0.18, 0.12], metalness=0.2, roughness=0.8)
        cylinder(h=3.2, r=0.16, center=true);

      // Giant Steel Maul Head
      translate([0, 0, 1.8]) {
        color([0.18, 0.2, 0.25], metalness=0.95, roughness=0.2)
          cube([1.1, 1.1, 1.3], center=true);
        // Glowing Molten Lava Core
        color([1.0, 0.35, 0.0], metalness=0.0, roughness=0.1, emissive=[1.0, 0.35, 0.0], emissiveIntensity=4.0)
          sphere(r=0.45);
        // Striking Spikes
        translate([0, 0.65, 0])
          rotate([-90, 0, 0])
            color([0.9, 0.9, 0.9], metalness=0.9, roughness=0.2)
              cylinder(h=0.5, r1=0.2, r2=0.0);
        translate([0, -0.65, 0])
          rotate([90, 0, 0])
            color([0.9, 0.9, 0.9], metalness=0.9, roughness=0.2)
              cylinder(h=0.5, r1=0.2, r2=0.0);
      }
    }
  }
}
`,
);

// assets/gem_xp.scad (Brilliant Faceted Octahedron Crystal)
writeFile(
  "assets/gem_xp.scad",
  `
$fn = 8;
$asa = 0.0;

anim_data = [
  ["Spin", [
    ["Gem", [
      [0.0, [0, 0, 0], [0, 0, 0.6]],
      [0.5, [0, 0, 90], [0, 0, 0.85]],
      [1.0, [0, 0, 180], [0, 0, 0.6]],
      [1.5, [0, 0, 270], [0, 0, 0.35]],
      [2.0, [0, 0, 360], [0, 0, 0.6]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="Gem", t=[0, 0, 0.6], r=[0, 0, 0]) {
    color([0.1, 0.85, 1.0], alpha=0.9, metalness=0.2, roughness=0.1, emissive=[0.05, 0.7, 0.95], emissiveIntensity=3.5, specularIntensity=2.0)
      cylinder(h=0.7, r1=0.6, r2=0.0);

    translate([0, 0, -0.7])
      color([0.1, 0.85, 1.0], alpha=0.9, metalness=0.2, roughness=0.1, emissive=[0.05, 0.7, 0.95], emissiveIntensity=3.5, specularIntensity=2.0)
        cylinder(h=0.7, r1=0.0, r2=0.6);

    color([1.0, 1.0, 1.0], metalness=0.0, roughness=0.0, emissive=[1.0, 1.0, 1.0], emissiveIntensity=4.5)
      sphere(r=0.25, $fn=12);
  }
}
`,
);

// assets/orb.scad (Holy Aegis Orbiting Shield Orb)
writeFile(
  "assets/orb.scad",
  `
$fn = 20;
$asa = 45.0;

anim_data = [
  ["Pulse", [
    ["Rings", [
      [0.0, [0, 0, 0]],
      [0.5, [45, 90, 0]],
      [1.0, [90, 180, 0]],
      [1.5, [45, 270, 0]],
      [2.0, [0, 360, 0]]
    ]]
  ]]
];

armature(animations=anim_data) {
  bone(name="Core", t=[0, 0, 0], r=[0, 0, 0]) {
    color([1.0, 0.85, 0.2], alpha=1.0, metalness=0.1, roughness=0.1, emissive=[1.0, 0.8, 0.1], emissiveIntensity=4.0)
      sphere(r=0.55);

    color([1.0, 1.0, 1.0], alpha=1.0, metalness=0.0, roughness=0.0, emissive=[1.0, 1.0, 1.0], emissiveIntensity=5.0)
      sphere(r=0.3);

    bone(name="Rings", t=[0, 0, 0], r=[0, 0, 0]) {
      color([0.2, 0.9, 1.0], alpha=0.9, metalness=0.8, roughness=0.2, emissive=[0.1, 0.8, 1.0], emissiveIntensity=2.5) {
        rotate([45, 0, 0])
          difference() {
            cylinder(h=0.08, r=0.95, center=true);
            cylinder(h=0.12, r=0.75, center=true);
          }
        rotate([0, 45, 0])
          difference() {
            cylinder(h=0.08, r=0.95, center=true);
            cylinder(h=0.75, r=0.75, center=true);
          }
      }
    }
  }
}
`,
);

// assets/projectile.scad
writeFile(
  "assets/projectile.scad",
  `
$fn = 16;
$asa = 35.0;

union() {
  translate([0, 0.8, 0])
    color([0.2, 1.0, 0.5], metalness=0.1, roughness=0.2, emissive=[0.2, 1.0, 0.5], emissiveIntensity=3.5)
      rotate([-90, 0, 0])
        cylinder(h=1.0, r1=0.25, r2=0.0, center=false);

  translate([0, 0, 0])
    color([0.8, 0.9, 1.0], metalness=0.9, roughness=0.2, emissive=[0.1, 0.4, 0.8], emissiveIntensity=2.0)
      rotate([-90, 0, 0])
        cylinder(h=1.4, r=0.12, center=true);

  translate([0, -0.6, 0])
    color([0.1, 0.7, 1.0], metalness=0.5, roughness=0.3, emissive=[0.1, 0.8, 1.0], emissiveIntensity=2.5) {
      cube([0.6, 0.3, 0.05], center=true);
      cube([0.05, 0.3, 0.6], center=true);
    }
}
`,
);

// =========================================================================
// 2. GODOT ADDON: SCAD IMPORTER
// =========================================================================

writeFile(
  "addons/scad_importer/plugin.cfg",
  `
[plugin]

name="OpenSCAD GLTF Importer"
description="Imports .scad files directly as 3D scenes using scad-gltf"
author="Ilia Grigorev"
version="0.1"
script="scad_plugin.gd"
`,
);

writeFile(
  "addons/scad_importer/scad_plugin.gd",
  `
@tool
extends EditorPlugin

var import_plugin

func _enter_tree():
	import_plugin = preload("res://addons/scad_importer/scad_importer.gd").new()
	add_scene_format_importer_plugin(import_plugin)

func _exit_tree():
	remove_scene_format_importer_plugin(import_plugin)
	import_plugin = null
`,
);

writeFile(
  "addons/scad_importer/scad_importer.gd",
  `
@tool
extends EditorSceneFormatImporter

func _get_extensions():
	return PackedStringArray(["scad"])

func _get_import_flags():
	return EditorSceneFormatImporter.IMPORT_SCENE

func _import_scene(path: String, flags: int, options: Dictionary) -> Object:
	var global_source = ProjectSettings.globalize_path(path)
	var unique_id = str(hash(path))
	var temp_glb_path = ProjectSettings.globalize_path("user://scad_cache_" + unique_id + ".glb")

	var args = PackedStringArray()
	args.append(global_source)
	args.append(temp_glb_path)

	var output = []
	print("Importing %s via scad-convert..." % path.get_file())

	var exit_code = -1
	if OS.get_name() == "Windows":
		var win_args = PackedStringArray(["/c", "scad-convert"])
		win_args.append_array(args)
		exit_code = OS.execute("cmd.exe", win_args, output, true)
	else:
		exit_code = OS.execute("scad-convert", args, output, true)

	if exit_code != 0:
		print("scad-convert conversion failed for %s. Attempting fallback to local scad-serve..." % path.get_file())
		var fallback_success = _try_scad_serve_fallback(global_source, temp_glb_path)

		if not fallback_success:
			push_error("Failed to compile SCAD file: %s." % path.get_file())
			return null

	var gltf_doc = GLTFDocument.new()
	var gltf_state = GLTFState.new()
	var err = gltf_doc.append_from_file(temp_glb_path, gltf_state)

	if FileAccess.file_exists(temp_glb_path):
		DirAccess.remove_absolute(temp_glb_path)

	if err != OK:
		push_error("Failed to parse the generated GLB for %s." % path.get_file())
		return null

	var generated_scene = gltf_doc.generate_scene(gltf_state)
	if generated_scene:
		generated_scene.name = path.get_file().get_basename()
		_make_all_animations_loop(generated_scene)

	return generated_scene

func _make_all_animations_loop(node: Node) -> void:
	if node is AnimationPlayer:
		for anim_name in node.get_animation_list():
			var anim = node.get_animation(anim_name)
			if anim:
				anim.loop_mode = Animation.LOOP_LINEAR
	for child in node.get_children():
		_make_all_animations_loop(child)

func _get_relative_path(base: String, target: String) -> String:
	var base_parts = base.replace("\\\\", "/").split("/", false)
	var target_parts = target.replace("\\\\", "/").split("/", false)

	if OS.get_name() == "Windows":
		if base_parts.size() > 0 and target_parts.size() > 0:
			if base_parts[0].nocasecmp_to(target_parts[0]) != 0:
				return target

	var common_count = 0
	var min_len = min(base_parts.size(), target_parts.size())
	for i in range(min_len):
		if base_parts[i].nocasecmp_to(target_parts[i]) == 0:
			common_count += 1
		else:
			break

	var rel_parts = PackedStringArray()
	for i in range(common_count, base_parts.size()):
		rel_parts.append("..")

	for i in range(common_count, target_parts.size()):
		rel_parts.append(target_parts[i])

	return "/".join(rel_parts)

func _get_dependencies_recursive(file_path: String, visited: Dictionary) -> void:
	if visited.has(file_path):
		return

	visited[file_path] = ""

	if not FileAccess.file_exists(file_path):
		return

	var file = FileAccess.open(file_path, FileAccess.READ)
	if not file:
		return

	var content = file.get_as_text()
	file.close()

	visited[file_path] = content

	var regex = RegEx.new()
	regex.compile("(?:include|use)\\\\s*[<\\"]([^>\\"]+)[>\\"]")

	var base_dir = file_path.get_base_dir()
	for result in regex.search_all(content):
		var dep_rel_path = result.get_string(1)
		var dep_abs_path = base_dir.path_join(dep_rel_path).simplify_path()
		_get_dependencies_recursive(dep_abs_path, visited)

func _get_dependencies(file_path: String) -> Dictionary:
	var visited = {}
	_get_dependencies_recursive(file_path, visited)
	return visited

func _try_scad_serve_fallback(source_path: String, out_glb_path: String) -> bool:
	var deps = _get_dependencies(source_path)
	var content = deps.get(source_path, "")
	deps.erase(source_path)

	if content == "":
		return false

	var additional_files = {}
	var base_dir = source_path.get_base_dir()
	for dep_path in deps.keys():
		var rel_path = _get_relative_path(base_dir, dep_path)
		additional_files[rel_path] = deps[dep_path]

	var http = HTTPClient.new()
	var err = http.connect_to_host("127.0.0.1", 3000)
	if err != OK:
		return false

	var max_wait = 500
	var wait = 0
	while http.get_status() in [HTTPClient.STATUS_CONNECTING, HTTPClient.STATUS_RESOLVING]:
		http.poll()
		OS.delay_msec(10)
		wait += 1
		if wait > max_wait:
			return false

	if http.get_status() != HTTPClient.STATUS_CONNECTED:
		return false

	var headers = PackedStringArray(["Content-Type: application/json"])
	var payload = {
		"content": content,
		"options": {
			"additionalFiles": additional_files
		}
	}

	var body = JSON.stringify(payload)
	err = http.request(HTTPClient.METHOD_POST, "/api/convert", headers, body)
	if err != OK:
		return false

	max_wait = 6000
	wait = 0
	while http.get_status() == HTTPClient.STATUS_REQUESTING:
		http.poll()
		OS.delay_msec(10)
		wait += 1
		if wait > max_wait:
			return false

	if http.has_response() and http.get_response_code() == 200:
		var rb = PackedByteArray()
		while http.get_status() == HTTPClient.STATUS_BODY:
			http.poll()
			var chunk = http.read_response_body_chunk()
			if chunk.size() == 0:
				OS.delay_msec(10)
			else:
				rb.append_array(chunk)

		if rb.is_empty():
			return false

		var out_file = FileAccess.open(out_glb_path, FileAccess.WRITE)
		if not out_file:
			return false
		out_file.store_buffer(rb)
		out_file.close()

		print("Successfully compiled %s using scad-serve fallback." % source_path.get_file())
		return true

	return false
`,
);

// =========================================================================
// 3. GDSCRIPT FILES
// =========================================================================

// scripts/spatial_grid.gd - FAST 2D COLLISION/SEPARATION CHECK
writeFile(
  "scripts/spatial_grid.gd",
  `
extends Node

const CELL_SIZE: float = 2.5
var grid: Dictionary = {}
var active_cells: Array[Vector2i] = []

func update_grid(enemies: Array):
	# Clear only previously active cells to prevent garbage generation in GDScript
	for c in active_cells:
		grid[c].clear()
	active_cells.clear()

	for e in enemies:
		if is_instance_valid(e):
			var cx = int(floor(e.global_position.x / CELL_SIZE))
			var cz = int(floor(e.global_position.z / CELL_SIZE))
			var cell = Vector2i(cx, cz)

			if not grid.has(cell):
				grid[cell] = []

			# If the list is empty, we register it to active_cells for clearing next frame
			if grid[cell].is_empty():
				active_cells.append(cell)

			grid[cell].append(e)

func get_nearby(pos: Vector3) -> Array:
	var cx = int(floor(pos.x / CELL_SIZE))
	var cz = int(floor(pos.z / CELL_SIZE))
	var neighbors = []

	for dx in range(-1, 2):
		for dz in range(-1, 2):
			var cell = Vector2i(cx + dx, cz + dz)
			if grid.has(cell):
				neighbors.append_array(grid[cell])

	return neighbors
`,
);

// scripts/sound_manager.gd
writeFile(
  "scripts/sound_manager.gd",
  `
extends Node

var players: Array[AudioStreamPlayer] = []
const POOL_SIZE = 16

# CRITICAL FIX: Caching the generated AudioStreamWAV streams so we don't
# calculate loops of thousands of iterations of math per-frame on large hits!
var cached_streams: Dictionary = {}

func _ready():
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i in range(POOL_SIZE):
		var p = AudioStreamPlayer.new()
		add_child(p)
		players.append(p)

func _get_free_player() -> AudioStreamPlayer:
	for p in players:
		if not p.playing:
			return p
	return players[0]

func play_shoot():
	_play_cached_tone("shoot", 580.0, 220.0, 0.12, 0.15, "saw")

func play_hit():
	_play_cached_tone("hit", 180.0, 60.0, 0.08, 0.2, "noise")

func play_gem():
	_play_cached_tone("gem", 650.0, 980.0, 0.1, 0.12, "sine")

func play_level_up():
	_play_cached_arpeggio("levelup", [523.25, 659.25, 783.99, 1046.5], 0.08, 0.25)

func play_lightning():
	_play_cached_tone("lightning", 300.0, 70.0, 0.25, 0.35, "noise")

func play_hurt():
	_play_cached_tone("hurt", 150.0, 50.0, 0.2, 0.3, "square")

func _play_cached_tone(id: String, freq_start: float, freq_end: float, duration: float, volume: float, waveform: String):
	if not cached_streams.has(id):
		cached_streams[id] = _generate_tone(freq_start, freq_end, duration, volume, waveform)

	var player = _get_free_player()
	player.stream = cached_streams[id]
	player.play()

func _play_cached_arpeggio(id: String, freqs: Array, note_duration: float, volume: float):
	if not cached_streams.has(id):
		cached_streams[id] = _generate_arpeggio(freqs, note_duration, volume)

	var player = _get_free_player()
	player.stream = cached_streams[id]
	player.play()

func _generate_tone(freq_start: float, freq_end: float, duration: float, volume: float, waveform: String) -> AudioStreamWAV:
	var sample_rate = 22050
	var total_samples = int(duration * sample_rate)
	var buffer = PackedByteArray()
	buffer.resize(total_samples * 2)

	for i in range(total_samples):
		var t = float(i) / float(total_samples)
		var freq = lerp(freq_start, freq_end, t)
		var phase = float(i) * freq / float(sample_rate)
		var amp = (1.0 - t) * volume
		var sample = 0.0

		match waveform:
			"sine":
				sample = sin(phase * TAU) * amp
			"square":
				sample = (1.0 if sin(phase * TAU) > 0.0 else -1.0) * amp
			"saw":
				sample = (fmod(phase, 1.0) * 2.0 - 1.0) * amp
			"noise":
				sample = randf_range(-amp, amp)

		var val16 = int(clamp(sample, -1.0, 1.0) * 32767.0)
		buffer.encode_s16(i * 2, val16)

	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.data = buffer
	return stream

func _generate_arpeggio(freqs: Array, note_duration: float, volume: float) -> AudioStreamWAV:
	var sample_rate = 22050
	var note_samples = int(note_duration * sample_rate)
	var total_samples = note_samples * freqs.size()
	var buffer = PackedByteArray()
	buffer.resize(total_samples * 2)

	for note_idx in range(freqs.size()):
		var freq = freqs[note_idx]
		for i in range(note_samples):
			var idx = note_idx * note_samples + i
			var t = float(i) / float(note_samples)
			var phase = float(i) * freq / float(sample_rate)
			var amp = (1.0 - t * 0.5) * volume
			var sample = sin(phase * TAU) * amp
			var val16 = int(clamp(sample, -1.0, 1.0) * 32767.0)
			buffer.encode_s16(idx * 2, val16)

	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.data = buffer
	return stream
`,
);

// scripts/damage_number.gd
writeFile(
  "scripts/damage_number.gd",
  `
extends Node3D

@onready var label: Label3D = $Label3D
var velocity: Vector3 = Vector3(0, 3.5, 0)
var lifetime: float = 0.65

func setup(amount: int, is_crit: bool = false):
	label.text = str(amount)
	if is_crit:
		label.modulate = Color(1.0, 0.85, 0.1)
		label.font_size = 42
		velocity.y = 4.5
	else:
		label.modulate = Color(1.0, 0.3, 0.2)
		label.font_size = 32

	velocity.x = randf_range(-1.5, 1.5)
	velocity.z = randf_range(-1.5, 1.5)

func _process(delta: float):
	global_position += velocity * delta
	velocity.y -= 5.0 * delta
	lifetime -= delta
	var alpha = clamp(lifetime / 0.65, 0.0, 1.0)
	label.modulate.a = alpha
	if lifetime <= 0:
		queue_free()
`,
);

// scenes/damage_number.tscn
writeFile(
  "scenes/damage_number.tscn",
  `
[gd_scene load_steps=2 format=3 uid="uid://dmgnum001"]

[ext_resource type="Script" path="res://scripts/damage_number.gd" id="1_dnum"]

[node name="DamageNumber" type="Node3D"]
script = ExtResource("1_dnum")

[node name="Label3D" type="Label3D" parent="."]
billboard = 1
no_depth_test = true
font_size = 32
outline_size = 8
outline_modulate = Color(0, 0, 0, 1)
text = "10"
`,
);

// scripts/xp_gem.gd
writeFile(
  "scripts/xp_gem.gd",
  `
extends Area3D

@export var xp_value: int = 10
var player: CharacterBody3D = null
var magnet_speed: float = 0.0
var collected: bool = false

func _ready():
	add_to_group("gems")
	_setup_loop_anim(self)

func _setup_loop_anim(node: Node):
	if node is AnimationPlayer:
		for anim_name in node.get_animation_list():
			var anim = node.get_animation(anim_name)
			if anim:
				anim.loop_mode = Animation.LOOP_LINEAR
		if node.get_animation_list().size() > 0:
			node.play(node.get_animation_list()[0])
			var a = node.get_animation(node.get_animation_list()[0])
			if a:
				node.seek(randf_range(0.0, a.length), true)
		return
	for child in node.get_children():
		_setup_loop_anim(child)

func _process(delta: float):
	rotation.y += 2.5 * delta

	if player and is_instance_valid(player):
		magnet_speed += 40.0 * delta
		var dir = (player.global_position + Vector3(0, 1.0, 0) - global_position).normalized()
		global_position += dir * magnet_speed * delta

		if global_position.distance_to(player.global_position + Vector3(0, 1.0, 0)) < 0.8:
			_collect()

func attract_to(target: CharacterBody3D):
	player = target

func _collect():
	if collected:
		return
	collected = true
	SoundManager.play_gem()
	if player and player.has_method("add_xp"):
		player.add_xp(xp_value)
	queue_free()
`,
);

// scenes/xp_gem.tscn
writeFile(
  "scenes/xp_gem.tscn",
  `
[gd_scene load_steps=4 format=3 uid="uid://gem0001"]

[ext_resource type="Script" path="res://scripts/xp_gem.gd" id="1_gem"]
[ext_resource type="PackedScene" path="res://assets/gem_xp.scad" id="2_gem_mesh"]

[sub_resource type="SphereShape3D" id="SphereShape3D_1"]
radius = 0.8

[node name="XPGem" type="Area3D"]
collision_layer = 8
collision_mask = 2
script = ExtResource("1_gem")

[node name="Model" parent="." instance=ExtResource("2_gem_mesh")]
transform = Transform3D(0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0)

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.4, 0)
shape = SubResource("SphereShape3D_1")
`,
);

// scripts/projectile.gd
writeFile(
  "scripts/projectile.gd",
  `
extends Area3D

var direction: Vector3 = Vector3.FORWARD
var speed: float = 24.0
var damage: int = 25
var pierce: int = 1
var lifetime: float = 3.0

func setup(dir: Vector3, dmg: int, p_speed: float = 24.0, p_pierce: int = 1):
	direction = dir.normalized()
	damage = dmg
	speed = p_speed
	pierce = p_pierce
	if direction != Vector3.ZERO:
		look_at(global_position + direction, Vector3.UP)

func _process(delta: float):
	global_position += direction * speed * delta
	lifetime -= delta
	if lifetime <= 0.0:
		queue_free()

func _on_body_entered(body: Node3D):
	if body.is_in_group("enemies") and body.has_method("take_damage"):
		body.take_damage(damage, global_position)
		pierce -= 1
		if pierce <= 0:
			queue_free()
`,
);

// scenes/projectile.tscn
writeFile(
  "scenes/projectile.tscn",
  `
[gd_scene load_steps=4 format=3 uid="uid://proj0001"]

[ext_resource type="Script" path="res://scripts/projectile.gd" id="1_proj"]
[ext_resource type="PackedScene" path="res://assets/projectile.scad" id="2_proj_mesh"]

[sub_resource type="SphereShape3D" id="SphereShape3D_1"]
radius = 0.55

[node name="Projectile" type="Area3D"]
collision_layer = 16
collision_mask = 4
script = ExtResource("1_proj")

[node name="Model" parent="." instance=ExtResource("2_proj_mesh")]
transform = Transform3D(0.8, 0, 0, 0, 0.8, 0, 0, 0, 0.8, 0, 0, 0)

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
shape = SubResource("SphereShape3D_1")

[connection signal="body_entered" from="." to="." method="_on_body_entered"]
`,
);

// scripts/orbit_shield.gd
writeFile(
  "scripts/orbit_shield.gd",
  `
extends Node3D

@export var damage: int = 30
@export var rotation_speed: float = 3.0
var current_angle: float = 0.0
var radius: float = 3.2
var orb_count: int = 1
var orb_scene = preload("res://scenes/orbit_orb.tscn")
var orbs: Array[Node3D] = []

func _ready():
	update_orbs()

func set_orb_count(count: int):
	orb_count = count
	update_orbs()

func update_orbs():
	for o in orbs:
		if is_instance_valid(o):
			o.queue_free()
	orbs.clear()

	for i in range(orb_count):
		var orb = orb_scene.instantiate()
		add_child(orb)
		orb.damage = damage
		orbs.append(orb)

func _process(delta: float):
	current_angle += rotation_speed * delta
	for i in range(orbs.size()):
		var angle = current_angle + (TAU / orbs.size()) * i
		var pos = Vector3(cos(angle) * radius, 1.2, sin(angle) * radius)
		orbs[i].position = pos
`,
);

// scripts/orbit_orb.gd
writeFile(
  "scripts/orbit_orb.gd",
  `
extends Area3D

var damage: int = 30
var hit_cooldowns: Dictionary = {}

func _ready():
	_setup_loop_anim(self)

func _setup_loop_anim(node: Node):
	if node is AnimationPlayer:
		for anim_name in node.get_animation_list():
			var anim = node.get_animation(anim_name)
			if anim:
				anim.loop_mode = Animation.LOOP_LINEAR
		if node.get_animation_list().size() > 0:
			node.play(node.get_animation_list()[0])
		return
	for child in node.get_children():
		_setup_loop_anim(child)

func _process(delta: float):
	var to_remove = []
	for e in hit_cooldowns.keys():
		hit_cooldowns[e] -= delta
		if hit_cooldowns[e] <= 0:
			to_remove.append(e)
	for e in to_remove:
		hit_cooldowns.erase(e)

func _on_body_entered(body: Node3D):
	if body.is_in_group("enemies") and body.has_method("take_damage"):
		if not hit_cooldowns.has(body):
			hit_cooldowns[body] = 0.35
			body.take_damage(damage, global_position)
			SoundManager.play_hit()
`,
);

// scenes/orbit_orb.tscn
writeFile(
  "scenes/orbit_orb.tscn",
  `
[gd_scene load_steps=4 format=3 uid="uid://orb0001"]

[ext_resource type="Script" path="res://scripts/orbit_orb.gd" id="1_orb"]
[ext_resource type="PackedScene" path="res://assets/orb.scad" id="2_orb_mesh"]

[sub_resource type="SphereShape3D" id="SphereShape3D_1"]
radius = 0.85

[node name="OrbitOrb" type="Area3D"]
collision_layer = 16
collision_mask = 4
script = ExtResource("1_orb")

[node name="Model" parent="." instance=ExtResource("2_orb_mesh")]
transform = Transform3D(0.7, 0, 0, 0, 0.7, 0, 0, 0, 0.7, 0, 0, 0)

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
shape = SubResource("SphereShape3D_1")

[connection signal="body_entered" from="." to="." method="_on_body_entered"]
`,
);

// scripts/lightning_strike.gd
writeFile(
  "scripts/lightning_strike.gd",
  `
extends Node3D

@onready var mesh: MeshInstance3D = $MeshInstance3D
var lifetime: float = 0.25

func _ready():
	SoundManager.play_lightning()

func _process(delta: float):
	lifetime -= delta
	var a = lifetime / 0.25
	scale.x = a
	scale.z = a
	if lifetime <= 0:
		queue_free()
`,
);

// scenes/lightning_strike.tscn
writeFile(
  "scenes/lightning_strike.tscn",
  `
[gd_scene load_steps=4 format=3 uid="uid://lightn001"]

[ext_resource type="Script" path="res://scripts/lightning_strike.gd" id="1_light"]

[sub_resource type="CylinderMesh" id="CylinderMesh_1"]
top_radius = 0.3
bottom_radius = 0.8
height = 20.0

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_1"]
transparency = 1
albedo_color = Color(0.6, 0.9, 1, 0.9)
emission_enabled = true
emission = Color(0.3, 0.8, 1, 1)
emission_energy_multiplier = 4.0

[node name="LightningStrike" type="Node3D"]
script = ExtResource("1_light")

[node name="MeshInstance3D" type="MeshInstance3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0)
mesh = SubResource("CylinderMesh_1")
surface_material_override/0 = SubResource("StandardMaterial3D_1")
`,
);

// scripts/enemy_base.gd
writeFile(
  "scripts/enemy_base.gd",
  `
extends CharacterBody3D

@export var max_health: int = 40
@export var speed: float = 3.8
@export var damage: int = 10
@export var xp_amount: int = 15
@export var is_boss: bool = false
@export var target_height: float = 0.0
@export var separation_radius: float = 1.5

var health: int
var player: CharacterBody3D = null
var flash_timer: float = 0.0
var gem_scene = preload("res://scenes/xp_gem.tscn")
var dmg_num_scene = preload("res://scenes/damage_number.tscn")

@onready var model_container = $ModelContainer
var anim_player: AnimationPlayer = null
var active_anim_name: String = ""

# CRITICAL FIX: Caching the StandardMaterial3D per enemy instance prevents standard material
# re-instantiation spam every time damage is taken (which chokes up garbage collection)
var flash_mat: StandardMaterial3D

func _ready():
	health = max_health
	add_to_group("enemies")
	player = get_tree().get_first_node_in_group("player")

	motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	axis_lock_linear_y = true
	global_position.y = target_height

	flash_mat = StandardMaterial3D.new()
	flash_mat.albedo_color = Color(1.0, 0.2, 0.2)
	flash_mat.emission_enabled = true
	flash_mat.emission = Color(1.0, 0.1, 0.1)
	flash_mat.emission_energy_multiplier = 3.0

	_setup_looping_animations(self)

func _setup_looping_animations(node: Node):
	if node is AnimationPlayer:
		anim_player = node
		_configure_and_play()
		return
	for child in node.get_children():
		_setup_looping_animations(child)
		if anim_player:
			return

func _configure_and_play():
	if not anim_player:
		return

	var anim_list = anim_player.get_animation_list()
	if anim_list.is_empty():
		return

	for a_name in anim_list:
		var anim = anim_player.get_animation(a_name)
		if anim:
			anim.loop_mode = Animation.LOOP_LINEAR

	var chosen_anim = anim_list[0]
	for a_name in anim_list:
		var lower = a_name.to_lower()
		if "walk" in lower or "fly" in lower:
			chosen_anim = a_name
			break

	active_anim_name = chosen_anim
	anim_player.play(active_anim_name)

	var a = anim_player.get_animation(active_anim_name)
	if a and a.length > 0.0:
		anim_player.seek(randf_range(0.0, a.length), true)

func _physics_process(delta: float):
	global_position.y = target_height
	velocity.y = 0.0

	if flash_timer > 0:
		flash_timer -= delta
		if flash_timer <= 0:
			_reset_material()

	if anim_player and not active_anim_name.is_empty():
		if not anim_player.is_playing():
			anim_player.play(active_anim_name)

	if not player or not is_instance_valid(player):
		player = get_tree().get_first_node_in_group("player")
		return

	var diff = player.global_position - global_position
	diff.y = 0
	var dir = diff.normalized()

	# --- 2D GRID FAST CHECK SEPARATION ---
	var separation := Vector3.ZERO
	var neighbors = SpatialGrid.get_nearby(global_position)
	var overlap_count = 0

	for n in neighbors:
		if n != self and is_instance_valid(n):
			var dist = global_position.distance_to(n.global_position)
			if dist < separation_radius:
				var push: Vector3
				if dist < 0.001:
					push = Vector3(randf_range(-1.0, 1.0), 0, randf_range(-1.0, 1.0)).normalized()
					dist = 0.01
				else:
					push = (global_position - n.global_position).normalized()
					push.y = 0

				separation += push * (separation_radius - dist)
				overlap_count += 1

	if overlap_count > 0:
		separation /= float(overlap_count)
		dir = (dir + separation * 3.0).normalized()
	# -------------------------------------

	velocity.x = dir.x * speed
	velocity.z = dir.z * speed
	move_and_slide()

	global_position.y = target_height
	velocity.y = 0.0

	if dir.length_squared() > 0.001:
		var target_yaw = atan2(-dir.x, -dir.z)
		rotation.y = lerp_angle(rotation.y, target_yaw, 10.0 * delta)

	for i in range(get_slide_collision_count()):
		var col = get_slide_collision(i)
		var collider = col.get_collider()
		if collider and collider.is_in_group("player") and collider.has_method("take_damage"):
			collider.take_damage(damage)

func take_damage(amount: int, from_pos: Vector3 = Vector3.ZERO):
	health -= amount
	SoundManager.play_hit()

	var dmg = dmg_num_scene.instantiate()
	get_parent().add_child(dmg)
	dmg.global_position = global_position + Vector3(0, 1.8, 0)
	dmg.setup(amount, amount > 35)

	if from_pos != Vector3.ZERO:
		var knock_dir = (global_position - from_pos).normalized()
		knock_dir.y = 0
		global_position += knock_dir * 0.45
		global_position.y = target_height

	_flash_red()

	if health <= 0:
		_die()

func _flash_red():
	flash_timer = 0.1
	_apply_flash(model_container)

func _apply_flash(node: Node):
	if node is MeshInstance3D:
		node.material_override = flash_mat
	for child in node.get_children():
		_apply_flash(child)

func _reset_material():
	_clear_flash(model_container)

func _clear_flash(node: Node):
	if node is MeshInstance3D:
		node.material_override = null
	for child in node.get_children():
		_clear_flash(child)

func _die():
	var gem = gem_scene.instantiate()
	gem.xp_value = xp_amount
	get_parent().add_child(gem)
	gem.global_position = global_position + Vector3(0, 0.5, 0)

	if is_boss:
		for i in range(4):
			var extra_gem = gem_scene.instantiate()
			extra_gem.xp_value = xp_amount
			get_parent().add_child(extra_gem)
			extra_gem.global_position = global_position + Vector3(randf_range(-1.5, 1.5), 0.5, randf_range(-1.5, 1.5))

	var main = get_tree().get_first_node_in_group("main")
	if main and main.has_method("register_kill"):
		main.register_kill()

	queue_free()
`,
);

// scenes/enemy_walker.tscn
// Physics Engine collision_mask 3 (World + Player) to ignore Godot rigid separation.
writeFile(
  "scenes/enemy_walker.tscn",
  `
[gd_scene load_steps=4 format=3 uid="uid://enmwalker01"]

[ext_resource type="Script" path="res://scripts/enemy_base.gd" id="1_ebase"]
[ext_resource type="PackedScene" path="res://assets/enemy_walker.scad" id="2_mesh"]

[sub_resource type="CapsuleShape3D" id="CapsuleShape3D_1"]
radius = 0.65
height = 2.4

[node name="EnemyWalker" type="CharacterBody3D"]
collision_layer = 4
collision_mask = 3
axis_lock_linear_y = true
motion_mode = 1
script = ExtResource("1_ebase")
max_health = 35
speed = 3.2
damage = 10
xp_amount = 12
target_height = 0.0
separation_radius = 1.3

[node name="ModelContainer" type="Node3D" parent="."]

[node name="Model" parent="ModelContainer" instance=ExtResource("2_mesh")]
transform = Transform3D(0.8, 0, 0, 0, 0.8, 0, 0, 0, 0.8, 0, 0, 0)

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.2, 0)
shape = SubResource("CapsuleShape3D_1")
`,
);

// scenes/enemy_swarmer.tscn
writeFile(
  "scenes/enemy_swarmer.tscn",
  `
[gd_scene load_steps=4 format=3 uid="uid://enmswarm01"]

[ext_resource type="Script" path="res://scripts/enemy_base.gd" id="1_ebase"]
[ext_resource type="PackedScene" path="res://assets/enemy_swarmer.scad" id="2_mesh"]

[sub_resource type="SphereShape3D" id="SphereShape3D_1"]
radius = 0.8

[node name="EnemySwarmer" type="CharacterBody3D"]
collision_layer = 4
collision_mask = 3
axis_lock_linear_y = true
motion_mode = 1
script = ExtResource("1_ebase")
max_health = 18
speed = 5.6
damage = 6
xp_amount = 8
target_height = 0.8
separation_radius = 1.2

[node name="ModelContainer" type="Node3D" parent="."]

[node name="Model" parent="ModelContainer" instance=ExtResource("2_mesh")]
transform = Transform3D(0.9, 0, 0, 0, 0.9, 0, 0, 0, 0.9, 0, 0, 0)

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.2, 0)
shape = SubResource("SphereShape3D_1")
`,
);

// scenes/enemy_brute.tscn
writeFile(
  "scenes/enemy_brute.tscn",
  `
[gd_scene load_steps=4 format=3 uid="uid://enmbrute01"]

[ext_resource type="Script" path="res://scripts/enemy_base.gd" id="1_ebase"]
[ext_resource type="PackedScene" path="res://assets/enemy_brute.scad" id="2_mesh"]

[sub_resource type="CapsuleShape3D" id="CapsuleShape3D_1"]
radius = 1.4
height = 3.6

[node name="EnemyBrute" type="CharacterBody3D"]
collision_layer = 4
collision_mask = 3
axis_lock_linear_y = true
motion_mode = 1
script = ExtResource("1_ebase")
max_health = 250
speed = 2.4
damage = 25
xp_amount = 80
is_boss = true
target_height = 0.0
separation_radius = 3.0

[node name="ModelContainer" type="Node3D" parent="."]

[node name="Model" parent="ModelContainer" instance=ExtResource("2_mesh")]
transform = Transform3D(1.1, 0, 0, 0, 1.1, 0, 0, 0, 1.1, 0, 0, 0)

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.8, 0)
shape = SubResource("CapsuleShape3D_1")
`,
);

// scripts/player.gd
writeFile(
  "scripts/player.gd",
  `
extends CharacterBody3D

signal health_changed(current, max_hp)
signal xp_changed(current, required, level)
signal leveled_up(new_level)
signal died()

@export var move_speed: float = 7.0
@export var max_health: int = 100
var current_health: int = 100

var level: int = 1
var current_xp: int = 0
var required_xp: int = 30
var magnet_radius: float = 4.5

var projectile_cooldown: float = 0.85
var projectile_timer: float = 0.0
var projectile_damage: int = 30
var projectile_count: int = 1

var lightning_unlocked: bool = false
var lightning_cooldown: float = 2.2
var lightning_timer: float = 0.0
var lightning_damage: int = 65

var orbit_shield_unlocked: bool = true
var orbit_count: int = 1

@onready var model: Node3D = $Model
@onready var magnet_area: Area3D = $MagnetArea
@onready var orbit_shield: Node3D = $OrbitShield

var anim_player: AnimationPlayer = null
var walk_anim_name: String = ""

var proj_scene = preload("res://scenes/projectile.tscn")
var lightning_scene = preload("res://scenes/lightning_strike.tscn")
var invulnerable_timer: float = 0.0

func _ready():
	add_to_group("player")
	current_health = max_health
	emit_signal("health_changed", current_health, max_health)
	emit_signal("xp_changed", current_xp, required_xp, level)

	motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	axis_lock_linear_y = true
	global_position.y = 0.0

	_update_magnet_shape()
	orbit_shield.set_orb_count(orbit_count)
	_setup_player_animations(model)

func _setup_player_animations(node: Node):
	if node is AnimationPlayer:
		anim_player = node
		for a_name in anim_player.get_animation_list():
			var anim = anim_player.get_animation(a_name)
			if anim:
				anim.loop_mode = Animation.LOOP_LINEAR
			if "walk" in a_name.to_lower():
				walk_anim_name = a_name
		if walk_anim_name.is_empty() and anim_player.get_animation_list().size() > 0:
			walk_anim_name = anim_player.get_animation_list()[0]
		return
	for child in node.get_children():
		_setup_player_animations(child)
		if anim_player:
			return

func _physics_process(delta: float):
	global_position.y = 0.0
	velocity.y = 0.0

	if invulnerable_timer > 0:
		invulnerable_timer -= delta

	var input_vec = Vector2.ZERO
	input_vec.x = Input.get_axis("move_left", "move_right")
	input_vec.y = Input.get_axis("move_up", "move_down")

	var move_dir = Vector3(input_vec.x, 0, input_vec.y).normalized()
	velocity.x = move_dir.x * move_speed
	velocity.z = move_dir.z * move_speed
	move_and_slide()

	global_position.y = 0.0
	velocity.y = 0.0

	if move_dir.length_squared() > 0.01:
		var target_yaw = atan2(-move_dir.x, -move_dir.z)
		model.rotation.y = lerp_angle(model.rotation.y, target_yaw, 15.0 * delta)

		if anim_player and not walk_anim_name.is_empty():
			if not anim_player.is_playing() or anim_player.current_animation != walk_anim_name:
				anim_player.play(walk_anim_name)
	else:
		if anim_player and anim_player.is_playing() and anim_player.current_animation == walk_anim_name:
			anim_player.stop()

	_process_weapons(delta)
	_process_magnet()

func _process_weapons(delta: float):
	projectile_timer += delta
	if projectile_timer >= projectile_cooldown:
		projectile_timer = 0.0
		_fire_projectiles()

	if lightning_unlocked:
		lightning_timer += delta
		if lightning_timer >= lightning_cooldown:
			lightning_timer = 0.0
			_strike_lightning()

func _fire_projectiles():
	var nearest_enemy = _get_nearest_enemy()
	var base_dir = Vector3.FORWARD
	if nearest_enemy:
		base_dir = (nearest_enemy.global_position - global_position).normalized()
		base_dir.y = 0
	elif velocity.length_squared() > 0.01:
		base_dir = velocity.normalized()
		base_dir.y = 0

	for i in range(projectile_count):
		var spread_angle = 0.0
		if projectile_count > 1:
			spread_angle = deg_to_rad(-15.0 + (30.0 / (projectile_count - 1)) * i)

		var rotated_dir = base_dir.rotated(Vector3.UP, spread_angle)
		var proj = proj_scene.instantiate()
		get_parent().add_child(proj)
		proj.global_position = global_position + Vector3(0, 1.2, 0) + rotated_dir * 0.8
		proj.setup(rotated_dir, projectile_damage)

	SoundManager.play_shoot()

func _strike_lightning():
	var enemies = get_tree().get_nodes_in_group("enemies")
	if enemies.is_empty():
		return

	enemies.shuffle()
	var target = enemies[0]
	if target and is_instance_valid(target):
		var strike = lightning_scene.instantiate()
		get_parent().add_child(strike)
		strike.global_position = target.global_position

		for e in enemies:
			if is_instance_valid(e) and e.global_position.distance_to(target.global_position) < 3.2:
				e.take_damage(lightning_damage, target.global_position)

func _get_nearest_enemy() -> CharacterBody3D:
	var enemies = get_tree().get_nodes_in_group("enemies")
	var nearest: CharacterBody3D = null
	var min_dist = 9999.0
	for e in enemies:
		if is_instance_valid(e):
			var d = global_position.distance_to(e.global_position)
			if d < min_dist:
				min_dist = d
				nearest = e
	return nearest

func _process_magnet():
	for area in magnet_area.get_overlapping_areas():
		if area.is_in_group("gems") and area.has_method("attract_to"):
			area.attract_to(self)

func _update_magnet_shape():
	var shape = magnet_area.get_node("CollisionShape3D").shape as SphereShape3D
	if shape:
		shape.radius = magnet_radius

func take_damage(amount: int):
	if invulnerable_timer > 0:
		return
	invulnerable_timer = 0.35
	current_health -= amount
	SoundManager.play_hurt()
	emit_signal("health_changed", current_health, max_health)

	if current_health <= 0:
		current_health = 0
		emit_signal("died")

func heal(amount: int):
	current_health = min(max_health, current_health + amount)
	emit_signal("health_changed", current_health, max_health)

func add_xp(amount: int):
	current_xp += amount
	if current_xp >= required_xp:
		current_xp -= required_xp
		level += 1
		required_xp = int(required_xp * 1.4)
		SoundManager.play_level_up()
		emit_signal("leveled_up", level)
	emit_signal("xp_changed", current_xp, required_xp, level)

func apply_upgrade(upgrade_id: String):
	match upgrade_id:
		"extra_orb":
			orbit_count += 1
			orbit_shield.set_orb_count(orbit_count)
		"fire_rate":
			projectile_cooldown = max(0.2, projectile_cooldown * 0.75)
		"multi_shot":
			projectile_count += 1
		"proj_dmg":
			projectile_damage = int(projectile_damage * 1.35)
		"lightning":
			if not lightning_unlocked:
				lightning_unlocked = true
			else:
				lightning_damage = int(lightning_damage * 1.4)
				lightning_cooldown = max(0.9, lightning_cooldown * 0.85)
		"move_speed":
			move_speed += 1.2
		"max_hp":
			max_health += 25
			current_health += 25
			emit_signal("health_changed", current_health, max_health)
		"magnet":
			magnet_radius += 2.5
			_update_magnet_shape()
`,
);

// scenes/player.tscn
writeFile(
  "scenes/player.tscn",
  `
[gd_scene load_steps=6 format=3 uid="uid://player0001"]

[ext_resource type="Script" path="res://scripts/player.gd" id="1_play"]
[ext_resource type="PackedScene" path="res://assets/player.scad" id="2_pmesh"]
[ext_resource type="Script" path="res://scripts/orbit_shield.gd" id="3_shield"]

[sub_resource type="CapsuleShape3D" id="CapsuleShape3D_1"]
radius = 0.6
height = 2.4

[sub_resource type="SphereShape3D" id="SphereShape3D_mag"]
radius = 4.5

[node name="Player" type="CharacterBody3D"]
collision_layer = 2
collision_mask = 5
axis_lock_linear_y = true
motion_mode = 1
script = ExtResource("1_play")

[node name="Model" parent="." instance=ExtResource("2_pmesh")]
transform = Transform3D(0.7, 0, 0, 0, 0.7, 0, 0, 0, 0.7, 0, 0, 0)

[node name="CollisionShape3D" type="CollisionShape3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1.2, 0)
shape = SubResource("CapsuleShape3D_1")

[node name="MagnetArea" type="Area3D" parent="."]
collision_layer = 0
collision_mask = 8

[node name="CollisionShape3D" type="CollisionShape3D" parent="MagnetArea"]
shape = SubResource("SphereShape3D_mag")

[node name="OrbitShield" type="Node3D" parent="."]
script = ExtResource("3_shield")
`,
);

// scripts/ui.gd
writeFile(
  "scripts/ui.gd",
  `
extends CanvasLayer

@onready var hp_bar: ProgressBar = $HUD/HPBar
@onready var xp_bar: ProgressBar = $HUD/XPBar
@onready var level_label: Label = $HUD/LevelLabel
@onready var timer_label: Label = $HUD/TimerLabel
@onready var kill_label: Label = $HUD/KillLabel
@onready var level_up_panel: Panel = $LevelUpPanel
@onready var cards_container: HBoxContainer = $LevelUpPanel/CardsContainer
@onready var game_over_panel: Panel = $GameOverPanel
@onready var victory_panel: Panel = $VictoryPanel

var player: CharacterBody3D

const ALL_UPGRADES = [
  {"id": "extra_orb", "name": "Holy Aegis +1", "desc": "Add an extra orbiting sacred energy orb to shred touching enemies."},
  {"id": "multi_shot", "name": "Multi-Missile +1", "desc": "Fire an additional projectile in a spread."},
  {"id": "fire_rate", "name": "Rapid Casting", "desc": "Increase missile fire rate by 25%."},
  {"id": "proj_dmg", "name": "Sharpened Daggers", "desc": "Boost projectile damage by 35%."},
  {"id": "lightning", "name": "Heaven's Thunder", "desc": "Unlock or empower lightning strikes crashing down on enemy hordes."},
  {"id": "move_speed", "name": "Boots of Haste", "desc": "Increase movement speed by +1.2 units."},
  {"id": "max_hp", "name": "Titan's Vitality", "desc": "Increase max health by +25 and heal immediately."},
  {"id": "magnet", "name": "Astral Attraction", "desc": "Significantly enlarge your Gem magnet pickup aura."}
]

func setup(p: CharacterBody3D):
	player = p
	player.health_changed.connect(_on_health_changed)
	player.xp_changed.connect(_on_xp_changed)
	player.leveled_up.connect(_on_leveled_up)
	player.died.connect(_on_died)
	level_up_panel.visible = false
	game_over_panel.visible = false
	victory_panel.visible = false

func update_timer(seconds: float):
	var m = int(seconds / 60.0)
	var s = int(seconds) % 60
	timer_label.text = "%02d:%02d" % [m, s]

func update_kills(kills: int):
	kill_label.text = "Kills: %d" % kills

func _on_health_changed(current: int, max_hp: int):
	hp_bar.max_value = max_hp
	hp_bar.value = current
	hp_bar.get_node("Label").text = "HP: %d / %d" % [current, max_hp]

func _on_xp_changed(current: int, required: int, lvl: int):
	xp_bar.max_value = required
	xp_bar.value = current
	level_label.text = "LVL %d" % lvl

func _on_leveled_up(_new_lvl: int):
	get_tree().paused = true
	level_up_panel.visible = true

	for child in cards_container.get_children():
		child.queue_free()

	var pool = ALL_UPGRADES.duplicate()
	pool.shuffle()
	var choices = pool.slice(0, 3)

	for upg in choices:
		var btn = Button.new()
		btn.custom_minimum_size = Vector2(260, 320)
		btn.text = "\\n\\n" + upg["name"] + "\\n\\n" + upg["desc"] + "\\n\\n\\n[ Select ]"
		btn.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		btn.pressed.connect(func(): _choose_upgrade(upg["id"]))
		cards_container.add_child(btn)

func _choose_upgrade(upgrade_id: String):
	player.apply_upgrade(upgrade_id)
	level_up_panel.visible = false
	get_tree().paused = false

func _on_died():
	get_tree().paused = true
	game_over_panel.visible = true

func show_victory():
	get_tree().paused = true
	victory_panel.visible = true

func _on_restart_pressed():
	get_tree().paused = false
	get_tree().reload_current_scene()
`,
);

// scenes/ui.tscn
writeFile(
  "scenes/ui.tscn",
  `
[gd_scene load_steps=2 format=3 uid="uid://ui00000001"]

[ext_resource type="Script" path="res://scripts/ui.gd" id="1_ui"]

[node name="UI" type="CanvasLayer"]
process_mode = 3
script = ExtResource("1_ui")

[node name="HUD" type="Control" parent="."]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
mouse_filter = 2

[node name="XPBar" type="ProgressBar" parent="HUD"]
layout_mode = 1
anchors_preset = 10
anchor_right = 1.0
offset_bottom = 24.0
grow_horizontal = 2
value = 30.0
show_percentage = false

[node name="LevelLabel" type="Label" parent="HUD"]
layout_mode = 1
anchors_preset = 5
anchor_left = 0.5
anchor_right = 0.5
offset_left = -60.0
offset_top = 28.0
offset_right = 60.0
offset_bottom = 54.0
grow_horizontal = 2
theme_override_font_sizes/font_size = 22
text = "LVL 1"
horizontal_alignment = 1

[node name="TimerLabel" type="Label" parent="HUD"]
layout_mode = 1
anchors_preset = 5
anchor_left = 0.5
anchor_right = 0.5
offset_left = -60.0
offset_top = 58.0
offset_right = 60.0
offset_bottom = 90.0
grow_horizontal = 2
theme_override_font_sizes/font_size = 28
text = "00:00"
horizontal_alignment = 1

[node name="KillLabel" type="Label" parent="HUD"]
layout_mode = 1
offset_left = 24.0
offset_top = 36.0
offset_right = 180.0
offset_bottom = 68.0
theme_override_font_sizes/font_size = 20
text = "Kills: 0"

[node name="HPBar" type="ProgressBar" parent="HUD"]
layout_mode = 1
anchors_preset = 7
anchor_left = 0.5
anchor_top = 1.0
anchor_right = 0.5
anchor_bottom = 1.0
offset_left = -200.0
offset_top = -60.0
offset_right = 200.0
offset_bottom = -28.0
grow_horizontal = 2
grow_vertical = 0
value = 100.0
show_percentage = false

[node name="Label" type="Label" parent="HUD/HPBar"]
layout_mode = 1
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
text = "HP: 100 / 100"
horizontal_alignment = 1
vertical_alignment = 1

[node name="LevelUpPanel" type="Panel" parent="."]
visible = false
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2

[node name="Title" type="Label" parent="LevelUpPanel"]
layout_mode = 1
anchors_preset = 5
anchor_left = 0.5
anchor_right = 0.5
offset_left = -200.0
offset_top = 60.0
offset_right = 200.0
offset_bottom = 120.0
grow_horizontal = 2
theme_override_font_sizes/font_size = 40
text = "LEVEL UP!"
horizontal_alignment = 1

[node name="Subtitle" type="Label" parent="LevelUpPanel"]
layout_mode = 1
anchors_preset = 5
anchor_left = 0.5
anchor_right = 0.5
offset_left = -200.0
offset_top = 120.0
offset_right = 200.0
offset_bottom = 150.0
grow_horizontal = 2
text = "Choose an upgrade to empower your warrior"
horizontal_alignment = 1

[node name="CardsContainer" type="HBoxContainer" parent="LevelUpPanel"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -440.0
offset_top = -140.0
offset_right = 440.0
offset_bottom = 200.0
grow_horizontal = 2
grow_vertical = 2
theme_override_constants/separation = 30
alignment = 1

[node name="GameOverPanel" type="Panel" parent="."]
visible = false
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2

[node name="Title" type="Label" parent="GameOverPanel"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -200.0
offset_top = -100.0
offset_right = 200.0
offset_bottom = -40.0
grow_horizontal = 2
grow_vertical = 2
theme_override_colors/font_color = Color(1, 0.2, 0.2, 1)
theme_override_font_sizes/font_size = 48
text = "YOU FELL"
horizontal_alignment = 1

[node name="Sub" type="Label" parent="GameOverPanel"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -200.0
offset_top = -30.0
offset_right = 200.0
offset_bottom = 0.0
grow_horizontal = 2
grow_vertical = 2
text = "The horde has claimed your soul."
horizontal_alignment = 1

[node name="RestartBtn" type="Button" parent="GameOverPanel"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -100.0
offset_top = 40.0
offset_right = 100.0
offset_bottom = 90.0
grow_horizontal = 2
grow_vertical = 2
theme_override_font_sizes/font_size = 20
text = "Try Again"

[node name="VictoryPanel" type="Panel" parent="."]
visible = false
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2

[node name="Title" type="Label" parent="VictoryPanel"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -250.0
offset_top = -100.0
offset_right = 250.0
offset_bottom = -40.0
grow_horizontal = 2
grow_vertical = 2
theme_override_colors/font_color = Color(1, 0.85, 0.1, 1)
theme_override_font_sizes/font_size = 48
text = "SURVIVAL ACHIEVED!"
horizontal_alignment = 1

[node name="Sub" type="Label" parent="VictoryPanel"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -200.0
offset_top = -30.0
offset_right = 200.0
offset_bottom = 0.0
grow_horizontal = 2
grow_vertical = 2
text = "Dawn breaks. You conquered the darkness."
horizontal_alignment = 1

[node name="RestartBtn" type="Button" parent="VictoryPanel"]
layout_mode = 1
anchors_preset = 8
anchor_left = 0.5
anchor_top = 0.5
anchor_right = 0.5
anchor_bottom = 0.5
offset_left = -100.0
offset_top = 40.0
offset_right = 100.0
offset_bottom = 90.0
grow_horizontal = 2
grow_vertical = 2
theme_override_font_sizes/font_size = 20
text = "Play Again"

[connection signal="pressed" from="GameOverPanel/RestartBtn" to="." method="_on_restart_pressed"]
[connection signal="pressed" from="VictoryPanel/RestartBtn" to="." method="_on_restart_pressed"]
`,
);

// scripts/main.gd
writeFile(
  "scripts/main.gd",
  `
extends Node3D

@export var win_time: float = 300.0

var game_time: float = 0.0
var total_kills: int = 0
var next_spawn_time: float = 0.0

@onready var player: CharacterBody3D = $Player
@onready var camera: Camera3D = $Camera3D
@onready var ui: CanvasLayer = $UI

var walker_scene = preload("res://scenes/enemy_walker.tscn")
var swarmer_scene = preload("res://scenes/enemy_swarmer.tscn")
var brute_scene = preload("res://scenes/enemy_brute.tscn")

var boss_spawned_3min: bool = false
var boss_spawned_4min: bool = false

func _ready():
	add_to_group("main")
	ui.setup(player)

func _process(delta: float):
	game_time += delta
	ui.update_timer(game_time)

	if player and is_instance_valid(player):
		var target_pos = player.global_position + Vector3(0, 18, 14)
		camera.global_position = camera.global_position.lerp(target_pos, 8.0 * delta)
		camera.look_at(player.global_position + Vector3(0, 0.5, 0), Vector3.UP)

	_process_spawning(delta)

	if game_time >= win_time:
		ui.show_victory()

func _physics_process(_delta: float):
	# Fast Grid physics tracking for custom enemy separation avoiding Godot engine bottlenecks
	var enemies = get_tree().get_nodes_in_group("enemies")
	SpatialGrid.update_grid(enemies)

func _process_spawning(delta: float):
	next_spawn_time -= delta
	var current_spawn_interval = max(0.2, 1.2 - (game_time / 180.0) * 0.9)

	if next_spawn_time <= 0.0:
		next_spawn_time = current_spawn_interval
		_spawn_wave()

	if game_time >= 90.0 and not boss_spawned_3min:
		boss_spawned_3min = true
		_spawn_brute()

	if game_time >= 210.0 and not boss_spawned_4min:
		boss_spawned_4min = true
		_spawn_brute()
		_spawn_brute()

func _spawn_wave():
	if not player or not is_instance_valid(player):
		return

	var count = 1 + int(game_time / 45.0)
	for i in range(count):
		var angle = randf() * TAU
		var dist = randf_range(20.0, 26.0)

		var enemy = null
		var r = randf()
		if game_time > 40.0 and r < 0.4:
			enemy = swarmer_scene.instantiate()
		else:
			enemy = walker_scene.instantiate()

		var spawn_pos = Vector3(player.global_position.x + cos(angle) * dist, enemy.target_height, player.global_position.z + sin(angle) * dist)
		add_child(enemy)
		enemy.global_position = spawn_pos

func _spawn_brute():
	if not player or not is_instance_valid(player):
		return
	var angle = randf() * TAU
	var brute = brute_scene.instantiate()
	var spawn_pos = Vector3(player.global_position.x + cos(angle) * 22.0, brute.target_height, player.global_position.z + sin(angle) * 22.0)
	add_child(brute)
	brute.global_position = spawn_pos

func register_kill():
	total_kills += 1
	ui.update_kills(total_kills)
`,
);

// scenes/main.tscn
writeFile(
  "scenes/main.tscn",
  `
[gd_scene load_steps=9 format=3 uid="uid://main0000001"]

[ext_resource type="Script" path="res://scripts/main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://scenes/player.tscn" id="2_play"]
[ext_resource type="PackedScene" path="res://scenes/ui.tscn" id="3_ui"]

[sub_resource type="PlaneMesh" id="PlaneMesh_arena"]
size = Vector2(300, 300)

[sub_resource type="StandardMaterial3D" id="StandardMaterial3D_floor"]
albedo_color = Color(0.12, 0.14, 0.18, 1)
roughness = 0.85
uv1_scale = Vector3(60, 60, 60)

[sub_resource type="BoxShape3D" id="BoxShape3D_floor"]
size = Vector3(300, 1, 300)

[sub_resource type="Environment" id="Environment_dark"]
background_mode = 1
background_color = Color(0.04, 0.05, 0.08, 1)
ambient_light_source = 2
ambient_light_color = Color(0.15, 0.18, 0.25, 1)
ambient_light_energy = 1.0
tonemap_mode = 3
glow_enabled = true
glow_bloom = 0.35

[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_dark")

[node name="DirectionalLight3D" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.866, -0.354, 0.354, 0, 0.707, 0.707, -0.5, -0.612, 0.612, 20, 30, 20)
light_color = Color(0.85, 0.9, 1, 1)
light_energy = 1.4
shadow_enabled = true

[node name="Floor" type="StaticBody3D" parent="."]
collision_layer = 1
collision_mask = 0

[node name="MeshInstance3D" type="MeshInstance3D" parent="Floor"]
mesh = SubResource("PlaneMesh_arena")
surface_material_override/0 = SubResource("StandardMaterial3D_floor")

[node name="CollisionShape3D" type="CollisionShape3D" parent="Floor"]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -0.5, 0)
shape = SubResource("BoxShape3D_floor")

[node name="Player" parent="." instance=ExtResource("2_play")]

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.707107, 0.707107, 0, -0.707107, 0.707107, 0, 18, 14)
current = true
fov = 55.0

[node name="UI" parent="." instance=ExtResource("3_ui")]
`,
);

// =========================================================================
// 4. CONFIGURATION & METADATA
// =========================================================================

writeFile(
  "project.godot",
  `
config_version=5

[application]

config/name="Horde Survivor 3D"
config/description="A high-octane 3D horde survival bullet heaven game inspired by Vampire Survivors."
run/main_scene="res://scenes/main.tscn"
config/features=PackedStringArray("4.3", "Forward Plus")

[autoload]

SoundManager="*res://scripts/sound_manager.gd"
SpatialGrid="*res://scripts/spatial_grid.gd"

[editor_plugins]

enabled=PackedStringArray("res://addons/scad_importer/plugin.cfg")

[layer_names]

3d_physics/layer_1="World"
3d_physics/layer_2="Player"
3d_physics/layer_3="Enemies"
3d_physics/layer_4="Pickups"
3d_physics/layer_5="Weapons"

[input]

move_left={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194319,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":65,"physical_keycode":0,"key_label":0,"unicode":97,"echo":false,"script":null)
]
}
move_right={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194321,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":68,"physical_keycode":0,"key_label":0,"unicode":100,"echo":false,"script":null)
]
}
move_up={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194320,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":87,"physical_keycode":0,"key_label":0,"unicode":119,"echo":false,"script":null)
]
}
move_down={
"deadzone": 0.5,
"events": [Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":4194322,"physical_keycode":0,"key_label":0,"unicode":0,"echo":false,"script":null)
, Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":83,"physical_keycode":0,"key_label":0,"unicode":115,"echo":false,"script":null)
]
}

[display]

window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"

[rendering]

anti_aliasing/quality/msaa_3d=2
glow/enabled=true
`,
);

writeFile(
  ".gitignore",
  `
.godot/
*.translation
user/
`,
);

writeFile(
  "README.md",
  `
# Horde Survivor 3D

A 3D auto-shooter / horde survival game inspired by *Vampire Survivors*.

## Physics Optimization
- Replaced the CPU-heavy Physics Engine character body repulsion with an ultra-fast **Spatial Grid Hashing** setup.
- Enemies manually separate and flock using 2D grid neighbor lookups, keeping thousands of CharacterBody3D nodes running at high frame rates.

## Model & Asset Polish:
- **The Brute**: Chest spikes now project forward (+Y) out of the armor plate instead of pointing up. Added spiked pauldrons, curved horns, and a two-handed obsidian war maul with a molten glowing core.
- **The Bat (Swarmer)**: Redesigned with organic swept wings, an arched elbow spar, wing claws, skeletal ribs, and smooth flapping animations.
- **The Zombie (Walker)**: Detailed with sunken eye sockets, glowing red pupils, a decaying jaw with teeth, exposed ribs, and clawed reaching hands.
- **The Hero (Knight)**: Wields an angled runic broadsword with pommel, grip, crossguard, and fuller in the right hand and an emblazoned heater kite shield on the left forearm.
`,
);

console.log("\n======================================================");
console.log('Project "Horde Survivor 3D" updated with Fast Grid Physics!');
console.log(`Directory: ${ROOT_DIR}`);
console.log("======================================================\n");
