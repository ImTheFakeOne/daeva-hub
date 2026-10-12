"use strict";
// Plugin repositories: one JSON file per repository listing its plugins.
//
//   { "name": "My plugins",
//     "plugins": [
//       { "id": "aion2-checklist", "name": "Aion 2 Checklist", "author": "…",
//         "description": "…", "version": "0.3.0", "tags": ["checklist"],
//         "download": "https://…/plugin.zip", "icon": "https://…/icon.png",
//         "repoUrl": "https://github.com/…" } ] }
//
// A bare array of plugins is accepted too. A GitHub repository address
// (github.com/owner/name) is read as that repository's repo.json.

const ID = /^[a-z0-9-]{1,40}$/;
const FETCH_TIMEOUT_MS = 15000;

function resolveRepoUrl(input) {
  const s = String(input || "").trim();
  if (!s) throw new Error("Enter a repository address.");
  const withScheme = /^[a-z]+:\/\//i.test(s) ? s : "https://" + s;
  let u;
  try { u = new URL(withScheme); } catch { throw new Error("That isn't a web address."); }
  if (u.protocol !== "https:") throw new Error("Repository addresses must start with https://");
  if (u.hostname === "github.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 2) {
      const repo = parts[1].replace(/\.git$/, "");
      return `https://raw.githubusercontent.com/${parts[0]}/${repo}/HEAD/repo.json`;
    }
    if (parts.length >= 5 && parts[2] === "blob") {
      return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join("/")}`;
    }
  }
  return u.toString();
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const httpsUrl = (v) => {
  try { const u = new URL(String(v)); return u.protocol === "https:" ? u.toString() : ""; } catch { return ""; }
};

// "plugins/dps-meter": relative, forward slashes, no "..", plain names only.
function subPath(v) {
  if (typeof v !== "string" || !v.trim()) return "";
  const parts = v.trim().replace(/^\/+|\/+$/g, "").split("/");
  return parts.length <= 5 && parts.every((x) => /^[A-Za-z0-9._-]{1,64}$/.test(x) && x !== "." && x !== "..") ? parts.join("/") : "";
}

function normalize(json, url) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.plugins) ? json.plugins : null;
  if (!list) throw new Error("The repository file has no plugin list.");
  const plugins = [];
  for (const p of list.slice(0, 500)) {
    const id = str(p?.id ?? p?.InternalName, 40).toLowerCase();
    const download = httpsUrl(p?.download ?? p?.DownloadLinkInstall);
    if (!ID.test(id) || !download) continue;
    plugins.push({
      id,
      name: str(p.name ?? p.Name, 60) || id,
      author: str(p.author ?? p.Author, 60),
      description: str(p.description ?? p.Description ?? p.punchline ?? p.Punchline, 600),
      version: str(p.version ?? p.AssemblyVersion, 30) || "0.0.0",
      tags: (Array.isArray(p.tags ?? p.Tags) ? p.tags ?? p.Tags : []).map((t) => str(t, 30)).filter(Boolean).slice(0, 10),
      download,
      icon: httpsUrl(p.icon ?? p.IconUrl),
      repoUrl: httpsUrl(p.repoUrl ?? p.RepoUrl),
      changelog: str(p.changelog ?? p.Changelog, 2000),
      // the plugin's folder inside the download, when it isn't at the top
      // (several plugins, or a plugin next to other code, in one repository)
      path: subPath(p.path),
      source: url,
    });
  }
  return { name: str(json?.name, 80), plugins };
}

async function fetchRepo(input, fetchFn = fetch) {
  const url = resolveRepoUrl(input);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctrl.signal, headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new Error(`The repository answered ${res.status}${res.status === 404 ? " (not found: check the address, and that the repository has a repo.json)" : ""}.`);
    const text = await res.text();
    if (text.length > 2_000_000) throw new Error("The repository file is too large.");
    let json;
    try { json = JSON.parse(text); } catch { throw new Error("The repository file isn't valid JSON."); }
    return { input, url, ...normalize(json, input) };
  } catch (e) {
    const msg = e.name === "AbortError" ? "The repository didn't answer in time." : e.message;
    return { input, url, name: "", plugins: [], error: msg };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolveRepoUrl, normalize, fetchRepo, ID };
