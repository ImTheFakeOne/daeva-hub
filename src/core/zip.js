// Minimal ZIP reader: enough to unpack plugin downloads (stored or deflated
// entries, as GitHub archives and every common zip tool produce). No
// third-party code, so nothing extra ships with the app.
"use strict";
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");

const MAX_ENTRIES = 5000;
const MAX_TOTAL = 200 * 1024 * 1024; // refuse archives that unpack past 200 MB

function readEntries(buf) {
  // End of central directory: signature 0x06054b50, within the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error("zip has too many files");
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip central directory is damaged");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/");
    out.push({ name, method, csize, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function entryData(buf, e) {
  if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error(`zip entry ${e.name} is damaged`);
  const nameLen = buf.readUInt16LE(e.local + 26);
  const extraLen = buf.readUInt16LE(e.local + 28);
  const start = e.local + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(e.size, 1) });
  throw new Error(`zip entry ${e.name} uses an unsupported compression method`);
}

/** Unpack `buf` into `dir`. Refuses any entry that would land outside `dir`. */
function extract(buf, dir) {
  const root = path.resolve(dir);
  let total = 0;
  for (const e of readEntries(buf)) {
    if (!e.name || e.name.startsWith("/") || /(^|\/)\.\.(\/|$)/.test(e.name) || /^[a-zA-Z]:/.test(e.name)) {
      throw new Error(`zip contains an unsafe path: ${e.name}`);
    }
    const target = path.resolve(root, e.name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`zip contains an unsafe path: ${e.name}`);
    if (e.name.endsWith("/")) { fs.mkdirSync(target, { recursive: true }); continue; }
    total += e.size;
    if (total > MAX_TOTAL) throw new Error("zip unpacks to more than 200 MB");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entryData(buf, e));
  }
}

module.exports = { extract, readEntries };
