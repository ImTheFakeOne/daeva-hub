"use strict";
// The launcher's own settings, in one JSON file.
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  repos: [],            // repository addresses, as the user entered them
  localFolders: [],     // developer plugin folders
  checkOnStart: true,   // look for plugin updates when the launcher starts
  windows: {},          // per plugin: { open, bounds, opacity, compact }
  enabledBuiltins: [],
  theme: { preset: "daeva-gold", tokens: null }, // the global colours (tokens: null = the preset as it is)
  pluginThemes: {},     // per plugin: its own full set of colours, or absent to follow the global theme  // built-in plugins (the DPS meter) the user has installed from Browse
};

class Settings {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(DEFAULTS);
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(file, "utf8"))); } catch {}
    // 92 was the old fixed default: windows nobody adjusted now follow Appearance.
    for (const w of Object.values(this.data.windows || {})) if (w && w.opacity === 92) w.opacity = null;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  window(id) {
    return (this.data.windows[id] ||= { open: false, bounds: null, opacity: null, compact: false, locked: false });
  }
}

module.exports = { Settings, DEFAULTS };
