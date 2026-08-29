#!/usr/bin/env node
import fs from "fs";
import path from "path";
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
    version: "1.2.0",
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
        name: "get_scad_prompt",
        description:
          "Generates the specialized instruction prompt containing the required syntax rules for PBR, Animations, and Texture Baking in this custom OpenSCAD environment.",
        inputSchema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "The description of the object you want to design.",
            },
          },
          required: ["description"],
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
          },
          required: ["scad_code"],
        },
      },
    ],
  };
});

// Tool Handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ------------------------------------------
  // TOOL 1: get_scad_prompt
  // ------------------------------------------
  if (name === "get_scad_prompt") {
    try {
      const promptText = generatePrompt(args.description, {});
      return {
        content: [
          {
            type: "text",
            text: promptText,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `Error generating prompt: ${error.message}` },
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

      // 1. Convert SCAD to GLB ArrayBuffer
      const glbDataArray = await convertScadToGltf(scadCode, {
        wasmUrl: `file://${wasmPath}`,
      });

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
                "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
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

          const width = 800;
          const height = 600;
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
          scene.add(new THREE.AmbientLight(0x404040, 0.5));

          const camera = new THREE.PerspectiveCamera(
            45,
            width / height,
            0.1,
            1000,
          );
          scene.add(camera);

          const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
          keyLight.position.set(10, 10, 10);
          camera.add(keyLight);

          const fillLight = new THREE.DirectionalLight(0xd0e0ff, 0.6);
          fillLight.position.set(-10, 5, -5);
          camera.add(fillLight);

          // Load the model from base64
          const loader = new GLTFLoader();
          const dataUrl = "data:application/octet-stream;base64," + base64Glb;
          const gltf = await loader.loadAsync(dataUrl);
          scene.add(gltf.scene);

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

          // Calculate bounding box and fit camera
          // Note: Bounding box is calculated AFTER animation is applied,
          // so it accounts for moved/extended geometry!
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 10;
          const distance = maxDim * 2.5;

          const results = [];
          for (const angle of angles) {
            let pos;
            switch (angle.toLowerCase()) {
              case "front":
                pos = [center.x, center.y, center.z + distance];
                break;
              case "back":
                pos = [center.x, center.y, center.z - distance];
                break;
              case "left":
                pos = [center.x - distance, center.y, center.z];
                break;
              case "right":
                pos = [center.x + distance, center.y, center.z];
                break;
              case "top":
                pos = [center.x, center.y + distance, center.z];
                break;
              case "bottom":
                pos = [center.x, center.y - distance, center.z];
                break;
              case "isometric":
              default:
                pos = [
                  center.x + distance,
                  center.y + distance,
                  center.z + distance,
                ];
                break;
            }

            camera.position.set(...pos);
            camera.lookAt(center);

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

  throw new Error(`Tool not found: ${name}`);
});

// Run Server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 SCAD MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
