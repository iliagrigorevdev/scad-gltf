import { extractFilesFromMarkdown, isScadFilePath } from "scad-gltf/utils";

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}_${str.length}`;
}

export function getUtf8ByteLength(str) {
  try {
    return new TextEncoder().encode(str).length;
  } catch {
    return str.length;
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function isMultiFileMarkdown(content) {
  if (typeof content !== "string") return false;
  return /^###\s+\S+\s*$/m.test(content) && content.includes("```");
}

export function getContentFileMap(content) {
  if (!isMultiFileMarkdown(content)) return null;
  const files = extractFilesFromMarkdown(content);
  return Object.keys(files).length > 0 ? files : null;
}

/**
 * Computes line-level diff between textA and textB.
 * Uses exact LCS DP for moderate deltas and falls back to greedy anchor matching
 * if the middle edit region is very large.
 */
export function computeLineDiff(textA, textB) {
  const normA = String(textA ?? "").replace(/\r\n/g, "\n");
  const normB = String(textB ?? "").replace(/\r\n/g, "\n");

  const linesA = normA === "" ? [] : normA.split("\n");
  const linesB = normB === "" ? [] : normB.split("\n");

  let prefix = 0;
  while (
    prefix < linesA.length &&
    prefix < linesB.length &&
    linesA[prefix] === linesB[prefix]
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < linesA.length - prefix &&
    suffix < linesB.length - prefix &&
    linesA[linesA.length - 1 - suffix] === linesB[linesB.length - 1 - suffix]
  ) {
    suffix++;
  }

  const ops = [];
  for (let i = 0; i < prefix; i++) {
    ops.push({ type: "equal", lineA: i + 1, lineB: i + 1, text: linesA[i] });
  }

  const midA = linesA.slice(prefix, linesA.length - suffix);
  const midB = linesB.slice(prefix, linesB.length - suffix);
  const m = midA.length;
  const n = midB.length;

  if (m === 0) {
    for (let j = 0; j < n; j++) {
      ops.push({
        type: "add",
        lineA: null,
        lineB: prefix + j + 1,
        text: midB[j],
      });
    }
  } else if (n === 0) {
    for (let i = 0; i < m; i++) {
      ops.push({
        type: "remove",
        lineA: prefix + i + 1,
        lineB: null,
        text: midA[i],
      });
    }
  } else if (m * n <= 1_000_000) {
    const stride = n + 1;
    const dp = new Int32Array((m + 1) * (n + 1));

    for (let i = m - 1; i >= 0; i--) {
      const rowOffset = i * stride;
      const nextRowOffset = (i + 1) * stride;
      const line = midA[i];
      for (let j = n - 1; j >= 0; j--) {
        if (line === midB[j]) {
          dp[rowOffset + j] = dp[nextRowOffset + j + 1] + 1;
        } else {
          const down = dp[nextRowOffset + j];
          const right = dp[rowOffset + j + 1];
          dp[rowOffset + j] = down >= right ? down : right;
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midA[i] === midB[j]) {
        ops.push({
          type: "equal",
          lineA: prefix + i + 1,
          lineB: prefix + j + 1,
          text: midA[i],
        });
        i++;
        j++;
      } else if (dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)]) {
        ops.push({
          type: "remove",
          lineA: prefix + i + 1,
          lineB: null,
          text: midA[i],
        });
        i++;
      } else {
        ops.push({
          type: "add",
          lineA: null,
          lineB: prefix + j + 1,
          text: midB[j],
        });
        j++;
      }
    }
    while (i < m) {
      ops.push({
        type: "remove",
        lineA: prefix + i + 1,
        lineB: null,
        text: midA[i],
      });
      i++;
    }
    while (j < n) {
      ops.push({
        type: "add",
        lineA: null,
        lineB: prefix + j + 1,
        text: midB[j],
      });
      j++;
    }
  } else {
    // Fast bounded lookahead fallback for very large files
    const indexB = new Map();
    for (let j = 0; j < n; j++) {
      let arr = indexB.get(midB[j]);
      if (!arr) {
        arr = [];
        indexB.set(midB[j], arr);
      }
      if (arr.length < 32) arr.push(j);
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (midA[i] === midB[j]) {
        ops.push({
          type: "equal",
          lineA: prefix + i + 1,
          lineB: prefix + j + 1,
          text: midA[i],
        });
        i++;
        j++;
        continue;
      }

      const positions = indexB.get(midA[i]);
      let nextJ = -1;
      if (positions) {
        for (const p of positions) {
          if (p >= j && p - j <= 120) {
            nextJ = p;
            break;
          }
        }
      }

      if (nextJ !== -1) {
        while (j < nextJ) {
          ops.push({
            type: "add",
            lineA: null,
            lineB: prefix + j + 1,
            text: midB[j],
          });
          j++;
        }
      } else {
        ops.push({
          type: "remove",
          lineA: prefix + i + 1,
          lineB: null,
          text: midA[i],
        });
        i++;
      }
    }
    while (i < m) {
      ops.push({
        type: "remove",
        lineA: prefix + i + 1,
        lineB: null,
        text: midA[i],
      });
      i++;
    }
    while (j < n) {
      ops.push({
        type: "add",
        lineA: null,
        lineB: prefix + j + 1,
        text: midB[j],
      });
      j++;
    }
  }

  for (let k = 0; k < suffix; k++) {
    const idxA = linesA.length - suffix + k;
    const idxB = linesB.length - suffix + k;
    ops.push({
      type: "equal",
      lineA: idxA + 1,
      lineB: idxB + 1,
      text: linesA[idxA],
    });
  }

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "remove") removed++;
    else unchanged++;
  }

  return { ops, added, removed, unchanged };
}

