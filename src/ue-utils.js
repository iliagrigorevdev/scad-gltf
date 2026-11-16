import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawnWithTimeout } from "./process-utils.js";

const PLATFORM_CONFIG = {
  win32: {
    editorParts: ["Engine", "Binaries", "Win64", "UnrealEditor.exe"],
    buildParts: ["Engine", "Build", "BatchFiles", "Build.bat"],
    platformName: "Win64",
  },
  darwin: {
    editorParts: ["Engine", "Binaries", "Mac", "UnrealEditor"],
    buildParts: ["Engine", "Build", "BatchFiles", "Mac", "Build.sh"],
    platformName: "Mac",
  },
  linux: {
    editorParts: ["Engine", "Binaries", "Linux", "UnrealEditor"],
    buildParts: ["Engine", "Build", "BatchFiles", "Linux", "Build.sh"],
    platformName: "Linux",
  },
};

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
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    throw new Error(
      `Unsupported platform for Unreal Engine automation: ${platform}`,
    );
  }

  const editor = path.join(ueRoot, ...config.editorParts);
  const buildScript = path.join(ueRoot, ...config.buildParts);

  if (!fs.existsSync(editor))
    throw new Error(`Unreal Editor missing at: ${editor}`);
  if (!fs.existsSync(buildScript))
    throw new Error(`Unreal Build Script missing at: ${buildScript}`);

  return { editor, buildScript, platformName: config.platformName };
}

/**
 * Compiles an Unreal Engine C++ project.
 */
export function buildUeProjectAsync(uprojectPath, timeoutMs = 240000) {
  let paths;
  try {
    paths = getUePaths();
  } catch (err) {
    return Promise.resolve({
      code: -1,
      output: `Initialization error: ${err.message}`,
    });
  }

  const projectName = path.basename(uprojectPath, ".uproject");
  const args = [
    `${projectName}Editor`,
    paths.platformName,
    "Development",
    uprojectPath,
  ];

  return spawnWithTimeout(paths.buildScript, args, {
    timeoutMs,
    timeoutMessage: "\n--- COMPILATION TIMED OUT ---",
  });
}

/**
 * Runs the Unreal Engine Editor in headless/game mode.
 */
export function runUeAsync(uprojectPath, extraArgs, timeoutMs) {
  let paths;
  try {
    paths = getUePaths();
  } catch (err) {
    return Promise.resolve({
      code: -1,
      output: `Initialization error: ${err.message}`,
    });
  }

  return spawnWithTimeout(paths.editor, [uprojectPath, ...extraArgs], {
    timeoutMs,
    timeoutMessage: "\n--- KILLED BY TIMEOUT ---",
  });
}
