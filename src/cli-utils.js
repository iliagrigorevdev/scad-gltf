import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import os from "node:os";
import readline from "node:readline";
import { execSync, spawn } from "node:child_process";
import zlib from "node:zlib";
import { getGodotBin } from "./godot-utils.js";

const __filename = fs.realpathSync(url.fileURLToPath(import.meta.url));
const __dirname = path.dirname(__filename);

export function hasStdinData() {
  try {
    const stat = fs.fstatSync(0); // 0 is the file descriptor for STDIN
    return stat.isFIFO() || stat.isFile();
  } catch (e) {
    return false;
  }
}

export function parseTaskAndOptions(startIndex = 2) {
  let task = "";
  let optionsStr = "{}";

  if (hasStdinData()) {
    try {
      task = fs.readFileSync(0, "utf-8").trim();
    } catch (e) {
      console.error("Error reading from STDIN:", e);
    }
    if (process.argv[startIndex]) optionsStr = process.argv[startIndex];
  } else {
    if (process.argv[startIndex]) task = process.argv[startIndex];
    if (process.argv[startIndex + 1]) optionsStr = process.argv[startIndex + 1];
  }
  return { task, optionsStr };
}

export async function writeToClipboard(text) {
  const clipboardy = (await import("clipboardy")).default;
  await clipboardy.write(text);
}

export function waitForEnter(message) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      try {
        const tty = process.platform === "win32" ? "CONIN$" : "/dev/tty";
        const fd = fs.openSync(tty, "rs");
        process.stdout.write(message);
        const buf = Buffer.alloc(1);
        fs.readSync(fd, buf, 0, 1, null);
        fs.closeSync(fd);
        console.log();
        resolve();
        return;
      } catch (e) {
        console.log(
          message +
            " (Auto-continuing due to non-interactive terminal environment)",
        );
        resolve();
        return;
      }
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

// Helper to ask a question and retrieve a text answer from the user
export function askQuestion(message) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      try {
        const tty = process.platform === "win32" ? "CONIN$" : "/dev/tty";
        const fd = fs.openSync(tty, "rs");
        process.stdout.write(message);
        let answer = "";
        const buf = Buffer.alloc(1);
        while (true) {
          const bytesRead = fs.readSync(fd, buf, 0, 1, null);
          if (bytesRead === 0) break;
          const char = buf.toString("utf-8");
          if (char === "\n" || char === "\r") break;
          answer += char;
        }
        fs.closeSync(fd);
        console.log();
        resolve(answer.trim());
        return;
      } catch (e) {
        console.log(
          message + " y (Auto-accepting due to non-interactive environment)",
        );
        resolve("y");
        return;
      }
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function generateScadPreviewUrl(scadCode) {
  try {
    const deflated = zlib.deflateRawSync(Buffer.from(scadCode, "utf-8"));
    const base64 = deflated
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `https://iliagrigorevdev.github.io/scad-gltf/#c${base64}`;
  } catch (e) {
    return null;
  }
}

