// A plugin window: a title bar the hub owns, and the plugin in a sandboxed
// frame (its own origin, no access to this page, no network). The plugin asks
// for things by message; this page answers only what its permissions allow.
(async () => {
  const id = new URLSearchParams(location.search).get("id");
  const stage = document.getElementById("stage");
  const toast = document.getElementById("toast");
  let info;
  try {
    info = await host.hello();
  } catch (e) {
    stage.textContent = "This plugin could not start: " + e.message;
    return;
  }
  const allowed = (perm) => info.permissions.includes(perm);
  document.title = info.name;
  document.getElementById("name").textContent = `${info.name} ${info.version}`;
  document.getElementById("badge").hidden = !info.local;

  let frame = null, ready = false;
  const queue = [];
  const send = (msg) => frame && frame.contentWindow && frame.contentWindow.postMessage({ a2: 1, ...msg }, "*");
  const deliver = (event, data) => (ready ? send({ event, data }) : queue.push({ event, data }));

  // panel preferences
  let opacity = info.opacity, compact = info.compact;
  const opacityEl = document.getElementById("opacity");
  const compactEl = document.getElementById("compact");
  const paint = () => {
    document.documentElement.style.setProperty("--alpha", String(opacity / 100));
    opacityEl.value = String(opacity);
    compactEl.setAttribute("aria-pressed", String(compact));
    compactEl.title = compactEl.ariaLabel = compact ? "Show the controls" : "Hide the controls";
  };
  paint();
  opacityEl.addEventListener("input", () => { opacity = Number(opacityEl.value); paint(); host.panel({ opacity }); });
  compactEl.addEventListener("click", () => { compact = !compact; paint(); host.panel({ compact }); deliver("compact", compact); });
  document.getElementById("close").addEventListener("click", () => host.close());
  document.getElementById("hubBtn").addEventListener("click", () => host.openHub());

  let toastTimer = 0;
  const showToast = (text) => {
    toast.textContent = text.slice(0, 200);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4000);
  };

  const calls = {
    ready: () => { ready = true; for (const m of queue.splice(0)) send(m); return true; },
    "storage.get": ([key]) => host.storageGet(String(key)),
    "storage.set": ([key, value]) => host.storageSet(String(key), String(value)),
    notify: ([text]) => { if (!allowed("notify")) throw new Error('the plugin lacks the "notify" permission'); showToast(String(text)); return true; },
    "window.show": () => true,
    "window.hide": () => true,
  };
  window.addEventListener("message", async (ev) => {
    if (!frame || ev.source !== frame.contentWindow) return;
    const m = ev.data;
    if (!m || m.a2 !== 1 || !m.id || typeof m.call !== "string") return;
    try {
      const fn = calls[m.call];
      if (!fn) throw new Error("unknown call " + m.call);
      send({ id: m.id, result: await fn(Array.isArray(m.args) ? m.args : []) });
    } catch (e) {
      send({ id: m.id, error: String((e && e.message) || e) });
    }
  });

  deliver("language", "en");
  deliver("compact", compact);
  frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.src = `plugin://${id}/index.html`;
  stage.appendChild(frame);
})();
