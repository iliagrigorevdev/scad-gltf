import test from "node:test";
import assert from "node:assert";
import { buildGodotPck } from "../editor/src/godot-pck.js";

function parsePckArchive(buffer) {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const decoder = new TextDecoder();

  const header = {
    magic: view.getUint32(0, true),
    formatVersion: view.getUint32(4, true),
    godotMajor: view.getUint32(8, true),
    godotMinor: view.getUint32(12, true),
    godotPatch: view.getUint32(16, true),
    packFlags: view.getUint32(20, true),
    fileBase: view.getBigUint64(24, true),
    fileCount: view.getUint32(96, true),
  };

  let pos = 100;
  const entries = [];
  for (let i = 0; i < header.fileCount; i++) {
    const paddedPathLen = view.getUint32(pos, true);
    pos += 4;
    const rawPathBytes = buffer.subarray(pos, pos + paddedPathLen);
    const pathStr = decoder.decode(rawPathBytes).replace(/\0+$/, "");
    pos += paddedPathLen;

    const offset = Number(view.getBigUint64(pos, true));
    pos += 8;
    const size = Number(view.getBigUint64(pos, true));
    pos += 8;
    const md5 = buffer.subarray(pos, pos + 16);
    pos += 16;
    const flags = view.getUint32(pos, true);
    pos += 4;

    entries.push({
      path: pathStr,
      paddedPathLen,
      offset,
      size,
      md5,
      flags,
      data: buffer.subarray(offset, offset + size),
    });
  }

  return { header, entries };
}

test("buildGodotPck - Writes valid Godot 4 PCK v2 header and entries", () => {
  const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
  const pck = buildGodotPck({
    "project.godot": "config_version=5\n",
    "res://scripts/player.gd": "extends Node\n",
    "\\nested\\dir\\data.bin": binaryData,
    "/leading/slash.txt": "hello",
  });

  assert.ok(pck instanceof Uint8Array);
  const { header, entries } = parsePckArchive(pck);

  assert.strictEqual(header.magic, 0x43504447);
  assert.strictEqual(header.formatVersion, 2);
  assert.strictEqual(header.godotMajor, 4);
  assert.strictEqual(header.godotMinor, 0);
  assert.strictEqual(header.godotPatch, 0);
  assert.strictEqual(header.packFlags, 0);
  assert.strictEqual(header.fileBase, 0n);
  assert.strictEqual(header.fileCount, 4);

  const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
  assert.ok(byPath["res://project.godot"]);
  assert.ok(byPath["res://scripts/player.gd"]);
  assert.ok(byPath["res://nested/dir/data.bin"]);
  assert.ok(byPath["res://leading/slash.txt"]);

  const decoder = new TextDecoder();
  assert.strictEqual(
    decoder.decode(byPath["res://project.godot"].data),
    "config_version=5\n",
  );
  assert.strictEqual(
    decoder.decode(byPath["res://scripts/player.gd"].data),
    "extends Node\n",
  );
  assert.deepStrictEqual(byPath["res://nested/dir/data.bin"].data, binaryData);
  assert.strictEqual(
    decoder.decode(byPath["res://leading/slash.txt"].data),
    "hello",
  );

  for (const entry of entries) {
    assert.strictEqual(entry.paddedPathLen % 4, 0);
    assert.strictEqual(entry.offset % 32, 0);
    assert.strictEqual(entry.flags, 0);
    assert.ok(entry.md5.every((b) => b === 0));
  }
});

test("buildGodotPck - Supports Map inputs, ArrayBuffer values, and empty archives", () => {
  const emptyPck = buildGodotPck(new Map());
  const emptyParsed = parsePckArchive(emptyPck);
  assert.strictEqual(emptyParsed.header.fileCount, 0);
  assert.strictEqual(emptyParsed.entries.length, 0);
  assert.strictEqual(emptyPck.byteLength % 32, 0);

  const rawBuf = new Uint8Array([10, 20, 30]).buffer;
  const mapInput = new Map([
    ["empty.txt", ""],
    ["raw.bin", rawBuf],
  ]);
  const mapPck = buildGodotPck(mapInput);
  const mapParsed = parsePckArchive(mapPck);

  assert.strictEqual(mapParsed.header.fileCount, 2);
  assert.strictEqual(mapParsed.entries[0].path, "res://empty.txt");
  assert.strictEqual(mapParsed.entries[0].size, 0);
  assert.strictEqual(mapParsed.entries[1].path, "res://raw.bin");
  assert.deepStrictEqual(
    mapParsed.entries[1].data,
    new Uint8Array([10, 20, 30]),
  );
});
