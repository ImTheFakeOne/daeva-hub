"use strict";
// Daeva Hub: a plugin launcher for Aion 2 tools. It never touches the game:
// plugins run in their own always-on-top windows, sandboxed, with no network
// access, and talk to the hub only through a small message API.
const { app, BrowserWindow, ipcMain, protocol, dialog, shell, net, screen, globalShortcut, clipboard } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { PluginManager } = require("./core/plugins");
const { Settings } = require("./core/settings");
const { fetchRepo, resolveRepoUrl } = require("./core/repos");
const { createUpdater } = require("./updater");
const Theme = require("./core/theme");
let updater = null;

app.setName("Daeva Hub");
if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: "plugin", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Your own plugins: always listed, and installed automatically the first time.
// Other people's repositories are added by each user in Settings.
const OFFICIAL_REPOS = ["github.com/ImTheFakeOne/daeva-hub"];
const BUILTIN_DIR = path.join(__dirname, "builtin");

let hubWindow = null;
let pm = null;
let settings = null;
let quitting = false;
let catalog = { repos: [], plugins: [], checkedAt: null };
const pluginWindows = new Map(); // id -> BrowserWindow

const SDK = fs.readFileSync(path.join(__dirname, "host", "a2.js"), "utf8");
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain",
};
// No network for plugins: only their own files, the SDK, inline styles and images from data: URLs.
const CSP = "default-src 'none'; script-src plugin:; style-src plugin: 'unsafe-inline'; img-src plugin: data: blob:; font-src plugin: data:; media-src plugin: data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

const localFolders = () => settings.data.localFolders;
const findPlugin = (id) => pm.get(id, localFolders());

function servePluginFile(request) {
  const url = new URL(request.url);
  const id = url.hostname;
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const headers = { "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff" };
  if (rel === "_sdk/a2.js") return new Response(SDK, { headers: { ...headers, "Content-Type": "text/javascript" } });
  const plugin = findPlugin(id);
  if (!plugin || !plugin.id) return new Response("not found", { status: 404, headers });
  const root = path.resolve(plugin.dir);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || path.basename(file) === ".hub.json") return new Response("not found", { status: 404, headers });
  try {
    const body = fs.readFileSync(file);
    return new Response(body, { headers: { ...headers, "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" } });
  } catch {
    return new Response("not found", { status: 404, headers });
  }
}

// ── windows ──────────────────────────────────────────────────────────────
function createHub() {
  if (hubWindow && !hubWindow.isDestroyed()) { hubWindow.show(); hubWindow.focus(); return; }
  hubWindow = new BrowserWindow({
    width: 980, height: 720, minWidth: 720, minHeight: 520,
    title: "Daeva Hub", backgroundColor: "#0d1119", autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "hub", "preload.js"), contextIsolation: true, sandbox: true },
  });
  hubWindow.loadFile(path.join(__dirname, "hub", "index.html"));
  hubWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  hubWindow.on("closed", () => { hubWindow = null; });
}

function visibleBounds(b) {
  if (!b) return null;
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
  });
  return onScreen ? b : null;
}