export async function runAutomatedAIFlow(
  apiKey,
  baseUrl,
  modelName,
  systemPrompt,
  inputRequest,
  allowedTools = ["render_scad_model", "test_godot_project"],
  projectType = "godot",
) {
  if (!baseUrl) {
    throw new Error("Base URL is required to run the automated AI flow.");
  }

  const outputFilename = `generate_${projectType}_project.js`;
  const isRawScad = projectType === "scad";
  const modelTag = modelName ? ` (${modelName})` : "";

  console.log(`\n🚀 Starting automated AI generation${modelTag}...`);

  let mcpClient = null;
  let mcpTransport = null;
  let openaiTools = [];

  try {
    const mcpClientIndex =
      await import("@modelcontextprotocol/sdk/client/index.js");
    const mcpClientStdio =
      await import("@modelcontextprotocol/sdk/client/stdio.js");

    console.log("🔌 Starting local SCAD MCP server...");
    mcpTransport = new mcpClientStdio.StdioClientTransport({
      command: process.execPath,
      args: [path.resolve(__dirname, "../bin/scad-mcp.js")],
    });

    mcpClient = new mcpClientIndex.Client(
      { name: "scad-client", version: "1.0.0" },
      { capabilities: {} },
    );
    await mcpClient.connect(mcpTransport);

    const { tools } = await mcpClient.listTools();

    // Map MCP Tools to OpenAI expected standard function format
    openaiTools = tools
      .filter((t) => allowedTools.includes(t.name))
      .map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

    console.log(
      `✔️  MCP tools linked: ${openaiTools.map((t) => t.function.name).join(", ")}`,
    );
  } catch (err) {
    console.warn(
      "⚠️  Could not initialize MCP client. Proceeding without visual tool support.",
      err.message,
    );
  }

  let messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: inputRequest },
  ];

  let iterations = 0;
  const maxIterations = 30;
  let disableImageSupport = false;

  // Ensure the baseUrl points to the chat completions path
  const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";

  while (iterations < maxIterations) {
    iterations++;
    const waitingFrom = modelName ? ` from ${modelName}` : "";
    console.log(`\n🧠 Waiting for response${waitingFrom}...`);

    const body = {
      messages: messages,
    };

    if (modelName) {
      body.model = modelName;
    }

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
    }

    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey || "sk-no-key-required"}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`AI API Network Error: ${error.message}`);
    }

    if (!response.ok) {
      const errorText = await response.text();

      // Auto-fallback if the model complains about image/vision input
      const errLower = errorText.toLowerCase();
      if (
        !disableImageSupport &&
        (errLower.includes("image") ||
          errLower.includes("vision") ||
          errLower.includes("invalid_request"))
      ) {
        console.log(
          "\n⚠️  API rejected image input. Falling back to text-only mode and retrying...",
        );
        disableImageSupport = true;

        // Strip any existing images from previous messages
        for (const msg of messages) {
          if (Array.isArray(msg.content)) {
            msg.content = msg.content.filter((c) => c.type !== "image_url");
            // If only text parts remain, just keep them. If empty, add placeholder.
            if (msg.content.length === 0) {
              msg.content =
                "[Images removed by system fallback due to lack of model vision support]";
            }
          }
        }

        iterations--;
        continue;
      }

      throw new Error(
        `AI API Error: ${response.status} ${response.statusText}\n${errorText}`,
      );
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    // Append the assistant message exactly as provided (including tool_calls)
    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolImagesUserContent = [];

      for (const toolCall of message.tool_calls) {
        console.log(`\n⚙️  AI is using tool: ${toolCall.function.name}`);

        let argsToLog = {};
        try {
          argsToLog = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.error(
            "   ❌ Failed to parse tool arguments:",
            toolCall.function.arguments,
          );
        }

        // Log truncated arguments to avoid flooding the terminal
        for (const key in argsToLog) {
          if (
            typeof argsToLog[key] === "string" &&
            argsToLog[key].length > 300
          ) {
            argsToLog[key] =
              argsToLog[key].substring(0, 300) +
              "\n... [truncated for logging]";
          }
        }
        console.log(
          `   Args:`,
          JSON.stringify(argsToLog, null, 2).replace(/\n/g, "\n   "),
        );

        if (!mcpClient) {
          console.error("   ❌ MCP client not available.");
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "MCP client not available.",
          });
          continue;
        }

        try {
          const callArgs = JSON.parse(toolCall.function.arguments);

          if (disableImageSupport) {
            callArgs.return_images = false;
          }

          if (
            toolCall.function.name === "render_scad_model" &&
            callArgs.scad_code
          ) {
            const link = generateScadPreviewUrl(callArgs.scad_code);
            if (link) {
              console.log(
                `   🔗 Intermediate Web Preview Link:\n      ${link}`,
              );
            }
          }

          const result = await mcpClient.callTool({
            name: toolCall.function.name,
            arguments: callArgs,
          });

          let responseText = "";
          let imageContents = [];
          for (const item of result.content) {
            if (item.type === "text") responseText += item.text + "\n";
            if (item.type === "image") {
              imageContents.push({
                type: "image_url",
                image_url: {
                  url: `data:${item.mimeType};base64,${item.data}`,
                },
              });
            }
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: responseText || "Success",
          });

          if (imageContents.length > 0) {
            toolImagesUserContent.push({
              type: "text",
              text: `Visual result of ${toolCall.function.name}:`,
            });
            toolImagesUserContent.push(...imageContents);
          }

          console.log(`✔️  Tool ${toolCall.function.name} completed.`);

          if (responseText) {
            const lines = responseText.trim().split("\n");
            const previewLines = lines.slice(0, 15);
            console.log(`   Response:\n   | ${previewLines.join("\n   | ")}`);
            if (lines.length > 15)
              console.log(`   | ... [${lines.length - 15} more lines]`);
          }
        } catch (err) {
          console.error(`⚠️  Tool error: ${err.message}`);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: `Error: ${err.message}`,
          });
        }
      }

      // Append accumulated tool images as a follow-up user message so the AI can "see" the visual outputs
      if (toolImagesUserContent.length > 0) {
        messages.push({
          role: "user",
          content: toolImagesUserContent,
        });
        const numImages = toolImagesUserContent.filter(
          (c) => c.type === "image_url",
        ).length;
        console.log(`   🖼️  Appended ${numImages} image(s) to AI context.`);
      }
    } else {
      const finalText = message.content || "";
      console.log("\n✅ AI proposed a final code version.");

      let finalCode = "";
      let extractedFilename = outputFilename;

      // Extract the code payload based on the project type target
      if (isRawScad) {
        const match = finalText.match(/```(?:openscad|scad)?\n([\s\S]*?)```/i);
        finalCode = match ? match[1].trim() : finalText.trim();

        extractedFilename = "generated_model.scad";
        const nameMatch = finalCode.match(
          /\/\*\s*Model Name:\s*([^*]+)\s*\*\//i,
        );
        if (nameMatch) {
          let safeName = nameMatch[1]
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_");
          if (!safeName.endsWith(".scad")) safeName += ".scad";
          extractedFilename = safeName;
        }
      } else {
        const match = finalText.match(
          /```(?:javascript|js|node)?\n([\s\S]*?)```/i,
        );
        finalCode = match ? match[1].trim() : finalText.trim();
      }

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scad-preview-"));
      const tempFilePath = path.join(tempDir, extractedFilename);
      let runProc = null;

      try {
        fs.writeFileSync(tempFilePath, finalCode, "utf-8");

        if (isRawScad) {
          console.log(
            `   Generating OpenSCAD file to preview in a temporary folder...`,
          );
          console.log(`   Temp file: ${tempFilePath}`);

          const link = generateScadPreviewUrl(finalCode);
          if (link) {
            console.log(`\n🔗 Direct Web Preview Link:\n   ${link}\n`);
          }

          console.log(
            `\n🌐 Starting local viewer to preview ${extractedFilename}...`,
          );

          const scadServePath = path.resolve(__dirname, "../bin/scad-serve.js");
          runProc = spawn(process.execPath, [scadServePath], {
            cwd: tempDir,
            stdio: "inherit",
            detached: false,
          });

          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          console.log(
            `   Generating project files to preview in a temporary folder...`,
          );
          console.log(`   Temp script: ${tempFilePath}`);

          execSync(`node "${tempFilePath}"`, {
            cwd: tempDir,
            stdio: "pipe",
          });

          let projectDir = null;
          let latestTime = 0;
          const items = fs.readdirSync(tempDir);

          for (const item of items) {
            const itemPath = path.join(tempDir, item);
            if (fs.statSync(itemPath).isDirectory()) {
              const isGodot =
                projectType === "godot" &&
                fs.existsSync(path.join(itemPath, "project.godot"));
              const isWeb =
                projectType === "web" &&
                fs.existsSync(path.join(itemPath, "package.json"));
              const isBevy =
                projectType === "bevy" &&
                fs.existsSync(path.join(itemPath, "Cargo.toml"));

              if (isGodot || isWeb || isBevy) {
                const mtime = fs.statSync(itemPath).mtimeMs;
                if (mtime > latestTime) {
                  latestTime = mtime;
                  projectDir = itemPath;
                }
              }
            }
          }

          if (!projectDir) {
            console.log(`   ❌ Could not find the generated project folder.`);
            const expectedFile =
              projectType === "godot"
                ? "project.godot"
                : projectType === "bevy"
                  ? "Cargo.toml"
                  : "package.json";
            messages.push({
              role: "user",
              content: `Your script successfully executed, but no valid project directory was found. Make sure your script creates a root folder and generates the correct required files (like ${expectedFile}) inside it.`,
            });
            continue;
          }

          console.log(`   Project folder: ${projectDir}`);

          if (projectType === "godot") {
            console.log(
              `\n🎮 Launching project visually: ${path.basename(projectDir)}`,
            );
            const godotBin = getGodotBin();
            runProc = spawn(godotBin, ["--path", projectDir], {
              stdio: "ignore",
              detached: true,
            });
            runProc.unref();
          } else if (projectType === "web") {
            console.log(
              `\n🌐 Installing dependencies for: ${path.basename(projectDir)}...`,
            );
            try {
              execSync("npm install", { cwd: projectDir, stdio: "inherit" });
            } catch (e) {
              console.log(
                "⚠️ npm install failed, trying to continue anyway...",
              );
            }

            console.log(`\n🌐 Starting dev server...`);
            const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
            runProc = spawn(npmCmd, ["run", "dev"], {
              cwd: projectDir,
              stdio: "inherit",
              detached: false,
            });

            await new Promise((resolve) => setTimeout(resolve, 2000));
          } else if (projectType === "bevy") {
            console.log(
              `\n🦀 Building and running Bevy project: ${path.basename(projectDir)}...`,
            );
            const cargoCmd =
              process.platform === "win32" ? "cargo.exe" : "cargo";
            runProc = spawn(cargoCmd, ["run"], {
              cwd: projectDir,
              stdio: "inherit",
              detached: false,
            });
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }

        const feedback = await askQuestion(
          "\nAre you happy with this result? (Type 'y' to accept, or type feedback for the AI to fix): ",
        );

        if (
          feedback.toLowerCase() === "y" ||
          feedback.toLowerCase() === "yes" ||
          feedback === ""
        ) {
          fs.copyFileSync(
            tempFilePath,
            path.resolve(process.cwd(), extractedFilename),
          );

          console.log(
            `\n🎉 Success! Final file finalized and written to: ${extractedFilename}`,
          );

          if (!isRawScad) {
            console.log(
              `▶️  Run it again later to unpack the final project with: node ${extractedFilename}`,
            );
          }

          if (mcpTransport) {
            try {
              await mcpTransport.close();
            } catch (e) {}
          }
          break;
        } else {
          console.log("\n🔄 Sending your feedback back to the LLM...");
          messages.push({
            role: "user",
            content: `I reviewed the current version. Here is my feedback to improve it:\n\n${feedback}\n\nPlease implement these fixes and output an updated ${isRawScad ? "OpenSCAD block" : "Node.js script"}.`,
          });
        }
      } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : err.message;
        console.error(
          `   ❌ Failed to execute/preview generated code:\n${stderr}`,
        );
        messages.push({
          role: "user",
          content: `Your generated code threw an error when I tried to run/preview it locally:\n${stderr}\n\nPlease fix the ${isRawScad ? "OpenSCAD code" : "Node.js script"}.`,
        });
      } finally {
        if (runProc) {
          try {
            runProc.kill();
          } catch (e) {}
        }
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {}
      }
    }
  }

  if (iterations >= maxIterations) {
    console.log(
      `\n⚠️ Reached maximum iterations (${maxIterations}). Terminating.`,
    );
    if (mcpTransport) {
      try {
        await mcpTransport.close();
      } catch (e) {}
    }
  }
}

