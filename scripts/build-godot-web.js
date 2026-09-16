import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const ROOT_DIR = process.cwd();
const EXAMPLES_DIR = path.resolve(ROOT_DIR, "godot/examples");
const DIST_DIR = path.resolve(ROOT_DIR, ".godot-dist");
const ENGINE_DIR = path.resolve(DIST_DIR, "engine");
const BUILD_DIR = path.resolve(ROOT_DIR, ".godot-build");
const BIN_DIR = path.resolve(ROOT_DIR, ".godot-bin");
const SCAD_CONVERT_JS = path.resolve(ROOT_DIR, "bin/scad-convert.js");
const COI_SCRIPT = path.resolve(
  ROOT_DIR,
  "node_modules/coi-serviceworker/coi-serviceworker.min.js",
);

const GODOT_VERSION = "4.7.2-stable";
const GODOT_SHORT_VERSION = "4.7.2.stable";

// ==========================================
// 1. ENSURE GODOT & SCAD-CONVERT IN $PATH
// ==========================================
fs.mkdirSync(BIN_DIR, { recursive: true });

// Create local executable shim for `scad-convert`
const shimPath = path.join(BIN_DIR, "scad-convert");
fs.writeFileSync(shimPath, `#!/bin/sh\nnode "${SCAD_CONVERT_JS}" "$@"\n`, {
  mode: 0o755,
});

// Prepend .godot-bin to PATH
process.env.PATH = `${BIN_DIR}${path.delimiter}${process.env.PATH}`;

// Find or download Godot
let godotBin = "";
try {
  execSync("godot --version", { stdio: "ignore" });
  godotBin = "godot";
} catch {
  const localGodot = path.join(BIN_DIR, "godot");
  if (!fs.existsSync(localGodot)) {
    console.log(`\n⬇️  Downloading Godot ${GODOT_VERSION} Linux headless...`);
    const zipPath = path.join(BIN_DIR, "godot.zip");
    execSync(
      `curl -fL "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.x86_64.zip" -o "${zipPath}"`,
      { stdio: "inherit" },
    );
    execSync(`unzip -q -o "${zipPath}" -d "${BIN_DIR}"`, { stdio: "inherit" });
    fs.renameSync(
      path.join(BIN_DIR, `Godot_v${GODOT_VERSION}_linux.x86_64`),
      localGodot,
    );
    fs.chmodSync(localGodot, 0o755);
    fs.unlinkSync(zipPath);

    console.log(`⬇️  Downloading Web export templates...`);
    const templateDir = path.join(
      os.homedir(),
      `.local/share/godot/export_templates/${GODOT_SHORT_VERSION}`,
    );
    fs.mkdirSync(templateDir, { recursive: true });

    const tpzPath = path.join(BIN_DIR, "templates.tpz");
    execSync(
      `curl -fL "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_export_templates.tpz" -o "${tpzPath}"`,
      { stdio: "inherit" },
    );
    const extractTemp = path.join(BIN_DIR, "templates_temp");
    execSync(`unzip -q -o "${tpzPath}" -d "${extractTemp}"`, {
      stdio: "inherit",
    });
    execSync(`cp -r "${extractTemp}/templates/"* "${templateDir}/"`, {
      stdio: "inherit",
    });
    fs.rmSync(extractTemp, { recursive: true, force: true });
    fs.unlinkSync(tpzPath);
  }
  godotBin = localGodot;
}

// Flags to prevent headless Linux crashes (disables Vulkan and ALSA/Pulse audio servers)
const HEADLESS_FLAGS =
  "--headless --audio-driver Dummy --rendering-driver opengl3";

// ==========================================
// 2. RESET OUTPUT DIRS & COPY SHARED ASSETS
// ==========================================
fs.rmSync(DIST_DIR, { recursive: true, force: true });
fs.rmSync(BUILD_DIR, { recursive: true, force: true });
fs.mkdirSync(DIST_DIR, { recursive: true });
fs.mkdirSync(ENGINE_DIR, { recursive: true });
fs.mkdirSync(BUILD_DIR, { recursive: true });

// Copy single root coi-serviceworker so its scope covers all child directories
if (fs.existsSync(COI_SCRIPT)) {
  fs.copyFileSync(COI_SCRIPT, path.join(DIST_DIR, "coi-serviceworker.min.js"));
  console.log(
    `✓ Placed single shared coi-serviceworker at .godot-dist/coi-serviceworker.min.js`,
  );
}

const exampleFiles = fs
  .readdirSync(EXAMPLES_DIR)
  .filter((f) => f.endsWith(".js"));
const builtDemos = [];

