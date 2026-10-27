import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import cp from "node:child_process";

/**
 * Resolves the paths for the Unreal Editor and Build tool based on the host OS.
 * Requires the UE_ROOT environment variable to be set.
 */
export function getUePaths() {
  const ueRoot = process.env.UE_ROOT;
  if (!ueRoot || !fs.existsSync(ueRoot)) {
    throw new Error(
      "UE_ROOT environment variable is not set or points to an invalid directory. " +
        "Please set it to your Unreal Engine installation folder.",
    );
  }

  const platform = os.platform();
  let editor, buildScript, platformName;

  if (platform === "win32") {
    editor = path.join(ueRoot, "Engine", "Binaries", "Win64", "UnrealEditor.exe");
    buildScript = path.join(ueRoot, "Engine", "Build", "BatchFiles", "Build.bat");
    platformName = "Win64";
  } else if (platform === "darwin") {
    editor = path.join(ueRoot, "Engine", "Binaries", "Mac", "UnrealEditor");
    buildScript = path.join(ueRoot, "Engine", "Build", "BatchFiles", "Mac", "Build.sh");
    platformName = "Mac";
  } else if (platform === "linux") {
    editor = path.join(ueRoot, "Engine", "Binaries", "Linux", "UnrealEditor");
    buildScript = path.join(ueRoot, "Engine", "Build", "BatchFiles", "Linux", "Build.sh");
    platformName = "Linux";
  } else {
    throw new Error(`Unsupported platform for Unreal Engine automation: ${platform}`);
  }

  if (!fs.existsSync(editor)) throw new Error(`Unreal Editor missing at: ${editor}`);
  if (!fs.existsSync(buildScript)) throw new Error(`Unreal Build Script missing at: ${buildScript}`);

  return { editor, buildScript, platformName };
}

/**
 * Compiles an Unreal Engine C++ project.
 */
export function buildUeProjectAsync(uprojectPath, timeoutMs = 240000) {
  return new Promise((resolve) => {
    let output = "";
    try {
      const { buildScript, platformName } = getUePaths();
      const projectName = path.basename(uprojectPath, ".uproject");

      const args = [
        `${projectName}Editor`,
        platformName,
        "Development",
        uprojectPath,
      ];

      const proc = cp.spawn(buildScript, args);

      proc.stdout.on("data", (data) => (output += data.toString()));
      proc.stderr.on("data", (data) => (output += data.toString()));

      let isResolved = false;
      const timer = setTimeout(() => {
        if (isResolved) return;
        isResolved = true;
        try {
          proc.kill("SIGKILL");
        } catch (e) {}
        resolve({ code: 124, output: output + "\n--- COMPILATION TIMED OUT ---" });
      }, timeoutMs);

      proc.on("close", (code) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timer);
        resolve({ code, output });
      });

      proc.on("error", (err) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timer);
        resolve({ code: -1, output: output + `\nProcess error: ${err.message}` });
      });
    } catch (err) {
      resolve({ code: -1, output: `Initialization error: ${err.message}` });
    }
  });
}

/**
 * Runs the Unreal Engine Editor in headless/game mode.
 */
export function runUeAsync(uprojectPath, extraArgs, timeoutMs) {
  return new Promise((resolve) => {
    let output = "";
    try {
      const { editor } = getUePaths();
      const args = [uprojectPath, ...extraArgs];

      const proc = cp.spawn(editor, args);

      proc.stdout.on("data", (data) => (output += data.toString()));
      proc.stderr.on("data", (data) => (output += data.toString()));

      let isResolved = false;
      const timer = setTimeout(() => {
        if (isResolved) return;
        isResolved = true;
        try {
          proc.kill("SIGKILL");
        } catch (e) {}
        resolve({ code: 124, output: output + "\n--- KILLED BY TIMEOUT ---" });
      }, timeoutMs);

      proc.on("close", (code) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timer);
        resolve({ code, output });
      });

      proc.on("error", (err) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timer);
        resolve({ code: -1, output: output + `\nProcess error: ${err.message}` });
      });
    } catch (err) {
      resolve({ code: -1, output: `Initialization error: ${err.message}` });
    }
  });
}
