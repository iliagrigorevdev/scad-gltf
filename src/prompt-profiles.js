import { generatePrompt } from "./prompt.js";

function formatMarkdownFile(displayPath, lang, content) {
  return `### ${displayPath}\n\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
}

function appendReferenceScadFiles(referenceFiles = [], isRawScad = false) {
  if (!Array.isArray(referenceFiles) || referenceFiles.length === 0) {
    return "";
  }

  let output = `\n\n=== USER PROVIDED OPENSCAD FILES ===\n`;
  if (isRawScad) {
    output += `The following .scad files are provided as reference or base assets. You MUST embed their contents directly into your final single OpenSCAD file (or use them as context), modifying them if necessary to fit the project logic.\n\n`;
  } else {
    output += `The following .scad files are provided as reference or base assets. You MUST embed and write them into the generated project (or use them as context), modifying them if necessary to fit the project logic.\n\n`;
  }

  for (const file of referenceFiles) {
    if (file && typeof file.content === "string") {
      const normalizedPath = String(file.path || "reference.scad").replace(
        /\\/g,
        "/",
      );
      output += formatMarkdownFile(
        normalizedPath,
        "openscad",
        file.content.replace(/\r\n/g, "\n"),
      );
    }
  }
  return output;
}

function appendTemplateFiles(templateFiles = []) {
  if (!Array.isArray(templateFiles) || templateFiles.length === 0) {
    return "";
  }
  let output = "";
  for (const file of templateFiles) {
    if (file && typeof file.content === "string") {
      output += formatMarkdownFile(
        file.path,
        file.lang || "text",
        file.content.replace(/\r\n/g, "\n"),
      );
    }
  }
  return output;
}

function getScadAssetsInstructions(promptRules, projectType) {
  let specificRules = "";
  if (projectType === "godot") {
    specificRules = `   - Scale & Units: 1 OpenSCAD unit = 1 Godot meter. Design your models using realistic meter-based scales (e.g., a character should be ~1.8 units tall). DO NOT use millimeter-based scaling.
   - Coordinate System & Forward Convention: Write standard OpenSCAD Z-up code (+Z is UP, XY plane is ground). Build objects standing upright and facing Front (Positive Y-axis).
   - Left/Right Convention: Always name and position "left" and "right" components (e.g., LeftArm, RightEye) based on the object's anatomical point of view (facing Forward towards +Y), NOT the camera/viewer's screen perspective. Because the object faces +Y, the object's Left side is along the -X axis, and the object's Right side is along the +X axis.
   - CRITICAL Coordinate Mapping: The SCAD to glTF converter used by the Godot importer automatically converts OpenSCAD's Z-up coordinate system to Godot's Y-up coordinate system. Design your models naturally in OpenSCAD using this exact mapping:
     * OpenSCAD +X (Right)   -> Godot +X (Right)
     * OpenSCAD -X (Left)    -> Godot -X (Left)
     * OpenSCAD +Y (Forward) -> Godot -Z (Forward)
     * OpenSCAD -Y (Back)    -> Godot +Z (Back)
     * OpenSCAD +Z (Up)      -> Godot +Y (Up)
     DO NOT manually apply root rotations (e.g., \`rotate([90, 0, 0])\`) to compensate for Godot.`;
  } else if (projectType === "ue") {
    specificRules = `   - Scale & Units: 1 OpenSCAD unit = 1 Meter. (Unreal's GLTF importer automatically scales meters to Unreal centimeters). Design models using realistic meter-based dimensions (e.g., a person/robot ~1.8 units, an industrial machine ~2.5 units, a vehicle ~4.5 units).
   - Coordinate System & Forward Convention: Unreal Engine uses a Left-Handed Z-Up coordinate system (+X Forward, +Y Right, +Z Up).
   - CRITICAL Coordinate Mapping: The SCAD-to-glTF exporter converts Z-up to Y-up, and Unreal's Interchange importer converts Y-up back to Z-up, preserving the horizontal axes without a 90-degree yaw rotation. Therefore:
     * OpenSCAD +X (Forward) -> Unreal +X (Forward)
     * OpenSCAD -X (Back)    -> Unreal -X (Back)
     * OpenSCAD -Y (Right)   -> Unreal +Y (Right)
     * OpenSCAD +Y (Left)    -> Unreal -Y (Left)
     * OpenSCAD +Z (Up)      -> Unreal +Z (Up)
   - Modeling Rules for Unreal:
     * Build objects standing upright on the XY plane (+Z is Up) and oriented with their primary front / functional direction facing POSITIVE X (+X).
     * Any directional feature (front grill, sensor array, nozzle, cockpit, display screen, or heading) MUST face +X.
     * Lateral components on the object's right side (e.g., RightWheel, RightArm) are positioned along -Y; components on the left side are positioned along +Y.
     * Elongated pathways, tracks, conveyors, or primary axes of motion should run along the X-axis, with lateral spans or widths along the Y-axis.
     * DO NOT apply manual rotation compensations in C++ (e.g., FRotator(0, -90, 0)); models built facing +X naturally align with Unreal's native FVector::ForwardVector.`;
  } else {
    specificRules = `   - CRITICAL: The SCAD to glTF converter automatically converts OpenSCAD's Z-up coordinate system to the standard glTF Y-up coordinate system. Design your models naturally in OpenSCAD.`;
  }

  return `1. 3D Assets (.scad):
   - Generate procedural 3D models for the project using OpenSCAD.
${specificRules}
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Hierarchical Node Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${promptRules}
=============================`;
}