export async function runCliApp({
  projectType,
  buildSystemPrompt,
  buildInputRequest,
  allowedTools = ["render_scad_model"],
  argStartIndex = 2,
}) {
  if (!projectType) {
    throw new Error("projectType is required.");
  }

  const isRawScad = projectType === "scad";
  const { task, optionsStr } = parseTaskAndOptions(argStartIndex);

  if (!task) {
    console.error("Error: Task parameter is required.");
    console.error(
      `Usage: scad-gen ${projectType} "<description>" [options_json]`,
    );
    console.error(
      `   or: echo "<description>" | scad-gen ${projectType} [options_json]`,
    );
    console.error("");
    console.error("Examples with JSON options (Automated AI flow):");
    if (isRawScad) {
      console.error(
        `  scad-gen ${projectType} "A modular sci-fi corridor piece" '{"openaiApiKey": "sk-...", "openaiModel": "gpt-4o"}'`,
      );
    } else {
      console.error(
        `  scad-gen ${projectType} "A simple 3D game" '{"openaiApiKey": "sk-...", "openaiModel": "gpt-4o"}'`,
      );
    }
    process.exit(1);
  }

  // Parse Options JSON
  // Disable heavy PBR features by default
  let options = {
    transmission: false,
    clearcoat: false,
    sheen: false,
    iridescence: false,
  };

  if (optionsStr) {
    try {
      const parsed = JSON.parse(optionsStr);
      options = { ...options, ...parsed }; // User provided options override defaults
    } catch (e) {
      console.error(`Invalid JSON options: ${optionsStr}`);
      process.exit(1);
    }
  }

  if (!isRawScad) {
    // Disable the modelName instructions specifically for these wrapper contexts
    options.modelName = false;
  }

  let promptRules = "";
  try {
    const { generatePrompt } = await import("./prompt.js");
    promptRules = generatePrompt(
      isRawScad ? task : "the 3D assets for the game",
      options,
    );
  } catch (e) {
    console.error("Error generating prompt rules from prompt.js:");
    console.error(e);
    process.exit(1);
  }

  const systemClipboardOutput = buildSystemPrompt(promptRules, options);
  const inputRequestOutput = buildInputRequest
    ? buildInputRequest(task, promptRules)
    : promptRules;

  // Check if API Key flows should be initialized instead of manual clipboard
  const openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY;
  const openaiBaseUrl = options.openaiBaseUrl || process.env.OPENAI_BASE_URL;
  const openaiModel = options.openaiModel || process.env.OPENAI_MODEL;

  if (openaiApiKey || openaiBaseUrl) {
    await runAutomatedAIFlow(
      openaiApiKey,
      openaiBaseUrl,
      openaiModel,
      systemClipboardOutput,
      inputRequestOutput,
      allowedTools,
      projectType,
    );
    return;
  }

  if (isRawScad) {
    try {
      await writeToClipboard(inputRequestOutput);
      console.log(
        "✔️  Input request and syntax rules have been copied to the clipboard. You can now paste it into your LLM.",
      );
    } catch (err) {
      console.error("Error: Failed to copy input request to the clipboard.");
      console.error(err.message);
      process.exit(1);
    }
    return;
  }

  // Write to System Clipboard (Part 1: System Instructions)
  try {
    await writeToClipboard(systemClipboardOutput);
    console.log("✔️  System instructions have been copied to the clipboard.");
  } catch (err) {
    console.error(
      "Error: Failed to copy system instructions to the clipboard.",
    );
    console.error(err.message);
    process.exit(1);
  }

  // Await user confirmation
  await waitForEnter(
    "Please paste the system instructions into your LLM, then press ENTER to copy your input request...",
  );

  // Write to System Clipboard (Part 2: Input Request)
  try {
    await writeToClipboard(inputRequestOutput);
    console.log(
      "✔️  Input request has been copied to the clipboard. You can now paste it into your LLM.",
    );
  } catch (err) {
    console.error("Error: Failed to copy input request to the clipboard.");
    console.error(err.message);
    process.exit(1);
  }
}
