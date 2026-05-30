# Flashcraft

A simple flashcard app for macOS. Build decks, add cards, study with spaced repetition. Runs entirely on your machine — no accounts, no cloud, no internet required.

## Features

- Deck and card management
- Spaced-repetition study sessions (hard / medium / easy)
- Card images sit as a tasteful background behind the question, not on top of it
- Five color themes (Blossom, Tide, Sprout, Ember, Paper) — your choice persists between launches
- Auto sign-in: data stays on this device

## Download

Grab the latest `Flashcraft-x.y.z-arm64.dmg` (Apple Silicon) or `Flashcraft-x.y.z.dmg` (Intel) from the [Releases page](https://github.com/hayatayubi/flashcraft/releases/latest), open the DMG, and drag `Flashcraft.app` to `/Applications`.

### First launch

The build is unsigned, so macOS will block it on first launch — usually with a misleading **"Flashcraft.app is damaged and can't be opened"** message. The app is fine; macOS is just refusing to run something it didn't recognise. Run this one-liner in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Flashcraft.app && open /Applications/Flashcraft.app
```

That strips the quarantine attribute macOS attached when you downloaded the DMG. After that, double-clicking Flashcraft works normally — you only need to do this once per install. (Re-run it whenever you install a new version from a fresh download.)

> The old "right-click → Open" trick stopped working reliably on macOS 15. Use the command above.

Your decks live at `~/Library/Application Support/Flashcraft/` so updating the app never touches your data.

## Run from source

```bash
npm install
npm run electron:dev
```

`electron:dev` builds the Vite frontend and launches Electron. Data lives at `~/Library/Application Support/Flashcraft/`.

## Build a macOS distributable

```bash
npm run dist:mac
```

Outputs to `release/`:

- `Flashcraft-1.0.0-arm64.dmg` — Apple Silicon
- `Flashcraft-1.0.0.dmg` — Intel

The build is unsigned. On first launch, right-click `Flashcraft.app` → Open → Open to bypass Gatekeeper.

## Refresh the app icon

If macOS keeps showing an old icon after an update:

```bash
killall Dock && killall Finder
```

## Project layout

- `src/` — React frontend (Vite + TypeScript)
- `server/` — Express server, bundled inside the Electron app; stores decks in JSON
- `electron/` — Electron main process; boots the server and opens the window
- `build/` — `icon.svg` source + `render-icons.mjs` to regenerate the iconset
- `public/` — static assets served by Vite

## Editing the app icon

1. Edit `build/icon.svg`
2. `node build/render-icons.mjs && iconutil -c icns build/icon.iconset -o build/icon.icns`
3. `npm run dist:mac`