function getDeliveryFormat(projectType, frameworkName, hasUserScadFiles) {
  let exampleCode = "";
  let includes = "";

  if (projectType === "bevy" || projectType === "wgpu") {
    exampleCode = `     ### my_project/Cargo.toml
     \`\`\`toml
     [package]
     name = "my_project"
     ...
     \`\`\`
     ### my_project/src/main.rs
     \`\`\`rust
     fn main() {}
     \`\`\``;
    includes = `     - Your generated Rust ${frameworkName} project files (\`Cargo.toml\`, \`src/main.rs\`).
     - The exact source code of the provided \`build.rs\` file, placed in the project root.`;
  } else if (projectType === "web") {
    exampleCode = `     ### my_project/package.json
     \`\`\`json
     {
       "name": "my_project"
     }
     \`\`\`
     ### my_project/main.js
     \`\`\`javascript
     console.log("Started");
     \`\`\``;
    includes = `     - Your generated Vite web project files.`;
  } else if (projectType === "godot") {
    exampleCode = `     ### my_project/project.godot
     \`\`\`ini
     config_version=5
     \`\`\`
     ### my_project/main.gd
     \`\`\`gdscript
     extends Node
     \`\`\``;
    includes = `     - Your generated Godot project files.
     - The exact source code of the provided \`addons/scad_importer/*\` files, placed in their correct respective paths.`;
  }

  return `3. Delivery Format (Single Markdown File):
   - Output exactly ONE Markdown response containing all project files.
   - Format EACH file with a Markdown header specifying the relative file path (using snake_case directories), followed immediately by a code block containing the file's contents.
   - Example Format:
${exampleCode}
   - The project files must be placed inside a root project folder (e.g., \`my_project/\`).
   - You must include and write:
     - Your generated \`.scad\` 3D assets.
${includes}${
    hasUserScadFiles
      ? "\n     - The provided user `.scad` files (modified if necessary), placed in the appropriate project folders."
      : ""
  }`;
}

