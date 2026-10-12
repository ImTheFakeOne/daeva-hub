"use strict";
// The plugin window's frame (not the plugin itself, which runs in a
// sandboxed frame inside it and never sees this).
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("host", {
  hello: () => ipcRenderer.invoke("host:hello"),
  storageGet: (key) => ipcRenderer.invoke("host:storageGet", key),
  storageSet: (key, value) => ipcRenderer.invoke("host:storageSet", key, value),
  panel: (prefs) => ipcRenderer.invoke("host:panel", prefs),
  close: () => ipcRenderer.invoke("host:close"),
  screenshot: () => ipcRenderer.invoke("host:screenshot"),
  openHub: () => ipcRenderer.invoke("host:openHub"),
  meter: (cmd) => ipcRenderer.invoke("host:meter", cmd),
  onEvent: (fn) => { ipcRenderer.on("host:event", (_e, msg) => fn(msg)); },
});
