import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { getPromptProfile } from "./prompt-profiles.js";

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

function loadUserScadFiles(options = {}) {
  if (!Array.isArray(options.scadFiles) || options.scadFiles.length === 0) {
    return [];
  }
  const files = [];
  for (const file of options.scadFiles) {
    const content = readFile(file);
    if (content !== null) {
      const relativePath = path.isAbsolute(file)
        ? path.relative(process.cwd(), file).replace(/\\/g, "/")
        : file.replace(/\\/g, "/");
      files.push({ path: relativePath, lang: "openscad", content });
    }
  }
  return files;
}

function loadTemplateFiles(projectType) {
  const templates = [];

  if (projectType === "bevy" || projectType === "wgpu") {
    const buildRsPath = path.join(DIR, "rust", "build.rs");
    const content = readFile(buildRsPath);
    if (content !== null) {
      templates.push({ path: "build.rs", lang: "rust", content });
    }
  } else if (projectType === "godot") {
    const addonDir = path.join(DIR, "godot", "addons", "scad_importer");
    try {
      if (fs.existsSync(addonDir)) {
        for (const file of fs.readdirSync(addonDir)) {
          const fullPath = path.join(addonDir, file);
          if (
            fs.statSync(fullPath).isFile() &&
            (file.endsWith(".gd") || file.endsWith(".cfg"))
          ) {
            const content = readFile(fullPath);
            if (content !== null) {
              templates.push({
                path: `addons/scad_importer/${file}`,
                lang: file.endsWith(".gd") ? "gdscript" : "text",
                content,
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("Warning: Could not read addon directory.", e);
    }
  } else if (projectType === "ue") {
    const pluginDir = path.join(DIR, "ue", "Plugins", "ScadImporter");
    const ueDir = path.join(DIR, "ue");

    function readDirRecursive(currentDir) {
      if (!fs.existsSync(currentDir)) return;
      for (const file of fs.readdirSync(currentDir)) {
        const fullPath = path.join(currentDir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          readDirRecursive(fullPath);
        } else if (/\.(uplugin|cs|cpp|h)$/i.test(file)) {
          const content = readFile(fullPath);
          if (content !== null) {
            const relativePath = path
              .relative(ueDir, fullPath)
              .replace(/\\/g, "/");
            let lang = "text";
            if (file.endsWith(".cpp") || file.endsWith(".h")) lang = "cpp";
            else if (file.endsWith(".cs")) lang = "csharp";
            else if (file.endsWith(".uplugin")) lang = "json";
            templates.push({ path: relativePath, lang, content });
          }
        }
      }
    }

    try {
      readDirRecursive(pluginDir);
    } catch (e) {
      console.error("Warning: Could not read plugin directory.", e);
    }
  }

  return templates;
}

export function getProjectPrompts(projectType) {
  const profile = getPromptProfile(projectType);

  return {
    buildSystemPrompt: (promptRules, options = {}) =>
      profile.buildSystemPrompt(promptRules, {
        templateFiles: loadTemplateFiles(projectType),
        referenceFiles: loadUserScadFiles(options),
      }),
    buildInputRequest: (task, promptRules) =>
      profile.buildInputRequest(task, promptRules),
    allowedTools: profile.allowedTools,
  };
}
