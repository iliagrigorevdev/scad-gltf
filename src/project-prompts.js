import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR = path.resolve(__dirname, "..");

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
  } catch (e) {
    console.error(`Warning: Skipping file '${filePath}'. It is not readable.`);
    return null;
  }
}

function formatMarkdownFile(displayPath, lang, content) {
  return `### ${displayPath}\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
}

function appendUserScadFiles(options = {}, isRawScad = false) {
  if (
    !options.scadFiles ||
    !Array.isArray(options.scadFiles) ||
    options.scadFiles.length === 0
  ) {
    return "";
  }

  let output = `\n\n=== USER PROVIDED OPENSCAD FILES ===\n`;
  if (isRawScad) {
    output += `The following .scad files are provided as reference or base assets. You MUST embed their contents directly into your final single OpenSCAD file (or use them as context), modifying them if necessary to fit the project logic.\n\n`;
  } else {
    output += `The following .scad files are provided as reference or base assets. You MUST embed and write them into the generated project (or use them as context), modifying them if necessary to fit the project logic.\n\n`;
  }
  for (const file of options.scadFiles) {
    const content = readFile(file);
    if (content !== null) {
      const relativePath = path.isAbsolute(file)
        ? path.relative(process.cwd(), file).replace(/\\/g, "/")
        : file.replace(/\\/g, "/");
      output += formatMarkdownFile(relativePath, "openscad", content);
    }
  }
  return output;
}

export function getProjectPrompts(projectType) {
  if (projectType === "scad") {
    return {
      buildSystemPrompt: (promptRules, options = {}) => {
        let output = promptRules;
        if (Array.isArray(options.scadFiles) && options.scadFiles.length > 0) {
          output += appendUserScadFiles(options, true);
        }
        return output;
      },
      buildInputRequest: (task) => task,
      allowedTools: ["render_scad_model"],
    };
  }

  if (projectType === "bevy" || projectType === "wgpu") {
    const isBevy = projectType === "bevy";
    const frameworkName = isBevy ? "Bevy" : "wgpu";
    const depName = isBevy ? "bevy" : "wgpu";

    return {
      buildSystemPrompt: (promptRules, options = {}) => {
        const hasUserScadFiles =
          Array.isArray(options.scadFiles) && options.scadFiles.length > 0;

        const systemPrompt = `You are an expert Rust ${frameworkName} developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.rs\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
1. 3D Assets (.scad):
   - Generate procedural 3D models for the project using OpenSCAD.
   - CRITICAL: The SCAD to glTF converter automatically converts OpenSCAD's Z-up coordinate system to the standard glTF Y-up coordinate system. Design your models naturally in OpenSCAD.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Rust ${frameworkName} Project Files:
   - Create the necessary files for a modern Rust ${frameworkName} application (e.g., \`Cargo.toml\`, \`build.rs\`, \`src/main.rs\`).
   - In \`Cargo.toml\`, include \`${depName}\` as a dependency.
   - You MUST include the provided \`build.rs\` script at the root of the project to automatically compile the \`.scad\` files into \`.glb\` format inside the \`assets/models\` folder before running the application via Cargo.
   - Write the core application logic in \`src/main.rs\` to load and display the converted \`.glb\` files interactively.${
     isBevy
       ? " Provide standard Bevy systems (camera, lights, movement, etc.)."
       : ""
   }

3. Delivery Format (Single Markdown File):
   - Output exactly ONE Markdown response containing all project files.
   - Do not output manual setup instructions or conversational explanations; output only the project files.
   - Format EACH file with a Markdown header specifying the relative file path (using snake_case directories), followed immediately by a code block containing the file's contents.
   - Example Format:
     ### my_project/Cargo.toml
     \`\`\`toml
     [package]
     name = "my_project"
     ...
     \`\`\`
     ### my_project/src/main.rs
     \`\`\`rust
     fn main() {}
     \`\`\`
   - The project files must be placed inside a root project folder (e.g., \`my_project/\`).
   - You must include and write:
     - Your generated \`.scad\` 3D assets.
     - Your generated Rust ${frameworkName} project files (\`Cargo.toml\`, \`src/main.rs\`).
     - The exact source code of the provided \`build.rs\` file, placed in the project root.${
       hasUserScadFiles
         ? "\n     - The provided user `.scad` files (modified if necessary), placed in the appropriate project folders."
         : ""
     }`;

        let systemClipboardOutput = `${systemPrompt}\n\n`;

        const buildRsPath = path.join(DIR, "rust", "build.rs");
        const buildRsContent = readFile(buildRsPath);
        if (buildRsContent !== null) {
          systemClipboardOutput += formatMarkdownFile(
            "build.rs",
            "rust",
            buildRsContent,
          );
        }

        systemClipboardOutput += appendUserScadFiles(options);

        return systemClipboardOutput.trimEnd() + "\n";
      },
      buildInputRequest: (task) =>
        `Design and implement a Rust ${frameworkName} project for the following concept: "${task}"`,
      allowedTools: ["render_scad_model", "compile_rust_project"],
    };
  }

  if (projectType === "web") {
    return {
      buildSystemPrompt: (promptRules, options = {}) => {
        const hasUserScadFiles =
          Array.isArray(options.scadFiles) && options.scadFiles.length > 0;

        return (
          `You are an expert Web 3D developer and procedural 3D technical artist.

What to generate:
1. 3D Web Assets (.scad):
   - Generate procedural 3D models for the project using OpenSCAD.
   - CRITICAL: The SCAD to glTF converter automatically converts OpenSCAD's Z-up coordinate system to the standard glTF Y-up coordinate system. Design your models naturally in OpenSCAD.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================

2. Vite Web Project Files (npm based):
   - Create the necessary files for a modern web application (e.g., \`package.json\`, \`index.html\`, \`main.js\`).
   - You can use ANY web 3D library with glTF support (e.g., Three.js, Babylon.js, @google/model-viewer, PlayCanvas, A-Frame, etc.) that fits the project's requirements.
   - In \`package.json\`, you MUST include the scad to gltf converter tool as a dev dependency:
     \`"scad-gltf": "^0.3.0"\`
   - In \`package.json\`, add npm scripts to automatically compile the \`.scad\` files into \`.glb\` format inside the \`public/\` folder before Vite runs its dev or build steps.
     For example:
     \`"predev": "scad-gltf convert ./scad ./public/models --cache"\`
     \`"prebuild": "scad-gltf convert ./scad ./public/models --cache"\`
   - Write the core application logic to load and display the converted \`.glb\` files interactively.

3. Delivery Format (Single Markdown File):
   - Output exactly ONE Markdown response containing all project files.
   - Do not output manual setup instructions or conversational explanations; output only the project files.
   - Format EACH file with a Markdown header specifying the relative file path (using snake_case directories), followed immediately by a code block containing the file's contents.
   - Example Format:
     ### my_project/package.json
     \`\`\`json
     {
       "name": "my_project"
     }
     \`\`\`
     ### my_project/main.js
     \`\`\`javascript
     console.log("Started");
     \`\`\`
   - The project files must be placed inside a root project folder (e.g., \`my_project/\`).
   - You must include and write:
     - Your generated \`.scad\` 3D assets.
     - Your generated Vite web project files.${
       hasUserScadFiles
         ? "\n     - The provided user `.scad` files (modified if necessary), placed in the appropriate project folders."
         : ""
     }` + appendUserScadFiles(options)
        );
      },
      buildInputRequest: (task) =>
        `Design and implement a web-based 3D glTF project using Vite for the following concept: "${task}"`,
      allowedTools: ["render_scad_model"],
    };
  }

  if (projectType === "godot") {
    return {
      buildSystemPrompt: (promptRules, options = {}) => {
        const hasUserScadFiles =
          Array.isArray(options.scadFiles) && options.scadFiles.length > 0;

        const systemPrompt = `You are an expert Godot 4 developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, scenes, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.gd\`, \`main_scene.tscn\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
1. 3D Assets (.scad):
   - Generate procedural 3D models for the project using OpenSCAD.
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
   - Create the necessary GDScript (\`.gd\`) and scene (\`.tscn\`) files to implement the project logic, responsive user input controls, and a core interaction loop.
   - The scenes should directly instance the generated \`.scad\` files (the provided addon will handle importing them as 3D scenes).
   - GDScript Coordinate, Forward, and Left/Right Conventions:
     * Forward is -Z: In Godot, \`Vector3.FORWARD\` is \`Vector3(0, 0, -1)\`. A 3D node's local forward direction is \`-transform.basis.z\` (or \`-global_transform.basis.z\`). In character movement, forward input (e.g., W or ui_up) must translate along \`-transform.basis.z\`. Never treat +Z as forward.
     * Backward is +Z: \`Vector3.BACK\` is \`Vector3(0, 0, 1)\` (\`transform.basis.z\`).
     * Right is +X: \`Vector3.RIGHT\` is \`Vector3(1, 0, 0)\` (\`transform.basis.x\`).
     * Left is -X: \`Vector3.LEFT\` is \`Vector3(-1, 0, 0)\` (\`-transform.basis.x\`).
     * Left/Right Convention in Godot Script: Maintain anatomical consistency in scripts—character Right is along +X (\`transform.basis.x\`) and character Left is along -X (\`-transform.basis.x\`).
     * Natural Model Alignment: Because OpenSCAD models face +Y (Forward), they automatically import facing Godot's Forward direction (-Z). Built-in Godot methods like \`look_at()\` orient the node's -Z axis toward the target, which perfectly aligns with the model's front. Do NOT apply compensation rotations (e.g., \`rotate_y(PI)\`) in GDScript to compensate for model orientation.
   - Generate a \`project.godot\` file. It must configure the project and automatically enable the \`scad_importer\` plugin.

3. Delivery Format (Single Markdown File):
   - Output exactly ONE Markdown response containing all project files.
   - Do not output manual setup instructions or conversational explanations; output only the project files.
   - Format EACH file with a Markdown header specifying the relative file path (using snake_case directories), followed immediately by a code block containing the file's contents.
   - Example Format:
     ### my_project/project.godot
     \`\`\`ini
     config_version=5
     \`\`\`
     ### my_project/main.gd
     \`\`\`gdscript
     extends Node
     \`\`\`
   - The project files must be placed inside a root project folder (e.g., \`my_project/\`).
   - You must include and write:
     - Your generated \`.scad\` assets.
     - Your generated Godot project files.
     - The exact source code of the provided \`addons/scad_importer/*\` files, placed in their correct respective paths.${
       hasUserScadFiles
         ? "\n     - The provided user `.scad` files (modified if necessary), placed in the appropriate project folders."
         : ""
     }`;

        let systemClipboardOutput = `${systemPrompt}\n\n`;

        // Gather Addon Files content
        const addonDir = path.join(DIR, "godot", "addons", "scad_importer");
        try {
          if (fs.existsSync(addonDir)) {
            const files = fs.readdirSync(addonDir);
            for (const file of files) {
              const fullPath = path.join(addonDir, file);
              if (
                fs.statSync(fullPath).isFile() &&
                (file.endsWith(".gd") || file.endsWith(".cfg"))
              ) {
                const content = readFile(fullPath);
                if (content !== null) {
                  const relativePath = `addons/scad_importer/${file}`;
                  const lang = file.endsWith(".gd") ? "gdscript" : "text";
                  systemClipboardOutput += formatMarkdownFile(
                    relativePath,
                    lang,
                    content,
                  );
                }
              }
            }
          }
        } catch (e) {
          console.error("Warning: Could not read addon directory.", e);
        }

        systemClipboardOutput += appendUserScadFiles(options);

        return systemClipboardOutput.trimEnd() + "\n";
      },
      buildInputRequest: (task) =>
        `Design and implement a Godot 4 project for the following concept: "${task}"`,
      allowedTools: ["render_scad_model", "test_godot_project"],
    };
  }

  throw new Error(`Unknown project type: ${projectType}`);
}
