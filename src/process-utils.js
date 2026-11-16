import fs from "node:fs";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";

const POLYFILL_FLAG = Symbol.for("scad_gltf.wasm_fetch_polyfilled");

/**
 * Installs a Node.js global.fetch handler for local `file://` and `.wasm` URLs
 * so OpenSCAD's Emscripten loader can read the WASM binary from disk.
 */
export function installWasmFetchPolyfill() {
  if (globalThis[POLYFILL_FLAG]) return;
  globalThis[POLYFILL_FLAG] = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = url.toString();
    if (urlStr.startsWith("file://") || urlStr.endsWith(".wasm")) {
      const normalizedPath = urlStr.startsWith("file://")
        ? fileURLToPath(urlStr)
        : urlStr;

      const buffer = fs.readFileSync(normalizedPath);
      return new Response(buffer, {
        status: 200,
        headers: { "Content-Type": "application/wasm" },
      });
    }
    return originalFetch ? originalFetch(url, options) : undefined;
  };
}

/**
 * Spawns a child process, captures combined stdout/stderr, and enforces a timeout.
 */
export function spawnWithTimeout(command, args, options = {}) {
  const {
    cwd,
    env,
    timeoutMs = 120000,
    timeoutMessage = "\n--- KILLED BY TIMEOUT ---",
    timeoutExitCode = 124,
    killSignal = "SIGKILL",
    formatError = null,
  } = options;

  return new Promise((resolve) => {
    let output = "";
    let proc;

    try {
      proc = cp.spawn(command, args, { cwd, env });
    } catch (err) {
      resolve({
        code: -1,
        output: `Initialization error: ${err.message}`,
      });
      return;
    }

    if (proc.stdout) {
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
    }
    if (proc.stderr) {
      proc.stderr.on("data", (data) => {
        output += data.toString();
      });
    }

    let isResolved = false;
    const finish = (code, finalOutput) => {
      if (isResolved) return;
      isResolved = true;
      if (timer) clearTimeout(timer);
      resolve({ code, output: finalOutput });
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (isResolved) return;
            try {
              proc.kill(killSignal);
            } catch (e) {}
            finish(timeoutExitCode, output + timeoutMessage);
          }, timeoutMs)
        : null;

    proc.on("close", (code) => {
      finish(code, output);
    });

    proc.on("error", (err) => {
      const msg = formatError
        ? formatError(err, command)
        : output + `\nProcess error: ${err.message}`;
      finish(-1, msg);
    });
  });
}