export function computeChangedRanges(items, isChangedFn, contextLines = 3) {
  const n = items.length;
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (isChangedFn(items[i])) {
      const start = Math.max(0, i - contextLines);
      const end = Math.min(n - 1, i + contextLines);
      for (let k = start; k <= end; k++) keep[k] = 1;
    }
  }
  return keep;
}

export function buildUnifiedDisplayItems(ops, showFull) {
  if (showFull) return ops;

  const keep = computeChangedRanges(ops, (op) => op.type !== "equal", 3);
  const items = [];
  let i = 0;
  while (i < ops.length) {
    if (!keep[i]) {
      let skipped = 0;
      while (i < ops.length && !keep[i]) {
        skipped++;
        i++;
      }
      items.push({ type: "hunk", skipped });
    } else {
      items.push(ops[i]);
      i++;
    }
  }
  return items;
}

export function buildSideBySideRows(ops, showFull) {
  const rows = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === "equal") {
      rows.push({
        type: "equal",
        left: { num: op.lineA, text: op.text, type: "equal" },
        right: { num: op.lineB, text: op.text, type: "equal" },
      });
      i++;
    } else {
      const removes = [];
      const adds = [];
      while (i < ops.length && ops[i].type !== "equal") {
        if (ops[i].type === "remove") removes.push(ops[i]);
        else adds.push(ops[i]);
        i++;
      }
      const maxLen = Math.max(removes.length, adds.length);
      for (let k = 0; k < maxLen; k++) {
        const r = removes[k] || null;
        const a = adds[k] || null;
        rows.push({
          type: "change",
          left: r
            ? { num: r.lineA, text: r.text, type: "remove" }
            : { num: "", text: "", type: "empty" },
          right: a
            ? { num: a.lineB, text: a.text, type: "add" }
            : { num: "", text: "", type: "empty" },
        });
      }
    }
  }

  if (showFull) return rows;

  const keep = computeChangedRanges(rows, (r) => r.type !== "equal", 3);
  const filtered = [];
  let idx = 0;
  while (idx < rows.length) {
    if (!keep[idx]) {
      let skipped = 0;
      while (idx < rows.length && !keep[idx]) {
        skipped++;
        idx++;
      }
      filtered.push({ type: "hunk", skipped });
    } else {
      filtered.push(rows[idx]);
      idx++;
    }
  }
  return filtered;
}

export function extractScadEntries(content) {
  if (typeof content !== "string" || !content.trim()) {
    return { isMd: false, scadFiles: [], filesMap: {} };
  }
  const filesMap = getContentFileMap(content);
  if (filesMap) {
    const scadFiles = Object.keys(filesMap).filter((f) => isScadFilePath(f));
    return { isMd: true, scadFiles, filesMap };
  }
  if (/```(?:openscad|scad)?\r?\n/i.test(content)) {
    const generic = extractFilesFromMarkdown(content);
    const scadFiles = Object.keys(generic).filter((f) => isScadFilePath(f));
    return { isMd: true, scadFiles, filesMap: generic };
  }
  return { isMd: false, scadFiles: [], filesMap: {} };
}

export function resolveScadCompilationInput(content, preferredScadPath) {
  const { isMd, scadFiles, filesMap } = extractScadEntries(content);
  if (!isMd) {
    return {
      entryCode: typeof content === "string" ? content : "",
      extractedAdditionalFiles: {},
      targetScadPath: null,
    };
  }

  if (scadFiles.length === 0) {
    return {
      entryCode: "",
      extractedAdditionalFiles: {},
      targetScadPath: null,
    };
  }

  const targetScadPath =
    preferredScadPath && scadFiles.includes(preferredScadPath)
      ? preferredScadPath
      : scadFiles[0];

  const extractedAdditionalFiles = {};
  for (const [fName, fContent] of Object.entries(filesMap)) {
    if (fName !== targetScadPath) {
      extractedAdditionalFiles[fName] = fContent;
    }
  }

  return {
    entryCode: filesMap[targetScadPath] || "",
    extractedAdditionalFiles,
    targetScadPath,
  };
}

export function createUnifiedDiffTable(
  items,
  {
    hunkText = (skipped) =>
      `⋯ ${skipped} unchanged line${skipped === 1 ? "" : "s"} ⋯`,
  } = {},
) {
  const table = document.createElement("table");
  table.className = "vc-diff-table vc-diff-unified";
  const colgroup = document.createElement("colgroup");
  for (const cls of ["vc-col-ln", "vc-col-ln", "vc-col-sign", "vc-col-code"]) {
    const col = document.createElement("col");
    col.className = cls;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);
  const tbody = document.createElement("tbody");

  for (const item of items) {
    const tr = document.createElement("tr");
    if (item.type === "hunk") {
      tr.className = "vc-row-hunk";
      const td = document.createElement("td");
      td.colSpan = 4;
      td.textContent = hunkText(item.skipped);
      tr.appendChild(td);
    } else {
      const tdNumA = document.createElement("td");
      tdNumA.className = `vc-ln vc-cell-${item.type}`;
      tdNumA.textContent = item.lineA === null ? "" : String(item.lineA);

      const tdNumB = document.createElement("td");
      tdNumB.className = `vc-ln vc-cell-${item.type}`;
      tdNumB.textContent = item.lineB === null ? "" : String(item.lineB);

      const tdSign = document.createElement("td");
      tdSign.className = `vc-sign vc-cell-${item.type}`;
      tdSign.textContent =
        item.type === "add" ? "+" : item.type === "remove" ? "-" : " ";

      const tdCode = document.createElement("td");
      tdCode.className = `vc-code vc-cell-${item.type}`;
      tdCode.textContent = item.text;

      tr.append(tdNumA, tdNumB, tdSign, tdCode);
    }
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return table;
}
