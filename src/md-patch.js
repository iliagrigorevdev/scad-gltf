import {
  extractFilesFromMarkdown,
  extractRootFolderFromMarkdownFiles,
  getMarkdownLangFromPath,
  getSafeFenceForContent,
  isFenceClose,
  normalizeMarkdownHeaderPath,
  normalizeRepoPath,
  parseFenceOpen,
  parseMarkdownFileHeader,
} from "./utils.js";

function findFileLineSpan(lines, targetPath) {
  const normalizedTarget = normalizeRepoPath(
    normalizeMarkdownHeaderPath(targetPath) || String(targetPath ?? ""),
  );

  let currentFile = null;
  let headerIdx = -1;
  let activeFence = null;
  let openFenceIdx = -1;
  let closeFenceIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (activeFence) {
      if (isFenceClose(line, activeFence.char, activeFence.len)) {
        if (currentFile === normalizedTarget) {
          closeFenceIdx = i;
          break;
        }
        activeFence = null;
        currentFile = null;
        headerIdx = -1;
      }
      continue;
    }

    const headerFile = parseMarkdownFileHeader(line);
    if (headerFile) {
      currentFile = normalizeRepoPath(headerFile);
      headerIdx = i;
      openFenceIdx = -1;
      closeFenceIdx = -1;
      continue;
    }

    const fence = parseFenceOpen(line);
    if (fence) {
      activeFence = fence;
      if (currentFile === normalizedTarget) {
        openFenceIdx = i;
      }
    }
  }

  if (openFenceIdx !== -1 && closeFenceIdx !== -1) {
    return { headerIdx, openFenceIdx, closeFenceIdx };
  }
  return null;
}

export function replaceFileInMarkdown(mdContent, targetPath, newFileContent) {
  const normalizedMd = String(mdContent ?? "").replace(/\r\n/g, "\n");
  const normalizedNew = String(newFileContent ?? "").replace(/\r\n/g, "\n");
  const normalizedTarget = normalizeRepoPath(
    normalizeMarkdownHeaderPath(targetPath) || String(targetPath ?? ""),
  );
  const lines = normalizedMd.split("\n");

  const span = findFileLineSpan(lines, normalizedTarget);
  if (span) {
    const { openFenceIdx, closeFenceIdx } = span;
    const openFence = parseFenceOpen(lines[openFenceIdx]);
    const safeFence = getSafeFenceForContent(normalizedNew);
    const fenceLen = Math.max(openFence?.len || 3, safeFence.length);
    const fenceChar =
      openFence?.char === "~" && fenceLen === openFence.len ? "~" : "`";
    const openLine = `${fenceChar.repeat(fenceLen)}${openFence?.info || ""}`;
    const closeLine = fenceChar.repeat(fenceLen);

    const replacementLines =
      normalizedNew === "" ? [] : normalizedNew.split("\n");
    const updatedLines = [
      ...lines.slice(0, openFenceIdx),
      openLine,
      ...replacementLines,
      closeLine,
      ...lines.slice(closeFenceIdx + 1),
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
  const safeFence = getSafeFenceForContent(normalizedNew);
  const sep =
    normalizedMd === ""
      ? ""
      : normalizedMd.endsWith("\n\n")
        ? ""
        : normalizedMd.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${normalizedMd}${sep}### ${normalizedTarget}\n${safeFence}${lang}\n${normalizedNew}\n${safeFence}\n`;
}

export function removeFileFromMarkdown(mdContent, targetPath) {
  const normalizedMd = String(mdContent ?? "").replace(/\r\n/g, "\n");
  const lines = normalizedMd.split("\n");
  const span = findFileLineSpan(lines, targetPath);
  if (!span) return normalizedMd;

  let start = span.headerIdx >= 0 ? span.headerIdx : span.openFenceIdx;
  let end = span.closeFenceIdx + 1;

  while (
    start > 0 &&
    lines[start - 1].trim() === "" &&
    end < lines.length &&
    lines[end].trim() === ""
  ) {
    end++;
  }
  while (end < lines.length && lines[end].trim() === "" && start === 0) {
    end++;
  }

  const remaining = [...lines.slice(0, start), ...lines.slice(end)];
  let out = remaining.join("\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

function extractPatchHeaderCandidate(text) {
  let s = text.trim();
  if (!s) return "";

  // Strip optional numbering / step prefixes (e.g. "1. ", "2) ", "File 1: ", "Step 2 - ")
  s = s
    .replace(/^(?:\d+[.)]\s+|(?:file|step)\s+\d+\s*[:.)\-–—]?\s+)/i, "")
    .trim();

  // Strip optional leading action verbs (e.g. "New ", "Update ", "Create file: ")
  s = s
    .replace(
      /^(?:new|add|added|create|created|update|updated|modify|modified|edit|edited|patch|patched|change|changed|fix|fixed)\s+(?:file\s+)?(?:[:\-–—]\s*)?/i,
      "",
    )
    .trim();

  // Extract leading formatted path token (`...`, **`...`**, **...**) with optional trailing notes
  const formattedMatch = s.match(
    /^(\*{2}`+[^`]+`+\*{2}|`+[^`]+`+|\*\*[^*]+\*\*)(?:\s*(?:[:\-–—].*|\([^)]*\).*|\[[^\]]*\].*))?$/,
  );
  if (formattedMatch) {
    s = formattedMatch[1];
  } else {
    // Strip trailing parenthetical/bracketed annotations, dash notes, or trailing colons
    let prev;
    do {
      prev = s;
      s = s
        .replace(/\s*(?:\([^)]*\)|\[[^\]]*\])\s*$/, "")
        .replace(/\s+[-–—]\s+.*$/, "")
        .replace(/:\s*$/, "")
        .trim();
    } while (s !== prev);
  }

  return normalizeMarkdownHeaderPath(s);
}

function parsePatchHeaderLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (!headingMatch) return null;

  let isDelete = false;
  let body = headingMatch[2].trim();

  const deleteSuffixMatch = body.match(
    /^(.+?)\s*(?:\(|\[)\s*(?:delete|deleted|remove|removed)\s*(?:\)|\])\s*$/i,
  );
  if (deleteSuffixMatch) {
    isDelete = true;
    body = deleteSuffixMatch[1].trim();
  } else {
    const deletePrefixMatch = body.match(
      /^(?:\d+[.)]\s+)?(?:DELETE|REMOVE):?\s+(.+)$/i,
    );
    if (deletePrefixMatch) {
      isDelete = true;
      body = deletePrefixMatch[1].trim();
    }
  }

  if (!isDelete && headingMatch[1] === "###") {
    const canonical = parseMarkdownFileHeader(trimmed);
    if (canonical) {
      return { filePath: canonical, isDelete: false };
    }
  }

  const norm = extractPatchHeaderCandidate(body);
  if (norm && !norm.includes(" ") && /[/.]/.test(norm) && !/\.$/.test(norm)) {
    return { filePath: norm, isDelete };
  }

  return null;
}

export function parseSearchReplaceBlocks(content) {
  const lines = String(content ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const hunks = [];
  let i = 0;

  while (i < lines.length) {
    if (/^<{5,9}(?:\s+SEARCH)?\s*$/i.test(lines[i])) {
      const searchLines = [];
      i++;
      while (i < lines.length && !/^={5,9}\s*$/.test(lines[i])) {
        searchLines.push(lines[i]);
        i++;
      }
      if (i >= lines.length) return null;
      i++;
      const replaceLines = [];
      while (
        i < lines.length &&
        !/^>{5,9}(?:\s+REPLACE)?\s*$/i.test(lines[i])
      ) {
        replaceLines.push(lines[i]);
        i++;
      }
      if (i >= lines.length) return null;
      hunks.push({
        search: searchLines.join("\n"),
        replace: replaceLines.join("\n"),
      });
    }
    i++;
  }

  return hunks.length > 0 ? hunks : null;
}

export function applySearchReplaceHunks(originalContent, hunks) {
  let result = String(originalContent ?? "").replace(/\r\n/g, "\n");
  const errors = [];

  for (let idx = 0; idx < hunks.length; idx++) {
    const { search, replace } = hunks[idx];
    if (!search) {
      errors.push(`Hunk #${idx + 1}: empty SEARCH block`);
      continue;
    }

    const exactIdx = result.indexOf(search);
    if (exactIdx !== -1) {
      result =
        result.slice(0, exactIdx) +
        replace +
        result.slice(exactIdx + search.length);
      continue;
    }

    const trimLineEnd = (s) =>
      s.split("\n").map((l) => l.replace(/[ \t]+$/g, ""));
    const resLines = result.split("\n");
    const resTrimmed = trimLineEnd(result);
    const searchTrimmed = trimLineEnd(search);
    let matchedLine = -1;

    for (let li = 0; li <= resTrimmed.length - searchTrimmed.length; li++) {
      let ok = true;
      for (let k = 0; k < searchTrimmed.length; k++) {
        if (resTrimmed[li + k] !== searchTrimmed[k]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matchedLine = li;
        break;
      }
    }

    if (matchedLine !== -1) {
      const before = resLines.slice(0, matchedLine);
      const after = resLines.slice(matchedLine + searchTrimmed.length);
      const repLines = replace === "" ? [] : replace.split("\n");
      result = [...before, ...repLines, ...after].join("\n");
    } else {
      const preview = search.split("\n")[0].trim().slice(0, 48);
      errors.push(`Hunk #${idx + 1} not found ("${preview}")`);
    }
  }

  return { content: result, errors };
}

function isExplicitDeleteBody(content) {
  const trimmed = String(content ?? "").trim();
  return /^(?:<!--\s*DELETE\s*-->|(?:\/\/|#)\s*DELETE(?:\s+FILE)?|DELETE(?:\s+FILE)?)$/i.test(
    trimmed,
  );
}

export function parseMarkdownPatchEntries(rawPatchText) {
  const normalized = String(rawPatchText ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const entries = [];

  let pendingHeader = null;
  let activeFence = null;
  let bodyLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (activeFence) {
      if (isFenceClose(line, activeFence.char, activeFence.len)) {
        if (pendingHeader) {
          const content = bodyLines.join("\n");
          const isDelete =
            pendingHeader.isDelete || isExplicitDeleteBody(content);
          const hunks = isDelete ? null : parseSearchReplaceBlocks(content);
          const hasMalformedHunks =
            !isDelete &&
            hunks === null &&
            /^<{5,9}(?:\s+SEARCH)?\s*$/im.test(content);
          entries.push({
            filePath: pendingHeader.filePath,
            isDelete,
            content,
            hunks,
            hasMalformedHunks,
          });
          pendingHeader = null;
        }
        activeFence = null;
        bodyLines = [];
      } else if (pendingHeader) {
        bodyLines.push(line);
      }
      continue;
    }

    const header = parsePatchHeaderLine(line);
    if (header) {
      if (pendingHeader && pendingHeader.isDelete) {
        entries.push({
          filePath: pendingHeader.filePath,
          isDelete: true,
          content: "",
          hunks: null,
          hasMalformedHunks: false,
        });
      }
      pendingHeader = header;
      bodyLines = [];
      continue;
    }

    const fence = parseFenceOpen(line);
    if (fence) {
      activeFence = fence;
      bodyLines = [];
    }
  }

  if (pendingHeader && pendingHeader.isDelete) {
    entries.push({
      filePath: pendingHeader.filePath,
      isDelete: true,
      content: "",
      hunks: null,
      hasMalformedHunks: false,
    });
  }

  return entries;
}

export function resolveMarkdownPatchTarget(
  existingPaths,
  incomingPath,
  rootFolder = null,
) {
  const normIncoming = normalizeRepoPath(incomingPath);
  if (!normIncoming) {
    return { resolvedPath: "", matchedExisting: false, remappedFrom: null };
  }

  const normalizedExisting = existingPaths.map((p) => ({
    orig: p,
    norm: normalizeRepoPath(p),
    lower: normalizeRepoPath(p).toLowerCase(),
  }));

  const exact = normalizedExisting.find((e) => e.norm === normIncoming);
  if (exact) {
    return {
      resolvedPath: exact.orig,
      matchedExisting: true,
      remappedFrom: exact.orig !== incomingPath ? incomingPath : null,
    };
  }

  const lowerIncoming = normIncoming.toLowerCase();
  const exactLower = normalizedExisting.find((e) => e.lower === lowerIncoming);
  if (exactLower) {
    return {
      resolvedPath: exactLower.orig,
      matchedExisting: true,
      remappedFrom: incomingPath,
    };
  }

  if (rootFolder) {
    const withRootLower = `${rootFolder}/${normIncoming}`.toLowerCase();
    const rootMatch = normalizedExisting.find((e) => e.lower === withRootLower);
    if (rootMatch) {
      return {
        resolvedPath: rootMatch.orig,
        matchedExisting: true,
        remappedFrom: incomingPath,
      };
    }

    const slashIdx = normIncoming.indexOf("/");
    if (slashIdx > 0) {
      const stripped = normIncoming.slice(slashIdx + 1);
      const swappedLower = `${rootFolder}/${stripped}`.toLowerCase();
      const swappedMatch = normalizedExisting.find(
        (e) => e.lower === swappedLower,
      );
      if (swappedMatch) {
        return {
          resolvedPath: swappedMatch.orig,
          matchedExisting: true,
          remappedFrom: incomingPath,
        };
      }
    }
  }

  const suffixMatches = normalizedExisting.filter((e) =>
    e.lower.endsWith(`/${lowerIncoming}`),
  );
  if (suffixMatches.length === 1) {
    return {
      resolvedPath: suffixMatches[0].orig,
      matchedExisting: true,
      remappedFrom: incomingPath,
    };
  }

  if (!normIncoming.includes("/")) {
    const baseMatches = normalizedExisting.filter((e) => {
      const idx = e.lower.lastIndexOf("/");
      const base = idx === -1 ? e.lower : e.lower.slice(idx + 1);
      return base === lowerIncoming;
    });
    if (baseMatches.length === 1) {
      return {
        resolvedPath: baseMatches[0].orig,
        matchedExisting: true,
        remappedFrom: incomingPath,
      };
    }
  }

  if (rootFolder) {
    const rootPrefixLower = `${rootFolder.toLowerCase()}/`;
    if (!lowerIncoming.startsWith(rootPrefixLower)) {
      return {
        resolvedPath: `${rootFolder}/${normIncoming}`,
        matchedExisting: false,
        remappedFrom: incomingPath,
      };
    }
  }

  return {
    resolvedPath: normIncoming,
    matchedExisting: false,
    remappedFrom: normIncoming !== incomingPath ? incomingPath : null,
  };
}

export function evaluatePatchEntryAgainstFiles(
  entry,
  targetPath,
  existingFilesMap,
  remappedFrom = null,
) {
  const cleanTarget = normalizeRepoPath(targetPath);
  const resolvedTarget =
    existingFilesMap[targetPath] !== undefined ? targetPath : cleanTarget;
  const prevContent = existingFilesMap[resolvedTarget];
  const exists = prevContent !== undefined;
  const itemId = `${cleanTarget}::${Math.random().toString(36).slice(2, 7)}`;

  if (entry.isDelete) {
    if (!exists) {
      return {
        id: itemId,
        action: "unchanged",
        targetPath: cleanTarget,
        sourcePath: entry.filePath,
        remappedFrom,
        previousContent: "",
        newContent: "",
        isSearchReplace: false,
        error: "File not present in project",
        enabled: false,
      };
    }
    return {
      id: itemId,
      action: "delete",
      targetPath: cleanTarget,
      sourcePath: entry.filePath,
      remappedFrom,
      previousContent: prevContent,
      newContent: "",
      isSearchReplace: false,
      error: null,
      enabled: true,
    };
  }

  if (entry.hasMalformedHunks) {
    return {
      id: itemId,
      action: "error",
      targetPath: cleanTarget,
      sourcePath: entry.filePath,
      remappedFrom,
      previousContent: exists ? prevContent : "",
      newContent: entry.content,
      isSearchReplace: true,
      error:
        "Malformed SEARCH/REPLACE block (missing ======= or >>>>>>> REPLACE)",
      enabled: false,
    };
  }

  if (entry.hunks) {
    if (!exists) {
      return {
        id: itemId,
        action: "error",
        targetPath: cleanTarget,
        sourcePath: entry.filePath,
        remappedFrom,
        previousContent: "",
        newContent: entry.content,
        isSearchReplace: true,
        error: "Cannot apply SEARCH/REPLACE: target file does not exist",
        enabled: false,
      };
    }
    const { content, errors } = applySearchReplaceHunks(
      prevContent,
      entry.hunks,
    );
    if (errors.length > 0) {
      return {
        id: itemId,
        action: "error",
        targetPath: cleanTarget,
        sourcePath: entry.filePath,
        remappedFrom,
        previousContent: prevContent,
        newContent: content,
        isSearchReplace: true,
        error: errors.join("; "),
        enabled: false,
      };
    }
    const unchanged = prevContent.replace(/\r\n/g, "\n") === content;
    return {
      id: itemId,
      action: unchanged ? "unchanged" : "update",
      targetPath: cleanTarget,
      sourcePath: entry.filePath,
      remappedFrom,
      previousContent: prevContent,
      newContent: content,
      isSearchReplace: true,
      error: null,
      enabled: !unchanged,
    };
  }

  const normalizedNew = String(entry.content ?? "").replace(/\r\n/g, "\n");
  if (!exists) {
    return {
      id: itemId,
      action: "add",
      targetPath: cleanTarget,
      sourcePath: entry.filePath,
      remappedFrom,
      previousContent: "",
      newContent: normalizedNew,
      isSearchReplace: false,
      error: null,
      enabled: true,
    };
  }

  const unchanged = prevContent.replace(/\r\n/g, "\n") === normalizedNew;
  return {
    id: itemId,
    action: unchanged ? "unchanged" : "update",
    targetPath: cleanTarget,
    sourcePath: entry.filePath,
    remappedFrom,
    previousContent: prevContent,
    newContent: normalizedNew,
    isSearchReplace: false,
    error: null,
    enabled: !unchanged,
  };
}

export function analyzeMarkdownPatch(
  existingMd,
  patchText,
  { existingFilesMap = null } = {},
) {
  const filesMap =
    existingFilesMap || extractFilesFromMarkdown(existingMd || "");
  const existingPaths = Object.keys(filesMap);
  const rootFolder = extractRootFolderFromMarkdownFiles(filesMap);
  const entries = parseMarkdownPatchEntries(patchText);

  const workingFiles = { ...filesMap };
  const items = [];
  let matchedCount = 0;
  let hasProjectGodotInPatch = false;

  for (const entry of entries) {
    const { resolvedPath, matchedExisting, remappedFrom } =
      resolveMarkdownPatchTarget(existingPaths, entry.filePath, rootFolder);

    if (matchedExisting) matchedCount++;
    const normEntry = normalizeRepoPath(entry.filePath).toLowerCase();
    if (normEntry === "project.godot" || normEntry.endsWith("/project.godot")) {
      hasProjectGodotInPatch = true;
    }

    const item = evaluatePatchEntryAgainstFiles(
      entry,
      resolvedPath,
      workingFiles,
      remappedFrom,
    );
    item.entry = entry;
    items.push(item);

    if (item.action === "update" || item.action === "add") {
      workingFiles[item.targetPath] = item.newContent;
    } else if (item.action === "delete") {
      delete workingFiles[item.targetPath];
    }
  }

  const isLikelyFullProjectReplacement =
    existingPaths.length === 0 ||
    (entries.length >= 2 && matchedCount === 0 && hasProjectGodotInPatch);

  return {
    entries,
    items,
    existingPaths,
    rootFolder,
    matchedCount,
    isLikelyFullProjectReplacement,
  };
}

export function applyMarkdownPatchPlan(existingMd, planItems) {
  let updatedMd = String(existingMd ?? "").replace(/\r\n/g, "\n");
  const appliedItems = [];

  for (const item of planItems) {
    if (!item || !item.enabled) continue;
    if (item.action === "delete") {
      updatedMd = removeFileFromMarkdown(updatedMd, item.targetPath);
      appliedItems.push(item);
    } else if (item.action === "update" || item.action === "add") {
      updatedMd = replaceFileInMarkdown(
        updatedMd,
        item.targetPath,
        item.newContent,
      );
      appliedItems.push(item);
    }
  }

  return { updatedMd, appliedItems };
}
