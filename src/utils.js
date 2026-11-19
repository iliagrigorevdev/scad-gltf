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

export function normalizeRepoPath(filePath) {
  return String(filePath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "");
}

export function isScadFilePath(filePath) {
  return (
    typeof filePath === "string" && filePath.toLowerCase().endsWith(".scad")
  );
}

export function parseFenceOpen(line) {
  const match = line.match(/^(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  const fence = match[1];
  const char = fence[0];
  const info = match[2];
  if (char === "`" && info.includes("`")) return null;
  return { char, len: fence.length, info: info.trim() };
}

export function isFenceClose(line, fenceChar, fenceLen) {
  const trimmed = line.trimEnd();
  if (!trimmed || trimmed[0] !== fenceChar) return false;
  let count = 0;
  while (count < trimmed.length && trimmed[count] === fenceChar) {
    count++;
  }
  return count >= fenceLen && count === trimmed.length;
}

export function getSafeFenceForContent(content) {
  const matches = String(content ?? "").match(/`{3,}/g);
  if (!matches) return "```";
  let maxLen = 2;
  for (const m of matches) {
    if (m.length > maxLen) maxLen = m.length;
  }
  return "`".repeat(maxLen + 1);
}

export function extractRootFolderFromMarkdownFiles(files) {
  const paths = Object.keys(files)
    .map((p) => p.replace(/\\/g, "/").replace(/^\/+/, ""))
    .filter(Boolean);
  if (paths.length === 0) return null;

  let rootFolder = null;
  for (const p of paths) {
    const slashIdx = p.indexOf("/");
    if (slashIdx <= 0) return null;
    const top = p.slice(0, slashIdx);
    if (rootFolder === null) {
      rootFolder = top;
    } else if (rootFolder !== top) {
      return null;
    }
  }
  return rootFolder;
}

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
    const fence = getSafeFenceForContent(normalizedContent);
    blocks.push(
      `### ${normalizedPath}\n${fence}${lang}\n${normalizedContent}\n${fence}`,
    );
  }

  return blocks.length > 0 ? blocks.join("\n\n") + "\n" : "";
}

/**
 * Normalizes a Markdown file header token by stripping optional surrounding
 * bold (`**...**`) or inline code (`` `...` ``) formatting.
 *
 * @param {string} rawPath
 * @returns {string}
 */
export function normalizeMarkdownHeaderPath(rawPath) {
  if (typeof rawPath !== "string") return "";
  let token = rawPath.trim();
  for (let i = 0; i < 2; i++) {
    const boldMatch = token.match(/^\*\*([\s\S]+)\*\*$/);
    if (boldMatch) {
      token = boldMatch[1].trim();
      continue;
    }
    const codeMatch = token.match(/^`+([^`]+)`+$/);
    if (codeMatch) {
      token = codeMatch[1].trim();
      continue;
    }
    break;
  }
  if (!token || /^[`*]+$/.test(token) || /\s/.test(token)) return "";
  return token;
}

/**
 * Parses a `### filepath` header line, returning the normalized file path or null.
 *
 * @param {string} line
 * @returns {string | null}
 */
export function parseMarkdownFileHeader(line) {
  if (typeof line !== "string") return null;
  // \S+ ensures the header is a single continuous path without spaces,
  // preventing regular English markdown headers from being parsed as files.
  const match = line.match(/^###\s+(\S+)\s*$/);
  if (!match) return null;
  const normalized = normalizeMarkdownHeaderPath(match[1]);
  return normalized || null;
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
  if (typeof mdContent !== "string") return files;
  const lines = mdContent.split("\n");
  let currentFile = null;
  let activeFence = null;
  let currentContent = [];

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (activeFence) {
      if (isFenceClose(line, activeFence.char, activeFence.len)) {
        if (currentFile) {
          files[currentFile] = currentContent.join("\n");
        }
        currentFile = null;
        activeFence = null;
        currentContent = [];
      } else {
        currentContent.push(line);
      }
      continue;
    }

    const headerFile = parseMarkdownFileHeader(line);
    if (headerFile) {
      currentFile = headerFile;
      activeFence = null;
      currentContent = [];
      continue;
    }

    if (currentFile) {
      const fence = parseFenceOpen(line);
      if (fence) {
        activeFence = fence;
        currentContent = [];
      }
    }
  }

  // Fallback for generic markdown with just a scad codeblock
  if (Object.keys(files).length === 0) {
    const genericMatch = mdContent.match(
      /```(?:openscad|scad)?\r?\n([\s\S]*?)```/i,
    );
    if (genericMatch) {
      files["main.scad"] = genericMatch[1].trim();
    }
  }

  return files;
}

/**
 * Extracts and sanitizes the model name from a SCAD block comment.
 * e.g., Model Name block comment (`Model Name: My Model`)
 */
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

export {
  replaceFileInMarkdown,
  removeFileFromMarkdown,
  parseSearchReplaceBlocks,
  applySearchReplaceHunks,
  parseMarkdownPatchEntries,
  resolveMarkdownPatchTarget,
  evaluatePatchEntryAgainstFiles,
  analyzeMarkdownPatch,
  applyMarkdownPatchPlan,
} from "./md-patch.js";
