import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawnWithTimeout } from "./process-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GODOT_VERSION = "4.7.2-stable";
const GODOT_SHORT_VERSION = "4.7.2.stable";
const DEFAULT_BIN_DIR = path.resolve(__dirname, "../.godot-bin");

function extractArchive(archivePath, destDir) {
  if (os.platform() === "win32") {
    cp.execSync(`tar -xf "${archivePath}" -C "${destDir}"`, {
      stdio: "ignore",
    });
  } else {
    cp.execSync(`unzip -q -o "${archivePath}" -d "${destDir}"`, {
      stdio: "ignore",
    });
  }
}

function getTemplatesDir() {
  const platform = os.platform();
  if (platform === "win32") {
    const baseDir =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(baseDir, "Godot", "export_templates", GODOT_SHORT_VERSION);
  }
  if (platform === "darwin") {
    const baseDir = path.join(os.homedir(), "Library", "Application Support");
    return path.join(baseDir, "Godot", "export_templates", GODOT_SHORT_VERSION);
  }
  const baseDir =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(baseDir, "godot", "export_templates", GODOT_SHORT_VERSION);
}

export function ensureExportTemplates(binDir = DEFAULT_BIN_DIR) {
  const templateDir = getTemplatesDir();
  if (!fs.existsSync(templateDir)) {
    console.log(`⬇️  Downloading Godot Web export templates...`);
    fs.mkdirSync(templateDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    const tpzPath = path.join(binDir, "templates.tpz");
    cp.execSync(
      `curl -fL "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_export_templates.tpz" -o "${tpzPath}"`,
      { stdio: "inherit" },
    );

    const extractTemp = path.join(binDir, "templates_temp");
    fs.mkdirSync(extractTemp, { recursive: true });
    extractArchive(tpzPath, extractTemp);

    const extractedTemplates = path.join(extractTemp, "templates");
    if (fs.existsSync(extractedTemplates)) {
      fs.cpSync(extractedTemplates, templateDir, { recursive: true });
    }

    fs.rmSync(extractTemp, { recursive: true, force: true });
    try {
      fs.unlinkSync(tpzPath);
    } catch (e) {}
  }
}

export function getGodotBin(withTemplates = false, binDir = DEFAULT_BIN_DIR) {
  if (process.env.GODOT_BIN && fs.existsSync(process.env.GODOT_BIN)) {
    if (withTemplates) ensureExportTemplates(binDir);
    return process.env.GODOT_BIN;
  }
  try {
    cp.execSync("godot --version", { stdio: "ignore" });
    if (withTemplates) ensureExportTemplates(binDir);
    return "godot";
  } catch {
    const isWin = os.platform() === "win32";
    const isMac = os.platform() === "darwin";
    const localGodot = path.join(
      binDir,
      isWin ? "godot.exe" : isMac ? "Godot.app/Contents/MacOS/Godot" : "godot",
    );

    if (!fs.existsSync(localGodot)) {
      console.log(`\n⬇️  Downloading Godot ${GODOT_VERSION} headless...`);
      fs.mkdirSync(binDir, { recursive: true });
      let zipUrl = "";

      if (isWin) {
        zipUrl = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_win64.exe.zip`;
      } else if (isMac) {
        zipUrl = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_macos.universal.zip`;
      } else {
        const archMap = { arm64: "arm64", arm: "arm32", ia32: "x86_32" };
        const linuxArch = archMap[os.arch()] || "x86_64";
        zipUrl = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.${linuxArch}.zip`;
      }

      const zipPath = path.join(binDir, "godot.zip");
      cp.execSync(`curl -fL "${zipUrl}" -o "${zipPath}"`, { stdio: "ignore" });
      extractArchive(zipPath, binDir);

      if (!isMac) {
        const files = fs.readdirSync(binDir);
        const extracted = files.find(
          (f) =>
            f.startsWith("Godot_v") &&
            !f.endsWith(".zip") &&
            fs.statSync(path.join(binDir, f)).isFile(),
        );
        if (extracted) {
          fs.renameSync(path.join(binDir, extracted), localGodot);
        }
      }

      fs.chmodSync(localGodot, 0o755);
      try {
        fs.unlinkSync(zipPath);
      } catch (e) {}
    }

    if (withTemplates) ensureExportTemplates(binDir);
    return localGodot;
  }
}

export function runGodotAsync(args, cwd, timeoutMs, options = {}) {
  const godotBin = getGodotBin(false, options.binDir || DEFAULT_BIN_DIR);
  const env = { ...process.env };
  let spawnBin = godotBin;
  let spawnArgs = args;

  if (process.platform === "linux") {
    spawnArgs = ["-a", "-s", "-screen 0 1024x768x24", spawnBin, ...args];
    spawnBin = "xvfb-run";
  }

  return spawnWithTimeout(spawnBin, spawnArgs, {
    cwd,
    env,
    timeoutMs,
    timeoutMessage: "\n--- KILLED BY TIMEOUT ---",
    formatError: (err, cmd) => {
      if (err.code === "ENOENT" && cmd === "xvfb-run") {
        return `Error: 'xvfb-run' is missing. To test Godot projects on headless Linux, you must install Xvfb.\n\nPlease run: sudo apt-get install xvfb`;
      }
      return `Process error: ${err.message}`;
    },
  });
}

export function ensureWebLibraries(destDir, binDir = DEFAULT_BIN_DIR) {
  ensureExportTemplates(binDir);
  const templateDir = getTemplatesDir();
  const candidates = [
    "web_nothreads_release.zip",
    "web_nothreads_debug.zip",
    "web_release.zip",
  ];

  const zipName = candidates.find((name) =>
    fs.existsSync(path.join(templateDir, name)),
  );

  if (!zipName) {
    throw new Error(`No Godot Web export template zip found in ${templateDir}`);
  }

  const zipPath = path.join(templateDir, zipName);
  fs.mkdirSync(destDir, { recursive: true });
  extractArchive(zipPath, destDir);

  return zipName;
}
