"use strict";
// Colours and type for the hub and every plugin window. One global theme, and
// optionally a full replacement per plugin. Plugins get the result as CSS
// variables (--a2-bg, --a2-accent, …) from the SDK.
// This file is shared: the main process requires it, and the hub loads it as a
// plain script (window.DaevaTheme).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DaevaTheme = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const COLORS = [
    { key: "bg", label: "Window background", group: "Window" },
    { key: "titleBg", label: "Title bar", group: "Window" },
    { key: "titleText", label: "Title bar text", group: "Window" },
    { key: "border", label: "Borders and lines", group: "Window" },
    { key: "surface", label: "Cards and rows", group: "Content" },
    { key: "surfaceAlt", label: "Hovered and alternate rows", group: "Content" },
    { key: "text", label: "Text", group: "Content" },
    { key: "muted", label: "Secondary text", group: "Content" },
    { key: "accent", label: "Accent", group: "Accent" },
    { key: "accentText", label: "Text on accent", group: "Accent" },
    { key: "highlight", label: "Highlight (you, selected)", group: "Accent" },
    { key: "good", label: "Done / good", group: "Status" },
    { key: "warn", label: "Warning", group: "Status" },
    { key: "bad", label: "Error / danger", group: "Status" },
  ];
  const FONTS = ["Segoe UI", "Bahnschrift", "Tahoma", "Verdana", "Trebuchet MS", "Arial", "Calibri", "Georgia", "Palatino Linotype", "Consolas"];
  const NUMBERS = {
    fontSize: { label: "Text size", min: 10, max: 18, step: 1, unit: "px" },
    radius: { label: "Corner roundness", min: 0, max: 16, step: 1, unit: "px" },
    borderWidth: { label: "Border thickness", min: 0, max: 3, step: 1, unit: "px" },
  };

  const base = { font: "Segoe UI", fontSize: 13, radius: 8, borderWidth: 1 };
  const PRESETS = {
    "daeva-gold": { name: "Daeva Gold", ...base,
      bg: "#0d1119", titleBg: "#0a0e15", titleText: "#e7eaf2", border: "#263044", surface: "#151b27", surfaceAlt: "#1c2434",
      text: "#e7eaf2", muted: "#8c94a8", accent: "#e0b555", accentText: "#1a1405", highlight: "#79a8ff", good: "#5cc47a", warn: "#ffbe50", bad: "#ff6b5c" },
    "elyos-sky": { name: "Elyos Sky", ...base,
      bg: "#0c1624", titleBg: "#0a1220", titleText: "#eaf4ff", border: "#24405e", surface: "#13233a", surfaceAlt: "#1a2e4a",
      text: "#eaf4ff", muted: "#8fa9c7", accent: "#5cc8ff", accentText: "#03121c", highlight: "#ffe08a", good: "#62d9a0", warn: "#ffcf5c", bad: "#ff7a7a" },
    "asmodian-crimson": { name: "Asmodian Crimson", ...base,
      bg: "#140c10", titleBg: "#10080c", titleText: "#f5e6ea", border: "#3e2129", surface: "#22131a", surfaceAlt: "#2c1820",
      text: "#f5e6ea", muted: "#b0909a", accent: "#e0405a", accentText: "#ffffff", highlight: "#b892ff", good: "#6cd08a", warn: "#ffb84d", bad: "#ff5c5c" },
    "abyss-violet": { name: "Abyss Violet", ...base,
      bg: "#100d1c", titleBg: "#0c0a16", titleText: "#ece6ff", border: "#2f2850", surface: "#1a1630", surfaceAlt: "#221c3d",
      text: "#ece6ff", muted: "#9d93c4", accent: "#a77bff", accentText: "#12082a", highlight: "#5ee0d0", good: "#6fd69a", warn: "#ffc65c", bad: "#ff6b8a" },
    "verdant": { name: "Verdant", ...base,
      bg: "#0b1411", titleBg: "#08100d", titleText: "#e4f5ec", border: "#20392f", surface: "#11211b", surfaceAlt: "#172b23",
      text: "#e4f5ec", muted: "#8bb09f", accent: "#4fd18b", accentText: "#04170d", highlight: "#f2d36b", good: "#4fd18b", warn: "#f2c14f", bad: "#ff6f61" },
    "midnight-mono": { name: "Midnight Mono", ...base, radius: 4,
      bg: "#0e0e10", titleBg: "#0a0a0b", titleText: "#f2f2f2", border: "#2c2c30", surface: "#18181b", surfaceAlt: "#212125",
      text: "#f2f2f2", muted: "#9a9aa2", accent: "#f2f2f2", accentText: "#0e0e10", highlight: "#7fb2ff", good: "#7ed492", warn: "#e8c06a", bad: "#f07070" },
    "daylight": { name: "Daylight", ...base,
      bg: "#f3f5fa", titleBg: "#e3e8f2", titleText: "#1b2233", border: "#c9d1e0", surface: "#ffffff", surfaceAlt: "#eaeef6",
      text: "#1b2233", muted: "#5d6880", accent: "#2f6fe0", accentText: "#ffffff", highlight: "#d98a00", good: "#238a4b", warn: "#b36b00", bad: "#c8352a" },
    "high-contrast": { name: "High contrast", ...base, fontSize: 14, borderWidth: 2,
      bg: "#000000", titleBg: "#000000", titleText: "#ffffff", border: "#ffffff", surface: "#111111", surfaceAlt: "#222222",
      text: "#ffffff", muted: "#d0d0d0", accent: "#ffd400", accentText: "#000000", highlight: "#00e5ff", good: "#3cff6e", warn: "#ffd400", bad: "#ff4040" },
  };
  const DEFAULT_PRESET = "daeva-gold";

  const HEX = /^#[0-9a-f]{6}$/i;
  function normalize(input, fallback = PRESETS[DEFAULT_PRESET]) {
    const t = input && typeof input === "object" ? input : {};
    const out = {};
    for (const { key } of COLORS) out[key] = HEX.test(t[key]) ? t[key].toLowerCase() : fallback[key];
    out.font = FONTS.includes(t.font) ? t.font : fallback.font;
    for (const [key, n] of Object.entries(NUMBERS)) {
      const v = Number(t[key]);
      out[key] = Number.isFinite(v) ? Math.min(n.max, Math.max(n.min, Math.round(v))) : fallback[key];
    }
    return out;
  }
  const presetTokens = (id) => normalize(PRESETS[id] || PRESETS[DEFAULT_PRESET]);

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ");
  function toCssVars(t) {
    const vars = {};
    for (const { key } of COLORS) {
      const name = "--a2-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      vars[name] = t[key];
      vars[name + "-rgb"] = rgb(t[key]);
    }
    vars["--a2-font"] = `"${t.font}", "Segoe UI", system-ui, sans-serif`;
    vars["--a2-font-size"] = t.fontSize + "px";
    vars["--a2-radius"] = t.radius + "px";
    vars["--a2-border-width"] = t.borderWidth + "px";
    return vars;
  }

  // Is this a light theme? (plugins with their own art can switch to a light variant)
  function isLight(t) {
    const [r, g, b] = rgb(t.bg).split(", ").map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
  }

  return { COLORS, FONTS, NUMBERS, PRESETS, DEFAULT_PRESET, normalize, presetTokens, toCssVars, isLight };
});