function openPlugin(id) {
  const existing = pluginWindows.get(id);
  if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return; }
  const plugin = findPlugin(id);
  if (!plugin || !plugin.id) throw new Error("That plugin isn't installed.");
  const ws = settings.window(id);
  const panel = (plugin.ui && plugin.ui.panel) || {};
  const clamp = (v, d) => Math.min(1600, Math.max(240, Number(v) || d));
  const b = visibleBounds(ws.bounds) || { width: clamp(panel.width, 380), height: clamp(panel.height, 560) + 34 };
  const win = new BrowserWindow({
    ...b, minWidth: 240, minHeight: 160,
    frame: false, transparent: true, hasShadow: false, resizable: true,
    alwaysOnTop: true, skipTaskbar: false, title: plugin.name,
    webPreferences: { preload: path.join(__dirname, "host", "preload.js"), contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, "screen-saver"); // above borderless-fullscreen games
  win.loadFile(path.join(__dirname, "host", "host.html"), { query: { id } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  let t = null;
  const remember = () => {
    clearTimeout(t);
    t = setTimeout(() => { if (!win.isDestroyed()) { settings.window(id).bounds = win.getBounds(); settings.save(); } }, 400);
  };
  win.on("move", remember);
  win.on("resize", remember);
  win.on("closed", () => {
    pluginWindows.delete(id);
    stopMeterIfUnused();
    if (!quitting) { settings.window(id).open = false; settings.save(); }
    notifyHub();
  });
  pluginWindows.set(id, win);
  if (ws.locked) win.setIgnoreMouseEvents(true, { forward: true });
  ws.open = true;
  settings.save();
  notifyHub();
}

// ── colours ─────────────────────────────────────────────────────────────
function globalTheme() {
  const t = settings.data.theme || {};
  return Theme.normalize(t.tokens || Theme.presetTokens(t.preset), Theme.presetTokens(t.preset));
}
function themeFor(id) {
  const own = (settings.data.pluginThemes || {})[id];
  const tokens = own ? Theme.normalize(own, globalTheme()) : globalTheme();
  return { tokens, vars: Theme.toCssVars(tokens), light: Theme.isLight(tokens), own: !!own };
}
function broadcastTheme() {
  for (const [id, w] of pluginWindows) if (!w.isDestroyed()) w.webContents.send("host:event", { event: "theme", data: themeFor(id) });
  notifyHub();
}

// ── click-through ("locked") overlays ────────────────────────────────────
function setLocked(id, locked) {
  const ws = settings.window(id);
  ws.locked = !!locked;
  settings.save();
  const w = pluginWindows.get(id);
  if (w && !w.isDestroyed()) {
    w.setIgnoreMouseEvents(ws.locked, { forward: true });
    w.webContents.send("host:event", { event: "locked", data: ws.locked });
  }
  notifyHub();
}
// Ctrl+Alt+L locks every open overlay, or unlocks them all if any is locked.
function toggleAllLocks() {
  const ids = [...pluginWindows.keys()];
  const anyLocked = ids.some((id) => settings.window(id).locked);
  for (const id of ids) setLocked(id, !anyLocked);
}

// Puts a plugin back to how it was when installed, in the parts the player picks:
// window (position, size, opacity, fold, lock), colours (its own theme),
// settings (the storage keys its manifest lists in "settingsKeys"), data (everything it saved).
async function resetPlugin(id, what = {}) {
  const p = findPlugin(id);
  if (!p || !p.id) throw new Error("That plugin isn't installed.");
  const win = pluginWindows.get(id);
  const wasOpen = !!(win && !win.isDestroyed());
  if (wasOpen) { const closed = new Promise((r) => win.once("closed", r)); win.close(); await closed; }
  if (what.window) delete settings.data.windows[id];
  if (what.colours && settings.data.pluginThemes) delete settings.data.pluginThemes[id];
  if (what.data) pm.storageClear(id, null);
  else if (what.settings) pm.storageClear(id, settingsKeys(p));
  settings.save();
  if (wasOpen) openPlugin(id);
  notifyHub();
}
const settingsKeys = (p) => (Array.isArray(p.settingsKeys) ? p.settingsKeys.filter((k) => typeof k === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(k)) : []);

function closePlugin(id) {
  const w = pluginWindows.get(id);
  if (w && !w.isDestroyed()) w.close();
}

// ── repositories and updates ─────────────────────────────────────────────
async function refreshCatalog() {
  const sources = [...OFFICIAL_REPOS.map((r) => ({ r, official: true })), ...settings.data.repos.map((r) => ({ r, official: false }))];
  const repos = await Promise.all(sources.map(async ({ r, official }) => ({ ...(await fetchRepo(r, net.fetch.bind(net))), official })));
  const plugins = [];
  for (const r of repos) for (const p of r.plugins) plugins.push({ ...p, repoName: r.name || r.input, official: r.official });
  catalog = { repos: repos.map(({ plugins: list, ...rest }) => ({ ...rest, count: list.length })), plugins, checkedAt: new Date().toISOString() };
  await migrateFormerBuiltins();
  notifyHub();
  return catalog;
}

// The DPS meter used to ship inside the app. Anyone who had it switched on
// gets the plugin from the official repository instead, with their settings
// (same id, same saved data) and its window as they left it.
async function migrateFormerBuiltins() {
  const on = settings.data.enabledBuiltins || [];
  for (const id of on.filter((x) => !isBuiltin(x))) {
    const entry = catalog.plugins.find((p) => p.id === id && p.official);
    if (!entry) continue;
    try {
      if (!pm.list(localFolders()).some((p) => p.id === id)) {
        pm.fetch = net.fetch.bind(net);
        await pm.install(entry);
      }
      settings.data.enabledBuiltins = (settings.data.enabledBuiltins || []).filter((x) => x !== id);
      settings.save();
      if (settings.window(id).open && !pluginWindows.has(id)) { try { openPlugin(id); } catch {} }
    } catch { /* try again next start */ }
  }
}

// Plugins that ship inside the app (the DPS meter). Nothing is installed for
// you: they are listed in Browse like any other plugin, and "Install" just
// switches one on (settings.enabledBuiltins).
let builtins = []; // [{ dir, manifest }]
function loadBuiltins() {
  builtins = [];
  let names = [];
  try { names = fs.readdirSync(BUILTIN_DIR); } catch {}
  for (const n of names) {
    const dir = path.join(BUILTIN_DIR, n);
    try { builtins.push({ dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) }); } catch {}
  }
  syncBuiltins();
}
const isBuiltin = (id) => builtins.some((b) => b.manifest.id === id);
function syncBuiltins() {
  const on = (settings.data.enabledBuiltins ||= []);
  pm.builtinDirs = builtins.filter((b) => on.includes(b.manifest.id)).map((b) => b.dir);
}
function setBuiltinEnabled(id, enabled) {
  const on = (settings.data.enabledBuiltins ||= []).filter((x) => x !== id);
  if (enabled) on.push(id);
  settings.data.enabledBuiltins = on;
  settings.save();
  syncBuiltins();
}
const builtinEntries = () => builtins.map(({ manifest: m }) => ({
  id: m.id, name: m.name, author: m.author || "", description: m.description || "", version: m.version,
  tags: m.tags || [], official: true, builtin: true, repoName: "Daeva Hub (built in)",
}));

function state() {
  const installed = pm.list(localFolders()).map((p) => ({ ...p, open: pluginWindows.has(p.id) }));
  return {
    version: app.getVersion(),
    appUpdate: updater ? updater.state() : { status: "idle" },
    settings: { repos: settings.data.repos, officialRepos: OFFICIAL_REPOS, localFolders: settings.data.localFolders, checkOnStart: settings.data.checkOnStart },
    theme: { preset: (settings.data.theme || {}).preset || Theme.DEFAULT_PRESET, custom: !!(settings.data.theme || {}).tokens, tokens: globalTheme(), pluginThemes: settings.data.pluginThemes || {} },
    locked: Object.fromEntries(Object.entries(settings.data.windows).map(([id, w]) => [id, !!w.locked])),
    installed,
    catalog: { ...catalog, plugins: [...builtinEntries(), ...catalog.plugins] },
    updates: pm.updates(catalog.plugins, localFolders()).map((u) => ({ id: u.installed.id, from: u.installed.version, to: u.available.version })),
  };
}

function notifyHub() {
  if (hubWindow && !hubWindow.isDestroyed()) hubWindow.webContents.send("hub:changed");
}

async function installOrUpdate(id) {
  if (isBuiltin(id)) { setBuiltinEnabled(id, true); notifyHub(); return; }
  const entry = catalog.plugins.filter((p) => p.id === id).sort((a, b) => require("./core/version").compare(b.version, a.version))[0];
  if (!entry) throw new Error("That plugin isn't in any of your repositories.");
  const wasOpen = pluginWindows.has(id);
  if (wasOpen) closePlugin(id);
  pm.fetch = net.fetch.bind(net);
  await pm.install(entry);
  if (wasOpen) openPlugin(id);
  notifyHub();
}

async function updateAll() {
  const results = [];
  for (const u of pm.updates(catalog.plugins, localFolders())) {
    try { await installOrUpdate(u.installed.id); results.push({ id: u.installed.id, ok: true, to: u.available.version }); }
    catch (e) { results.push({ id: u.installed.id, ok: false, error: e.message }); }
  }
  return results;
}

// ── the DPS meter ────────────────────────────────────────────────────────
// daeva-meter.exe is A2Tools' capture and damage parser, run without a window.
// It runs only while a plugin with the "meter" permission has its window open,
// and its numbers go only to those windows.
let meter = null;
let meterStatus = { running: false, npcap: null, error: null };
let meterName = ""; // the player's character name, from the meter's settings; sent again on every start

function meterDir() {
  return app.isPackaged ? path.join(process.resourcesPath, "meter") : path.join(__dirname, "..", "meter-dist");
}
const meterWindows = () => [...pluginWindows].filter(([id, w]) => !w.isDestroyed() && (findPlugin(id)?.permissions || []).includes("meter"));

function sendMeter(event, data) {
  for (const [, w] of meterWindows()) w.webContents.send("host:event", { event, data });
}

function startMeter() {
  if (meter) return;
  const exe = path.join(meterDir(), process.platform === "win32" ? "daeva-meter.exe" : "daeva-meter");
  if (!fs.existsSync(exe)) {
    meterStatus = { running: false, npcap: null, error: "The meter isn't included in this build." };
    sendMeter("meter-status", meterStatus);
    return;
  }
  meter = spawn(exe, ["--data", path.join(meterDir(), "data")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  meterStatus = { running: true, npcap: null, error: null };
  if (meterName) { try { meter.stdin.write(`name ${meterName}\n`); } catch {} }
  let buf = "";
  meter.stdout.setEncoding("utf8");
  meter.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.type === "status") {
        meterStatus = { ...meterStatus, npcap: !!msg.npcap, error: msg.npcap ? null : "npcap-missing" };
        sendMeter("meter-status", meterStatus);
      } else if (msg.type === "dps") {
        sendMeter("meter", { dps: msg.data, ping: msg.ping, me: msg.me });
      }
    }
  });
  meter.stderr.on("data", () => {});
  meter.on("exit", (code) => {
    meter = null;
    meterStatus = { running: false, npcap: meterStatus.npcap, error: code ? `The meter stopped (code ${code}).` : null };
    sendMeter("meter-status", meterStatus);
  });
  meter.on("error", (e) => {
    meter = null;
    meterStatus = { running: false, npcap: null, error: e.code === "EACCES" || e.code === "EPERM" ? "Windows didn't allow the meter to start." : e.message };
    sendMeter("meter-status", meterStatus);
  });
}

