import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import readline from "node:readline";

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

export async function runAutomatedGeminiFlow(
  apiKey,
  modelName,
  systemPrompt,
  inputRequest,
  outputFilename = "generate_project.js",
) {
  console.log(
    `\n🚀 Starting automated generation via Gemini API (${modelName})...`,
  );

  let mcpClient = null;
  let mcpTransport = null;
  let geminiTools = [];

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

    function mapSchemaToGemini(schema) {
      if (!schema) return undefined;
      const typeMap = {
        string: "STRING",
        number: "NUMBER",
        integer: "INTEGER",
        boolean: "BOOLEAN",
        array: "ARRAY",
        object: "OBJECT",
      };
      const mapped = { type: typeMap[schema.type] || "STRING" };
      if (schema.description) mapped.description = schema.description;
      if (schema.properties) {
        mapped.properties = {};
        for (const [k, v] of Object.entries(schema.properties)) {
          mapped.properties[k] = mapSchemaToGemini(v);
        }
      }
      if (schema.items) mapped.items = mapSchemaToGemini(schema.items);
      if (schema.enum) mapped.enum = schema.enum;
      return mapped;
    }

    geminiTools = tools
      .filter(
        (t) =>
          t.name === "render_scad_model" || t.name === "test_godot_project",
      )
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: {
          type: "OBJECT",
          properties: mapSchemaToGemini({
            properties: t.inputSchema.properties,
          }).properties,
          required: t.inputSchema.required,
        },
      }));
    console.log(
      `✔️  MCP tools linked: ${geminiTools.map((t) => t.name).join(", ")}`,
    );
  } catch (err) {
    console.warn(
      "⚠️  Could not initialize MCP client. Proceeding without visual tool support.",
      err.message,
    );
  }

  let contents = [{ role: "user", parts: [{ text: inputRequest }] }];
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: apiKey });

  let iterations = 0;
  const maxIterations = 15;

  while (iterations < maxIterations) {
    iterations++;
    console.log("\n🧠 Waiting for Gemini...");

    const config = { systemInstruction: systemPrompt };
    if (geminiTools.length > 0)
      config.tools = [{ functionDeclarations: geminiTools }];

    let response;
    try {
      response = await ai.models.generateContent({
        model: modelName,
        contents: contents,
        config: config,
      });
    } catch (error) {
      throw new Error(`Gemini API Error: ${error.message}`);
    }

    const responseMessage = response.candidates[0].content;
    contents.push(responseMessage);

    const parts = responseMessage.parts || [];
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length > 0) {
      const functionResponsesParts = [];
      for (const fcall of functionCalls) {
        console.log(`\n⚙️  AI is using tool: ${fcall.functionCall.name}`);

        // Log truncated arguments to avoid flooding the terminal with long scripts
        const argsToLog = fcall.functionCall.args
          ? { ...fcall.functionCall.args }
          : {};
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
          functionResponsesParts.push({
            functionResponse: {
              name: fcall.functionCall.name,
              response: { error: "MCP client not available." },
            },
          });
          continue;
        }

        try {
          const result = await mcpClient.callTool({
            name: fcall.functionCall.name,
            arguments: fcall.functionCall.args,
          });
          let responseText = "";
          const imageParts = [];
          for (const item of result.content) {
            if (item.type === "text") responseText += item.text + "\n";
            if (item.type === "image")
              imageParts.push({
                inlineData: { mimeType: item.mimeType, data: item.data },
              });
          }
          functionResponsesParts.push({
            functionResponse: {
              name: fcall.functionCall.name,
              response: { result: responseText || "Success" },
            },
          });
          functionResponsesParts.push(...imageParts);

          console.log(`✔️  Tool ${fcall.functionCall.name} completed.`);

          // Print a snippet of the tool's response text
          if (responseText) {
            const lines = responseText.trim().split("\n");
            const previewLines = lines.slice(0, 15);
            console.log(`   Response:\n   | ${previewLines.join("\n   | ")}`);
            if (lines.length > 15)
              console.log(`   | ... [${lines.length - 15} more lines]`);
          }
          if (imageParts.length > 0) {
            console.log(`   🖼️  Returned ${imageParts.length} image(s).`);
          }
        } catch (err) {
          console.error(`⚠️  Tool error: ${err.message}`);
          functionResponsesParts.push({
            functionResponse: {
              name: fcall.functionCall.name,
              response: { error: err.message },
            },
          });
        }
      }
      contents.push({ role: "user", parts: functionResponsesParts });
    } else {
      const textPart = parts.find((p) => p.text);
      const finalText = textPart ? textPart.text : "";

      console.log("\n✅ Gemini finished thinking.");
      const match = finalText.match(
        /```(?:javascript|js|node)?\n([\s\S]*?)```/,
      );
      const finalJS = match ? match[1].trim() : finalText.trim();

      fs.writeFileSync(outputFilename, finalJS, "utf-8");
      console.log(`\n🎉 Success! Node.js script written to: ${outputFilename}`);
      console.log(`▶️  Run it with: node ${outputFilename}`);

      if (mcpTransport) {
        try {
          await mcpTransport.close();
        } catch (e) {}
      }
      break;
    }
  }
}