export const PROMPT_PROFILES = {
  scad: {
    id: "scad",
    label: "OpenSCAD Model",
    showInEditor: true,
    isRawScad: true,
    helpText:
      "Describe the object you want to generate. The copied prompt will include advanced PBR and Animation rules based on your selection.",
    descriptionPlaceholder: "e.g. A shiny gold ring with an embedded red gem",
    defaultDescription: "an object",
    defaultPromptOptions: {
      basic: true,
      transmission: true,
      clearcoat: true,
      sheen: true,
      emissive: true,
      specular: true,
      iridescence: true,
      unlit: true,
      autoSmoothAngle: true,
      animation: true,
      lights: false,
      bakeColors: false,
      bakeNormals: false,
      bakeOrm: false,
      bakeUvs: false,
      colormap: false,
      modelName: true,
    },
    forcedPromptOptions: {},
    allowedTools: ["render_scad_model"],
    buildSystemPrompt: (promptRules, { referenceFiles = [] } = {}) => {
      let output = promptRules;
      output += appendReferenceScadFiles(referenceFiles, true);
      return output;
    },
    buildInputRequest: (task) => task,
  },

  godot: {
    id: "godot",
    label: "Godot 4 Project",
    showInEditor: true,
    isRawScad: false,
    scadTaskFallback: "the 3D assets for the project",
    helpText:
      "Describe the Godot 4 3D project you want to generate. The prompt includes Godot project structure, GDScript conventions, and SCAD asset rules.",
    descriptionPlaceholder:
      "e.g. A third-person 3D robot platformer with animated collectibles",
    defaultDescription: "a simple 3D interactive scene",
    defaultPromptOptions: {
      basic: true,
      transmission: false,
      clearcoat: false,
      sheen: false,
      emissive: true,
      specular: true,
      iridescence: false,
      unlit: true,
      autoSmoothAngle: true,
      animation: true,
      lights: false,
      bakeColors: false,
      bakeNormals: false,
      bakeOrm: false,
      bakeUvs: false,
      colormap: false,
      modelName: false,
    },
    forcedPromptOptions: {
      modelName: false,
    },
    allowedTools: ["render_scad_model", "test_godot_project"],
    buildSystemPrompt: (
      promptRules,
      { templateFiles = [], referenceFiles = [] } = {},
    ) => {
      const hasUserScadFiles =
        Array.isArray(referenceFiles) && referenceFiles.length > 0;

      const systemPrompt = `You are an expert Godot 4 developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, scenes, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.gd\`, \`main_scene.tscn\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
${getScadAssetsInstructions(promptRules, "godot")}

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
   - Do NOT use \`preload("res://...scad")\` at the top of GDScript files, because Godot may parse scripts before the \`.scad\` importer finishes on the initial project scan. Instead, instance \`.scad\` files directly in \`.tscn\` scenes or load them dynamically with \`load("res://...scad")\` inside \`_ready()\`.

${getDeliveryFormat("godot", null, hasUserScadFiles)}`;

      let output = `${systemPrompt}\n\n`;
      output += appendTemplateFiles(templateFiles);
      output += appendReferenceScadFiles(referenceFiles, false);
      return output.trimEnd() + "\n";
    },
    buildInputRequest: (task) =>
      `Design and implement a Godot 4 project for the following concept: "${task}"`,
  },

  web: {
    id: "web",
    label: "Vite Web 3D Project",
    showInEditor: false,
    isRawScad: false,
    scadTaskFallback: "the 3D assets for the project",
    defaultPromptOptions: {
      transmission: false,
      clearcoat: false,
      sheen: false,
      iridescence: false,
      colormap: false,
      modelName: false,
    },
    forcedPromptOptions: { modelName: false },
    allowedTools: ["render_scad_model"],
    buildSystemPrompt: (promptRules, { referenceFiles = [] } = {}) => {
      const hasUserScadFiles =
        Array.isArray(referenceFiles) && referenceFiles.length > 0;

      return (
        `You are an expert Web 3D developer and procedural 3D technical artist.

What to generate:
${getScadAssetsInstructions(promptRules, "web")}

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

${getDeliveryFormat("web", null, hasUserScadFiles)}` +
        appendReferenceScadFiles(referenceFiles, false)
      );
    },
    buildInputRequest: (task) =>
      `Design and implement a web-based 3D glTF project using Vite for the following concept: "${task}"`,
  },

  bevy: {
    id: "bevy",
    label: "Rust Bevy Project",
    showInEditor: false,
    isRawScad: false,
    scadTaskFallback: "the 3D assets for the project",
    defaultPromptOptions: {
      transmission: false,
      clearcoat: false,
      sheen: false,
      iridescence: false,
      colormap: false,
      modelName: false,
    },
    forcedPromptOptions: { modelName: false },
    allowedTools: ["render_scad_model", "compile_rust_project"],
    buildSystemPrompt: (
      promptRules,
      { templateFiles = [], referenceFiles = [] } = {},
    ) => {
      const hasUserScadFiles =
        Array.isArray(referenceFiles) && referenceFiles.length > 0;
      const systemPrompt = `You are an expert Rust Bevy developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.rs\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
${getScadAssetsInstructions(promptRules, "bevy")}

2. Rust Bevy Project Files:
   - Create the necessary files for a modern Rust Bevy application (e.g., \`Cargo.toml\`, \`build.rs\`, \`src/main.rs\`).
   - In \`Cargo.toml\`, include \`bevy\` as a dependency.
   - You MUST include the provided \`build.rs\` script at the root of the project to automatically compile the \`.scad\` files into \`.glb\` format inside the \`assets/models\` folder before running the application via Cargo.
   - Write the core application logic in \`src/main.rs\` to load and display the converted \`.glb\` files interactively. Provide standard Bevy systems (camera, lights, movement, etc.).

${getDeliveryFormat("bevy", "Bevy", hasUserScadFiles)}`;

      let output = `${systemPrompt}\n\n`;
      output += appendTemplateFiles(templateFiles);
      output += appendReferenceScadFiles(referenceFiles, false);
      return output.trimEnd() + "\n";
    },
    buildInputRequest: (task) =>
      `Design and implement a Rust Bevy project for the following concept: "${task}"`,
  },

  wgpu: {
    id: "wgpu",
    label: "Rust wgpu Project",
    showInEditor: false,
    isRawScad: false,
    scadTaskFallback: "the 3D assets for the project",
    defaultPromptOptions: {
      transmission: false,
      clearcoat: false,
      sheen: false,
      iridescence: false,
      colormap: false,
      modelName: false,
    },
    forcedPromptOptions: { modelName: false },
    allowedTools: ["render_scad_model", "compile_rust_project"],
    buildSystemPrompt: (
      promptRules,
      { templateFiles = [], referenceFiles = [] } = {},
    ) => {
      const hasUserScadFiles =
        Array.isArray(referenceFiles) && referenceFiles.length > 0;
      const systemPrompt = `You are an expert Rust wgpu developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, models, scripts, and root folders MUST strictly use snake_case (lowercase with underscores, e.g. \`player_character.rs\`, \`enemy_walker.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
${getScadAssetsInstructions(promptRules, "wgpu")}

2. Rust wgpu Project Files:
   - Create the necessary files for a modern Rust wgpu application (e.g., \`Cargo.toml\`, \`build.rs\`, \`src/main.rs\`).
   - In \`Cargo.toml\`, include \`wgpu\` as a dependency.
   - You MUST include the provided \`build.rs\` script at the root of the project to automatically compile the \`.scad\` files into \`.glb\` format inside the \`assets/models\` folder before running the application via Cargo.
   - Write the core application logic in \`src/main.rs\` to load and display the converted \`.glb\` files interactively.

${getDeliveryFormat("wgpu", "wgpu", hasUserScadFiles)}`;

      let output = `${systemPrompt}\n\n`;
      output += appendTemplateFiles(templateFiles);
      output += appendReferenceScadFiles(referenceFiles, false);
      return output.trimEnd() + "\n";
    },
    buildInputRequest: (task) =>
      `Design and implement a Rust wgpu project for the following concept: "${task}"`,
  },

  ue: {
    id: "ue",
    label: "Unreal Engine 5 Project",
    showInEditor: false,
    isRawScad: false,
    scadTaskFallback: "the 3D assets for the project",
    defaultPromptOptions: {
      transmission: false,
      clearcoat: false,
      sheen: false,
      iridescence: false,
      colormap: false,
      modelName: false,
    },
    forcedPromptOptions: { modelName: false },
    allowedTools: ["render_scad_model"],
    buildSystemPrompt: (
      promptRules,
      { templateFiles = [], referenceFiles = [] } = {},
    ) => {
      const hasUserScadFiles =
        Array.isArray(referenceFiles) && referenceFiles.length > 0;
      const systemPrompt = `You are an expert Unreal Engine 5 C++ developer and procedural 3D technical artist.

NAMING CONVENTION REQUIREMENT:
- All generated files, directories, C++ classes, and structs MUST strictly use standard Unreal Engine PascalCase naming conventions (e.g., \`MyGameMode.cpp\`, \`AMyPlayerCharacter\`).
- Use standard UE prefixes: 'A' for Actors, 'U' for UObjects, 'F' for Structs.
- 3D asset files (.scad) should use PascalCase (e.g., \`PlayerCharacter.scad\`).
- NEVER use hyphens/minus signs (\`-\`) or spaces in any file or folder names.

What to generate:
${getScadAssetsInstructions(promptRules, "ue")}

2. Unreal Engine 5 Project Files:
   - Create the necessary C++ files (.h and .cpp), a \`.uproject\` file, and Unreal build system files (\`.Target.cs\`, \`.Build.cs\`) to implement the project logic, responsive user input controls, and a core interaction loop.
   - For all \`.Target.cs\` files, you MUST set \`DefaultBuildSettings = BuildSettingsVersion.Latest;\` and \`IncludeOrderVersion = EngineIncludeOrderVersion.Latest;\`.
   - Configure the project to automatically enable the \`ScadImporter\` plugin and the \`Interchange\` framework in the \`.uproject\` file.
   - UE C++ Coordinate Conventions:
     * Forward is +X: \`FVector::ForwardVector\` or \`GetActorForwardVector()\`.
     * Right is +Y: \`FVector::RightVector\` or \`GetActorRightVector()\`.
     * Up is +Z: \`FVector::UpVector\` or \`GetActorUpVector()\`.
   - Asset loading: The ScadImporter plugin will automatically compile and import the .scad files into .uasset files (UStaticMesh / USkeletalMesh) on the FIRST launch of the editor.
     - CRITICAL C++ ASSET LOADING RULE: Because the .scad files are compiled to .uasset dynamically during the editor's initial startup, the .uasset files DO NOT EXIST when C++ Class Default Objects (CDO) are constructed.
       * NEVER use \`ConstructorHelpers::FObjectFinder\` or \`FClassFinder\` to reference your generated meshes in C++ constructors! This will fail initialization.
       * INSTEAD, expose the meshes as \`UPROPERTY(EditAnywhere)\` or load them dynamically at runtime in \`BeginPlay()\`.
       * When loading dynamically via \`LoadObject\`, you MUST account for the Interchange importer's folder structure based on your model type:
         - For STATIC meshes: \`LoadObject<UStaticMesh>(nullptr, TEXT("/Game/Models/YourModel/StaticMeshes/YourModel.YourModel"))\`
         - For ANIMATED models (using \`armature()\`), the importer generates a single unified Skeletal Mesh and an Animation Sequence:
           * Mesh: \`LoadObject<USkeletalMesh>(nullptr, TEXT("/Game/Models/YourModel/SkeletalMeshes/YourModel.YourModel"))\`
           * Animation: \`LoadObject<UAnimSequence>(nullptr, TEXT("/Game/Models/YourModel/SkeletalMeshes/YourModel_Anim.YourModel_Anim"))\`

3. Delivery Format (Single Markdown File):
   - Output exactly ONE Markdown response containing all project files.
   - Format EACH file with a Markdown header specifying the relative file path, followed immediately by a code block containing the file's contents.
   - Example Format:
     ### MyProject/MyProject.uproject
     \`\`\`json
     {
       "FileVersion": 3
     }
     \`\`\`
     ### MyProject/Source/MyProject/MyProject.cpp
     \`\`\`cpp
     #include "MyProject.h"
     \`\`\`
   - The project files must be placed inside a root project folder (e.g., \`MyProject/\`).
   - You must include and write:
     - Your generated \`.scad\` 3D assets inside a \`Content/Models/\` directory.
     - Your generated Unreal project files (\`Source\`, \`Config\`, \`.uproject\`).
     - The exact source code of the provided \`Plugins/ScadImporter/*\` files, which must be placed into the generated project's \`Plugins/ScadImporter/\` directory.${
       hasUserScadFiles
         ? "\n     - The provided user `.scad` files (modified if necessary), placed in the appropriate project folders."
         : ""
     }`;

      let output = `${systemPrompt}\n\n`;
      output += appendTemplateFiles(templateFiles);
      output += appendReferenceScadFiles(referenceFiles, false);
      return output.trimEnd() + "\n";
    },
    buildInputRequest: (task) =>
      `Design and implement an Unreal Engine 5 project for the following concept: "${task}"`,
  },
};

