// DPS Meter: draws what the hub's built-in meter sees (capture code from
// A2Tools). Every look-and-feel choice is a setting, saved with a2.storage.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // job names arrive in Korean from the parser
  const CLASSES = {
    검성: { key: "gladiator", name: "Gladiator" }, 수호성: { key: "templar", name: "Templar" },
    궁성: { key: "ranger", name: "Ranger" }, 살성: { key: "assassin", name: "Assassin" },
    마도성: { key: "sorcerer", name: "Sorcerer" }, 치유성: { key: "cleric", name: "Cleric" },
    정령성: { key: "spiritmaster", name: "Spiritmaster" }, 호법성: { key: "chanter", name: "Chanter" },
    권성: { key: "fighter", name: "Brawler" },
  };
  const CLASS_ORDER = ["gladiator", "templar", "assassin", "ranger", "sorcerer", "spiritmaster", "cleric", "chanter", "fighter"];
  const CLASS_LABEL = Object.fromEntries(Object.values(CLASSES).map((c) => [c.key, c.name]));
  const CLASS_DEFAULT = {
    gladiator: "#2f8580", templar: "#3d6c9c", assassin: "#5f7f2e", ranger: "#3d7d55", sorcerer: "#5a4b94",
    spiritmaster: "#86509c", cleric: "#9c8636", chanter: "#a56832", fighter: "#a34848",
  };

  // ── settings ────────────────────────────────────────────────────────────
  const D = {
    // layout
    layout: "classic", scale: 100, rowH: 32, gap: 4, rowRadius: 3, maxRows: 12, sortBy: "dps", fadeIdle: false,
    // rows
    nameMode: "name", showIcon: true, showRank: false, showCp: true, showDamage: false, showDps: true, showShare: true,
    dpsFormat: "full", meDot: true, meOutline: false, pinMe: true,
    // bars
    barMode: "top", barColor: "class", barCustom: "#4a7fb5", barAlpha: 85, gradient: false, track: true, trackColor: "#000000", trackAlpha: 35,
    // target and footer
    showTarget: true, showCombatLabel: true, showHpNumbers: true, hpFormat: "full", hpHeight: 7, showTStats: false, showTimer: true, showPing: true, showTools: true,
    // colours
    cpColor: "#7fd6e0", shareColor: "#ffd76a", dpsColor: "#ffffff", nameColor: "#f1f1f1", hp1: "#3fb98a", hp2: "#3fb98a", hpPct: "#6fd6c6", timerColor: "#39d26a",
    ...Object.fromEntries(CLASS_ORDER.map((k) => ["cls_" + k, CLASS_DEFAULT[k]])),
  };
  const TABS = [
    { id: "layout", label: "Layout", fields: [
      ["presets"],
      ["sec", "Shape"],
      ["layout", "select", "Bar style", [["classic", "Square bars"], ["pill", "Rounded pills"]]],
      ["scale", "range", "Size", 70, 160, 5, "%"],
      ["rowH", "range", "Row height", 18, 48, 1, "px"],
      ["gap", "range", "Space between rows", 0, 10, 1, "px"],
      ["rowRadius", "range", "Row corners", 0, 16, 1, "px"],
      ["sec", "Behaviour"],
      ["maxRows", "range", "Rows shown", 1, 24, 1, ""],
      ["sortBy", "select", "Sort by", [["dps", "DPS"], ["amount", "Total damage"]]],
      ["fadeIdle", "check", "Fade out between fights"],
    ] },
    { id: "rows", label: "Rows", fields: [
      ["sec", "Columns"],
      ["showIcon", "check", "Class icon"],
      ["showRank", "check", "Rank number"],
      ["showCp", "check", "Combat power"],
      ["showDamage", "check", "Total damage"],
      ["showDps", "check", "DPS"],
      ["showShare", "check", "Damage share %"],
      ["sec", "Text"],
      ["nameMode", "select", "Names", [["name", "Character names"], ["class", "Class names"], ["hideOthers", "Only my name"]]],
      ["dpsFormat", "select", "DPS numbers", [["full", "591,924/s"], ["compact", "591.92K"]]],
      ["sec", "You"],
      ["meDot", "check", "Green dot on my icon"],
      ["meOutline", "check", "Outline my row"],
      ["pinMe", "check", "Always show my row"],
    ] },
    { id: "bars", label: "Bars", fields: [
      ["barMode", "select", "Bar length", [["top", "Compared to the top player"], ["share", "Share of the damage"], ["none", "No bars"]]],
      ["barColor", "select", "Bar colour", [["class", "Class colours"], ["accent", "Theme accent"], ["custom", "One colour"]]],
      ["barCustom", "color", "One colour"],
      ["barAlpha", "range", "Bar strength", 15, 100, 5, "%"],
      ["gradient", "check", "Fade bars to the right"],
      ["track", "check", "Dark track behind bars"],
      ["trackColor", "color", "Track colour"],
      ["trackAlpha", "range", "Track strength", 0, 100, 5, "%"],
    ] },
    { id: "target", label: "Target", fields: [
      ["showTarget", "check", "Target card"],
      ["showCombatLabel", "check", "“Combat 00:00” on the card"],
      ["showHpNumbers", "check", "HP numbers"],
      ["hpFormat", "select", "HP numbers style", [["full", "90,707 / 119,700"], ["compact", "90.7K / 119.7K"]]],
      ["hpHeight", "range", "HP bar thickness", 2, 14, 1, "px"],
      ["showTStats", "check", "Kill time, party DPS and damage"],
      ["sec", "Bottom"],
      ["showTimer", "check", "Fight timer"],
      ["showPing", "check", "Ping"],
      ["showTools", "check", "Buttons (show again from the window's ▾)"],
    ] },
    { id: "colours", label: "Colours", fields: [
      ["sec", "Classes"],
      ...CLASS_ORDER.map((k) => ["cls_" + k, "color", CLASS_LABEL[k], k]),
      ["sec", "Text"],
      ["nameColor", "color", "Names"],
      ["cpColor", "color", "Combat power"],
      ["dpsColor", "color", "DPS"],
      ["shareColor", "color", "Share %"],
      ["sec", "Target and timer"],
      ["hp1", "color", "HP bar start"],
      ["hp2", "color", "HP bar end (same = solid)"],
      ["hpPct", "color", "HP percentage"],
      ["timerColor", "color", "Timer and my dot"],
    ] },
  ];
  const PRESETS = [
    { name: "Classic", note: "Like the game overlay", set: { layout: "classic", rowH: 32, gap: 4, rowRadius: 3, gradient: false, track: true, scale: 100, dpsFormat: "full", showCp: true, showTStats: false, showCombatLabel: true, hpFormat: "full", hpHeight: 7 } },
    { name: "Pills", note: "Slim bars, kill timer", set: { layout: "pill", rowH: 22, gap: 3, gradient: true, track: false, scale: 90, dpsFormat: "compact", showCp: true, showTStats: true, showCombatLabel: true, hpFormat: "compact", hpHeight: 4 } },
    { name: "Minimal", note: "Name, DPS, share", set: { layout: "classic", rowH: 22, gap: 2, rowRadius: 2, showIcon: false, showCp: false, showTStats: false, showHpNumbers: false, showTools: false, dpsFormat: "compact", scale: 90 } },
    { name: "Big", note: "Easy to read on stream", set: { layout: "classic", rowH: 40, gap: 5, rowRadius: 4, scale: 130, showCp: true, showDamage: false } },
  ];

  let S = { ...D };
  let saveTimer = 0;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => a2.storage.set("settings", S), 250); };

  const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };
  function applySettings() {
    const r = document.documentElement.style;
    r.setProperty("--m-scale", String(S.scale / 100));
    r.setProperty("--m-row-h", S.rowH + "px");
    r.setProperty("--m-gap", S.gap + "px");
    r.setProperty("--m-row-r", S.rowRadius + "px");
    r.setProperty("--m-hp-h", S.hpHeight + "px");
    r.setProperty("--m-bar-a", String(S.barAlpha / 100));
    r.setProperty("--m-track", S.track ? hexA(S.trackColor, S.trackAlpha / 100) : "transparent");
    for (const [v, k] of [["--m-cp", "cpColor"], ["--m-share", "shareColor"], ["--m-dps", "dpsColor"], ["--m-name", "nameColor"], ["--m-hp1", "hp1"], ["--m-hp2", "hp2"], ["--m-hp-pct", "hpPct"], ["--m-timer", "timerColor"]]) r.setProperty(v, S[k]);
    const m = $("meter");
    m.classList.toggle("pill", S.layout === "pill");
    m.classList.toggle("gradient", !!S.gradient);
    m.classList.toggle("trackOn", !!S.track);
    m.classList.toggle("noTrack", !S.track);
    $("tcard").hidden = !S.showTarget;
    $("tstats").hidden = !S.showTStats;
    $("thp").hidden = !S.showHpNumbers;
    $("timer").hidden = !S.showTimer;
    $("pingBox").hidden = !S.showPing;
    document.querySelector(".tools").hidden = !S.showTools;
    $("foot").hidden = !S.showTimer && !S.showPing && !S.showTools;
    if (last) render(last);
  }

  // ── numbers ─────────────────────────────────────────────────────────────
  const compact = (n) => {
    n = Number(n) || 0;
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e8 ? 1 : 2) + "M";
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e5 ? 1 : 2) + "K";
    return String(Math.round(n));
  };
  const full = (n) => Math.round(Number(n) || 0).toLocaleString("en");
  const fmtDps = (n) => (S.dpsFormat === "full" ? full(n) + "/s" : compact(n));
  const mmss = (ms) => {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  const set = (node, t) => { if (node.textContent !== t) node.textContent = t; };
  const CP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 3l7 7-1.4 1.4-1.8-1.8L5 12.4 3.6 11l2.8-2.8L3 4.4zm16 0l1 1.4-3.4 3.4L20.4 11 19 12.4l-2.8-2.8-1.8 1.8L13 10zM12 13.4l1.4 1.4-6.6 6.6H4v-2.8zm0 0l6.6 6.6V22h-2.8l-5.2-5.2z"/></svg>';

  // ── live data ───────────────────────────────────────────────────────────
  let last = null, lastFightAt = 0, fight = null; // fight = latest snapshot worth keeping
  const notice = $("notice");

  function showNotice(kind, message) {
    notice.replaceChildren();
    if (!kind) { notice.hidden = true; return; }
    notice.hidden = false;
    const p = el("div");
    const b = el("button");
    if (kind === "npcap") {
      p.textContent = "Npcap isn't installed. The meter needs it to read the game's traffic. Install it with “WinPcap API-compatible mode” ticked, then reopen this window.";
      b.textContent = "Get Npcap";
      b.onclick = () => a2.meter.installNpcap();
    } else {
      p.textContent = message;
      b.textContent = "Try again";
      b.onclick = () => a2.meter.start();
    }
    notice.append(p, b);
  }
  a2.on("meter-status", (s) => {
    if (!s) return;
    if (s.error === "npcap-missing" || s.npcap === false) showNotice("npcap");
    else if (s.error) showNotice("error", s.error + " If it keeps happening, run Daeva Hub as administrator.");
    else showNotice(null);
  });

  function people(d) {
    const meId = d.localPlayerId != null ? String(d.localPlayerId) : null;
    const list = Object.entries(d.map || {}).map(([id, p]) => ({ id, ...p, me: id === meId }))
      .filter((p) => Number(p.amount) > 0 || Number(p.dps) > 0);
    const key = S.sortBy === "amount" ? "amount" : "dps";
    list.sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
    return list;
  }
  const nameOf = (p, msg) => {
    const cls = CLASSES[p.job];
    if (S.nameMode === "class" || (S.nameMode === "hideOthers" && !p.me)) return cls ? cls.name : "Unknown";
    return p.nickname || (p.me ? (msg.me && msg.me.name) || "You" : (cls ? cls.name : "Unknown"));
  };
  const barColour = (p) => {
    if (S.barColor === "accent") return "var(--a2-accent)";
    if (S.barColor === "custom") return S.barCustom;
    const cls = CLASSES[p.job];
    return cls ? S["cls_" + cls.key] : "#56627a";
  };

  function rowFor(p, i, top, total, msg) {
    const cls = CLASSES[p.job];
    const row = el("div", "row" + (p.me && S.meOutline ? " me" : ""));
    if (S.barMode !== "none") {
      const bar = el("div", "bar");
      const frac = S.barMode === "share" ? (total ? (Number(p.amount) || 0) / total : 0) : (Number(p[S.sortBy === "amount" ? "amount" : "dps"]) || 0) / top;
      bar.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + "%";
      bar.style.background = barColour(p);
      row.append(bar);
    }
    if (S.showRank) row.append(el("span", "rank", String(i + 1)));
    if (S.showIcon) {
      const ic = el("span", "ic");
      if (cls) { const img = el("img"); img.src = `img/${cls.key}.png`; img.alt = cls.name; img.title = cls.name; ic.append(img); }
      if (p.me && S.meDot) ic.append(el("span", "dot"));
      row.append(ic);
    }
    row.append(el("span", "nm", nameOf(p, msg)));
    if (S.showCp && Number(p.combatPower) > 0) { const cp = el("span", "cp"); cp.innerHTML = CP_ICON; cp.append(compact(p.combatPower)); row.append(cp); }
    if (S.showDamage) row.append(el("span", "dmg", compact(p.amount)));
    if (S.showDps) row.append(el("span", "dps", fmtDps(p.dps)));
    if (S.showShare) row.append(el("span", "sh", (total ? ((Number(p.amount) || 0) / total) * 100 : 0).toFixed(1) + "%"));
    return row;
  }

  function render(msg) {
    last = msg;
    const d = msg.dps || {};
    const list = people(d);
    const total = list.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const partyDps = list.reduce((s, p) => s + (Number(p.dps) || 0), 0);
    const bt = Number(d.battleTime) || 0;

    // target card
    set($("tname"), d.targetName || (bt ? "Fighting…" : "Waiting for combat…"));
    $("boss").classList.toggle("normal", !d.targetIsBoss);
    const max = Number(d.targetMaxHp) || 0, cur = Number(d.targetCurrentHp);
    const hasHp = max > 0 && Number.isFinite(cur);
    const pct = hasHp ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    $("hpfill").style.width = (hasHp ? pct : 0).toFixed(1) + "%";
    const hpN = S.hpFormat === "full" ? full : compact;
    set($("thp"), hasHp ? `${hpN(cur)} / ${hpN(max)}` : "");
    set($("tpct"), hasHp ? pct.toFixed(1) + "%" : "");
    set($("kill"), hasHp && partyDps > 0 && cur > 0 ? "≈" + mmss((cur / partyDps) * 1000) : "–");
    set($("pdps"), partyDps ? compact(partyDps) + "/s" : "–");
    set($("tdmg"), total ? compact(total) : "–");
    set($("ccombat"), S.showCombatLabel && bt ? "Combat " + mmss(bt) : "");

    // footer
    set($("timer"), mmss(bt));
    const ping = Number(msg.ping);
    set($("ping"), Number.isFinite(ping) && ping > 0 ? Math.round(ping) + "ms" : "–");
    $("pingBox").classList.toggle("slow", ping >= 80 && ping < 150);
    $("pingBox").classList.toggle("bad", ping >= 150);

    // rows
    const rows = $("rows");
    if (!list.length) {
      if (!rows.querySelector(".empty")) rows.replaceChildren(el("div", "empty", "No damage yet. Hit something in game."));
    } else {
      const key = S.sortBy === "amount" ? "amount" : "dps";
      const top = Math.max(1, Number(list[0][key]) || 0);
      const shown = list.slice(0, S.maxRows);
      const nodes = shown.map((p, i) => rowFor(p, i, top, total, msg));
      const meIdx = list.findIndex((p) => p.me);
      if (S.pinMe && meIdx >= S.maxRows) { const r = rowFor(list[meIdx], meIdx, top, total, msg); r.classList.add("pinned"); nodes.push(r); }
      rows.replaceChildren(...nodes);
    }

    // fade between fights
    if (bt && total) lastFightAt = Date.now();
    document.body.style.opacity = S.fadeIdle && Date.now() - lastFightAt > 20000 ? "0.35" : "";

    trackFight(d, list, total);
  }

  // ── fight history (last 15 fights, kept with the plugin's data) ─────────
  let history = [];
  function trackFight(d, list, total) {
    const bt = Number(d.battleTime) || 0;
    // a new fight started (timer went back) → keep the one that ended
    if (fight && bt + 1000 < fight.time) keepFight();
    if (bt > 0 && total > 0) {
      fight = { at: Date.now(), target: d.targetName || "Unknown target", boss: !!d.targetIsBoss, time: bt, total,
        rows: list.slice(0, 12).map((p) => ({ name: nameOf(p, last), cls: (CLASSES[p.job] || {}).key || "", dps: Number(p.dps) || 0, amount: Number(p.amount) || 0, me: p.me })) };
    }
  }
  function keepFight() {
    if (fight && fight.time >= 5000) {
      history.unshift(fight);
      history = history.slice(0, 15);
      a2.storage.set("history", history);
      if (!$("history").hidden) renderHistory();
    }
    fight = null;
  }
  function renderHistory() {
    const body = $("histBody");
    if (!history.length) { body.replaceChildren(el("p", "sNote", "Fights longer than 5 seconds are kept here when the next one starts or you reset.")); return; }
    body.replaceChildren(...history.map((f) => {
      const box = el("div", "hist");
      const head = el("button");
      head.type = "button";
      const when = new Date(f.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      head.append(el("b", "", (f.boss ? "★ " : "") + f.target), el("span", "", `${mmss(f.time)} · ${compact(f.total)} · ${when}`));
      const ol = el("ol");
      ol.hidden = true;
      for (const r of f.rows) {
        const li = el("li", r.me ? "me" : "");
        li.append(el("span", "", r.name), el("span", "num", `${compact(r.dps)}/s · ${(f.total ? (r.amount / f.total) * 100 : 0).toFixed(1)}%`));
        ol.append(li);
      }
      head.onclick = () => { ol.hidden = !ol.hidden; };
      box.append(head, ol);
      return box;
    }));
  }

  // ── settings panel ──────────────────────────────────────────────────────
  let tab = "layout";
  function renderSettings() {
    $("sTabs").replaceChildren(...TABS.map((t) => {
      const b = el("button", "sTab", t.label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t.id === tab));
      b.onclick = () => { tab = t.id; renderSettings(); };
      return b;
    }));
    const body = $("sBody");
    body.replaceChildren();
    for (const f of TABS.find((t) => t.id === tab).fields) {
      const [key, type, label] = f;
      if (key === "sec") { body.append(el("div", "sSec", type)); continue; }
      if (key === "presets") {
        const g = el("div", "sPresets");
        for (const p of PRESETS) {
          const b = el("button", "sPreset");
          b.type = "button";
          b.append(el("b", "", p.name), el("span", "", p.note));
          b.onclick = () => { S = { ...S, ...p.set }; save(); applySettings(); renderSettings(); };
          g.append(b);
        }
        body.append(g);
        continue;
      }
      const row = el("label", "sRow");
      if (type === "color" && f[3]) { const img = el("img", "ci"); img.src = `img/${f[3]}.png`; img.alt = ""; row.append(img); }
      row.append(el("span", "l", label));
      let input;
      if (type === "check") {
        input = el("input"); input.type = "checkbox"; input.checked = !!S[key];
        input.onchange = () => { S[key] = input.checked; save(); applySettings(); };
      } else if (type === "range") {
        const [, , , min, max, step, unit] = f;
        input = el("input"); input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = S[key];
        const out = el("output", "", S[key] + unit);
        input.oninput = () => { S[key] = Number(input.value); out.textContent = input.value + unit; save(); applySettings(); };
        row.append(input, out);
        body.append(row);
        continue;
      } else if (type === "select") {
        input = el("select");
        for (const [v, t] of f[3]) { const o = el("option", "", t); o.value = v; input.append(o); }
        input.value = S[key];
        input.onchange = () => { S[key] = input.value; save(); applySettings(); };
      } else if (type === "color") {
        input = el("input"); input.type = "color"; input.value = S[key];
        input.oninput = () => { S[key] = input.value; save(); applySettings(); };
      }
      row.append(input);
      body.append(row);
    }
  }
  function openPanel(which) {
    $("settings").hidden = which !== "settings";
    $("history").hidden = which !== "history";
    $("gear").setAttribute("aria-pressed", String(which === "settings"));
    $("histBtn").setAttribute("aria-pressed", String(which === "history"));
    if (which === "settings") renderSettings();
    if (which === "history") renderHistory();
  }
  $("gear").onclick = () => openPanel($("settings").hidden ? "settings" : null);
  $("histBtn").onclick = () => openPanel($("history").hidden ? "history" : null);
  $("sClose").onclick = () => openPanel(null);
  $("histClose").onclick = () => openPanel(null);
  $("sDefaults").onclick = () => {
    for (const f of TABS.find((t) => t.id === tab).fields) if (f[0] in D) S[f[0]] = D[f[0]];
    if (tab === "layout") Object.assign(S, PRESETS[0].set);
    save(); applySettings(); renderSettings();
  };
  $("reset").onclick = () => { keepFight(); a2.meter.reset(); };
  $("shot").onclick = async () => {
    try { await a2.window.screenshot(); } catch (e) { console.warn(e); }
  };

  a2.on("meter", render);
  a2.on("compact", (on) => document.body.classList.toggle("compact", !!on));

  (async () => {
    try { S = { ...D, ...((await a2.storage.get("settings")) || {}) }; } catch {}
    try { history = (await a2.storage.get("history")) || []; } catch {}
    applySettings();
    render({ dps: {} });
    await a2.ready();
    try {
      await a2.meter.start();
      const s = await a2.meter.status();
      if (s && s.error) showNotice(s.error === "npcap-missing" ? "npcap" : "error", s.error);
    } catch (e) {
      showNotice("error", e.message);
    }
  })();
})();
