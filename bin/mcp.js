#!/usr/bin/env node
import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execSync } from "child_process";
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import puppeteer from "puppeteer";
import { convertScadToGltf } from "../src/convert.js";
import { generatePrompt } from "../src/prompt.js";
import { getProjectPrompts } from "../src/project-prompts.js";
import { runGodotAsync } from "../src/godot-utils.js";
import {
  extractFilesFromMarkdown,
  writeExtractedFiles,
} from "../src/cli-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wasmPath = path.resolve(__dirname, "../src/ext/openscad.wasm");

// Polyfill fetch so the WASM loader works natively in Node.js
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
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

// Initialize MCP Server
const server = new Server(
  {
    name: "scad-mcp-server",
    version: "1.4.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Define MCP Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_project_prompt",
        description:
          "Generates the specialized system prompt and user input request for creating full procedural 3D projects (Godot, Web, Rust, or pure SCAD). This provides the syntax rules and structure required to generate the project.",
        inputSchema: {
          type: "object",
          properties: {
            project_type: {
              type: "string",
              enum: ["scad", "bevy", "wgpu", "web", "godot"],
              description:
                "The target framework or output type for the project.",
            },
            description: {
              type: "string",
              description:
                "The description of the project or object you want to design.",
            },
            options: {
              type: "object",
              description:
                "Optional feature toggles to customize the generated prompt syntax rules.",
              properties: {
                basic: {
                  type: "boolean",
                  description:
                    "Include rules for basic PBR attributes: metalness and roughness. (Default: true)",
                },
                transmission: {
                  type: "boolean",
                  description:
                    "Include rules for transparent/glass volumes. (Default: false)",
                },
                clearcoat: {
                  type: "boolean",
                  description:
                    "Include rules for clearcoat and clearcoatRoughness. (Default: false)",
                },
                sheen: {
                  type: "boolean",
                  description:
                    "Include rules for cloth/velvet sheen. (Default: false)",
                },
                emissive: {
                  type: "boolean",
                  description:
                    "Include rules for glowing materials: emissive and emissiveIntensity. (Default: true)",
                },
                specular: {
                  type: "boolean",
                  description:
                    "Include rules for specular reflections. (Default: true)",
                },
                iridescence: {
                  type: "boolean",
                  description:
                    "Include rules for thin-film interference. (Default: false)",
                },
                unlit: {
                  type: "boolean",
                  description:
                    "Include rules for unlit/shadeless materials. (Default: true)",
                },
                autoSmoothAngle: {
                  type: "boolean",
                  description:
                    "Include rules for smooth shading vertex normals via $asa. (Default: true)",
                },
                animation: {
                  type: "boolean",
                  description:
                    "Include rules for hierarchical node animations using armature() and bone(). (Default: true)",
                },
                bakeColors: {
                  type: "boolean",
                  description:
                    "Include rules for baking colors from high-poly onto low-poly meshes. (Default: false)",
                },
                bakeNormals: {
                  type: "boolean",
                  description:
                    "Include rules for baking tangent-space normal maps. (Default: false)",
                },
                bakeOrm: {
                  type: "boolean",
                  description:
                    "Include rules for baking Occlusion/Roughness/Metallic (ORM) textures. (Default: false)",
                },
                bakeUvs: {
                  type: "boolean",
                  description:
                    "Include rules for generating textureless UV coordinates and tangents. (Default: false)",
                },
                lazyUnion: {
                  type: "boolean",
                  description:
                    "Include rules for the lazy-union compiler optimization. (Default: false)",
                },
                lights: {
                  type: "boolean",
                  description:
                    "Include rules for adding scene lights. (Default: false)",
                },
                scadFiles: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Array of file paths to existing .scad files to embed as context.",
                },
              },
            },
          },
          required: ["project_type", "description"],
        },
      },
      {
        name: "render_scad_model",
        description:
          "Converts OpenSCAD code to GLTF and uses a 3D renderer to capture images from requested camera angles. Analyze these returned images to verify your design, including specific frames of your animations.",
        inputSchema: {
          type: "object",
          properties: {
            scad_code: {
              type: "string",
              description: "The raw OpenSCAD code to convert and render.",
            },
            camera_angles: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "front",
                  "back",
                  "left",
                  "right",
                  "top",
                  "bottom",
                  "isometric",
                ],
              },
              description:
                "Array of camera angles to render. Defaults to ['front', 'top', 'isometric']. Use this to inspect specific sides of your model.",
            },
            animation_time: {
              type: "number",
              description:
                "The time in seconds to evaluate the animation at (e.g. 1.5). Default is 0.0. Useful for verifying moving parts.",
            },
            animation_index: {
              type: "number",
              description:
                "The index of the animation track to play if multiple exist. Default is 0.",
            },
            return_images: {
              type: "boolean",
              description:
                "Return image renderings of the model. Set to false for text-only validation (faster). Default is true.",
            },
          },
          required: ["scad_code"],
        },
      },
      {
        name: "test_godot_project",
        description:
          "Extracts a Godot project from a Markdown format and runs it for a short duration to detect script errors, missing resources, or runtime crashes. Returns the console output logs and a visual screenshot.",
        inputSchema: {
          type: "object",
          properties: {
            project_markdown: {
              type: "string",
              description:
                "The complete markdown string containing all project files formatted with '### filepath' headers and code blocks.",
            },
            run_time: {
              type: "number",
              description:
                "Time in seconds to run the project before terminating. Default is 5.0.",
            },
            return_images: {
              type: "boolean",
              description:
                "Capture a screenshot of the project. Set to false for text-only logs. Default is true.",
            },
          },
          required: ["project_markdown"],
        },
      },
      {
        name: "compile_rust_project",
        description:
          "Extracts a Rust project from a Markdown format and compiles it to detect syntax errors, missing dependencies, or compilation failures. Returns the cargo console output logs.",
        inputSchema: {
          type: "object",
          properties: {
            project_markdown: {
              type: "string",
              description:
                "The complete markdown string containing all project files formatted with '### filepath' headers and code blocks.",
            },
          },
          required: ["project_markdown"],
        },
      },
    ],
  };
});

