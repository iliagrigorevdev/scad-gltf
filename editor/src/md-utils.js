import {
  extractRootFolderFromMarkdownFiles,
  getSafeFenceForContent,
  isFenceClose,
  isScadFilePath,
  normalizeRepoPath,
  parseFenceOpen,
  parseMarkdownFileHeader,
  replaceFileInMarkdown,
  removeFileFromMarkdown,
  parseSearchReplaceBlocks,
  applySearchReplaceHunks,
  parseMarkdownPatchEntries,
  resolveMarkdownPatchTarget,
  evaluatePatchEntryAgainstFiles,
  analyzeMarkdownPatch,
  applyMarkdownPatchPlan,
} from "scad-gltf/utils";

export {
  extractRootFolderFromMarkdownFiles,
  getSafeFenceForContent,
  isScadFilePath,
  normalizeRepoPath,
  replaceFileInMarkdown,
  removeFileFromMarkdown,
  parseSearchReplaceBlocks,
  applySearchReplaceHunks,
  parseMarkdownPatchEntries,
  resolveMarkdownPatchTarget,
  evaluatePatchEntryAgainstFiles,
  analyzeMarkdownPatch,
  applyMarkdownPatchPlan,
};

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
  let activeFence = null;
  let contentStart = -1;

  while (pos <= mdContent.length) {
    const nlIdx = mdContent.indexOf("\n", pos);
    const lineEnd = nlIdx === -1 ? mdContent.length : nlIdx;
    const rawLine = mdContent.slice(pos, lineEnd);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (activeFence) {
      if (isFenceClose(line, activeFence.char, activeFence.len)) {
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
        activeFence = null;
        contentStart = -1;
      }
    } else {
      const headerFile = parseMarkdownFileHeader(line);
      if (headerFile) {
        currentFile = headerFile;
        headerStart = pos;
        activeFence = null;
        contentStart = -1;
      } else if (currentFile) {
        const fence = parseFenceOpen(line);
        if (fence) {
          activeFence = fence;
          contentStart = nlIdx === -1 ? lineEnd : nlIdx + 1;
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

export function analyzeMdLines(content) {
  const lines = content.split("\n");
  const parsed = new Array(lines.length);

  let currentFile = null;
  let activeFence = null;
  let genericFence = null;
  let genericFilePath = null;
  let genericIsScad = false;
  let blockIdx = -1;
  let hasFileBlocks = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (activeFence && currentFile !== null) {
      const isScad = isScadFilePath(currentFile);
      if (isFenceClose(line, activeFence.char, activeFence.len)) {
        parsed[i] = {
          line,
          role: "fence-close",
          blockIdx,
          filePath: currentFile,
          isScad,
        };
        activeFence = null;
        currentFile = null;
      } else {
        parsed[i] = {
          line,
          role: "body",
          blockIdx,
          filePath: currentFile,
          isScad,
        };
      }
      continue;
    }

    if (genericFence) {
      if (isFenceClose(line, genericFence.char, genericFence.len)) {
        parsed[i] = {
          line,
          role: "fence-close",
          blockIdx,
          filePath: genericFilePath,
          isScad: genericIsScad,
        };
        genericFence = null;
        genericFilePath = null;
        genericIsScad = false;
      } else {
        parsed[i] = {
          line,
          role: "body",
          blockIdx,
          filePath: genericFilePath,
          isScad: genericIsScad,
        };
      }
      continue;
    }

    const headerFile = parseMarkdownFileHeader(line);
    if (headerFile) {
      blockIdx++;
      currentFile = headerFile;
      activeFence = null;
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
      const fence = parseFenceOpen(line);
      if (fence) {
        activeFence = fence;
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
          role: "preamble",
          blockIdx,
          filePath: currentFile,
          isScad,
        };
      }
      continue;
    }

    const fence = parseFenceOpen(line);
    if (fence) {
      const fenceLang = fence.info.toLowerCase();
      genericIsScad =
        fenceLang === "" || fenceLang === "openscad" || fenceLang === "scad";
      genericFilePath = genericIsScad ? "main.scad" : null;
      blockIdx++;
      genericFence = fence;
      hasFileBlocks = true;
      parsed[i] = {
        line,
        role: "fence-open",
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
