// The plugin browser: installed plugins, everything your repositories offer,
// and settings. All the work happens in the main process (window.hub).
(() => {
  let S = null;
  let tab = "installed";
  let query = "";
  let busy = new Set();          // plugin ids being installed/updated
  let confirmUninstall = null;   // id waiting for a second click
  const $ = (id) => document.getElementById(id);

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs) {
      if (k === "on") for (const ev in attrs.on) e.addEventListener(ev, attrs.on[ev]);
      else if (k === "disabled") e.disabled = !!attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    for (const k of kids) if (k != null && k !== false) e.append(k);
    return e;
  }

  let statusTimer = 0;
  function status(text, kind = "info", sticky = false) {
    const s = $("status");
    s.textContent = text;
    s.className = "status " + kind;
    s.hidden = !text;
    clearTimeout(statusTimer);
    if (text && !sticky) statusTimer = setTimeout(() => { s.hidden = true; }, 6000);
  }

  async function run(label, fn) {
    try {
      const r = await fn();
      if (r && r.installed) S = r;
      else if (r && r.state) S = r.state;
      render();
      return r;
    } catch (e) {
      status(`${label}: ${String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}`, "error", true);
      return null;
    }
  }

  const matches = (p) => {
    if (!query) return true;
    const hay = [p.name, p.id, p.author, p.description, ...(p.tags || [])].join(" ").toLowerCase();
    return query.split(/\s+/).every((w) => hay.includes(w));
  };
  const isOfficial = (id) => S.catalog.plugins.some((p) => p.id === id && p.official);
  const updateFor = (id) => S.updates.find((u) => u.id === id);
  const catalogLatest = () => {
    const best = new Map();
    for (const p of S.catalog.plugins) {
      const cur = best.get(p.id);
      if (!cur || compareVersions(p.version, cur.version) > 0) best.set(p.id, p);
    }
    return [...best.values()].sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || a.name.localeCompare(b.name));
  };
  function compareVersions(a, b) {
    const pa = String(a).replace(/^v/, "").split("-")[0].split(".").map(Number);
    const pb = String(b).replace(/^v/, "").split("-")[0].split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  function icon(p) {
    if (p.icon) return el("img", { class: "icon", src: p.icon, alt: "" });
    return el("div", { class: "icon letter", "aria-hidden": "true" }, (p.name || "?").slice(0, 1).toUpperCase());
  }

  async function install(id, verb) {
    busy.add(id); render();
    const r = await run(`Couldn't ${verb.toLowerCase()} ${id}`, () => hub.install(id));
    busy.delete(id); render();
    if (r) status(`${verb === "Install" ? "Installed" : "Updated"} ${S.installed.find((p) => p.id === id)?.name || id}.`, "ok");
  }

  // ── views ───────────────────────────────────────────────────────────────
  function renderInstalled() {
    const v = $("view-installed");
    v.textContent = "";
    const list = S.installed.filter(matches).sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0));
    if (!S.installed.length) {
      v.append(el("div", { class: "empty" },
        el("p", {}, "No plugins installed yet."),
        el("p", { class: "hint" }, "Pick the ones you want from Browse."),
        el("button", { class: "btn primary", type: "button", on: { click: () => setTab("browse") } }, "Browse plugins")));
      return;
    }
    if (!list.length) { v.append(el("p", { class: "empty" }, `No installed plugin matches “${query}”.`)); return; }
    for (const p of list) {
      if (p.error) {
        v.append(el("article", { class: "card broken" }, el("div", { class: "icon letter" }, "!"),
          el("div", { class: "body" }, el("h3", {}, p.name), el("p", { class: "desc" }, `This local folder can't be loaded: ${p.error}`), el("p", { class: "meta" }, p.dir))));
        continue;
      }
      const up = updateFor(p.id);
      const actions = el("div", { class: "actions" });
      if (busy.has(p.id)) actions.append(el("span", { class: "working" }, "Working…"));
      else {
        if (up) actions.append(el("button", { class: "btn primary", type: "button", on: { click: () => install(p.id, "Update") } }, `Update to ${up.to}`));
        actions.append(p.open
          ? el("button", { class: "btn", type: "button", on: { click: () => run("Couldn't close it", () => hub.close(p.id)) } }, "Close")
          : el("button", { class: "btn", type: "button", on: { click: () => run("Couldn't open it", () => hub.open(p.id)) } }, "Open"));
        if (p.open) {
          const locked = !!(S.locked || {})[p.id];
          actions.append(el("button", { class: "btn", type: "button", title: "Locked overlays let clicks through to the game. Ctrl+Alt+L toggles all of them.",
            on: { click: () => run("Couldn't change that", () => hub.setLocked(p.id, !locked)) } }, locked ? "Unlock" : "Lock (click-through)"));
        }
        actions.append(el("button", { class: "btn ghost", type: "button", on: { click: () => { apTarget = p.id; setTab("appearance"); } } }, "Colours"));
        if (!p.local) {
          if (confirmUninstall === p.id) {
            actions.append(el("span", { class: "confirm" }, "Uninstall? Your saved data is kept.",
              el("button", { class: "btn danger", type: "button", on: { click: async () => { confirmUninstall = null; await run("Couldn't uninstall it", () => hub.uninstall(p.id, true)); status(`Uninstalled ${p.name}.`, "ok"); } } }, "Uninstall"),
              el("button", { class: "btn ghost", type: "button", on: { click: () => { confirmUninstall = null; render(); } } }, "Cancel")));
          } else {
            actions.append(el("button", { class: "btn ghost", type: "button", on: { click: () => { confirmUninstall = p.id; render(); } } }, "Uninstall"));
          }
        }
      }
      v.append(el("article", { class: "card" + (p.open ? " running" : "") }, icon(p),
        el("div", { class: "body" },
          el("h3", {}, p.name, el("span", { class: "ver" }, "v" + p.version),
            p.local ? el("span", { class: "tag gold" }, "local") : null,
            p.builtin ? el("span", { class: "tag blue" }, "built in") : (isOfficial(p.id) ? el("span", { class: "tag blue" }, "official") : null),
            p.open ? el("span", { class: "tag green" }, (S.locked || {})[p.id] ? "open · locked" : "open") : null,
            (S.theme.pluginThemes || {})[p.id] ? el("span", { class: "tag gold" }, "own colours") : null,
            up ? el("span", { class: "tag gold" }, "update available") : null),
          p.author ? el("p", { class: "meta" }, "by " + p.author) : null,
          p.description ? el("p", { class: "desc" }, p.description) : null),
        actions));
    }
  }

  function renderBrowse() {
    const v = $("view-browse");
    v.textContent = "";
    for (const r of S.catalog.repos.filter((r) => r.error)) {
      v.append(el("p", { class: "status error" }, `${r.input}: ${r.error}`));
    }
    if (!S.catalog.checkedAt) v.append(el("p", { class: "hint" }, "Loading the plugin repositories…"));
    const all = catalogLatest().filter(matches);
    if (!all.length) { if (S.catalog.checkedAt) v.append(el("p", { class: "empty" }, query ? `Nothing matches “${query}”.` : "Your repositories don't list any plugins.")); return; }
    for (const p of all) {
      const inst = S.installed.find((i) => i.id === p.id && !i.error);
      const up = inst && updateFor(p.id);
      const actions = el("div", { class: "actions" });
      if (busy.has(p.id)) actions.append(el("span", { class: "working" }, "Working…"));
      else if (!inst) actions.append(el("button", { class: "btn primary", type: "button", on: { click: () => install(p.id, "Install") } }, "Install"));
      else if (up) actions.append(el("button", { class: "btn primary", type: "button", on: { click: () => install(p.id, "Update") } }, `Update to ${up.to}`));
      else actions.append(el("button", { class: "btn", type: "button", on: { click: () => run("Couldn't open it", () => hub.open(p.id)) } }, inst.open ? "Show" : "Open"));
      v.append(el("article", { class: "card" }, icon(p),
        el("div", { class: "body" },
          el("h3", {}, p.name, el("span", { class: "ver" }, "v" + p.version),
            p.official ? el("span", { class: "tag blue" }, p.builtin ? "built in" : "official") : null,
            inst ? el("span", { class: "tag green" }, inst.local ? "local copy" : `installed v${inst.version}`) : null),
          el("p", { class: "meta" }, [p.author && "by " + p.author, "from " + (p.repoName || "a repository")].filter(Boolean).join(" · ")),
          p.description ? el("p", { class: "desc" }, p.description) : null,
          p.tags.length ? el("div", { class: "tags" }, ...p.tags.map((t) => el("button", { class: "tag", type: "button", on: { click: () => { $("search").value = query = t.toLowerCase(); render(); } } }, t))) : null,
          p.repoUrl ? el("button", { class: "link", type: "button", on: { click: () => hub.openLink(p.repoUrl) } }, "Project page ↗") : null),
        actions));
    }
  }

  function renderSettings() {
    const repos = $("repoList");
    repos.textContent = "";
    for (const r of S.settings.officialRepos || []) {
      const info = S.catalog.repos.find((x) => x.input === r);
      repos.append(el("li", { class: "official" },
        el("div", { class: "grow" }, el("div", { class: "strong" }, info?.name || "Daeva Hub", el("span", { class: "tag blue" }, "official")),
          el("div", { class: "meta" + (info?.error ? " err" : "") }, info?.error ? info.error : `${r} · plugins made by the Daeva Hub author, listed in Browse`)),
        el("span", { class: "meta" }, "Built in")));
    }
    for (const r of S.settings.repos) {
      const info = S.catalog.repos.find((x) => x.input === r);
      repos.append(el("li", {},
        el("div", { class: "grow" }, el("div", { class: "strong" }, info?.name || r),
          el("div", { class: "meta" + (info?.error ? " err" : "") }, info ? (info.error ? info.error : `${r} · ${info.count} plugin${info.count === 1 ? "" : "s"}`) : r)),
        el("button", { class: "btn ghost", type: "button", on: { click: () => run("Couldn't remove it", () => hub.removeRepo(r)) } }, "Remove")));
    }
    if (!S.settings.repos.length) repos.append(el("li", { class: "meta" }, "No other repositories yet. Plugins from other authors appear in Browse once you add theirs."));
    const folders = $("folderList");
    folders.textContent = "";
    for (const d of S.settings.localFolders) {
      folders.append(el("li", {}, el("div", { class: "grow meta" }, d),
        el("button", { class: "btn ghost", type: "button", on: { click: () => run("Couldn't remove it", () => hub.removeLocalFolder(d)) } }, "Remove")));
    }
  }

  // ── appearance ──────────────────────────────────────────────────────────
  const T = window.DaevaTheme;
  let apTarget = "";          // "" = everything; otherwise a plugin id
  let apDraft = null;         // tokens being edited (saved a moment after each change)
  let apSaveTimer = 0;
  let apBuilt = false;

  const mix = (a, b, w) => {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return "#" + pa.map((v, i) => Math.round(v * (1 - w) + pb[i] * w).toString(16).padStart(2, "0")).join("");
  };
  // The hub wears the global theme too.
  function applyHubTheme() {
    const t = S.theme.tokens, r = document.documentElement.style;
    const set = (k, v) => r.setProperty(k, v);
    set("--bg", t.bg); set("--side", t.titleBg); set("--card", t.surface); set("--card2", t.surfaceAlt); set("--line", t.border);
    set("--fg", t.text); set("--muted", t.muted); set("--gold", t.accent); set("--gold-ink", t.accentText);
    set("--green", t.good); set("--red", t.bad); set("--hl", t.highlight);
    set("--body", `"${t.font}", "Segoe UI", system-ui, sans-serif`);
    document.documentElement.style.colorScheme = T.isLight(t) ? "light" : "dark";
  }

  const ownTheme = () => (apTarget ? (S.theme.pluginThemes || {})[apTarget] : null);
  const editing = () => !apTarget || !!ownTheme();
  const currentTokens = () => apDraft || (apTarget && ownTheme() ? T.normalize(ownTheme(), S.theme.tokens) : S.theme.tokens);

  function saveDraft() {
    clearTimeout(apSaveTimer);
    apSaveTimer = setTimeout(async () => {
      const tokens = apDraft;
      if (!tokens) return;
      const r = await run("Couldn't save the colours", () => (apTarget ? hub.setPluginTheme(apTarget, tokens) : hub.setTheme({ preset: S.theme.preset, tokens })));
      if (r && apDraft === tokens) apDraft = null;
    }, 180);
  }
  function setToken(key, value) {
    apDraft = { ...currentTokens(), [key]: value };
    paintPreview(apDraft);
    applyLiveHub();
    saveDraft();
  }
  function applyLiveHub() { if (!apTarget && apDraft) { const keep = S.theme.tokens; S.theme.tokens = apDraft; applyHubTheme(); S.theme.tokens = keep; } }
  function paintPreview(t) {
    const pv = $("apPreview");
    for (const [k, v] of Object.entries(T.toCssVars(t))) pv.style.setProperty(k, v);
  }

  function buildControls() {
    const box = $("apControls");
    const groups = {};
    for (const c of T.COLORS) (groups[c.group] ||= []).push(c);
    for (const [name, list] of Object.entries(groups)) {
      const fs = el("fieldset", {}, el("legend", {}, name));
      for (const c of list) {
        const color = el("input", { type: "color", id: "ap-" + c.key, "aria-label": c.label });
        const hex = el("input", { class: "hex", type: "text", id: "aph-" + c.key, maxlength: "7", spellcheck: "false", "aria-label": c.label + " (hex)" });
        color.addEventListener("input", () => { hex.value = color.value; hex.classList.remove("bad"); setToken(c.key, color.value); });
        hex.addEventListener("input", () => {
          const v = hex.value.trim().replace(/^([^#])/, "#$1");
          const ok = /^#[0-9a-f]{6}$/i.test(v);
          hex.classList.toggle("bad", !ok);
          if (ok) { color.value = v.toLowerCase(); setToken(c.key, v.toLowerCase()); }
        });
        fs.append(el("label", { class: "apField" }, el("span", { class: "lbl" }, c.label), color, hex));
      }
      box.append(fs);
    }
    const fs = el("fieldset", {}, el("legend", {}, "Text and shape"));
    const font = el("select", { id: "ap-font", "aria-label": "Font" }, ...T.FONTS.map((f) => el("option", { value: f }, f)));
    font.addEventListener("change", () => setToken("font", font.value));
    fs.append(el("label", { class: "apField" }, el("span", { class: "lbl" }, "Font"), font));
    for (const [key, n] of Object.entries(T.NUMBERS)) {
      const range = el("input", { type: "range", id: "ap-" + key, min: n.min, max: n.max, step: n.step, "aria-label": n.label });
      const out = el("output", { id: "apo-" + key });
      range.addEventListener("input", () => { out.textContent = range.value + n.unit; setToken(key, Number(range.value)); });
      fs.append(el("label", { class: "apField" }, el("span", { class: "lbl" }, n.label), range, out));
    }
    box.append(fs);
    apBuilt = true;
  }

  function renderAppearance() {
    if (!apBuilt) buildControls();
    // target list: everything, then each installed plugin
    const sel = $("apTarget");
    const plugins = S.installed.filter((p) => !p.error);
    if (apTarget && !plugins.some((p) => p.id === apTarget)) apTarget = "";
    sel.replaceChildren(el("option", { value: "" }, "Everything (all plugins and the hub)"),
      ...plugins.map((p) => el("option", { value: p.id }, p.name + ((S.theme.pluginThemes || {})[p.id] ? " (own colours)" : ""))));
    sel.value = apTarget;
    $("apOwnWrap").hidden = !apTarget;
    $("apOwn").checked = !!ownTheme();
    const t = currentTokens();
    const can = editing();
    $("apNote").textContent = !apTarget
      ? (S.theme.custom ? `Custom, based on ${T.PRESETS[S.theme.preset]?.name || "a preset"}.` : `Preset: ${T.PRESETS[S.theme.preset]?.name}.`)
      : can ? "This plugin ignores the global colours." : "Follows the global colours. Tick the box to change them for this plugin only.";

    // presets
    const pr = $("apPresets");
    pr.replaceChildren(...Object.entries(T.PRESETS).map(([id, p]) => {
      const active = !apTarget ? (!S.theme.custom && S.theme.preset === id) : false;
      return el("button", { class: "preset", type: "button", "aria-pressed": String(active), disabled: !can,
        on: { click: () => { apDraft = null; run("Couldn't change the colours", () => (apTarget ? hub.setPluginTheme(apTarget, T.presetTokens(id)) : hub.setTheme({ preset: id, tokens: null }))); } } },
        el("div", { class: "sw" }, ...["bg", "surface", "accent", "highlight", "text"].map((k) => { const i = el("i"); i.style.background = p[k]; return i; })),
        el("span", {}, p.name));
    }));

    // controls (don't overwrite a field the user is typing in)
    for (const fs of $("apControls").querySelectorAll("fieldset")) fs.disabled = !can;
    for (const c of T.COLORS) {
      const color = $("ap-" + c.key), hex = $("aph-" + c.key);
      if (document.activeElement !== hex) { hex.value = t[c.key]; hex.classList.remove("bad"); }
      if (document.activeElement !== color) color.value = t[c.key];
    }
    if (document.activeElement !== $("ap-font")) $("ap-font").value = t.font;
    for (const [key, n] of Object.entries(T.NUMBERS)) {
      if (document.activeElement !== $("ap-" + key)) $("ap-" + key).value = t[key];
      $("apo-" + key).textContent = t[key] + n.unit;
    }
    $("apReset").disabled = !can;
    paintPreview(t);
  }

  function renderAppUpdate() {
    const u = S.appUpdate || { status: "idle" };
    $("appUpdate").hidden = u.status !== "ready";
    $("appUpdateText").textContent = `Daeva Hub ${u.version} is ready to install.`;
    const line = {
      dev: "Running from source: updates are off.",
      checking: "Looking for a new version…",
      downloading: `Downloading version ${u.version}… ${u.percent || 0}%`,
      ready: `Version ${u.version} is downloaded. Restart to update.`,
      current: "You have the latest version.",
      error: `Couldn't check for a new version: ${u.error}`,
    }[u.status] || "";
    $("appVersionText").textContent = `You have version ${S.version}. ${line}`;
    $("appCheckBtn").disabled = ["checking", "downloading", "dev"].includes(u.status);
    if (u.status === "ready") { $("appCheckBtn").textContent = "Restart to update"; $("appCheckBtn").className = "btn primary"; }
    else { $("appCheckBtn").textContent = "Check for a new version"; $("appCheckBtn").className = "btn"; }
    return u.status === "downloading" ? ` · downloading update ${u.percent || 0}%` : u.status === "ready" ? " · update ready" : "";
  }

  function render() {
    if (!S) return;
    for (const b of document.querySelectorAll(".navItem")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    for (const t of ["installed", "browse", "appearance", "settings"]) $("view-" + t).hidden = t !== tab;
    $("countInstalled").textContent = S.installed.filter((p) => !p.error).length || "";
    $("countBrowse").textContent = S.updates.length ? `${S.updates.length} update${S.updates.length === 1 ? "" : "s"}` : "";
    $("countBrowse").classList.toggle("hot", !!S.updates.length);
    const ub = $("updateAllBtn");
    ub.textContent = S.updates.length ? `Update all (${S.updates.length})` : "Update all";
    ub.disabled = !S.updates.length || busy.size > 0;
    $("search").hidden = tab === "settings" || tab === "appearance";
    applyHubTheme();
    $("sideFoot").textContent = `Version ${S.version}` + renderAppUpdate();
    renderInstalled();
    renderBrowse();
    renderSettings();
    renderAppearance();
  }

  function setTab(t) { tab = t; confirmUninstall = null; render(); }

  // ── wiring ──────────────────────────────────────────────────────────────
  for (const b of document.querySelectorAll(".navItem")) b.addEventListener("click", () => setTab(b.dataset.tab));
  $("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); render(); });
  $("checkBtn").addEventListener("click", async () => {
    status("Checking your repositories…", "info", true);
    const r = await run("Couldn't check for updates", () => hub.refresh());
    if (r) status(S.updates.length ? `${S.updates.length} update${S.updates.length === 1 ? "" : "s"} available.` : "Everything is up to date.", "ok");
  });
  $("updateAllBtn").addEventListener("click", async () => {
    for (const u of S.updates) busy.add(u.id);
    status("Updating…", "info", true);
    render();
    const r = await run("Couldn't update", () => hub.updateAll());
    busy.clear();
    render();
    if (r) {
      const ok = r.results.filter((x) => x.ok).length, failed = r.results.filter((x) => !x.ok);
      status(failed.length ? `Updated ${ok}; ${failed.map((f) => `${f.id} failed (${f.error})`).join(", ")}.` : `Updated ${ok} plugin${ok === 1 ? "" : "s"}.`, failed.length ? "error" : "ok", !!failed.length);
    }
  });
  $("repoForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("repoInput").value.trim();
    if (!input) return;
    status("Adding the repository…", "info", true);
    const r = await run("Couldn't add that repository", () => hub.addRepo(input));
    if (r) { $("repoInput").value = ""; status("Repository added.", "ok"); }
  });
  $("addFolderBtn").addEventListener("click", () => run("Couldn't add the folder", () => hub.addLocalFolder()));
  $("a2toolsLink").addEventListener("click", (e) => { e.preventDefault(); hub.openLink("https://github.com/taengu/A2Tools-DPS-Meter"); });
  $("npcapLink").addEventListener("click", (e) => { e.preventDefault(); hub.openLink("https://npcap.com/#download"); });
  const installAppUpdate = () => { status("Restarting to update…", "info", true); hub.installAppUpdate(); };
  $("appUpdateBtn").addEventListener("click", installAppUpdate);
  $("appCheckBtn").addEventListener("click", () => {
    if (S.appUpdate && S.appUpdate.status === "ready") return installAppUpdate();
    run("Couldn't check for a new version", () => hub.checkAppUpdate());
  });
  $("apTarget").addEventListener("change", (e) => { apTarget = e.target.value; apDraft = null; render(); });
  $("apOwn").addEventListener("change", (e) => {
    apDraft = null;
    run("Couldn't change that", () => hub.setPluginTheme(apTarget, e.target.checked ? S.theme.tokens : null));
  });
  $("apReset").addEventListener("click", () => {
    apDraft = null;
    run("Couldn't reset", () => (apTarget ? hub.setPluginTheme(apTarget, S.theme.tokens) : hub.setTheme({ preset: S.theme.preset, tokens: null })));
  });
  $("apCopy").addEventListener("click", async () => {
    const code = "daeva-theme:" + btoa(JSON.stringify(currentTokens()));
    try { await navigator.clipboard.writeText(code); status("Theme code copied. Paste it to a friend, or keep it as a backup.", "ok"); }
    catch { $("apPasteBox").hidden = false; $("apCode").value = code; $("apCode").select(); status("Copy the code from the box below.", "info"); }
  });
  $("apPasteOpen").addEventListener("click", () => { $("apPasteBox").hidden = false; $("apCode").value = ""; $("apCode").focus(); });
  $("apPasteCancel").addEventListener("click", () => { $("apPasteBox").hidden = true; });
  $("apApply").addEventListener("click", async () => {
    let tokens = null;
    try {
      const raw = $("apCode").value.trim();
      tokens = JSON.parse(raw.startsWith("daeva-theme:") ? atob(raw.slice(12)) : raw);
      if (!tokens || typeof tokens !== "object") throw new Error();
    } catch { status("That isn't a theme code.", "error"); return; }
    if (apTarget && !ownTheme()) { status("Tick “Give this plugin its own colours” first, or pick Everything.", "error"); return; }
    apDraft = null;
    const r = await run("Couldn't use that theme", () => (apTarget ? hub.setPluginTheme(apTarget, tokens) : hub.setTheme({ preset: S.theme.preset, tokens })));
    if (r) { $("apPasteBox").hidden = true; status("Theme applied.", "ok"); }
  });
  $("dataBtn").addEventListener("click", () => hub.openDataFolder());
  hub.onChanged(async () => { S = await hub.state(); render(); });

  hub.state().then((s) => {
    S = s;
    render();
    if (!S.catalog.checkedAt) hub.refresh().then((x) => { S = x; render(); }).catch(() => {});
  });
})();