// Tool Handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ------------------------------------------
  // TOOL 1: get_project_prompt
  // ------------------------------------------
  if (name === "get_project_prompt") {
    try {
      const pType = args.project_type;
      const desc = args.description;
      const opts = {
        transmission: false,
        clearcoat: false,
        sheen: false,
        iridescence: false,
        ...(args.options || {}),
      };

      if (!["scad", "bevy", "wgpu", "web", "godot"].includes(pType)) {
        throw new Error(`Invalid project type: ${pType}`);
      }

      if (pType !== "scad") {
        opts.modelName = false;
      }

      const promptRules = generatePrompt(
        pType === "scad" ? desc : "the 3D assets for the project",
        opts,
      );

      const prompts = getProjectPrompts(pType);
      const systemPrompt = prompts.buildSystemPrompt(promptRules, opts);
      const userRequest = prompts.buildInputRequest
        ? prompts.buildInputRequest(desc, promptRules)
        : promptRules;

      return {
        content: [
          {
            type: "text",
            text: `=== SYSTEM PROMPT ===\n${systemPrompt}\n\n=== USER REQUEST ===\n${userRequest}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error generating project prompt: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // ------------------------------------------
  // TOOL 2: render_scad_model
  // ------------------------------------------
  if (name === "render_scad_model") {
    let browser;
    try {
      const scadCode = args.scad_code;
      const requestedAngles =
        args.camera_angles && args.camera_angles.length > 0
          ? args.camera_angles
          : ["front", "top", "isometric"];
      const animTime = args.animation_time || 0.0;
      const animIndex = args.animation_index || 0;
      const returnImages = args.return_images !== false;

      // 1. Convert SCAD to GLB ArrayBuffer
      const glbDataArray = await convertScadToGltf(scadCode, {
        wasmUrl: `file://${wasmPath}`,
      });

      if (!returnImages) {
        return {
          content: [
            {
              type: "text",
              text: `Successfully compiled SCAD without syntax errors. (Visual rendering skipped because return_images is false).`,
            },
          ],
        };
      }

      // Convert Uint8Array to base64
      const glbBase64 = Buffer.from(glbDataArray).toString("base64");

      // 2. Launch Puppeteer Headless to Render using Three.js
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      const page = await browser.newPage();

      // Provide an importmap so Puppeteer can load three.js modules cleanly
      const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>body{margin:0; overflow:hidden;}</style>
          <script type="importmap">
            {
              "imports": {
                "three": "https://unpkg.com/three@0.186.1/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.186.1/examples/jsm/"
              }
            }
          </script>
        </head>
        <body></body>
      </html>
      `;
      await page.goto(`data:text/html,${encodeURIComponent(html)}`);

      // 3. Inject rendering logic and return base64 snapshots
      const snapshots = await page.evaluate(
        async (base64Glb, angles, targetAnimTime, targetAnimIndex) => {
          const THREE = await import("three");
          const { GLTFLoader } =
            await import("three/addons/loaders/GLTFLoader.js");
          const { RoomEnvironment } =
            await import("three/addons/environments/RoomEnvironment.js");

          const width = 512;
          const height = 512;
          const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            preserveDrawingBuffer: true,
          });
          renderer.setSize(width, height);
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          document.body.appendChild(renderer.domElement);

          const scene = new THREE.Scene();
          scene.background = new THREE.Color(0x222222);

          const pmremGenerator = new THREE.PMREMGenerator(renderer);
          scene.environment = pmremGenerator.fromScene(
            new RoomEnvironment(),
            0.04,
          ).texture;

          // Soft global ambient light
          const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
          scene.add(ambientLight);

          // Hemisphere light for natural sky/ground illumination
          const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4);
          hemiLight.position.set(0, 20, 0);
          scene.add(hemiLight);

          const camera = new THREE.PerspectiveCamera(
            45,
            width / height,
            0.1,
            1000,
          );
          scene.add(camera);

          // 3-Point Lighting Rig attached to camera for consistent illumination from all angles

          // Key Light (Main illumination from top-right)
          const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
          keyLight.position.set(10, 10, 5);
          camera.add(keyLight);
          camera.add(keyLight.target);
          keyLight.target.position.set(0, 0, -5);

          // Fill Light (Softer light from bottom-left to reduce shadows)
          const fillLight = new THREE.DirectionalLight(0xd0e0ff, 0.6);
          fillLight.position.set(-10, -2, 5);
          camera.add(fillLight);
          camera.add(fillLight.target);
          fillLight.target.position.set(0, 0, -5);

          // Rim Light (Highlight edges from behind the object)
          const rimLight = new THREE.DirectionalLight(0xffeedd, 0.8);
          rimLight.position.set(0, 10, -15);
          camera.add(rimLight);
          camera.add(rimLight.target);
          rimLight.target.position.set(0, 0, -5);

          // Load the model from base64
          const loader = new GLTFLoader();
          const dataUrl = "data:application/octet-stream;base64," + base64Glb;
          const gltf = await loader.loadAsync(dataUrl);
          scene.add(gltf.scene);

          // Detect scene lights to match editor behavior
          let sceneHasLights = false;
          let maxDir = 0;
          let maxPt = 0;

          gltf.scene.traverse((child) => {
            if (child.isMesh) {
              child.frustumCulled = false;
            }
            if (child.isLight) {
              sceneHasLights = true;
              child.castShadow = true;
              if (child.isDirectionalLight) {
                maxDir = Math.max(maxDir, child.intensity);
              } else {
                maxPt = Math.max(maxPt, child.intensity);
              }
            }
          });

          if (sceneHasLights) {
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;

            gltf.scene.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });

            let optimalExposure = 1.0;
            const expDir = maxDir > 0 ? 3.0 / maxDir : 1.0;
            const expPt = maxPt > 0 ? 3000.0 / maxPt : 1.0;

            if (maxDir > 0 && maxPt > 0)
              optimalExposure = Math.min(expDir, expPt);
            else if (maxDir > 0) optimalExposure = expDir;
            else if (maxPt > 0) optimalExposure = expPt;

            optimalExposure = Math.max(0.00001, Math.min(optimalExposure, 5.0));

            renderer.toneMappingExposure = optimalExposure;
            scene.environmentIntensity = 0.0;

            ambientLight.visible = false;
            hemiLight.visible = false;
            keyLight.visible = false;
            fillLight.visible = false;
            rimLight.visible = false;
          }

          // --- Apply Animation State if requested ---
          let appliedAnim = false;
          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(gltf.scene);
            // Clamp index to available animations
            const clipIndex = Math.min(
              Math.max(targetAnimIndex, 0),
              gltf.animations.length - 1,
            );
            const clip = gltf.animations[clipIndex];

            if (clip) {
              const action = mixer.clipAction(clip);
              action.play();
              // Advance the mixer exactly to the requested time.
              // If targetAnimTime > duration, modulo it so it loops naturally like a real animation.
              const duration = clip.duration;
              const finalTime = duration > 0 ? targetAnimTime % duration : 0;

              mixer.setTime(finalTime);
              appliedAnim = true;
            }
          }

          // Wait for matrices to update properly after animation applied
          scene.updateMatrixWorld(true);

          // Calculate bounding box to find initial anchor center and scale
          const box = new THREE.Box3().setFromObject(gltf.scene);
          if (box.isEmpty()) {
            box.setFromCenterAndSize(
              new THREE.Vector3(0, 0, 0),
              new THREE.Vector3(1, 1, 1),
            );
          }
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const initialDim = Math.max(size.x, size.y, size.z) || 10;

          // Extract all world-space vertices
          const vertices = [];
          const v3 = new THREE.Vector3();
          gltf.scene.traverse((child) => {
            if (
              child.isMesh &&
              child.geometry &&
              child.geometry.attributes.position
            ) {
              const pos = child.geometry.attributes.position;
              const matrix = child.matrixWorld;
              for (let i = 0; i < pos.count; i++) {
                v3.fromBufferAttribute(pos, i).applyMatrix4(matrix);
                vertices.push(v3.x, v3.y, v3.z);
              }
            }
          });

          if (vertices.length === 0) {
            vertices.push(center.x, center.y, center.z);
          }

          // Dynamically scale shadow biases and camera bounds based on actual model size
          const shadowCamSize = initialDim * 1.5;
          const shadowScale = initialDim / 10.0;

          if (sceneHasLights) {
            gltf.scene.traverse((child) => {
              if (child.isLight && child.shadow) {
                child.shadow.bias = -0.0005 * shadowScale;
                child.shadow.normalBias = 0.02 * shadowScale;

                if (child.isDirectionalLight) {
                  child.shadow.camera.left = -shadowCamSize;
                  child.shadow.camera.right = shadowCamSize;
                  child.shadow.camera.top = shadowCamSize;
                  child.shadow.camera.bottom = -shadowCamSize;
                  child.shadow.camera.near = Math.max(0.01, initialDim * 0.01);
                  child.shadow.camera.far = shadowCamSize * 4;
                  child.shadow.camera.updateProjectionMatrix();
                  child.shadow.mapSize.width = 2048;
                  child.shadow.mapSize.height = 2048;
                } else if (child.isPointLight || child.isSpotLight) {
                  child.shadow.camera.near = Math.max(0.01, initialDim * 0.01);
                  child.shadow.camera.far = shadowCamSize * 4;
                  child.shadow.camera.updateProjectionMatrix();
                }
              }
            });
          }

          const fovY = (camera.fov * Math.PI) / 180;
          const tanY = Math.tan(fovY / 2);
          const tanX = tanY * camera.aspect;

          const results = [];
          for (const angle of angles) {
            const dir = new THREE.Vector3();
            switch (angle.toLowerCase()) {
              case "front":
                dir.set(0, 0, 1);
                break;
              case "back":
                dir.set(0, 0, -1);
                break;
              case "left":
                dir.set(-1, 0, 0);
                break;
              case "right":
                dir.set(1, 0, 0);
                break;
              case "top":
                dir.set(0, 1, 0);
                break;
              case "bottom":
                dir.set(0, -1, 0);
                break;
              case "isometric":
              default:
                dir.set(1, 1, 1).normalize();
                break;
            }

            let viewCenter = center.clone();
            let distance = initialDim * 2.5;

            // Iterate to converge perspective NDC screen bounds to exact center and margin
            for (let iter = 0; iter < 5; iter++) {
              camera.near = Math.max(0.01, initialDim * 0.01);
              camera.far = Math.max(1000, distance * 10);
              camera.updateProjectionMatrix();

              camera.position
                .copy(viewCenter)
                .add(dir.clone().multiplyScalar(distance));
              camera.lookAt(viewCenter);
              camera.updateMatrixWorld();
              camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

              const pvMatrix = new THREE.Matrix4().multiplyMatrices(
                camera.projectionMatrix,
                camera.matrixWorldInverse,
              );
              const pme = pvMatrix.elements;

              let minNdcX = Infinity,
                maxNdcX = -Infinity;
              let minNdcY = Infinity,
                maxNdcY = -Infinity;

              for (let i = 0; i < vertices.length; i += 3) {
                const x = vertices[i];
                const y = vertices[i + 1];
                const z = vertices[i + 2];

                const nx = x * pme[0] + y * pme[4] + z * pme[8] + pme[12];
                const ny = x * pme[1] + y * pme[5] + z * pme[9] + pme[13];
                const nw = x * pme[3] + y * pme[7] + z * pme[11] + pme[15];

                if (nw > 0) {
                  const ndcX = nx / nw;
                  const ndcY = ny / nw;
                  if (ndcX < minNdcX) minNdcX = ndcX;
                  if (ndcX > maxNdcX) maxNdcX = ndcX;
                  if (ndcY < minNdcY) minNdcY = ndcY;
                  if (ndcY > maxNdcY) maxNdcY = ndcY;
                }
              }

              if (minNdcX === Infinity) break;

              const midNdcX = (minNdcX + maxNdcX) / 2;
              const midNdcY = (minNdcY + maxNdcY) / 2;
              const spanX = (maxNdcX - minNdcX) / 2;
              const spanY = (maxNdcY - minNdcY) / 2;

              const worldShift = new THREE.Vector3(
                midNdcX * distance * tanX,
                midNdcY * distance * tanY,
                0,
              ).applyQuaternion(camera.quaternion);

              viewCenter.add(worldShift);
              const maxSpan = Math.max(spanX, spanY);
              distance = Math.max(distance * maxSpan * 1.08, camera.near + 0.1);
            }

            camera.near = Math.max(0.01, initialDim * 0.01);
            camera.far = Math.max(1000, distance * 10);
            camera.updateProjectionMatrix();

            // Final render with converged camera setup
            camera.position
              .copy(viewCenter)
              .add(dir.clone().multiplyScalar(distance));
            camera.lookAt(viewCenter);
            camera.updateMatrixWorld();

            renderer.render(scene, camera);

            const b64 = renderer.domElement
              .toDataURL("image/png")
              .split(",")[1];
            results.push({ name: angle, data: b64, appliedAnim });
          }

          return results;
        },
        glbBase64,
        requestedAngles,
        animTime,
        animIndex,
      );

      // 4. Close browser
      await browser.close();

      // 5. Construct the MCP Response
      const appliedAnimStr = snapshots[0].appliedAnim
        ? ` at animation time ${animTime}s (Track ${animIndex})`
        : ` (Static Model)`;

      const content = [
        {
          type: "text",
          text: `Successfully compiled SCAD and rendered ${snapshots.length} camera angle(s)${appliedAnimStr}. Please analyze these visual results to determine your next adjustments.`,
        },
      ];

      for (const snap of snapshots) {
        const angleName =
          snap.name.charAt(0).toUpperCase() + snap.name.slice(1);
        content.push({
          type: "text",
          text: `${angleName} View:`,
        });
        content.push({
          type: "image",
          data: snap.data,
          mimeType: "image/png",
        });
      }

      return { content };
    } catch (error) {
      if (browser) await browser.close();
      return {
        content: [
          {
            type: "text",
            text: `Failed to compile or render OpenSCAD model. Error: ${error.message}\nIf this is a syntax error, review your OpenSCAD code and try again.`,
          },
        ],
        isError: true,
      };
    }
  }

  // ------------------------------------------
  // TOOL 3: test_godot_project
  // ------------------------------------------
  if (name === "test_godot_project") {
    let cleanupDir = null;
    try {
      let projectDir = null;
      const runTime = args.run_time || 5.0;
      const markdown = args.project_markdown;

      if (!markdown) {
        return {
          content: [
            {
              type: "text",
              text: `Error: 'project_markdown' is required.`,
            },
          ],
          isError: true,
        };
      }

      // Create a unique temporary directory
      const tempBase = fs.mkdtempSync(
        path.join(os.tmpdir(), "scad-godot-test-"),
      );
      cleanupDir = tempBase;

      const files = extractFilesFromMarkdown(markdown);
      if (Object.keys(files).length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: No files could be extracted from the Markdown text. Make sure you use '### filepath' headers followed by code blocks.`,
            },
          ],
          isError: true,
        };
      }

      writeExtractedFiles(files, tempBase);

      // Find the generated folder containing project.godot
      const items = fs.readdirSync(tempBase);
      for (const item of items) {
        const itemPath = path.join(tempBase, item);
        if (
          fs.statSync(itemPath).isDirectory() &&
          fs.existsSync(path.join(itemPath, "project.godot"))
        ) {
          projectDir = itemPath;
          break;
        }
      }

      if (!projectDir) {
        return {
          content: [
            {
              type: "text",
              text: `Error: The extracted Markdown output did not contain a valid Godot project. A valid Godot project requires a 'project.godot' file placed inside a root directory block.`,
            },
          ],
          isError: true,
        };
      }

      const returnImages = args.return_images !== false;

      // 1. Headless Editor Import Step (Wait for Godot to import .scad and other assets)
      const importResult = await runGodotAsync(
        ["--headless", "--editor", "--quit", "--path", projectDir],
        projectDir,
        30000,
      );

      const projectGodotPath = path.join(projectDir, "project.godot");
      const originalProjectGodot = fs.readFileSync(projectGodotPath, "utf8");
      let playResult;

      // 1.5 Prepare MCP Runner Autoload Script (ALWAYS inject to ensure a clean exit)
      const snapTime = Math.max(0.5, runTime - 0.5);

      let runnerScript = `extends Node\nfunc _ready():\n\tprint("[MCP] Autoload ready. Waiting ${snapTime} seconds...")\n\tawait get_tree().create_timer(${snapTime}).timeout\n`;

      // If returning images, inject the screenshot capture logic
      if (returnImages) {
        runnerScript += `\tvar ds = DisplayServer.get_name()
\tprint("[MCP] DisplayServer is: ", ds)
\tif ds != "headless":
\t\tawait RenderingServer.frame_post_draw
\t\tvar tex = get_viewport().get_texture()
\t\tif tex != null:
\t\t\tvar img = tex.get_image()
\t\t\tif img != null and not img.is_empty():
\t\t\t\tvar path = ProjectSettings.globalize_path("res://screenshot_mcp.png")
\t\t\t\tvar err = img.save_png(path)
\t\t\t\tprint("[MCP] Save PNG to ", path, " returned error code: ", err)
\t\t\telse:
\t\t\t\tprint("[MCP] Error: Image is null or empty.")
\t\telse:
\t\t\tprint("[MCP] Error: Viewport texture is null.")\n`;
      }

      // Always force Godot to quit gracefully from the inside
      runnerScript += `\tget_tree().quit()\n`;

      fs.writeFileSync(path.join(projectDir, "mcp_runner.gd"), runnerScript);

      let tempProjectGodot = originalProjectGodot;
      if (tempProjectGodot.includes("[autoload]")) {
        tempProjectGodot = tempProjectGodot.replace(
          "[autoload]",
          '[autoload]\nMCPRunner="*res://mcp_runner.gd"',
        );
      } else {
        tempProjectGodot += `\n[autoload]\nMCPRunner="*res://mcp_runner.gd"\n`;
      }
      fs.writeFileSync(projectGodotPath, tempProjectGodot, "utf8");

      // 2. Run Project Step
      // Give the Node wrapper a +5000ms buffer so the internal Godot timer always finishes first
      const safeNodeTimeout = runTime * 1000 + 5000;

      if (returnImages) {
        // Windowed first to get the screenshot
        let playArgs = [
          "--windowed",
          "--audio-driver",
          "Dummy",
          "--path",
          projectDir,
        ];

        playResult = await runGodotAsync(playArgs, projectDir, safeNodeTimeout);
        let windowedOutput = playResult.output;

        // Fallback if windowed mode fails due to display server issues
        if (
          playResult.code !== 0 &&
          (playResult.output.includes("Unable to create DisplayServer") ||
            playResult.output.includes("Display driver"))
        ) {
          playResult = await runGodotAsync(
            ["--headless", "--audio-driver", "Dummy", "--path", projectDir],
            projectDir,
            safeNodeTimeout,
          );
          playResult.output =
            "--- WINDOWED LAUNCH FAILED (Display Error) ---\n" +
            windowedOutput.trim() +
            "\n\n--- FALLBACK HEADLESS LAUNCH ---\n" +
            playResult.output;
        }
      } else {
        // Text-only mode: Run headless immediately
        playResult = await runGodotAsync(
          ["--headless", "--audio-driver", "Dummy", "--path", projectDir],
          projectDir,
          safeNodeTimeout,
        );
      }

      // 3. Cleanup Autoloads
      fs.writeFileSync(projectGodotPath, originalProjectGodot, "utf8");
      if (fs.existsSync(path.join(projectDir, "mcp_runner.gd"))) {
        fs.unlinkSync(path.join(projectDir, "mcp_runner.gd"));
      }

      // 4. Read Screenshot
      let screenshotBase64 = null;
      if (returnImages) {
        const screenshotPath = path.join(projectDir, "screenshot_mcp.png");
        if (fs.existsSync(screenshotPath)) {
          screenshotBase64 = fs.readFileSync(screenshotPath).toString("base64");
          fs.unlinkSync(screenshotPath); // Remove the image after reading
        }
      }

      // Format Text Output
      const fullOutput =
        "--- IMPORT PHASE ---\n" +
        importResult.output +
        "\n\n--- PLAY PHASE ---\n" +
        playResult.output;

      const errorLines = fullOutput
        .split("\n")
        .filter(
          (line) =>
            line.includes("ERROR:") ||
            line.includes("SCRIPT ERROR:") ||
            line.includes("Parse Error:"),
        );

      let responseText = `Godot Import Exit Code: ${importResult.code}\nGodot Play Exit Code: ${playResult.code}\n\n`;

      if (errorLines.length > 0) {
        responseText +=
          "🚨 Errors detected in Godot output:\n" +
          errorLines.join("\n") +
          "\n\n";
      } else {
        responseText +=
          "✅ No obvious errors detected in the Godot output log.\n\n";
      }

      const maxOutputLen = 4000;
      let truncatedOutput = fullOutput;
      if (fullOutput.length > maxOutputLen) {
        truncatedOutput = fullOutput.substring(
          fullOutput.length - maxOutputLen,
        );
        responseText += `...[truncated]...\n`;
      }
      responseText += truncatedOutput;

      // 5. Construct Final MCP Response
      const responseContent = [
        {
          type: "text",
          text: responseText,
        },
      ];

      // If screenshot was captured successfully, attach it
      if (returnImages) {
        if (screenshotBase64) {
          responseContent.push({
            type: "image",
            data: screenshotBase64,
            mimeType: "image/png",
          });
        } else {
          responseContent.push({
            type: "text",
            text: "⚠️ A visual screenshot could not be captured (Godot may have crashed immediately or rendering failed).",
          });
        }
      }

      return {
        content: responseContent,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error testing Godot project: ${error.message}`,
          },
        ],
        isError: true,
      };
    } finally {
      // Clean up temporary directory if we created one
      if (cleanupDir && fs.existsSync(cleanupDir)) {
        try {
          fs.rmSync(cleanupDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`Failed to clean up temp dir: ${cleanupDir}`, e);
        }
      }
    }
  }

  // ------------------------------------------
  // TOOL 4: compile_rust_project
  // ------------------------------------------
  if (name === "compile_rust_project") {
    let cleanupDir = null;
    try {
      let projectDir = null;
      const markdown = args.project_markdown;

      if (!markdown) {
        return {
          content: [
            {
              type: "text",
              text: `Error: 'project_markdown' is required.`,
            },
          ],
          isError: true,
        };
      }

      // Create a unique temporary directory
      const tempBase = fs.mkdtempSync(
        path.join(os.tmpdir(), "scad-rust-compile-"),
      );
      cleanupDir = tempBase;

      const files = extractFilesFromMarkdown(markdown);
      if (Object.keys(files).length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: No files could be extracted from the Markdown text. Make sure you use '### filepath' headers followed by code blocks.`,
            },
          ],
          isError: true,
        };
      }

      writeExtractedFiles(files, tempBase);

      // Find the generated folder containing Cargo.toml
      const items = fs.readdirSync(tempBase);
      for (const item of items) {
        const itemPath = path.join(tempBase, item);
        if (
          fs.statSync(itemPath).isDirectory() &&
          fs.existsSync(path.join(itemPath, "Cargo.toml"))
        ) {
          projectDir = itemPath;
          break;
        }
      }

      if (!projectDir) {
        return {
          content: [
            {
              type: "text",
              text: `Error: The extracted Markdown output did not contain a valid Rust project. A valid Rust project requires a 'Cargo.toml' file placed inside a root directory block.`,
            },
          ],
          isError: true,
        };
      }

      const runCargoAsync = () =>
        new Promise((resolve) => {
          const cargoCmd = process.platform === "win32" ? "cargo.exe" : "cargo";
          const child = spawn(cargoCmd, ["check"], {
            cwd: projectDir,
          });

          let output = "";
          if (child.stdout)
            child.stdout.on("data", (data) => (output += data.toString()));
          if (child.stderr)
            child.stderr.on("data", (data) => (output += data.toString()));

          child.on("error", (error) => {
            output += `\nError launching cargo: ${error.message}`;
            resolve({ code: 1, output });
          });

          child.on("close", (code) => {
            resolve({ code, output });
          });

          // 2-minute timeout for Rust compilation (can be slow as dependencies download)
          setTimeout(() => {
            try {
              child.kill();
            } catch (e) {}
            output += "\n--- COMPILATION TIMED OUT (2 minutes) ---";
            resolve({ code: 1, output });
          }, 120000);
        });

      const compileResult = await runCargoAsync();
      const compileOutput = compileResult.output;
      const compileCode = compileResult.code;

      const fullOutput = "--- CARGO CHECK ---\n" + compileOutput.trim();

      const errorLines = fullOutput
        .split("\n")
        .filter(
          (line) =>
            line.includes("error:") ||
            line.includes("error[E") ||
            line.includes("could not compile"),
        );

      let responseText = `Cargo Check Exit Code: ${compileCode}\n\n`;

      if (compileCode !== 0 || errorLines.length > 0) {
        responseText +=
          "🚨 Errors detected in Cargo output:\n" +
          errorLines.join("\n") +
          "\n\n";
      } else {
        responseText +=
          "✅ No obvious errors detected. Project checked successfully.\n\n";
      }

      const maxOutputLen = 4000;
      let truncatedOutput = fullOutput;
      if (fullOutput.length > maxOutputLen) {
        truncatedOutput = fullOutput.substring(
          fullOutput.length - maxOutputLen,
        );
        responseText += `...[truncated]...\n`;
      }
      responseText += truncatedOutput;

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error compiling Rust project: ${error.message}`,
          },
        ],
        isError: true,
      };
    } finally {
      if (cleanupDir && fs.existsSync(cleanupDir)) {
        try {
          fs.rmSync(cleanupDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`Failed to clean up temp dir: ${cleanupDir}`, e);
        }
      }
    }
  }

  throw new Error(`Tool not found: ${name}`);
});

// Run Server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 scad-gltf mcp server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