function stopMeterIfUnused() {
  if (meter && !meterWindows().length) {
    try { meter.stdin.write("quit\n"); } catch {}
    const m = meter;
    setTimeout(() => { try { m.kill(); } catch {} }, 1500);
    meter = null;
  }
}

// ── IPC: the hub window ──────────────────────────────────────────────────
const fromHub = (e) => hubWindow && e.sender === hubWindow.webContents;
function handleHub(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!fromHub(e)) throw new Error("not allowed");
    return fn(...args);
  });
}
handleHub("hub:state", () => state());
handleHub("hub:refresh", async () => { await refreshCatalog(); return state(); });
handleHub("hub:install", async (id) => { await installOrUpdate(String(id)); return state(); });
handleHub("hub:updateAll", async () => { const results = await updateAll(); return { results, state: state() }; });
handleHub("hub:uninstall", (id, keepData) => {
  const p = findPlugin(String(id));
  closePlugin(String(id));
  if (p && p.builtin) { setBuiltinEnabled(String(id), false); notifyHub(); return state(); }
  pm.uninstall(String(id), { keepData: keepData !== false });
  notifyHub();
  return state();
});
handleHub("hub:open", (id) => { openPlugin(String(id)); return state(); });
handleHub("hub:close", (id) => { closePlugin(String(id)); return state(); });
handleHub("hub:addRepo", async (input) => {
  const url = resolveRepoUrl(input); // throws a readable error for bad input
  if (OFFICIAL_REPOS.some((r) => resolveRepoUrl(r) === url)) throw new Error("That's the official repository: it's always included.");
  const r = await fetchRepo(input, net.fetch.bind(net));
  if (r.error) throw new Error(r.error);
  if (!settings.data.repos.some((x) => resolveRepoUrl(x) === url)) settings.data.repos.push(String(input).trim());
  settings.save();
  await refreshCatalog();
  return state();
});
handleHub("hub:removeRepo", async (input) => {
  settings.data.repos = settings.data.repos.filter((r) => r !== input);
  settings.save();
  await refreshCatalog();
  return state();
});
handleHub("hub:addLocalFolder", async () => {
  const r = await dialog.showOpenDialog(hubWindow, { title: "Choose a plugin folder (the one with manifest.json)", properties: ["openDirectory"] });
  if (!r.canceled && r.filePaths[0] && !settings.data.localFolders.includes(r.filePaths[0])) {
    settings.data.localFolders.push(r.filePaths[0]);
    settings.save();
  }
  return state();
});
handleHub("hub:removeLocalFolder", (dir) => {
  settings.data.localFolders = settings.data.localFolders.filter((d) => d !== dir);
  settings.save();
  return state();
});
handleHub("hub:setCheckOnStart", (on) => { settings.data.checkOnStart = !!on; settings.save(); return state(); });
// When Appearance changes the background transparency, overlays follow it
// again even where their own slider was moved.
function followThemeOpacity(ids, before, after) {
  if (before.bgOpacity === after.bgOpacity) return;
  for (const id of ids) { const w = settings.data.windows[id]; if (w) w.opacity = null; }
}
handleHub("hub:setTheme", (t) => {
  const before = globalTheme();
  const preset = Theme.PRESETS[t && t.preset] ? t.preset : Theme.DEFAULT_PRESET;
  settings.data.theme = { preset, tokens: t && t.tokens ? Theme.normalize(t.tokens, Theme.presetTokens(preset)) : null };
  const own = settings.data.pluginThemes || {};
  followThemeOpacity(Object.keys(settings.data.windows).filter((id) => !own[id]), before, globalTheme());
  settings.save();
  broadcastTheme();
  return state();
});
handleHub("hub:setPluginTheme", (id, tokens) => {
  id = String(id);
  const all = (settings.data.pluginThemes ||= {});
  const before = themeFor(id).tokens;
  if (tokens) all[id] = Theme.normalize(tokens, globalTheme()); else delete all[id];
  followThemeOpacity([id], before, themeFor(id).tokens);
  settings.save();
  broadcastTheme();
  return state();
});
handleHub("hub:resetPlugin", async (id, what) => { await resetPlugin(String(id), what || {}); return state(); });
handleHub("hub:resetAll", async () => {
  for (const p of pm.list(localFolders())) {
    if (p.id && !p.error) await resetPlugin(p.id, { window: true, colours: true, settings: true });
  }
  return state();
});
handleHub("hub:setLocked", (id, locked) => { setLocked(String(id), !!locked); return state(); });
handleHub("hub:checkAppUpdate", async () => { if (updater) await updater.check(); return state(); });
handleHub("hub:installAppUpdate", () => (updater ? updater.install() : false));
handleHub("hub:openLink", (url) => {
  const u = new URL(String(url));
  if (u.protocol === "https:") shell.openExternal(u.toString());
});
handleHub("hub:openDataFolder", () => shell.openPath(app.getPath("userData")));

