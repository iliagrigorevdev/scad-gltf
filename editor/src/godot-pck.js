const PCK_MAGIC = 0x43504447; // "GDPC"
const PCK_FORMAT_VERSION = 2;
const GODOT_VERSION_MAJOR = 4;
const GODOT_VERSION_MINOR = 0;
const GODOT_VERSION_PATCH = 0;
const HEADER_SIZE = 100; // 6 * uint32 + 1 * uint64 + 16 * uint32 + 1 * uint32

function alignTo(value, alignment) {
  const rem = value % alignment;
  return rem === 0 ? value : value + (alignment - rem);
}

/**
 * Packs a map of Godot virtual paths ("res://...") -> string | Uint8Array
 * into a Godot 4 PCK v2 archive.
 *
 * @param {Map<string, string | Uint8Array> | Record<string, string | Uint8Array>} files
 * @returns {Uint8Array}
 */
export function buildGodotPck(files) {
  const encoder = new TextEncoder();
  const entriesIterable =
    files instanceof Map ? files.entries() : Object.entries(files);

  const preparedEntries = [];
  let dirTableSize = 0;

  for (const [rawPath, rawContent] of entriesIterable) {
    let resPath = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!resPath.startsWith("res://")) {
      resPath = `res://${resPath}`;
    }

    const pathBytes = encoder.encode(resPath);
    const paddedPathLen = alignTo(pathBytes.length, 4);
    const dataBytes =
      typeof rawContent === "string"
        ? encoder.encode(rawContent)
        : rawContent instanceof Uint8Array
          ? rawContent
          : new Uint8Array(rawContent);

    preparedEntries.push({
      pathBytes,
      paddedPathLen,
      dataBytes,
      offset: 0,
    });

    // 4 (path len) + paddedPathLen + 8 (offset) + 8 (size) + 16 (md5) + 4 (flags)
    dirTableSize += 40 + paddedPathLen;
  }

  let dataCursor = alignTo(HEADER_SIZE + dirTableSize, 32);
  for (const entry of preparedEntries) {
    entry.offset = dataCursor;
    dataCursor = alignTo(dataCursor + entry.dataBytes.byteLength, 32);
  }

  const pck = new Uint8Array(dataCursor);
  const view = new DataView(pck.buffer);

  // Header
  let pos = 0;
  view.setUint32(pos, PCK_MAGIC, true);
  pos += 4;
  view.setUint32(pos, PCK_FORMAT_VERSION, true);
  pos += 4;
  view.setUint32(pos, GODOT_VERSION_MAJOR, true);
  pos += 4;
  view.setUint32(pos, GODOT_VERSION_MINOR, true);
  pos += 4;
  view.setUint32(pos, GODOT_VERSION_PATCH, true);
  pos += 4;
  view.setUint32(pos, 0, true); // pack_flags = 0 (absolute offsets)
  pos += 4;
  view.setBigUint64(pos, 0n, true); // file_base = 0
  pos += 8;

  // 16 reserved uint32s (64 bytes, already zeroed)
  pos += 64;

  view.setUint32(pos, preparedEntries.length, true);
  pos += 4;

  // File directory entries
  for (const entry of preparedEntries) {
    view.setUint32(pos, entry.paddedPathLen, true);
    pos += 4;

    pck.set(entry.pathBytes, pos);
    pos += entry.paddedPathLen;

    view.setBigUint64(pos, BigInt(entry.offset), true);
    pos += 8;

    view.setBigUint64(pos, BigInt(entry.dataBytes.byteLength), true);
    pos += 8;

    // 16 bytes MD5 placeholder (zeroed)
    pos += 16;

    view.setUint32(pos, 0, true); // flags = 0
    pos += 4;
  }

  // File contents
  for (const entry of preparedEntries) {
    pck.set(entry.dataBytes, entry.offset);
  }

  return pck;
}
