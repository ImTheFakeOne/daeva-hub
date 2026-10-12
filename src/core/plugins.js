"use strict";
// Installed plugins: where they live, installing and updating them from a
// repository's download, removing them, and each plugin's own saved data.
//
//   <root>/plugins/<id>/            the plugin's files (manifest.json, index.html, …)
//   <root>/plugins/<id>/.hub.json   where it came from (repository, download)
//   <root>/plugin-data/<id>/<key>.json   what the plugin saved
const fs = require("fs");
const path = require("path");
const { extract } = require("./zip");
const { newer } = require("./version");
const { ID } = require("./repos");

const MAX_DOWNLOAD = 50 * 1024 * 1024;
const KEY = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_STORED = 1024 * 1024;

function readManifest(dir) {
  const file = path.join(dir, "manifest.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!m || !ID.test(String(m.id || ""))) throw new Error("manifest.json needs an id of lowercase letters, digits and '-'");
  if (!fs.existsSync(path.join(dir, "index.html"))) throw new Error("the plugin has no index.html");
  return {
    id: m.id,
    name: String(m.name || m.id).slice(0, 60),
    version: String(m.version || "0.0.0").slice(0, 30),
    author: String(m.author || "").slice(0, 60),
    description: String(m.description || "").slice(0, 600),
    permissions: Array.isArray(m.permissions) ? m.permissions.map(String) : [],
    ui: m.ui && typeof m.ui === "object" ? m.ui : {},
  };
}

/** The folder inside an unpacked download that holds manifest.json. */
function findPluginRoot(dir, depth = 0) {
  if (fs.existsSync(path.join(dir, "manifest.json"))) return dir;
  if (depth >= 2) return null;
  for (const name of fs.readdirSync(dir)) {
    const sub = path.join(dir, name);
    if (fs.statSync(sub).isDirectory()) {
      const found = findPluginRoot(sub, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

class PluginManager {
  constructor(root, { fetch: fetchFn = fetch } = {}) {
    this.root = root;
    this.pluginsDir = path.join(root, "plugins");
    this.dataDir = path.join(root, "plugin-data");
    this.tmpDir = path.join(root, "tmp");
    this.fetch = fetchFn;
    for (const d of [this.pluginsDir, this.dataDir, this.tmpDir]) fs.mkdirSync(d, { recursive: true });
  }

  /** Installed plugins plus any local (developer) folders. */
  list(localFolders = []) {
    const out = [];
    for (const name of fs.readdirSync(this.pluginsDir)) {
      const dir = path.join(this.pluginsDir, name);
      try {
        const m = readManifest(dir);
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, ".hub.json"), "utf8")); } catch {}
        out.push({ ...m, dir, local: false, source: meta.source || "", installedAt: meta.installedAt || null });
      } catch { /* not a plugin folder; skip */ }
    }
    for (const dir of localFolders) {
      try {
        const m = readManifest(dir);
        const i = out.findIndex((p) => p.id === m.id);
        if (i >= 0) out.splice(i, 1); // a local folder wins over an installed copy
        out.push({ ...m, dir, local: true, source: "", installedAt: null });
      } catch (e) {
        out.push({ id: null, name: path.basename(dir), dir, local: true, error: e.message });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id, localFolders = []) {
    return this.list(localFolders).find((p) => p.id === id) || null;
  }

  /** Download a repository entry and install it (or replace the installed copy). */
  async install(entry) {
    if (!ID.test(entry.id)) throw new Error("invalid plugin id");
    const res = await this.fetch(entry.download, { redirect: "follow" });
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD) throw new Error("The download is larger than 50 MB.");
    const work = fs.mkdtempSync(path.join(this.tmpDir, entry.id + "-"));
    try {
      extract(buf, path.join(work, "x"));
      const found = findPluginRoot(path.join(work, "x"));
      if (!found) throw new Error("The download has no manifest.json.");
      const m = readManifest(found);
      if (m.id !== entry.id) throw new Error(`The download is plugin "${m.id}", not "${entry.id}".`);
      fs.writeFileSync(path.join(found, ".hub.json"), JSON.stringify({
        source: entry.source || "", download: entry.download, installedAt: new Date().toISOString(),
      }, null, 2));
      const target = path.join(this.pluginsDir, entry.id);
      const old = path.join(work, "old");
      if (fs.existsSync(target)) fs.renameSync(target, old);
      try {
        fs.renameSync(found, target);
      } catch (e) {
        if (fs.existsSync(old)) fs.renameSync(old, target); // put the previous version back
        throw e;
      }
      return m;
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  uninstall(id, { keepData = true } = {}) {
    if (!ID.test(id)) throw new Error("invalid plugin id");
    fs.rmSync(path.join(this.pluginsDir, id), { recursive: true, force: true });
    if (!keepData) fs.rmSync(path.join(this.dataDir, id), { recursive: true, force: true });
  }

  /** Installed (non-local) plugins with a newer version in the catalog. */
  updates(catalog, localFolders = []) {
    const out = [];
    for (const p of this.list(localFolders)) {
      if (!p.id || p.local) continue;
      const best = catalog.filter((e) => e.id === p.id).sort((a, b) => (newer(a.version, b.version) ? -1 : 1))[0];
      if (best && newer(best.version, p.version)) out.push({ installed: p, available: best });
    }
    return out;
  }

  // ── per-plugin storage ──
  dataFile(id, key) {
    if (!ID.test(id)) throw new Error("invalid plugin id");
    if (!KEY.test(key)) throw new Error("storage keys are letters, digits, '-' and '_'");
    return path.join(this.dataDir, id, key + ".json");
  }
  storageGet(id, key) {
    try { return fs.readFileSync(this.dataFile(id, key), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }
  storageSet(id, key, value) {
    const text = String(value);
    if (text.length > MAX_STORED) throw new Error("that value is larger than 1 MB");
    const file = this.dataFile(id, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file); // never leave a half-written file behind
  }
}

module.exports = { PluginManager, readManifest, findPluginRoot };
