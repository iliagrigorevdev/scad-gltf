import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import child_process from "node:child_process";
import { EventEmitter } from "node:events";
import { getGodotBin, runGodotAsync } from "../src/godot-utils.js";

test("getGodotBin - Returns 'godot' if globally installed", (t) => {
  // Mock execSync to simulate a successful `godot --version` call
  t.mock.method(child_process, "execSync", (command) => {
    if (command === "godot --version") {
      return Buffer.from("4.7.2.stable");
    }
    throw new Error("Unexpected command");
  });

  const bin = getGodotBin(false);
  assert.strictEqual(bin, "godot", "Should return the global 'godot' command");
});

test("getGodotBin - Falls back to local binary path if not globally installed", (t) => {
  // Mock execSync to throw on global check
  t.mock.method(child_process, "execSync", (command) => {
    if (command === "godot --version") {
      throw new Error("Command not found");
    }
  });

  // Mock existsSync to simulate the binary is already downloaded locally
  t.mock.method(fs, "existsSync", (path) => {
    if (path.includes(".godot-bin")) return true;
    return false;
  });

  // Test across simulated platforms
  t.mock.method(os, "platform", () => "win32");
  const winBin = getGodotBin(false);
  assert.ok(winBin.endsWith("godot.exe"), "Should return Windows local path");

  t.mock.method(os, "platform", () => "darwin");
  const macBin = getGodotBin(false);
  assert.ok(macBin.endsWith("Godot"), "Should return macOS local path");

  t.mock.method(os, "platform", () => "linux");
  const linBin = getGodotBin(false);
  assert.ok(linBin.endsWith("godot"), "Should return Linux local path");
});

test("runGodotAsync - Injects xvfb-run on Linux", async (t) => {
  t.mock.method(os, "platform", () => "linux");

  // Set process platform mock (since runGodotAsync checks process.platform directly)
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: "linux" });

  // Mock getGodotBin to avoid downloading
  t.mock.method(child_process, "execSync", () => Buffer.from("4.7.2.stable"));

  // Mock spawn
  let spawnCmd = "";
  let spawnArgs = [];
  t.mock.method(child_process, "spawn", (cmd, args) => {
    spawnCmd = cmd;
    spawnArgs = args;

    // Return a dummy event emitter mimicking a child process
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    // Auto-resolve close after tick
    setTimeout(() => {
      child.stdout.emit("data", "Mock Godot Output");
      child.emit("close", 0);
    }, 10);

    return child;
  });

  try {
    const res = await runGodotAsync(["--headless"], ".", 1000);

    assert.strictEqual(
      spawnCmd,
      "xvfb-run",
      "Linux runs should be wrapped in xvfb-run",
    );
    assert.ok(
      spawnArgs.includes("--headless"),
      "Original args should be appended",
    );
    assert.strictEqual(res.code, 0, "Should resolve exit code");
    assert.ok(
      res.output.includes("Mock Godot Output"),
      "Should capture output",
    );
  } finally {
    // Restore platform
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  }
});
