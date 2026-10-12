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
        el("p", { class: "hint" }, "Add a repository in Settings, then install plugins from Browse."),
        el("button", { class: "btn primary", type: "button", on: { click: () => setTab(S.settings.repos.length ? "browse" : "settings") } },
          S.settings.repos.length ? "Browse plugins" : "Add a repository")));
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
        if (!p.local && !p.builtin) {
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
            p.open ? el("span", { class: "tag green" }, "open") : null,
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
    if (!S.catalog.checkedAt) {
      v.append(el("div", { class: "empty" }, el("p", {}, "Loading your repositories…")));
      return;
    }
    const all = catalogLatest().filter(matches);
    if (!all.length) { v.append(el("p", { class: "empty" }, query ? `Nothing matches “${query}”.` : "Your repositories don't list any plugins.")); return; }
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
            p.official ? el("span", { class: "tag blue" }, "official") : null,
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
          el("div", { class: "meta" + (info?.error ? " err" : "") }, info?.error ? info.error : `${r} · plugins made by the Daeva Hub author, installed for you`)),
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

  function render() {
    if (!S) return;
    for (const b of document.querySelectorAll(".navItem")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    for (const t of ["installed", "browse", "settings"]) $("view-" + t).hidden = t !== tab;
    $("countInstalled").textContent = S.installed.filter((p) => !p.error).length || "";
    $("countBrowse").textContent = S.updates.length ? `${S.updates.length} update${S.updates.length === 1 ? "" : "s"}` : "";
    $("countBrowse").classList.toggle("hot", !!S.updates.length);
    const ub = $("updateAllBtn");
    ub.textContent = S.updates.length ? `Update all (${S.updates.length})` : "Update all";
    ub.disabled = !S.updates.length || busy.size > 0;
    $("search").hidden = tab === "settings";
    $("sideFoot").textContent = `Version ${S.version}` + (S.catalog.checkedAt ? ` · checked ${new Date(S.catalog.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "");
    renderInstalled();
    renderBrowse();
    renderSettings();
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
  $("dataBtn").addEventListener("click", () => hub.openDataFolder());
  hub.onChanged(async () => { S = await hub.state(); render(); });

  hub.state().then((s) => {
    S = s;
    render();
    if (!S.catalog.checkedAt) hub.refresh().then((x) => { S = x; render(); }).catch(() => {});
  });
})();
