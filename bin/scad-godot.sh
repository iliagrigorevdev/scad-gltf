#!/usr/bin/env bash

# Safely resolve symlinks to find the actual package directory (required for npx)
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$( cd -P "$( dirname "$SOURCE" )/.." >/dev/null 2>&1 && pwd )"

TASK=""
OPTIONS_JSON="{}"

# Check if task is provided via argument, otherwise read from STDIN if piped
if [ ! -t 0 ]; then
  TASK=$(cat)
  if [ -n "$1" ]; then
    OPTIONS_JSON="$1"
  fi
else
  if [ -n "$1" ]; then
    TASK="$1"
  fi
  if [ -n "$2" ]; then
    OPTIONS_JSON="$2"
  fi
fi

if [ -z "$TASK" ]; then
  echo "Error: Task parameter is required."
  echo "Usage: scad-godot \"<description of the game to generate>\" [options_json]"
  echo "   or: echo \"<description>\" | scad-godot [options_json]"
  echo ""
  echo "Example with JSON options:"
  echo "  scad-godot \"Game description\" '{\"animation\": false, \"transmission\": false}'"
  exit 1
fi

# Execute node to dynamically generate the OpenSCAD portion of the prompt using the JS method
PROMPT_RULES=$(PROMPT_JS="$DIR/src/prompt.js" TASK_STR="the 3D assets for the game" OPTIONS_JSON="$OPTIONS_JSON" node -e "
import('node:url').then(url => import(url.pathToFileURL(process.env.PROMPT_JS).href)).then(m => {
  const task = process.env.TASK_STR;
  let options = {};
  if (process.env.OPTIONS_JSON) {
    try {
      options = JSON.parse(process.env.OPTIONS_JSON);
    } catch (e) {
      console.error('Invalid JSON options: ' + process.env.OPTIONS_JSON);
      process.exit(1);
    }
  }
  // Disable the modelName instructions specifically for the Godot wrapper context
  // This prevents the LLM from trying to wrap generated SCAD files in \`\`\`openscad when outputting Node.js
  options.modelName = false;
  console.log(m.generatePrompt(task, options));
}).catch(e => { console.error(e); process.exit(1); });
")

if [ $? -ne 0 ]; then
  echo "Error generating prompt rules from prompt.js"
  exit 1
fi

# Execute clip.sh using absolute paths from the resolved package root
cat <<EOF | "$DIR/clip.sh" "$DIR/godot/addons/scad_importer/"*
You are an expert Godot 4 game developer and procedural 3D technical artist.

Input Task:
Design and implement a Godot 4 project for the following game concept: "${TASK}"

What to generate:
1. 3D Game Assets (.scad):
   - Generate procedural 3D models for the game using OpenSCAD.
   - CRITICAL: You must use the custom OpenSCAD glTF extensions for PBR materials (e.g., \`roughness\`, \`metalness\`, \`emissive\`) and Skeletal Animations (\`armature()\`, \`bone()\`). The rules and syntax for these features are provided below:

=== OPENSCAD SYNTAX RULES ===
${PROMPT_RULES}
=============================

2. Godot 4 Project Files:
   - Create the necessary GDScript (\`.gd\`) and scene (\`.tscn\`) files to implement the game logic, responsive player input controls, and a core gameplay loop.
   - The scenes should directly instance the generated \`.scad\` files (the provided addon will handle importing them as 3D scenes).
   - Generate a \`project.godot\` file. It must configure the project and automatically enable the \`scad_importer\` plugin.
   - Generate a \`.gitignore\` file that ignores the \`.godot/\` folder.
   - Generate a \`README.md\` file that documents the project, gameplay mechanics, and controls.

3. Delivery Format (Single Node.js Script):
   - Output exactly ONE self-contained Node.js script. Do not output manual setup instructions.
   - CRITICAL: The generated Node.js script MUST first create a root project folder (named using a slugified version of the project name) and output all files and folders inside this newly created project folder.
   - When executed, this script must programmatically create the entire project directory structure and write all the files to disk using the \`fs\` module.
   - The script must embed and write:
     - Your generated \`.scad\` game assets.
     - Your generated Godot project files.
     - The exact source code of the provided \`addons/scad_importer/*\` files, placed in their correct respective paths.
   - Ensure all string file contents inside the Node.js script are properly escaped.
EOF
