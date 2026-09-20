import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import os from "node:os";
import readline from "node:readline";
import { execSync, spawn } from "node:child_process";
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

export function parseTaskAndOptions() {
  let task = "";
  let optionsStr = "{}";

  if (hasStdinData()) {
    try {
      task = fs.readFileSync(0, "utf-8").trim();
    } catch (e) {
      console.error("Error reading from STDIN:", e);
    }
    if (process.argv[2]) optionsStr = process.argv[2];
  } else {
    if (process.argv[2]) task = process.argv[2];
    if (process.argv[3]) optionsStr = process.argv[3];
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

export async function runAutomatedAIFlow(
  apiKey,
  baseUrl,
  modelName,
  systemPrompt,
  inputRequest,
  allowedTools = ["render_scad_model", "test_godot_project"],
  projectType = "godot",
) {
  const outputFilename = `generate_${projectType}_project.js`;

  console.log(`\n🚀 Starting automated AI generation (${modelName})...`);

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

  // If a baseUrl is given (like llama.cpp http://127.0.0.1:8080/v1), ensure it points to the chat completions path
  const endpoint = baseUrl
    ? baseUrl.replace(/\/+$/, "") + "/chat/completions"
    : "https://api.openai.com/v1/chat/completions";

  while (iterations < maxIterations) {
    iterations++;
    console.log(`\n🧠 Waiting for response from ${modelName}...`);

    const body = {
      model: modelName,
      messages: messages,
    };

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
      console.log("\n✅ AI proposed a code version.");
      const match = finalText.match(
        /```(?:javascript|js|node)?\n([\s\S]*?)```/,
      );
      const finalJS = match ? match[1].trim() : finalText.trim();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scad-preview-"));
      const tempScriptPath = path.join(tempDir, outputFilename);
      let runProc = null;

      try {
        fs.writeFileSync(tempScriptPath, finalJS, "utf-8");

        console.log(
          `   Generating project files to preview in a temporary folder...`,
        );
        console.log(`   Temp folder: ${tempDir}`);
        console.log(`   Temp script: ${tempScriptPath}`);

        execSync(`node "${tempScriptPath}"`, {
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

            if (isGodot || isWeb) {
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
          messages.push({
            role: "user",
            content: `Your script successfully executed, but no valid ${projectType === "godot" ? "Godot" : "Web (package.json)"} project directory was found. Make sure your script creates a root folder and generates the correct required files inside it.`,
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
            `\n🌐 Installing web dependencies for: ${path.basename(projectDir)}...`,
          );
          try {
            execSync("npm install", { cwd: projectDir, stdio: "inherit" });
          } catch (e) {
            console.log("⚠️ npm install failed, trying to continue anyway...");
          }

          console.log(`\n🌐 Starting web dev server...`);
          const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
          runProc = spawn(npmCmd, ["run", "dev"], {
            cwd: projectDir,
            stdio: "inherit",
            detached: false,
          });

          await new Promise((resolve) => setTimeout(resolve, 2000));
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
            tempScriptPath,
            path.resolve(process.cwd(), outputFilename),
          );

          console.log(
            `\n🎉 Success! Final Node.js script finalized and written to: ${outputFilename}`,
          );
          console.log(
            `▶️  Run it again later to unpack the final project with: node ${outputFilename}`,
          );

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
            content: `I reviewed the current version. Here is my feedback to improve it:\n\n${feedback}\n\nPlease implement these fixes and output an updated Node.js script.`,
          });
        }
      } catch (err) {
        const stderr = err.stderr ? err.stderr.toString() : err.message;
        console.error(`   ❌ Failed to execute generated script:\n${stderr}`);
        messages.push({
          role: "user",
          content: `Your generated script threw an error when I tried to run it locally:\n${stderr}\n\nPlease fix the Node.js script.`,
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
