import fs from "fs";
import path from "path";
import os from "os";
import { execSync, spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GODOT_VERSION = "4.7.2-stable";
const GODOT_SHORT_VERSION = "4.7.2.stable";
const BIN_DIR = path.resolve(__dirname, "../.godot-bin");

function getTemplatesDir() {
  const isWin = os.platform() === "win32";
  const isMac = os.platform() === "darwin";
  let baseDir;
  if (isWin) {
    baseDir =
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(baseDir, "Godot", "export_templates", GODOT_SHORT_VERSION);
  } else if (isMac) {
    baseDir = path.join(os.homedir(), "Library", "Application Support");
    return path.join(baseDir, "Godot", "export_templates", GODOT_SHORT_VERSION);
  } else {
    baseDir =
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    return path.join(baseDir, "godot", "export_templates", GODOT_SHORT_VERSION);
  }
}

export function ensureExportTemplates() {
  const templateDir = getTemplatesDir();
  if (!fs.existsSync(templateDir)) {
    console.log(`⬇️  Downloading Godot Web export templates...`);
    fs.mkdirSync(templateDir, { recursive: true });
    fs.mkdirSync(BIN_DIR, { recursive: true });

    const tpzPath = path.join(BIN_DIR, "templates.tpz");
    execSync(
      `curl -fL "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_export_templates.tpz" -o "${tpzPath}"`,
      { stdio: "inherit" },
    );

    const extractTemp = path.join(BIN_DIR, "templates_temp");
    fs.mkdirSync(extractTemp, { recursive: true });

    if (os.platform() === "win32") {
      execSync(`tar -xf "${tpzPath}" -C "${extractTemp}"`, { stdio: "ignore" });
    } else {
      execSync(`unzip -q -o "${tpzPath}" -d "${extractTemp}"`, {
        stdio: "ignore",
      });
    }

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

export function getGodotBin(withTemplates = false) {
  try {
    execSync("godot --version", { stdio: "ignore" });
    if (withTemplates) ensureExportTemplates();
    return "godot";
  } catch {
    const isWin = os.platform() === "win32";
    const isMac = os.platform() === "darwin";
    const localGodot = path.join(
      BIN_DIR,
      isWin ? "godot.exe" : isMac ? "Godot.app/Contents/MacOS/Godot" : "godot",
    );

    if (!fs.existsSync(localGodot)) {
      console.log(`\n⬇️  Downloading Godot ${GODOT_VERSION} headless...`);
      fs.mkdirSync(BIN_DIR, { recursive: true });
      let zipUrl = "";

      if (isWin) {
        zipUrl = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_win64.exe.zip`;
      } else if (isMac) {
        zipUrl = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_macos.universal.zip`;
      } else {
        const arch = os.arch();
        let linuxArch = "x86_64";
        if (arch === "arm64") {
          linuxArch = "arm64";
        } else if (arch === "arm") {
          linuxArch = "arm32";
        } else if (arch === "ia32") {
          linuxArch = "x86_32";
        }
        zipUrl = `https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}/Godot_v${GODOT_VERSION}_linux.${linuxArch}.zip`;
      }

      const zipPath = path.join(BIN_DIR, "godot.zip");
      execSync(`curl -fL "${zipUrl}" -o "${zipPath}"`, { stdio: "ignore" });

      if (isWin) {
        execSync(`tar -xf "${zipPath}" -C "${BIN_DIR}"`, { stdio: "ignore" });
      } else {
        execSync(`unzip -q -o "${zipPath}" -d "${BIN_DIR}"`, {
          stdio: "ignore",
        });
      }

      if (!isMac) {
        const files = fs.readdirSync(BIN_DIR);
        const extracted = files.find(
          (f) =>
            f.startsWith("Godot_v") &&
            !f.endsWith(".zip") &&
            fs.statSync(path.join(BIN_DIR, f)).isFile(),
        );
        if (extracted) {
          fs.renameSync(path.join(BIN_DIR, extracted), localGodot);
        }
      }

      fs.chmodSync(localGodot, 0o755);
      try {
        fs.unlinkSync(zipPath);
      } catch (e) {}
    }

    if (withTemplates) ensureExportTemplates();
    return localGodot;
  }
}

export function runGodotAsync(args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    let output = "";
    const godotBin = getGodotBin();

    const env = { ...process.env };
    let spawnBin = godotBin;
    let spawnArgs = args;

    // ---------------------------------------------------------
    // CRITICAL: Do not use real display on Linux. Run inside Xvfb
    // to avoid popping up windows or failing in headless server environments.
    // ---------------------------------------------------------
    if (process.platform === "linux") {
      spawnArgs = ["-a", "-s", "-screen 0 1024x768x24", spawnBin, ...args];
      spawnBin = "xvfb-run";
    }

    const godotProcess = spawn(spawnBin, spawnArgs, { cwd, env });

    godotProcess.stdout.on("data", (data) => {
      output += data.toString();
    });
    godotProcess.stderr.on("data", (data) => {
      output += data.toString();
    });

    const timer = setTimeout(() => {
      godotProcess.kill();
    }, timeoutMs);

    godotProcess.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });

    godotProcess.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, output: `Process error: ${err.message}` });
    });
  });
}
