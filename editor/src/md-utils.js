import {
  getMarkdownLangFromPath,
  normalizeMarkdownHeaderPath,
  parseMarkdownFileHeader,
} from "scad-gltf/utils";

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

export function isMarkdownContent(code) {
  if (typeof code !== "string") return false;
  return (
    (code.includes("```") && code.includes("###")) ||
    /```(?:openscad|scad)?\r?\n/i.test(code)
  );
}

export function parseMdFileBlocks(mdContent) {
  const blocks = [];
  if (typeof mdContent !== "string") return blocks;

  let pos = 0;
  let currentFile = null;
  let headerStart = -1;
  let inCodeBlock = false;
  let contentStart = -1;

  while (pos <= mdContent.length) {
    const nlIdx = mdContent.indexOf("\n", pos);
    const lineEnd = nlIdx === -1 ? mdContent.length : nlIdx;
    const rawLine = mdContent.slice(pos, lineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    const headerFile = parseMarkdownFileHeader(line);
    if (headerFile) {
      currentFile = headerFile;
      headerStart = pos;
      inCodeBlock = false;
      contentStart = -1;
    } else if (currentFile) {
      if (line.startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          contentStart = nlIdx === -1 ? lineEnd : nlIdx + 1;
        } else {
          const prevChar = pos >= 2 ? mdContent[pos - 2] : "";
          const contentEnd =
            pos > contentStart
              ? prevChar === "\r"
                ? pos - 2
                : pos - 1
              : contentStart;
          blocks.push({
            filePath: currentFile,
            headerStart,
            contentStart,
            contentEnd,
            blockEnd: lineEnd,
          });
          currentFile = null;
          inCodeBlock = false;
          contentStart = -1;
        }
      }
    }

    if (nlIdx === -1) break;
    pos = nlIdx + 1;
  }

  if (blocks.length === 0) {
    const genericRegex = /```(?:openscad|scad)?\r?\n([\s\S]*?)```/i;
    const match = genericRegex.exec(mdContent);
    if (match) {
      const fullMatchStart = match.index;
      const openNl = mdContent.indexOf("\n", fullMatchStart);
      const rawStart = openNl === -1 ? fullMatchStart : openNl + 1;
      const rawEnd = fullMatchStart + match[0].length - 3;
      const bodySlice = mdContent.slice(rawStart, rawEnd);
      const trimmedBody = bodySlice.trim();
      const trimOffset = trimmedBody ? bodySlice.indexOf(trimmedBody) : 0;
      blocks.push({
        filePath: "main.scad",
        headerStart: fullMatchStart,
        contentStart: rawStart + trimOffset,
        contentEnd: rawStart + trimOffset + trimmedBody.length,
        blockEnd: fullMatchStart + match[0].length,
      });
    }
  }

  return blocks;
}

export function findMdBlockAtCursor(mdContent, cursorIndex) {
  const blocks = parseMdFileBlocks(mdContent);
  for (const b of blocks) {
    if (cursorIndex >= b.headerStart && cursorIndex <= b.blockEnd) {
      return b;
    }
  }
  return null;
}

export function isScadFilePath(filePath) {
  return (
    typeof filePath === "string" && filePath.toLowerCase().endsWith(".scad")
  );
}

export function analyzeMdLines(content) {
  const lines = content.split("\n");
  const parsed = new Array(lines.length);

  let currentFile = null;
  let inCodeBlock = false;
  let genericInCodeBlock = false;
  let genericFilePath = null;
  let genericIsScad = false;
  let blockIdx = -1;
  let hasFileBlocks = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerFile = parseMarkdownFileHeader(line);

    if (headerFile) {
      blockIdx++;
      currentFile = headerFile;
      inCodeBlock = false;
      genericInCodeBlock = false;
      genericFilePath = null;
      genericIsScad = false;
      hasFileBlocks = true;
      parsed[i] = {
        line,
        role: "header",
        blockIdx,
        filePath: currentFile,
        isScad: isScadFilePath(currentFile),
      };
      continue;
    }

    if (currentFile !== null) {
      const isScad = isScadFilePath(currentFile);
      if (line.startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          parsed[i] = {
            line,
            role: "fence-open",
            blockIdx,
            filePath: currentFile,
            isScad,
          };
        } else {
          parsed[i] = {
            line,
            role: "fence-close",
            blockIdx,
            filePath: currentFile,
            isScad,
          };
          inCodeBlock = false;
          currentFile = null;
        }
      } else if (inCodeBlock) {
        parsed[i] = {
          line,
          role: "body",
          blockIdx,
          filePath: currentFile,
          isScad,
        };
      } else {
        parsed[i] = {
          line,
          role: "preamble",
          blockIdx,
          filePath: currentFile,
          isScad,
        };
      }
      continue;
    }

    if (line.startsWith("```")) {
      if (!genericInCodeBlock) {
        const fenceLang = line.slice(3).trim().toLowerCase();
        genericIsScad =
          fenceLang === "" || fenceLang === "openscad" || fenceLang === "scad";
        genericFilePath = genericIsScad ? "main.scad" : null;
        blockIdx++;
        genericInCodeBlock = true;
        hasFileBlocks = true;
        parsed[i] = {
          line,
          role: "fence-open",
          blockIdx,
          filePath: genericFilePath,
          isScad: genericIsScad,
        };
      } else {
        parsed[i] = {
          line,
          role: "fence-close",
          blockIdx,
          filePath: genericFilePath,
          isScad: genericIsScad,
        };
        genericInCodeBlock = false;
        genericFilePath = null;
        genericIsScad = false;
      }
      continue;
    }

    if (genericInCodeBlock) {
      parsed[i] = {
        line,
        role: "body",
        blockIdx,
        filePath: genericFilePath,
        isScad: genericIsScad,
      };
      continue;
    }

    parsed[i] = {
      line,
      role: "plain",
      blockIdx: -1,
      filePath: null,
      isScad: false,
    };
  }

  return { parsed, hasFileBlocks };
}