// ==========================================
// 3. BUILD PROJECTS
// ==========================================
for (const file of exampleFiles) {
  const demoName = path.basename(file, ".js");
  const jsScriptPath = path.join(EXAMPLES_DIR, file);
  const projectDir = path.join(BUILD_DIR, demoName);

  console.log(`\n========================================`);
  console.log(`📦 Unpacking: ${demoName}`);
  console.log(`========================================`);
  execSync(`node "${jsScriptPath}"`, { cwd: BUILD_DIR, stdio: "inherit" });

  if (!fs.existsSync(projectDir)) {
    console.warn(`Skipping ${demoName}: directory not found.`);
    continue;
  }

  // Ensure GL Compatibility renderer and stream playback mode for Web
  const projectGodotPath = path.join(projectDir, "project.godot");
  let projectGodot = fs.readFileSync(projectGodotPath, "utf8");
  projectGodot = projectGodot.replace(/"Forward Plus"/g, '"GL Compatibility"');
  if (!projectGodot.includes('rendering_method="gl_compatibility"')) {
    projectGodot += `\n[rendering]\nrenderer/rendering_method="gl_compatibility"\nrenderer/rendering_method.web="gl_compatibility"\n`;
  }
  if (!projectGodot.includes("default_playback_type.web")) {
    projectGodot += `\n[audio]\ngeneral/default_playback_type.web=0\n`;
  }
  fs.writeFileSync(projectGodotPath, projectGodot, "utf8");

  // Copy Web export presets
  fs.copyFileSync(
    path.resolve(ROOT_DIR, "godot/export_presets.cfg"),
    path.join(projectDir, "export_presets.cfg"),
  );

  // Export to Web (Godot automatically runs scad-convert and scene imports here)
  const outDir = path.join(DIST_DIR, demoName);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n🚀 Exporting Web build to: ${outDir}`);
  // We export FIRST so Godot populates the .godot/ cache with global classes and imported resources,
  // preventing script parse errors during screenshot capture.
  execSync(
    `"${godotBin}" ${HEADLESS_FLAGS} --export-release "Web" "${path.join(outDir, "index.html")}" --path "${projectDir}"`,
    { stdio: "inherit", env: process.env },
  );

  // ==========================================
  // 3.5 CAPTURE SCREENSHOT
  // ==========================================
  console.log(`\n📸 Capturing screenshot for ${demoName}...`);
  // Temporarily add an Autoload to capture a perfectly square screenshot after 3 seconds.
  const screenshotScript = `extends Node
func _ready():
\tawait get_tree().create_timer(3).timeout
\tvar img = get_viewport().get_texture().get_image()
\tif img != null and not img.is_empty():
\t\tvar w = img.get_width()
\t\tvar h = img.get_height()
\t\tvar size = min(w, h)
\t\tvar x = (w - size) / 2
\t\tvar y = (h - size) / 2
\t\tvar cropped = img.get_region(Rect2i(x, y, size, size))
\t\tcropped.save_png("res://screenshot.png")
\tget_tree().quit()
`;
  fs.writeFileSync(path.join(projectDir, "screenshot.gd"), screenshotScript);

  const currentProjectGodot = fs.readFileSync(projectGodotPath, "utf8");
  let tempProjectGodot = currentProjectGodot;
  if (tempProjectGodot.includes("[autoload]")) {
    tempProjectGodot = tempProjectGodot.replace(
      "[autoload]",
      '[autoload]\nScreenshot="*res://screenshot.gd"',
    );
  } else {
    tempProjectGodot += `\n[autoload]\nScreenshot="*res://screenshot.gd"\n`;
  }
  fs.writeFileSync(projectGodotPath, tempProjectGodot, "utf8");

  try {
    // Run windowed with square resolution so the center crop matches the game area perfectly
    execSync(
      `"${godotBin}" --windowed --resolution 512x512 --audio-driver Dummy --path "${projectDir}"`,
      {
        stdio: "ignore",
        env: process.env,
        timeout: 15000,
      },
    );
  } catch (err) {
    console.warn(
      `  ⚠️ Screenshot capture for ${demoName} failed or timed out (requires display server).`,
    );
  }

  // Restore project.godot without the Autoload
  fs.writeFileSync(projectGodotPath, currentProjectGodot, "utf8");
  fs.unlinkSync(path.join(projectDir, "screenshot.gd"));

  const screenshotPath = path.join(projectDir, "screenshot.png");
  if (fs.existsSync(screenshotPath)) {
    fs.copyFileSync(screenshotPath, path.join(outDir, "screenshot.png"));
    fs.unlinkSync(screenshotPath);
    console.log(`  ✓ Saved squared screenshot.png`);
  }

  // ==========================================
  // 4. DEDUPLICATE ENGINE RUNTIME FILES
  // ==========================================
  console.log(`⚡ Decoupling WASM engine files to shared directory...`);

  const engineFiles = [
    { from: "index.js", to: "godot.js" },
    { from: "index.wasm", to: "godot.wasm" },
    { from: "index.audio.worklet.js", to: "godot.audio.worklet.js" },
    {
      from: "index.audio.position.worklet.js",
      to: "godot.audio.position.worklet.js",
    },
    { from: "index.side.wasm", to: "godot.side.wasm" },
  ];

  for (const { from, to } of engineFiles) {
    const src = path.join(outDir, from);
    const dest = path.join(ENGINE_DIR, to);

    if (fs.existsSync(src)) {
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        console.log(`  ✓ Cached shared engine file: engine/${to}`);
      }
      fs.unlinkSync(src);
    }
  }

  // Patch index.html to use shared engine and shared root coi-serviceworker
  const htmlPath = path.join(outDir, "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");

  // 1. Point script tag to shared engine script
  html = html.replace(
    /<script\s+src="index\.js"><\/script>/,
    '<script src="../engine/godot.js"></script>',
  );

  // 2. Configure Godot engine to use shared executable while loading local index.pck
  html = html.replace(
    /"executable"\s*:\s*"index"/,
    '"executable":"../engine/godot","mainPack":"index.pck"',
  );

  // 3. Update fileSizes key for progress bar
  html = html.replace(/"index\.wasm"/g, '"../engine/godot.wasm"');

  // 4. Reference the single root service worker and configure for social in-app browsers & iOS Safari
  html = html.replace(
    "<head>",
    `<head>
    <script>
      window.coi = {
        coepCredentialless: () => true,
        doReload: () => {
          const url = new URL(window.location.href);
          url.searchParams.set('coi-reload', Date.now());
          window.location.replace(url.href);
        }
      };
    </script>
    <script src="../coi-serviceworker.min.js"></script>`,
  );

  fs.writeFileSync(htmlPath, html, "utf8");
  builtDemos.push(demoName);
}

// ==========================================
// 5. GENERATE HUB LAUNCHER INDEX.HTML
// ==========================================
console.log(`\n📑 Generating launcher index.html...`);
const hubHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script>
    window.coi = {
      coepCredentialless: () => true,
      doReload: () => {
        const url = new URL(window.location.href);
        url.searchParams.set('coi-reload', Date.now());
        window.location.replace(url.href);
      }
    };
  </script>
  <script src="coi-serviceworker.min.js"></script>
  <title>SCAD Godot Web Demos</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f1117; color: #e1e4ea; margin: 0; padding: 2rem; }
    header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #232733; padding-bottom: 0.5rem; flex-wrap: wrap; gap: 1rem; }
    h1 { color: #478cbf; margin: 0; }
    .repo-link { display: inline-flex; align-items: center; gap: 0.5rem; color: #e1e4ea; text-decoration: none; font-size: 0.9rem; font-weight: 500; background: #1a1d27; border: 1px solid #282c3c; border-radius: 6px; padding: 0.5rem 0.85rem; transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease; }
    .repo-link:hover { background: #232738; border-color: #478cbf; color: #00d2ff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
    .card { background: #1a1d27; border: 1px solid #282c3c; border-radius: 8px; padding: 1.5rem; text-decoration: none; color: inherit; display: block; transition: transform 0.15s ease, border-color 0.15s ease; }
    .card:hover { transform: translateY(-3px); border-color: #478cbf; }
    .card-img-container { width: 100%; aspect-ratio: 1 / 1; background: #0f1117; border-radius: 4px; margin-bottom: 1rem; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    .card-img-container img { width: 100%; height: 100%; object-fit: cover; }
    .card h2 { margin: 0 0 0.5rem 0; font-size: 1.25rem; color: #00d2ff; }
    .card p { margin: 0; font-size: 0.875rem; color: #8c93a8; }
  </style>
</head>
<body>
  <header>
    <h1>🎮 SCAD Godot Examples</h1>
    <a class="repo-link" href="https://github.com/iliagrigorevdev/scad-godot" target="_blank" rel="noopener noreferrer">
      <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
      </svg>
      Source Repository
    </a>
  </header>
  <div class="grid">
    ${builtDemos
      .map(
        (name) => `
    <a class="card" href="./${name}/">
      <div class="card-img-container">
        <img src="./${name}/screenshot.png" alt="${name} screenshot" onerror="this.style.display='none'" />
      </div>
      <h2>${name}</h2>
    </a>`,
      )
      .join("")}
  </div>
</body>
</html>`;

fs.writeFileSync(path.join(DIST_DIR, "index.html"), hubHtml, "utf-8");

console.log(`\n🎉 Success! All projects built by Godot into .godot-dist/`);