export function getPromptProfile(profileId = "scad") {
  const profile = PROMPT_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown project type / prompt profile: ${profileId}`);
  }
  return profile;
}

export function getEditorPromptProfiles() {
  return Object.values(PROMPT_PROFILES).filter((p) => p.showInEditor);
}

/**
 * Builds a complete clipboard-ready prompt for the given profile.
 */
export function buildProfilePrompt(
  profileId,
  { task, promptOptions = {}, templateFiles = [], referenceFiles = [] } = {},
) {
  const profile = getPromptProfile(profileId);
  const effectiveTask = (task || "").trim() || profile.defaultDescription;

  const mergedOptions = {
    ...profile.defaultPromptOptions,
    ...promptOptions,
    ...profile.forcedPromptOptions,
  };

  const scadPromptRules = generatePrompt(
    profile.isRawScad ? effectiveTask : profile.scadTaskFallback,
    mergedOptions,
  );

  const systemPrompt = profile.buildSystemPrompt(scadPromptRules, {
    templateFiles,
    referenceFiles,
  });

  if (profile.isRawScad) {
    return systemPrompt;
  }

  const userRequest = profile.buildInputRequest(effectiveTask, scadPromptRules);

  return `=== SYSTEM PROMPT ===\n${systemPrompt}\n\n=== USER REQUEST ===\n${userRequest}`;
}
