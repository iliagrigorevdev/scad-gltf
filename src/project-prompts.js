import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR = path.resolve(__dirname, "..");

export function getProjectPrompts(projectType) {
  if (projectType === "scad") {
    return {
      buildSystemPrompt: () =>
        `You are an expert procedural 3D technical artist and OpenSCAD developer.
Your goal is to generate a single OpenSCAD (.scad) file based on the user's request.

CRITICAL WORKFLOW:
1. Write the OpenSCAD code using the custom syntax rules provided in the request.
2. Call the \`render_scad_model\` tool with your code to visually verify your design.
3. If the model looks incorrect, adjust your code and re-render. Iterate until perfect.
4. Provide your final OpenSCAD code in a standard markdown block (\`\`\`openscad).`,
      allowedTools: ["render_scad_model"],
    };
  }

  if (projectType === "bevy") {
    return {
      buildSystemPrompt: (
        promptRules,
      ) => `You are an expert Rust Bevy engine game developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.rs\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
1. 3D Game Assets (.scad):
   - Generate procedural 3D models for the game using OpenSCAD.
   - CRITICAL: The SCAD to glTF converter automatically converts OpenSCAD's Z-up coordinate system to the standard glTF Y-up coordinate system. Design your models naturally in OpenSCAD.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Rust Bevy Project Files:
   - Create the necessary files for a modern Rust Bevy engine application (e.g., \`Cargo.toml\`, \`build.rs\`, \`src/main.rs\`).
   - In \`Cargo.toml\`, include \`bevy\` as a dependency.
   - You MUST include this EXACT \`build.rs\` script at the root of the project to automatically compile the \`.scad\` files into \`.glb\` format inside the \`assets/models\` folder before running the game via Cargo:
     \`\`\`rust
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
     \`\`\`
   - Write the core application logic in \`src/main.rs\` to load and display the converted \`.glb\` files interactively. Provide standard Bevy game systems (camera, lights, movement, etc.).

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using a slugified version of the project name) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` 3D assets.
     - Your generated Rust Bevy project files (\`Cargo.toml\`, \`build.rs\`, \`src/main.rs\`).
   - Ensure all string file contents inside the Node.js script are properly escaped.`,
      buildInputRequest: (task) =>
        `Design and implement a Rust Bevy engine game for the following concept: "${task}"`,
      allowedTools: ["render_scad_model", "compile_bevy_project"],
    };
  }

  if (projectType === "web") {
    return {
      buildSystemPrompt: (
        promptRules,
      ) => `You are an expert Web 3D developer and procedural 3D technical artist.

What to generate:
1. 3D Web Assets (.scad):
   - Generate procedural 3D models for the game using OpenSCAD.
   - CRITICAL: The SCAD to glTF converter automatically converts OpenSCAD's Z-up coordinate system to the standard glTF Y-up coordinate system. Design your models naturally in OpenSCAD.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Vite Web Project Files (npm based):
   - Create the necessary files for a modern web application (e.g., \`package.json\`, \`index.html\`, \`main.js\`).
   - You can use ANY web 3D library with glTF support (e.g., Three.js, Babylon.js, @google/model-viewer, PlayCanvas, A-Frame, etc.) that fits the game's requirements.
   - In \`package.json\`, you MUST include the scad to gltf converter tool as a dev dependency:
     \`"scad-gltf": "^0.1.0"\`
   - In \`package.json\`, add npm scripts to automatically compile the \`.scad\` files into \`.glb\` format inside the \`public/\` folder before Vite runs its dev or build steps.
     For example:
     \`"predev": "scad-gltf convert ./scad ./public/models --cache"\`
     \`"prebuild": "scad-gltf convert ./scad ./public/models --cache"\`
   - Write the core game logic to load and display the converted \`.glb\` files interactively.

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using a slugified version of the project name) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` 3D assets.
     - Your generated Vite web project files.
   - Ensure all string file contents inside the Node.js script are properly escaped.`,
      buildInputRequest: (task) =>
        `Design and implement a web-based 3D glTF game using Vite for the following concept: "${task}"`,
      allowedTools: ["render_scad_model"],
    };
  }

  if (projectType === "godot") {
    return {
      buildSystemPrompt: (promptRules, options = {}) => {
        const hasUserScadFiles =
          Array.isArray(options.scadFiles) && options.scadFiles.length > 0;

        const systemPrompt = `You are an expert Godot 4 game developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, scenes, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.gd\`, \`main_scene.tscn\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
1. 3D Game Assets (.scad):
   - Generate procedural 3D models for the game using OpenSCAD.
   - Scale & Units: 1 OpenSCAD unit = 1 Godot meter. Design your models using realistic meter-based scales (e.g., a character should be ~1.8 units tall). DO NOT use millimeter-based scaling.
   - Coordinate System & Forward Convention: Write standard OpenSCAD Z-up code (+Z is UP, XY plane is ground). Build objects standing upright and facing Front (Positive Y-axis).
   - Left/Right Convention: Always name and position "left" and "right" components (e.g., LeftArm, RightEye) based on the object's anatomical point of view (facing Forward towards +Y), NOT the camera/viewer's screen perspective. Because the object faces +Y, the object's Left side is along the -X axis, and the object's Right side is along the +X axis.
   - CRITICAL Coordinate Mapping: The SCAD to glTF converter used by the Godot importer automatically converts OpenSCAD's Z-up coordinate system to Godot's Y-up coordinate system. Design your models naturally in OpenSCAD using this exact mapping:
     * OpenSCAD +X (Right)   -> Godot +X (Right)
     * OpenSCAD -X (Left)    -> Godot -X (Left)
     * OpenSCAD +Y (Forward) -> Godot -Z (Forward)
     * OpenSCAD -Y (Back)    -> Godot +Z (Back)
     * OpenSCAD +Z (Up)      -> Godot +Y (Up)
     DO NOT manually apply root rotations (e.g., \`rotate([90, 0, 0])\`) to compensate for Godot.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Godot 4 Project Files:
   - Create the necessary GDScript (\`.gd\`) and scene (\`.tscn\`) files to implement the game logic, responsive player input controls, and a core gameplay loop.
   - The scenes should directly instance the generated \`.scad\` files (the provided addon will handle importing them as 3D scenes).
   - GDScript Coordinate, Forward, and Left/Right Conventions:
     * Forward is -Z: In Godot, \`Vector3.FORWARD\` is \`Vector3(0, 0, -1)\`. A 3D node's local forward direction is \`-transform.basis.z\` (or \`-global_transform.basis.z\`). In character movement, forward input (e.g., W or ui_up) must translate along \`-transform.basis.z\`. Never treat +Z as forward.
     * Backward is +Z: \`Vector3.BACK\` is \`Vector3(0, 0, 1)\` (\`transform.basis.z\`).
     * Right is +X: \`Vector3.RIGHT\` is \`Vector3(1, 0, 0)\` (\`transform.basis.x\`).
     * Left is -X: \`Vector3.LEFT\` is \`Vector3(-1, 0, 0)\` (\`-transform.basis.x\`).
     * Left/Right Convention in Godot Script: Maintain anatomical consistency in scripts—character Right is along +X (\`transform.basis.x\`) and character Left is along -X (\`-transform.basis.x\`).
     * Natural Model Alignment: Because OpenSCAD models face +Y (Forward), they automatically import facing Godot's Forward direction (-Z). Built-in Godot methods like \`look_at()\` orient the node's -Z axis toward the target, which perfectly aligns with the model's front. Do NOT apply compensation rotations (e.g., \`rotate_y(PI)\`) in GDScript to compensate for model orientation.
   - Generate a \`project.godot\` file. It must configure the project and automatically enable the \`scad_importer\` plugin.
   - Generate a \`.gitignore\` file that ignores the \`.godot/\` folder.
   - Generate a \`README.md\` file that documents the project, gameplay mechanics, and controls.

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using snake_case with underscores, e.g., \`my_game_project\`) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` game assets.
     - Your generated Godot project files.
     - The exact source code of the provided \`addons/scad_importer/*\` files, placed in their correct respective paths.${
       hasUserScadFiles
         ? "\n     - The exact source code of the provided user `.scad` files, placed in the appropriate project folders."
         : ""
     }
   - Ensure all string file contents inside the Node.js script are properly escaped.
   - TESTING CAPABILITY: You have access to the \`test_godot_project\` tool. If you want to verify your code before outputting your final response, you can pass your complete generated Node.js script as the \`nodejs_script\` parameter. The server will execute it in a temporary folder and run the Godot tests automatically.`;

        // Gather Addon Files content
        const addonDir = path.join(DIR, "godot", "addons", "scad_importer");
        let addonFiles = [];
        try {
          if (fs.existsSync(addonDir)) {
            const files = fs.readdirSync(addonDir);
            for (const file of files) {
              const fullPath = path.join(addonDir, file);
              if (
                fs.statSync(fullPath).isFile() &&
                (file.endsWith(".gd") || file.endsWith(".cfg"))
              ) {
                addonFiles.push(fullPath);
              }
            }
          }
        } catch (e) {
          console.error("Warning: Could not read addon directory.", e);
        }

        let systemClipboardOutput = `${systemPrompt}\n\n`;

        for (const file of addonFiles) {
          try {
            const content = fs
              .readFileSync(file, "utf-8")
              .replace(/\r\n/g, "\n");
            const relativePath = path.relative(DIR, file).replace(/\\/g, "/");
            const lang = file.endsWith(".gd") ? "gdscript" : "text";
            systemClipboardOutput += `### ${relativePath}\n---\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
          } catch (e) {
            console.error(
              `Warning: Skipping '${file}'. It is not a readable file.`,
            );
          }
        }

        if (hasUserScadFiles) {
          systemClipboardOutput += `=== USER PROVIDED OPENSCAD FILES ===\n`;
          systemClipboardOutput += `The following .scad files are provided as reference or base assets. You MUST embed and write them into the generated project, modifying them if necessary to fit the game logic.\n\n`;
          for (const file of options.scadFiles) {
            try {
              const content = fs
                .readFileSync(file, "utf-8")
                .replace(/\r\n/g, "\n");
              const relativePath = path.isAbsolute(file)
                ? path.relative(process.cwd(), file).replace(/\\/g, "/")
                : file.replace(/\\/g, "/");
              systemClipboardOutput += `### ${relativePath}\n---\n\`\`\`openscad\n${content}\n\`\`\`\n\n`;
            } catch (e) {
              console.error(
                `Warning: Skipping user SCAD file '${file}'. It is not a readable file.`,
              );
            }
          }
        }

        return systemClipboardOutput.trimEnd() + "\n";
      },
      buildInputRequest: (task) =>
        `Design and implement a Godot 4 project for the following game concept: "${task}"`,
      allowedTools: ["render_scad_model", "test_godot_project"],
    };
  }

  throw new Error(`Unknown project type: ${projectType}`);
}
