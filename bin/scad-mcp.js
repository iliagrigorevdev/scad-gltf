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
    version: "1.0.0",
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
          "Converts OpenSCAD code to GLTF and uses a 3D renderer to capture images from different camera angles (Front, Top, Isometric). Analyize these returned images to verify your design and make the next move.",
        inputSchema: {
          type: "object",
          properties: {
            scad_code: {
              type: "string",
              description: "The raw OpenSCAD code to convert and render.",
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
      const snapshots = await page.evaluate(async (base64Glb) => {
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

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(10, 10, 10);
        scene.add(dirLight);
        scene.add(new THREE.AmbientLight(0x404040, 0.5));

        const camera = new THREE.PerspectiveCamera(
          45,
          width / height,
          0.1,
          1000,
        );

        // Load the model from base64
        const loader = new GLTFLoader();
        const dataUrl = "data:application/octet-stream;base64," + base64Glb;
        const gltf = await loader.loadAsync(dataUrl);
        scene.add(gltf.scene);

        // Calculate bounding box and fit camera
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        const distance = maxDim * 2;

        const angles = [
          {
            name: "Front",
            position: [center.x, center.y, center.z + distance],
          },
          {
            name: "Isometric",
            position: [
              center.x + distance,
              center.y + distance,
              center.z + distance,
            ],
          },
          { name: "Top", position: [center.x, center.y + distance, center.z] },
        ];

        const results = [];
        for (const angle of angles) {
          camera.position.set(...angle.position);
          camera.lookAt(center);

          // Move light to roughly match camera for better visibility
          dirLight.position.set(
            camera.position.x,
            camera.position.y + 10,
            camera.position.z,
          );
          dirLight.lookAt(center);

          renderer.render(scene, camera);

          const b64 = renderer.domElement.toDataURL("image/png").split(",")[1];
          results.push({ name: angle.name, data: b64 });
        }

        return results;
      }, glbBase64);

      // 4. Close browser
      await browser.close();

      // 5. Construct the MCP Response
      const content = [
        {
          type: "text",
          text: `Successfully compiled SCAD and rendered ${snapshots.length} camera angles. Please analyze these visual results to determine your next adjustments.`,
        },
      ];

      for (const snap of snapshots) {
        content.push({
          type: "text",
          text: `${snap.name} View:`,
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
