// node --test test/
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { resolveRepoUrl, normalize, fetchRepo } = require("../src/core/repos");
const { compare, newer } = require("../src/core/version");
const { PluginManager } = require("../src/core/plugins");
const { extract } = require("../src/core/zip");

// A tiny zip writer for the tests (deflated entries).
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

const fakeFetch = (routes) => async (url) => {
  const body = routes[url];
  if (body === undefined) return { ok: false, status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return { ok: true, status: 200, text: async () => buf.toString("utf8"), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
};

test("repository addresses", () => {
  assert.equal(resolveRepoUrl("github.com/ImTheFakeOne/aion2-checklist"), "https://raw.githubusercontent.com/ImTheFakeOne/aion2-checklist/HEAD/repo.json");
  assert.equal(resolveRepoUrl("https://github.com/a/b.git"), "https://raw.githubusercontent.com/a/b/HEAD/repo.json");
  assert.equal(resolveRepoUrl("https://github.com/a/b/blob/main/x/repo.json"), "https://raw.githubusercontent.com/a/b/main/x/repo.json");
  assert.equal(resolveRepoUrl("https://example.com/repo.json"), "https://example.com/repo.json");
  assert.throws(() => resolveRepoUrl("http://example.com/repo.json"));
  assert.throws(() => resolveRepoUrl(""));
});

test("repository files are checked and cleaned up", () => {
  const r = normalize({ name: "Mine", plugins: [
    { id: "good-one", name: "Good", version: "1.2.0", download: "https://x/y.zip" },
    { id: "Bad Id", download: "https://x/y.zip" },
    { id: "no-download" },
    { id: "insecure", download: "http://x/y.zip" },
  ] }, "src");
  assert.equal(r.name, "Mine");
  assert.deepEqual(r.plugins.map((p) => p.id), ["good-one"]);
  // Dalamud-style field names work too
  assert.equal(normalize([{ InternalName: "dal", Name: "D", AssemblyVersion: "2.0", DownloadLinkInstall: "https://x/z.zip" }], "s").plugins[0].version, "2.0");
});

test("versions", () => {
  assert.ok(newer("1.10.0", "1.9.9"));
  assert.ok(newer("v0.3.1", "0.3.0"));
  assert.ok(!newer("0.3.0", "0.3.0"));
  assert.ok(newer("1.0.0", "1.0.0-beta"));
  assert.equal(compare("1.0", "1.0.0"), 0);
});

test("unsafe zip paths are refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hubzip-"));
  assert.throws(() => extract(makeZip({ "../evil.txt": "x" }), dir), /unsafe/);
  assert.throws(() => extract(makeZip({ "a/../../evil.txt": "x" }), dir), /unsafe/);
  assert.ok(!fs.existsSync(path.join(dir, "..", "evil.txt")));
});

test("install, update, storage and uninstall", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-"));
  const v1 = makeZip({
    "aion2-checklist-0.3.0/manifest.json": JSON.stringify({ id: "aion2-checklist", name: "Aion 2 Checklist", version: "0.3.0" }),
    "aion2-checklist-0.3.0/index.html": "<p>v1</p>",
    "aion2-checklist-0.3.0/img/a.png": "png",
  });
  const v2 = makeZip({
    "manifest.json": JSON.stringify({ id: "aion2-checklist", name: "Aion 2 Checklist", version: "0.4.0" }),
    "index.html": "<p>v2</p>",
  });
  const wrong = makeZip({ "manifest.json": JSON.stringify({ id: "something-else" }), "index.html": "" });
  const repo = { plugins: [{ id: "aion2-checklist", name: "Aion 2 Checklist", version: "0.3.0", download: "https://dl/v1.zip" }] };
  const fetchFn = fakeFetch({
    "https://raw.githubusercontent.com/me/plugins/HEAD/repo.json": repo,
    "https://dl/v1.zip": v1, "https://dl/v2.zip": v2, "https://dl/wrong.zip": wrong,
  });
  const pm = new PluginManager(root, { fetch: fetchFn });

  const r = await fetchRepo("github.com/me/plugins", fetchFn);
  assert.equal(r.error, undefined);
  await pm.install(r.plugins[0]);
  let list = pm.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].version, "0.3.0");
  assert.equal(fs.readFileSync(path.join(list[0].dir, "img", "a.png"), "utf8"), "png");

  pm.storageSet("aion2-checklist", "state", '{"x":1}');
  assert.equal(pm.storageGet("aion2-checklist", "state"), '{"x":1}');
  assert.throws(() => pm.storageSet("aion2-checklist", "../x", "1"));

  const catalog = [{ ...r.plugins[0], version: "0.4.0", download: "https://dl/v2.zip" }];
  const ups = pm.updates(catalog);
  assert.equal(ups.length, 1);
  await pm.install(ups[0].available);
  list = pm.list();
  assert.equal(list[0].version, "0.4.0");
  assert.equal(fs.readFileSync(path.join(list[0].dir, "index.html"), "utf8"), "<p>v2</p>");
  assert.ok(!fs.existsSync(path.join(list[0].dir, "img")), "old files are gone after an update");
  assert.equal(pm.updates(catalog).length, 0);
  assert.equal(pm.storageGet("aion2-checklist", "state"), '{"x":1}', "data survives an update");

  await assert.rejects(pm.install({ id: "aion2-checklist", download: "https://dl/wrong.zip" }), /not "aion2-checklist"/);
  assert.equal(pm.list()[0].version, "0.4.0", "a failed install leaves the installed copy alone");

  const missing = await fetchRepo("https://nowhere/repo.json", fetchFn);
  assert.match(missing.error, /404/);

  pm.uninstall("aion2-checklist");
  assert.equal(pm.list().length, 0);
  assert.equal(pm.storageGet("aion2-checklist", "state"), '{"x":1}', "uninstall keeps data by default");
});

test("local developer folders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-"));
  const dev = fs.mkdtempSync(path.join(os.tmpdir(), "dev-"));
  fs.writeFileSync(path.join(dev, "manifest.json"), JSON.stringify({ id: "my-dev", name: "Dev", version: "0.0.1" }));
  fs.writeFileSync(path.join(dev, "index.html"), "");
  const pm = new PluginManager(root, { fetch: fakeFetch({}) });
  const list = pm.list([dev, path.join(dev, "missing")]);
  assert.equal(list.find((p) => p.id === "my-dev").local, true);
  assert.ok(list.find((p) => p.error), "a broken folder is listed with its error");
});
