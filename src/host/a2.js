// The plugin SDK, served to every plugin at /_sdk/a2.js.
// It speaks the same message format as the A2Tools plugin SDK, so a plugin
// written for A2Tools runs in Daeva Hub unchanged.
//
//   a2.on("compact", (on) => …)        the window's fold button
//   a2.on("language", (code) => …)     "en" for now
//   await a2.storage.get(key)          the plugin's own saved data (JSON values)
//   await a2.storage.set(key, value)
//   a2.notify(text)                    a short message in the plugin's window
//   a2.meter.start() / a2.meter.reset()  the DPS meter (permission "meter")
//   a2.on("theme", ({tokens, vars, light}) => …)  the player's colours (also set
//                                      as CSS variables --a2-bg, --a2-accent, … on <html>)
//   a2.ready()                         call once your handlers are set
(() => {
  const handlers = {};
  const waiting = new Map();
  let next = 0;
  const call = (name, args) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    window.parent.postMessage({ a2: 1, id, call: name, args }, "*");
  });
  window.addEventListener("message", (ev) => {
    if (ev.source !== window.parent) return;
    const m = ev.data;
    if (!m || m.a2 !== 1) return;
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? w.reject(new Error(m.error)) : w.resolve(m.result);
    } else if (m.event) {
      for (const fn of handlers[m.event] || []) {
        try { fn(m.data, { character: m.character ?? null }); } catch (e) { console.error(e); }
      }
    }
  });
  // The player's colours, as CSS variables on <html>, before the first paint
  // where possible and again whenever they change.
  const applyTheme = (t) => {
    if (!t || !t.vars) return;
    const s = document.documentElement.style;
    for (const k in t.vars) if (/^--a2-[a-z0-9-]+$/.test(k)) s.setProperty(k, String(t.vars[k]));
    document.documentElement.classList.toggle("a2-light", !!t.light);
    document.documentElement.classList.add("a2-themed");
  };
  (handlers.theme ||= []).push(applyTheme);
  call("theme.get", []).then(applyTheme, () => {});
  window.a2 = Object.freeze({
    on(event, fn) { (handlers[event] ||= []).push(fn); },
    storage: Object.freeze({
      get: (key) => call("storage.get", [key]).then((v) => (v == null ? null : JSON.parse(v))),
      set: (key, value) => call("storage.set", [key, JSON.stringify(value)]),
    }),
    notify: (text) => call("notify", [String(text)]),
    // screenshot(): copies this window to the clipboard and saves it in Pictures\Daeva Hub
    window: Object.freeze({ show: () => call("window.show", []), hide: () => call("window.hide", []), screenshot: () => call("window.screenshot", []) }),
    // DPS meter (permission "meter"): start() begins capture; numbers arrive as
    // a2.on("meter", ({dps, ping, me}) => …) twice a second, and the capture
    // state as a2.on("meter-status", ({running, npcap, error}) => …).
    meter: Object.freeze({
      start: () => call("meter.start", []),
      reset: () => call("meter.reset", []),
      status: () => call("meter.status", []),
      installNpcap: () => call("meter.installNpcap", []),
    }),
    ready: () => call("ready", []),
  });
})();
