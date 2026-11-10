# Flashcraft

A flashcard app for macOS. Make decks, add cards and study them with spaced repetition. It runs on your Mac with no account and no internet connection.

## What it does

- Decks and cards
- Study sessions with spaced repetition (rate each card hard, medium or easy)
- Optional images on cards, shown faintly behind the question
- Five colour themes: Blossom, Tide, Sprout, Ember and Paper. Your choice is remembered.
- Your decks stay on your Mac in `~/Library/Application Support/Flashcraft/`, and updates keep them

## Install

1. Download **[Flashcraft.dmg](https://github.com/hayatayubi/flashcraft/releases/latest)**.
2. Open it and drag Flashcraft into Applications.

The app is signed and notarised, and it's a universal build, so it runs on Apple Silicon and Intel Macs.

## Running from source

```bash
npm install
npm run electron:dev
```

This builds the Vite frontend and starts Electron.

## Building the Mac app

```bash
npm run dist:mac
```

That writes `release/Flashcraft.dmg`, a universal build that's ad-hoc signed. For a release build, sign with a Developer ID certificate with the hardened runtime turned on, then notarise the DMG with `notarytool` and staple the ticket.

## Project layout

- `src/`: React frontend (Vite and TypeScript)
- `server/`: small Express server that stores decks as JSON. It's bundled into the Electron app.
- `electron/`: Electron main process. It starts the server and opens the window.
- `build/`: the icon source (`icon.svg`) and `render-icons.mjs` to regenerate the icon set
- `public/`: static assets

## Changing the icon

1. Edit `build/icon.svg`
2. Run `node build/render-icons.mjs && iconutil -c icns build/icon.iconset -o build/icon.icns`
3. Run `npm run dist:mac`

If macOS keeps showing the old icon, run `killall Dock && killall Finder`.
