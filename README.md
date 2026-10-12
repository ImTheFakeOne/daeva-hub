# Daeva Hub

A plugin launcher for Aion 2 tools, in the spirit of Dalamud: browse plugins from repositories you choose, install them with one click, and keep them all up to date with **Update all**.

Daeva Hub never touches the game. Plugins run in their own always-on-top overlay windows, sandboxed, with no internet access.

## What you can install

Daeva Hub starts with nothing installed. Everything is in **Browse**, and you pick what you want:

- **DPS Meter** (ships inside the app): live damage per second for you and your party, styled after NotMeter: target card with HP, class-coloured bars, combat power, DPS and share, fight timer, ping, fight history and a screenshot button. Its ⚙ settings cover layout presets, bar style, row size, columns, names, number formats and every colour, down to each class. It reads the game's network traffic, the same way the A2Tools DPS Meter does (its capture code comes from A2Tools). It needs [Npcap](https://npcap.com/#download): install it with *WinPcap API-compatible mode* ticked. If the meter can't capture, run Daeva Hub as administrator. Like any DPS meter, use it at your own risk: the game's terms may not allow third-party tools.
- **Official plugins**, such as the **Aion 2 Checklist**, from this repository's [`repo.json`](repo.json). That repository is always listed, so they show in Browse without adding anything.
- **Plugins from other authors**, once you add their repository in Settings.

## Install

Download `DaevaHub-Setup-<version>.exe` from the [Releases page](https://github.com/ImTheFakeOne/daeva-hub/releases) and run it. Windows may warn that the installer is from an unknown publisher, because it isn't code-signed: choose **More info → Run anyway**.

You only install it once. From version 0.3.0 Daeva Hub updates itself: it checks for a new version when it starts and every few hours, downloads it in the background, and shows **Restart to update** (if you ignore it, the update installs the next time you quit). **Settings → Daeva Hub updates** checks by hand.

## Use

1. **Settings → Plugin repositories:** the official repository is always there. To get plugins from other authors, paste their repository address and click **Add**.
2. **Browse:** search everything your repositories offer, and click **Install**.
3. **Installed:** open, close or uninstall plugins. Each one opens in its own overlay window. Drag it by its title bar, set its background opacity with the slider, and fold its controls away with ▾. Windows remember where you left them and reopen next time.
4. **Update all** (top right) installs every newer version your repositories list. Daeva Hub checks for updates when it starts, and whenever you click **Check for updates**.

**Appearance** changes the colours of the hub and every plugin: pick a preset or set each colour, the font, text size and corner roundness, with a live preview. Any plugin can have its own colours instead. Copy a theme code to share it or keep a backup.

**Lock (click-through):** the 🔓 on an overlay's title bar, or Lock on its card in Installed, lets clicks go through to the game. **Ctrl+Alt+L** locks or unlocks every overlay.

Overlay windows show above the game in **borderless / windowed fullscreen**. In exclusive fullscreen Windows doesn't allow anything on top of the game.

## Make a plugin

A plugin is a folder with a `manifest.json` and an `index.html`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "apiVersion": 2,
  "author": "you",
  "description": "What it does, in one sentence.",
  "permissions": ["storage"],
  "ui": { "panel": { "width": 360, "height": 480 } }
}
```

- `id`: lowercase letters, digits and `-`, at most 40 characters.
- `permissions`: `storage` (save its own data), `notify` (short messages in its window) and `meter` (live DPS numbers from the built-in meter).

The page loads the SDK with `<script src="/_sdk/a2.js"></script>` and gets an `a2` object:

```js
const saved = await a2.storage.get("state");      // your data, or null
await a2.storage.set("state", { ticks: 3 });      // any JSON value, up to 1 MB
a2.notify("Saved!");
a2.on("compact", (on) => { /* hide your controls */ });
a2.ready();                                        // call once your handlers are set
await a2.window.screenshot();                      // copy this window to the clipboard

// with the "meter" permission:
a2.on("meter", ({ dps, ping, me }) => { /* dps.map, dps.targetName, dps.battleTime … twice a second */ });
a2.on("meter-status", ({ running, npcap, error }) => {});
await a2.meter.start();                            // starts capture (stops when no meter window is open)
await a2.meter.reset();                            // new fight
```

The SDK matches the A2Tools DPS Meter's plugin SDK, so plugins written for A2Tools run here too. Plugins can't reach the network, and their scripts and styles must be files in the plugin folder. Keep the page background transparent: the window paints its own panel at the opacity the player picks.

Use the player's colours: the SDK sets CSS variables on `<html>` (and the class `a2-themed`, plus `a2-light` for light themes), and updates them live. They are `--a2-bg`, `--a2-title-bg`, `--a2-title-text`, `--a2-border`, `--a2-surface`, `--a2-surface-alt`, `--a2-text`, `--a2-muted`, `--a2-accent`, `--a2-accent-text`, `--a2-highlight`, `--a2-good`, `--a2-warn`, `--a2-bad` (each also as `-rgb`, e.g. `rgba(var(--a2-accent-rgb), .3)`), and `--a2-font`, `--a2-font-size`, `--a2-radius`, `--a2-border-width`. `a2.on("theme", ({ tokens, light }) => …)` gives the same in script.

While you work on a plugin, add its folder under **Settings → Local plugin folders**. It loads straight from the folder; close and reopen its window to see your changes.

## Publish plugins: the repository file

A repository is one JSON file. Put a `repo.json` at the top of a GitHub repository, and people can add it by its address (`github.com/you/your-repo`):

```json
{
  "name": "My plugins",
  "plugins": [
    {
      "id": "my-plugin",
      "name": "My Plugin",
      "author": "you",
      "description": "What it does.",
      "version": "1.0.0",
      "tags": ["timers"],
      "download": "https://github.com/you/your-repo/archive/refs/tags/v1.0.0.zip",
      "icon": "https://raw.githubusercontent.com/you/your-repo/HEAD/icon.png",
      "repoUrl": "https://github.com/you/your-repo"
    }
  ]
}
```

`download` is a zip containing the plugin folder. A GitHub archive works as it is: of a tag (`…/archive/refs/tags/v1.0.0.zip`) or of a commit (`…/archive/<commit id>.zip`). To release an update: raise `version` in `manifest.json` and push, then change `version` and `download` in `repo.json` to match. Everyone gets it with **Update all**.

## Build it yourself

```
npm install
cargo build --release --manifest-path meter/Cargo.toml   # the DPS meter (Rust)
# copy meter/target/release/daeva-meter.exe and meter/data into meter-dist/
npm start        # run it
npm test         # the core tests
npm run dist     # build the Windows installer into dist/
```

Every push to `main` makes GitHub Actions build the installer and publish it, with the `latest.yml` the updater reads, as the release for the version in `package.json`. To ship a new version to everyone, raise `version` there and push: installed copies pick it up on their next check. Pushes that don't change the version replace that release's files, and copies that already have that version don't see them, so always raise the version for a real update.

## Licence

GPL-3.0 – see [LICENSE](LICENSE). The DPS meter's capture and damage code in `meter/` comes from [A2Tools DPS Meter](https://github.com/taengu/A2Tools-DPS-Meter) by taengu and contributors, also GPL-3.0; the commit it was taken from is in `meter/A2TOOLS_COMMIT`. Its class icons are from A2Tools too.
