# Flashcraft

A simple flashcard app for macOS. Build decks, add cards, study with spaced repetition. Runs entirely on your machine — no accounts, no cloud, no internet required.

## Features

- Deck and card management
- Spaced-repetition study sessions (hard / medium / easy)
- Card images sit as a tasteful background behind the question, not on top of it
- Five color themes (Blossom, Tide, Sprout, Ember, Paper) — your choice persists between launches
- Auto sign-in: data stays on this device

## Install

1. Download the latest **[Flashcraft.dmg](https://github.com/hayatayubi/flashcraft/releases/latest)**.
2. Open the DMG and drag `Flashcraft` into the `Applications` folder.
3. Double-click `Flashcraft` in Applications. macOS will block it — click **OK**.
4. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.

That's it. The DMG is a universal binary, so the same download works on Apple Silicon and Intel Macs. Your decks live at `~/Library/Application Support/Flashcraft/` and are preserved across updates.

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

Outputs `release/Flashcraft.dmg` — a single universal binary (arm64 + x64), ad-hoc signed so macOS shows the "Open Anyway" flow instead of the "damaged" error.

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