// ── IPC: plugin windows (each may only touch its own plugin) ─────────────
function pluginOf(e) {
  for (const [id, w] of pluginWindows) if (!w.isDestroyed() && w.webContents === e.sender) return id;
  throw new Error("not a plugin window");
}
ipcMain.handle("host:hello", (e) => {
  const id = pluginOf(e);
  const p = findPlugin(id);
  const ws = settings.window(id);
  return { id, name: p.name, version: p.version, permissions: p.permissions, local: p.local, builtin: !!p.builtin, opacity: ws.opacity, compact: ws.compact, locked: !!ws.locked, theme: themeFor(id) };
});
ipcMain.handle("host:storageGet", (e, key) => {
  const id = pluginOf(e);
  if (!findPlugin(id).permissions.includes("storage")) throw new Error('the plugin lacks the "storage" permission');
  return pm.storageGet(id, String(key));
});
ipcMain.handle("host:storageSet", (e, key, value) => {
  const id = pluginOf(e);
  if (!findPlugin(id).permissions.includes("storage")) throw new Error('the plugin lacks the "storage" permission');
  pm.storageSet(id, String(key), String(value));
  return true;
});
ipcMain.handle("host:panel", (e, prefs) => {
  const ws = settings.window(pluginOf(e));
  if (typeof prefs?.opacity === "number") ws.opacity = Math.min(100, Math.max(0, prefs.opacity));
  if (typeof prefs?.compact === "boolean") ws.compact = prefs.compact;
  settings.save();
  if (prefs?.locked === true) setLocked(pluginOf(e), true);
  return true;
});
ipcMain.handle("host:screenshot", async (e) => {
  const id = pluginOf(e);
  const img = await pluginWindows.get(id).webContents.capturePage();
  clipboard.writeImage(img);
  const dir = path.join(app.getPath("pictures"), "Daeva Hub");
  fs.mkdirSync(dir, { recursive: true });
  const name = `${id}-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}.png`;
  fs.writeFileSync(path.join(dir, name), img.toPNG());
  return { name };
});
// Saving files for plugins (permission "save"): always through a Save dialog,
// so the player picks the place. Plugins only get back the file name and a
// token they can use to show it in its folder.
const savedFiles = new Map(); // token → full path
const SAVE_TYPES = { json: ["JSON", "application/json"], csv: ["CSV", "text/csv"], txt: ["Text", "text/plain"] };
ipcMain.handle("host:saveFile", async (e, name, text, type) => {
  const id = pluginOf(e);
  if (!findPlugin(id).permissions.includes("save")) throw new Error('the plugin lacks the "save" permission');
  const ext = SAVE_TYPES[type] ? type : "txt";
  const body = String(text ?? "");
  if (body.length > 20 * 1024 * 1024) throw new Error("that file is larger than 20 MB");
  let base = String(name || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").replace(/^\.+/, "").trim().slice(0, 120) || "file";
  if (!base.toLowerCase().endsWith("." + ext)) base += "." + ext;
  const dir = path.join(app.getPath("documents"), "Daeva Hub", id);
  fs.mkdirSync(dir, { recursive: true });
  const r = await dialog.showSaveDialog(pluginWindows.get(id), {
    title: "Save", defaultPath: path.join(dir, base), filters: [{ name: SAVE_TYPES[ext][0], extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return { saved: false };
  fs.writeFileSync(r.filePath, body, "utf8");
  const token = require("crypto").randomUUID();
  savedFiles.set(token, r.filePath);
  return { saved: true, name: path.basename(r.filePath), id: token };
});
ipcMain.handle("host:revealFile", (e, token) => {
  pluginOf(e);
  const file = savedFiles.get(String(token));
  if (file && fs.existsSync(file)) shell.showItemInFolder(file);
  return !!file;
});
ipcMain.handle("host:close", (e) => { closePlugin(pluginOf(e)); return true; });
ipcMain.handle("host:meter", (e, cmd, arg) => {
  const id = pluginOf(e);
  if (!findPlugin(id).permissions.includes("meter")) throw new Error('the plugin lacks the "meter" permission');
  if (cmd === "start") { startMeter(); return meterStatus; }
  if (cmd === "status") return meterStatus;
  if (cmd === "reset" && meter) { meter.stdin.write("reset\n"); return true; }
  if (cmd === "name") {
    meterName = String(arg || "").replace(/[\r\n]/g, " ").trim().slice(0, 40);
    if (meter) { try { meter.stdin.write(`name ${meterName}\n`); } catch {} }
    return true;
  }
  if (cmd === "npcap") { shell.openExternal("https://npcap.com/#download"); return true; }
  return false;
});
ipcMain.handle("host:openHub", () => { createHub(); return true; });

// ── start ────────────────────────────────────────────────────────────────
app.on("second-instance", () => createHub());
app.on("will-quit", () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on("before-quit", () => { quitting = true; if (meter) { try { meter.kill(); } catch {} } });
app.on("window-all-closed", () => app.quit());

app.whenReady().then(async () => {
  const root = app.getPath("userData");
  settings = new Settings(path.join(root, "settings.json"));
  pm = new PluginManager(root, { fetch: net.fetch.bind(net) });
  loadBuiltins();
  try { globalShortcut.register("CommandOrControl+Alt+L", toggleAllLocks); } catch {}
  protocol.handle("plugin", servePluginFile);
  createHub();
  updater = createUpdater(() => notifyHub());
  for (const [id, ws] of Object.entries(settings.data.windows)) {
    if (ws.open) { try { openPlugin(id); } catch { ws.open = false; } }
  }
  settings.save();
  // Always look at the official repository on start, so your plugins arrive
  // (and update) without anyone having to add anything.
  refreshCatalog().catch(() => {});
});
