import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { parseTaskAndOptions, logAIThinking } from "../src/cli-utils.js";

test("parseTaskAndOptions - Parses CLI arguments correctly (No STDIN)", (t) => {
  // Mock fstatSync to simulate a TTY (No STDIN data)
  t.mock.method(fs, "fstatSync", () => ({
    isFIFO: () => false,
    isFile: () => false,
  }));

  const origArgv = process.argv;
  process.argv = ["node", "script", "Generate a cube", '{"basic": false}'];

  const { task, optionsStr } = parseTaskAndOptions(2);

  assert.strictEqual(
    task,
    "Generate a cube",
    "Should extract the task description",
  );
  assert.strictEqual(
    optionsStr,
    '{"basic": false}',
    "Should extract the options JSON",
  );

  // Cleanup
  process.argv = origArgv;
});

test("parseTaskAndOptions - Handles missing options gracefuly", (t) => {
  t.mock.method(fs, "fstatSync", () => ({
    isFIFO: () => false,
    isFile: () => false,
  }));

  const origArgv = process.argv;
  process.argv = ["node", "script", "Only task provided"];

  const { task, optionsStr } = parseTaskAndOptions(2);

  assert.strictEqual(task, "Only task provided", "Should extract the task");
  assert.strictEqual(
    optionsStr,
    "{}",
    "Should default optionsStr to empty JSON object string",
  );

  process.argv = origArgv;
});

test("logAIThinking - Formats short thoughts normally", (t) => {
  const origLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));

  const shortThought = "Thinking step 1\nThinking step 2\nThinking step 3";
  logAIThinking(shortThought, false);

  console.log = origLog;

  assert.ok(
    logs.some((log) => log.includes("🤔 AI Thinking:")),
    "Should output header",
  );
  assert.ok(
    logs.some((log) => log.includes("Thinking step 2")),
    "Should output all lines",
  );
  assert.ok(
    !logs.some((log) => log.includes("hidden")),
    "Should not hide any lines for short thoughts",
  );
});

test("logAIThinking - Truncates long thoughts unless verbose", (t) => {
  const origLog = console.log;
  let logs = [];
  console.log = (...args) => logs.push(args.join(" "));

  const longThought = Array.from(
    { length: 15 },
    (_, i) => `Thought line ${i + 1}`,
  ).join("\n");

  // Non-verbose
  logAIThinking(longThought, false);

  assert.ok(
    logs.some((log) => log.includes("Thought line 1")),
    "Should include head",
  );
  assert.ok(
    logs.some((log) => log.includes("Thought line 15")),
    "Should include tail",
  );
  assert.ok(
    logs.some((log) => log.includes("7 lines hidden")),
    "Should calculate and display hidden lines",
  );

  // Reset and test Verbose
  logs = [];
  logAIThinking(longThought, true);

  console.log = origLog;

  assert.ok(
    logs.some((log) => log.includes("Thought line 8")),
    "Should include middle lines when verbose",
  );
  assert.ok(
    !logs.some((log) => log.includes("hidden")),
    "Should not hide lines when verbose is true",
  );
});
