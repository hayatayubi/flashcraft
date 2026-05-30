# Flashcraft

A simple flashcard app for macOS. Build decks, add cards, study with spaced repetition. Runs entirely on your machine — no accounts, no cloud, no internet required.

## Features

- Deck and card management
- Spaced-repetition study sessions (hard / medium / easy)
- Card images sit as a tasteful background behind the question, not on top of it
- Five color themes (Blossom, Tide, Sprout, Ember, Paper) — your choice persists between launches
- Auto sign-in: data stays on this device

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
