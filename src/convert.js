import OpenScad from "./openscad.js";

// Helper to resolve relative paths for the virtual file system
function resolvePath(base, relative) {
  const stack = base.split("/").filter(Boolean);
  const parts = relative.split("/").filter(Boolean);
  for (const part of parts) {
    if (part === "..") stack.pop();
    else if (part !== ".") stack.push(part);
  }
  return "/" + stack.join("/");
}

// Helper to recursively create directories in the virtual file system
function mkdirp(fs, pathStr) {
  const parts = pathStr.split("/").filter(Boolean);
  let curr = "";
  for (let i = 0; i < parts.length - 1; i++) {
    curr += "/" + parts[i];
    try {
      fs.mkdir(curr);
    } catch (e) {
      // Ignore if directory already exists
    }
  }
}

/**
 * Converts SCAD code to a GLTF/GLB Uint8Array using the OpenSCAD WASM compiler.
 * @param {string} scadCode - The OpenSCAD code to compile.
 * @param {Object} [options={}] - Options object.
 * @param {string} [options.wasmUrl] - Optional URL to the openscad.wasm file, useful for bundlers or extensions.
 * @param {boolean} [options.binary=true] - Whether to compile to a binary GLB (true) or normal GLTF (false).
 * @param {boolean} [options.lazyUnion=false] - Whether to apply the lazy union optimization (--enable=lazy-union).
 * @param {Object} [options.additionalFiles={}] - Key-value pair of relative file paths to their string contents for include/use resolution.
 * @returns {Promise<Uint8Array>} The resulting GLB/GLTF data.
 */
export async function convertScadToGltf(scadCode, options = {}) {
  const wasmUrl = options.wasmUrl;
  const isBinary = options.binary !== undefined ? options.binary : true;
  const lazyUnion = options.lazyUnion !== undefined ? options.lazyUnion : false;

  // Initialize a NEW instance every time because callMain terminates the WASM environment
  const instance = await OpenScad({
    noInitialRun: true,
    locateFile: (path) => {
      if (wasmUrl && path.endsWith("openscad.wasm")) {
        return wasmUrl;
      }
      return path;
    },
  });

  const WORK_DIR = "/workdir";
  try {
    instance.FS.mkdir(WORK_DIR);
  } catch (e) {}

  // Write any additional files (dependencies) to the virtual file system
  if (options.additionalFiles) {
    for (const [relPath, content] of Object.entries(options.additionalFiles)) {
      // Normalize path separators in case of Windows paths
      const normalizedRel = relPath.replace(/\\/g, "/");
      const absPath = resolvePath(WORK_DIR, normalizedRel);
      mkdirp(instance.FS, absPath);
      instance.FS.writeFile(absPath, content);
    }
  }

  const outputExt = isBinary ? "glb" : "gltf";
  const inputName = `${WORK_DIR}/input.scad`;
  const outputName = `${WORK_DIR}/output.${outputExt}`;

  // Write the input SCAD code
  instance.FS.writeFile(inputName, scadCode);

  // Compile to GLTF/GLB
  const args = [inputName, "-o", outputName];
  if (lazyUnion) {
    args.push("--enable=lazy-union");
  }

  instance.callMain(args);

  // Read the resulting byte array back from the virtual file system
  const outputArray = instance.FS.readFile(outputName);
  return outputArray;
}
