"use strict";
// Daeva Hub: a plugin launcher for Aion 2 tools. It never touches the game:
// plugins run in their own always-on-top windows, sandboxed, with no network
// access, and talk to the hub only through a small message API.
const { app, BrowserWindow, ipcMain, protocol, dialog, shell, net, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { PluginManager } = require("./core/plugins");
const { Settings } = require("./core/settings");
const { fetchRepo, resolveRepoUrl } = require("./core/repos");

app.setName("Daeva Hub");
if (!app.requestSingleInstanceLock()) app.quit();

protocol.registerSchemesAsPrivileged([
  { scheme: "plugin", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

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
    if (!quitting) { settings.window(id).open = false; settings.save(); }
    notifyHub();
  });
  pluginWindows.set(id, win);
  ws.open = true;
  settings.save();
  notifyHub();
}

function closePlugin(id) {
  const w = pluginWindows.get(id);
  if (w && !w.isDestroyed()) w.close();
}

// ── repositories and updates ─────────────────────────────────────────────
async function refreshCatalog() {
  const repos = await Promise.all(settings.data.repos.map((r) => fetchRepo(r, net.fetch.bind(net))));
  const plugins = [];
  for (const r of repos) for (const p of r.plugins) plugins.push({ ...p, repoName: r.name || r.input });
  catalog = { repos: repos.map(({ plugins: list, ...rest }) => ({ ...rest, count: list.length })), plugins, checkedAt: new Date().toISOString() };
  notifyHub();
  return catalog;
}

function state() {
  const installed = pm.list(localFolders()).map((p) => ({ ...p, open: pluginWindows.has(p.id) }));
  return {
    version: app.getVersion(),
    settings: { repos: settings.data.repos, localFolders: settings.data.localFolders, checkOnStart: settings.data.checkOnStart },
    installed,
    catalog,
    updates: pm.updates(catalog.plugins, localFolders()).map((u) => ({ id: u.installed.id, from: u.installed.version, to: u.available.version })),
  };
}

function notifyHub() {
  if (hubWindow && !hubWindow.isDestroyed()) hubWindow.webContents.send("hub:changed");
}

async function installOrUpdate(id) {
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
handleHub("hub:uninstall", (id, keepData) => { closePlugin(String(id)); pm.uninstall(String(id), { keepData: keepData !== false }); notifyHub(); return state(); });
handleHub("hub:open", (id) => { openPlugin(String(id)); return state(); });
handleHub("hub:close", (id) => { closePlugin(String(id)); return state(); });
handleHub("hub:addRepo", async (input) => {
  const url = resolveRepoUrl(input); // throws a readable error for bad input
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
  return { id, name: p.name, version: p.version, permissions: p.permissions, local: p.local, opacity: ws.opacity, compact: ws.compact };
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
  if (typeof prefs?.opacity === "number") ws.opacity = Math.min(100, Math.max(20, prefs.opacity));
  if (typeof prefs?.compact === "boolean") ws.compact = prefs.compact;
  settings.save();
  return true;
});
ipcMain.handle("host:close", (e) => { closePlugin(pluginOf(e)); return true; });
ipcMain.handle("host:openHub", () => { createHub(); return true; });

// ── start ────────────────────────────────────────────────────────────────
app.on("second-instance", () => createHub());
app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => app.quit());

app.whenReady().then(async () => {
  const root = app.getPath("userData");
  settings = new Settings(path.join(root, "settings.json"));
  pm = new PluginManager(root, { fetch: net.fetch.bind(net) });
  protocol.handle("plugin", servePluginFile);
  createHub();
  for (const [id, ws] of Object.entries(settings.data.windows)) {
    if (ws.open) { try { openPlugin(id); } catch { ws.open = false; } }
  }
  settings.save();
  if (settings.data.checkOnStart && settings.data.repos.length) refreshCatalog().catch(() => {});
});
