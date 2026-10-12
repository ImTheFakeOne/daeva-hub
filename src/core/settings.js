"use strict";
// The launcher's own settings, in one JSON file.
const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  repos: [],            // repository addresses, as the user entered them
  localFolders: [],     // developer plugin folders
  checkOnStart: true,   // look for plugin updates when the launcher starts
  windows: {},          // per plugin: { open, bounds, opacity, compact }
};

class Settings {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(DEFAULTS);
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(file, "utf8"))); } catch {}
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
  window(id) {
    return (this.data.windows[id] ||= { open: false, bounds: null, opacity: 92, compact: false });
  }
}

module.exports = { Settings, DEFAULTS };