export function replaceFileInMarkdown(mdContent, targetPath, newFileContent) {
  const normalizedMd = String(mdContent ?? "").replace(/\r\n/g, "\n");
  const normalizedNew = String(newFileContent ?? "").replace(/\r\n/g, "\n");
  const normalizedTarget =
    normalizeMarkdownHeaderPath(targetPath) || String(targetPath ?? "");
  const lines = normalizedMd.split("\n");

  let currentFile = null;
  let inCodeBlock = false;
  let openFenceIdx = -1;
  let closeFenceIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerFile = parseMarkdownFileHeader(line);
    if (headerFile) {
      currentFile = headerFile;
      inCodeBlock = false;
      continue;
    }

    if (currentFile === normalizedTarget) {
      if (line.startsWith("```")) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          openFenceIdx = i;
        } else {
          closeFenceIdx = i;
          break;
        }
      }
    } else if (currentFile !== null) {
      if (line.startsWith("```")) {
        if (inCodeBlock) {
          currentFile = null;
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
      }
    }
  }

  if (openFenceIdx !== -1 && closeFenceIdx !== -1) {
    const replacementLines =
      normalizedNew === "" ? [] : normalizedNew.split("\n");
    const updatedLines = [
      ...lines.slice(0, openFenceIdx + 1),
      ...replacementLines,
      ...lines.slice(closeFenceIdx),
    ];
    return updatedLines.join("\n");
  }

  if (normalizedTarget === "main.scad") {
    const genericRegex = /(```(?:openscad|scad)?\n)([\s\S]*?)(```)/i;
    if (genericRegex.test(normalizedMd)) {
      const body = normalizedNew === "" ? "" : `${normalizedNew}\n`;
      return normalizedMd.replace(genericRegex, `$1${body}$3`);
    }
  }

  const lang = getMarkdownLangFromPath(normalizedTarget);
  const sep = normalizedMd.endsWith("\n") ? "\n" : "\n\n";
  return `${normalizedMd}${normalizedMd ? sep : ""}### ${normalizedTarget}\n\`\`\`${lang}\n${normalizedNew}\n\`\`\`\n`;
}
