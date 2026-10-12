// DPS Meter: shows what the hub's built-in meter sees. The capture itself runs
// in the hub (code from A2Tools); this page only draws the numbers.
(() => {
  const CLASSES = {
    검성: ["Gladiator", "gladiator", "#4FD1C5"],
    수호성: ["Templar", "templar", "#5F8CFF"],
    궁성: ["Ranger", "ranger", "#41D98A"],
    살성: ["Assassin", "assassin", "#7BE35A"],
    마도성: ["Sorcerer", "sorcerer", "#9A6BFF"],
    치유성: ["Cleric", "cleric", "#F2C15A"],
    정령성: ["Spiritmaster", "spiritmaster", "#E06BFF"],
    호법성: ["Chanter", "chanter", "#FF9A3D"],
    권성: ["Fighter", "fighter", "#E85D5D"],
  };
  const $ = (id) => document.getElementById(id);
  const rowsEl = $("rows"), notice = $("notice");
  const nf = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const fmt = (n) => (Number(n) >= 10000 ? nf.format(Number(n)) : Math.round(Number(n) || 0).toLocaleString("en"));
  const mmss = (ms) => {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  const text = (el, t) => { if (el.textContent !== t) el.textContent = t; };

  let mineOnly = false, last = null;

  function showNotice(kind, message) {
    notice.replaceChildren();
    if (!kind) { notice.hidden = true; return; }
    notice.hidden = false;
    const p = document.createElement("div");
    if (kind === "npcap") {
      p.textContent = "Npcap isn't installed. The meter needs it to read the game's traffic. Install it with “WinPcap API-compatible mode” ticked, then reopen this window.";
      const b = document.createElement("button");
      b.textContent = "Get Npcap";
      b.onclick = () => a2.meter.installNpcap();
      notice.append(p, b);
    } else {
      p.textContent = message;
      const b = document.createElement("button");
      b.textContent = "Try again";
      b.onclick = () => a2.meter.start();
      notice.append(p, b);
    }
  }

  a2.on("meter-status", (s) => {
    if (!s) return;
    if (s.error === "npcap-missing" || s.npcap === false) showNotice("npcap");
    else if (s.error) showNotice("error", s.error + " If it keeps happening, run Daeva Hub as administrator.");
    else showNotice(null);
  });

  function render(msg) {
    last = msg;
    const d = msg.dps || {};
    const ping = Number(msg.ping);
    text($("ping"), Number.isFinite(ping) && ping > 0 ? Math.round(ping) + " ms" : "");
    text($("time"), mmss(d.battleTime));

    const tname = $("tname");
    text(tname, d.targetName || (d.battleTime ? "Fighting…" : "Waiting for combat…"));
    tname.classList.toggle("boss", !!d.targetIsBoss);
    const max = Number(d.targetMaxHp) || 0, cur = Number(d.targetCurrentHp);
    $("hp").hidden = !(max > 0 && Number.isFinite(cur));
    if (max > 0 && Number.isFinite(cur)) {
      const pct = Math.max(0, Math.min(100, (cur / max) * 100));
      $("hpfill").style.width = pct.toFixed(1) + "%";
      text($("hptext"), `${fmt(cur)} / ${fmt(max)} (${pct.toFixed(1)}%)`);
    }

    const meId = d.localPlayerId != null ? String(d.localPlayerId) : null;
    let people = Object.entries(d.map || {}).map(([id, p]) => ({ id, ...p }))
      .filter((p) => Number(p.amount) > 0 || Number(p.dps) > 0);
    const total = people.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    people.sort((a, b) => (Number(b.dps) || 0) - (Number(a.dps) || 0));
    if (mineOnly) people = people.filter((p) => p.id === meId);
    const top = Math.max(1, ...people.map((p) => Number(p.dps) || 0));

    text($("total"), total ? `Total ${fmt(total)}` : "");
    if (!people.length) {
      if (!rowsEl.querySelector(".empty")) {
        const e = document.createElement("div");
        e.className = "empty";
        e.textContent = "No damage yet. Hit something in game.";
        rowsEl.replaceChildren(e);
      }
      return;
    }
    rowsEl.replaceChildren(...people.map((p) => {
      const cls = CLASSES[p.job] || [p.job || "", "", "#8aa0c8"];
      const row = document.createElement("div");
      row.className = "row" + (p.id === meId ? " me" : "");
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = ((Number(p.dps) || 0) / top * 100).toFixed(1) + "%";
      bar.style.background = cls[2];
      const icon = document.createElement("img");
      icon.alt = cls[0];
      icon.title = cls[0];
      if (cls[1]) icon.src = `img/${cls[1]}.png`; else icon.style.visibility = "hidden";
      const who = document.createElement("div");
      who.className = "who";
      who.textContent = p.nickname || (p.id === meId ? (msg.me && msg.me.name) || "You" : "Unknown");
      const dmg = document.createElement("span");
      dmg.className = "dmg";
      dmg.textContent = fmt(p.amount) + " damage";
      who.append(dmg);
      const dps = document.createElement("div");
      dps.className = "dps";
      dps.textContent = fmt(p.dps) + "/s";
      const pct = document.createElement("div");
      pct.className = "pct";
      pct.textContent = (total ? ((Number(p.amount) || 0) / total) * 100 : 0).toFixed(1) + "%";
      row.append(bar, icon, who, dps, pct);
      return row;
    }));
  }

  a2.on("meter", render);
  a2.on("compact", (on) => document.body.classList.toggle("compact", !!on));
  $("reset").onclick = () => a2.meter.reset();
  $("mineOnly").onchange = (e) => {
    mineOnly = e.target.checked;
    a2.storage.set("mineOnly", mineOnly);
    if (last) render(last);
  };

  (async () => {
    mineOnly = !!(await a2.storage.get("mineOnly"));
    $("mineOnly").checked = mineOnly;
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
