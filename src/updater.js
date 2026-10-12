"use strict";
// Updates Daeva Hub itself from the GitHub Releases of ImTheFakeOne/daeva-hub.
// On start (and every few hours) it looks for a newer release, downloads it in
// the background, and the hub shows "Restart to update". Plugins update
// separately, from their repositories.
const { app } = require("electron");

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

function createUpdater(onChange) {
  let state = { status: "idle", version: null, percent: 0, error: null };
  const set = (patch) => { state = { ...state, ...patch }; onChange(state); };

  if (!app.isPackaged) {
    state.status = "dev";
    return { state: () => state, check: async () => state, install: () => false };
  }

  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;  // a downloaded update also installs when you quit normally
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: null }));
  autoUpdater.on("update-not-available", () => set({ status: "current", version: null }));
  autoUpdater.on("update-available", (info) => set({ status: "downloading", version: info.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version, percent: 100 }));
  autoUpdater.on("error", (e) => set({ status: "error", error: String((e && e.message) || e).split("\n")[0].slice(0, 200) }));

  const check = async () => {
    if (state.status === "downloading" || state.status === "ready") return state;
    try { await autoUpdater.checkForUpdates(); } catch (e) { set({ status: "error", error: String(e.message || e).split("\n")[0] }); }
    return state;
  };
  setTimeout(check, 5000);
  setInterval(check, CHECK_EVERY_MS).unref?.();

  return {
    state: () => state,
    check,
    // Quits, runs the new installer silently, and starts Daeva Hub again.
    install: () => {
      if (state.status !== "ready") return false;
      setImmediate(() => autoUpdater.quitAndInstall(true, true));
      return true;
    },
  };
}

module.exports = { createUpdater };
