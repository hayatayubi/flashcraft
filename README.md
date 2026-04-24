# Flashcraft

Flashcraft is a modern flashcard web app for revision. It includes:

- Account creation and sign-in
- Per-user saved progress
- Deck and card management
- Spaced-repetition study sessions
- AI-assisted flashcard generation from pasted notes or uploaded PDFs
- JSON backup import and export

## Project structure

- `src/` contains the React frontend
- `netlify/functions/api.mjs` contains the API for auth, saved progress, and AI imports
- `server/index.mjs` is kept as a legacy local server path

## Environment

Copy `.env.example` to `.env` and set:

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5.4
JWT_SECRET=replace_this_with_a_long_random_secret
```

`OPENAI_API_KEY` is required for AI note/PDF imports. The rest of the app works without it.

## Run locally

```bash
npm install
npm run dev
```

This starts Netlify local dev (frontend + functions) and serves the app on `http://localhost:8888` by default.

## Build

```bash
npm run build
```

## Legacy local run (optional)

```bash
npm run build
npm run dev:legacy
```

## Notes

- Production account/state data is stored in Netlify Blobs.
- AI imports use the OpenAI Responses API with structured JSON output.
- Uploaded PDFs are parsed locally before the extracted text is sent to the model.

## Deploy to Netlify

1. Push this repo to GitHub.
2. In Netlify, create a new site from that repo.
3. Build settings are already defined in `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. In Netlify Site settings -> Environment variables, add:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional, default `gpt-5.4`)
   - `JWT_SECRET` (required, use a long random value)
5. Deploy.

After deploy, `/api/*` requests are automatically routed to the Netlify Function.
