# FASHN Virtual Try-On — local demo

A small React + Vite + PrimeReact app for trying out two FASHN AI generation modes:

- **Agent Images**: prompt-driven editing with up to 6 input images (the same engine as the app.fashn.ai Agent).
  It uses `POST /v1/agent/images/run` and polls `GET /v1/agent/status/{id}` every 3 s.
- **Try-On Max**: a single, deterministic try-on from one model image and one product image. It's cheaper for bulk work.
  It uses `POST /v1/run` with `model_name: "tryon-max"` and polls `GET /v1/status/{id}` every 2 s.

There is no backend. The Vite dev/preview server proxies `/fashn/*` to `https://api.fashn.ai/*` and adds
`Authorization: Bearer $FASHN_API_KEY` on the server side. This avoids CORS, and the key never reaches the browser bundle.

## Setup

Requires Node 18+.

```bash
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
# edit .env and set FASHN_API_KEY=<your key from https://app.fashn.ai/api>

npm install
npm run dev
```

Then open http://localhost:5173.

After you change `.env`, restart `npm run dev`, because the key is read when the server starts.

### Production-style preview

```bash
npm run build
npm run preview             # http://localhost:4173 (the same proxy is configured)
```

`dist/` alone will **not** work on a static host, because the API calls need the proxy (or your own backend) to add the key.

## Features

- Drag-and-drop, click or paste to upload into each slot, or paste a public image URL instead.
- Uploaded files are downscaled to at most 2048 px on the longest side and converted to JPEG (quality 0.92, white background) before sending.
- Agent prompt presets, with resolution, generation mode and aspect ratio settings.
- Try-On Max settings: an optional prompt, resolution, mode, 1–4 images, and a seed with a random-seed button.
- A live status line with elapsed time, and a Cancel button. Cancel only stops polling in the browser. A job that was already submitted may still finish and use credits.
- A results gallery with full-size preview, download (falls back to opening a new tab if the CDN blocks CORS) and copy URL.
- For Agent runs, the app shows the credits used and the tools the agent ran.
- An in-memory session history. Click an entry to restore its settings and results.
- The credit balance from `GET /v1/credits` is shown in the header and refreshed after every run.
- Error toasts show the HTTP status and error name (400 BadRequest, 422 NoImageGenerated / ImageLoadError, 429, 504 AgentTimeout).

> Result CDN URLs expire after about 3 days. Download anything you want to keep.

## Code layout

```
vite.config.js                 proxy + key injection (dev and preview)
src/fashn.js                   API client, polling, error parsing, image utils
src/App.jsx                    layout, mode switch, forms, generate/poll/cancel, history
src/components/ImageSlot.jsx   upload/URL slot with preview
src/components/ResultsGallery.jsx
src/styles.css
```
