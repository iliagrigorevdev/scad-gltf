/**
 * Shared utility functions that are environment-agnostic (work in both Node.js and browsers).
 */

const EXT_TO_LANG = {
  scad: "openscad",
  gd: "gdscript",
  rs: "rust",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  uplugin: "json",
  uproject: "json",
  toml: "toml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "cpp",
  hpp: "cpp",
  cs: "csharp",
  py: "python",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  svg: "xml",
  ini: "ini",
  cfg: "ini",
  tscn: "ini",
  tres: "ini",
  godot: "ini",
  md: "markdown",
  txt: "text",
  glsl: "glsl",
  wgsl: "wgsl",
  gdshader: "gdshader",
};

/**
 * Resolves a Markdown code block language tag from a file path.
 *
 * @param {string} filepath
 * @returns {string}
 */
export function getMarkdownLangFromPath(filepath) {
  const base = filepath.split("/").pop() || filepath;
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0) return "text";
  const ext = base.slice(lastDot + 1).toLowerCase();
  return EXT_TO_LANG[ext] || "text";
}

/**
 * Packs a dictionary of filepaths and contents into a single Markdown string
 * using "### filepath" headers followed by fenced code blocks.
 *
 * @param {Record<string, string>} files
 * @returns {string}
 */
export function packFilesToMarkdown(files) {
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  const blocks = [];

  for (const [filepath, content] of entries) {
    const normalizedPath = filepath.replace(/\\/g, "/");
    const normalizedContent = String(content ?? "").replace(/\r\n/g, "\n");
    const lang = getMarkdownLangFromPath(normalizedPath);
    blocks.push(
      `### ${normalizedPath}\n\`\`\`${lang}\n${normalizedContent}\n\`\`\``,
    );
  }

  return blocks.length > 0 ? blocks.join("\n\n") + "\n" : "";
}

/**
 * Parses a markdown string and extracts files defined by standard "### filepath" headers.
 * Includes a fallback for extracting generic un-headered OpenSCAD codeblocks.
 *
 * @param {string} mdContent The markdown string to parse
 * @returns {Record<string, string>} A dictionary mapping filepaths to their string contents
 */
export function extractFilesFromMarkdown(mdContent) {
  const files = {};
  const lines = mdContent.split("\n");
  let currentFile = null;
  let inCodeBlock = false;
  let currentContent = [];

  // \S+ ensures the header is a single continuous path without spaces,
  // preventing regular English markdown headers from being parsed as files.
  const headerMatchRegex = /^###\s+(\S+)\s*$/;

  for (const line of lines) {
    const headerMatch = line.match(headerMatchRegex);
    if (headerMatch) {
      currentFile = headerMatch[1];
      inCodeBlock = false;
      currentContent = [];
      continue;
    }

    if (currentFile) {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          // Close block and save
          files[currentFile] = currentContent.join("\n");
          currentFile = null;
          inCodeBlock = false;
        } else {
          // Open block
          inCodeBlock = true;
          currentContent = [];
        }
      } else if (inCodeBlock) {
        currentContent.push(line);
      }
    }
  }

  // Fallback for generic markdown with just a scad codeblock
  if (Object.keys(files).length === 0) {
    const genericMatch = mdContent.match(
      /```(?:openscad|scad)?\n([\s\S]*?)```/i,
    );
    if (genericMatch) {
      files["main.scad"] = genericMatch[1].trim();
    }
  }

  return files;
}

/**
 * Extracts and sanitizes the model name from a SCAD block comment.
 * e.g., /* Model Name: My Model */
export function extractModelNameFromScad(scadCode) {
  const nameMatch = scadCode.match(/\/\*\s*Model Name:\s*(.*?)\s*\*\//i);
  if (nameMatch && nameMatch[1]) {
    return nameMatch[1]
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "");
  }
  return null;
}

/**
 * Parses SCAD code to find all relative paths imported via 'include' or 'use'.
 */
export function extractScadDependencies(scadCode) {
  const deps = [];
  const includeRegex = /(?:include|use)\s*([<"])([^>"]+)([>"])/g;
  let match;
  while ((match = includeRegex.exec(scadCode)) !== null) {
    deps.push(match[2]);
  }
  return deps;
}
