"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
contextBridge.exposeInMainWorld("hub", {
  state: call("hub:state"),
  refresh: call("hub:refresh"),
  install: call("hub:install"),
  updateAll: call("hub:updateAll"),
  uninstall: call("hub:uninstall"),
  open: call("hub:open"),
  close: call("hub:close"),
  addRepo: call("hub:addRepo"),
  removeRepo: call("hub:removeRepo"),
  addLocalFolder: call("hub:addLocalFolder"),
  removeLocalFolder: call("hub:removeLocalFolder"),
  setCheckOnStart: call("hub:setCheckOnStart"),
  openLink: call("hub:openLink"),
  checkAppUpdate: call("hub:checkAppUpdate"),
  installAppUpdate: call("hub:installAppUpdate"),
  openDataFolder: call("hub:openDataFolder"),
  onChanged: (fn) => { ipcRenderer.on("hub:changed", () => fn()); },
});
