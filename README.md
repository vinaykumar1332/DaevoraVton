# FASHN Virtual Try-On — local demo

A small React + Vite + Tailwind + shadcn/ui app for trying out two FASHN AI generation modes:

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
- Uploaded files are downscaled to at most 1600 px on the longest side and converted to JPEG (quality 0.85, white background) before sending.
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

## Sign-in and security

Sign-in is checked **on the server**, not in the browser:

- `/api/login` checks the username and password against the `APP_USERS` environment variable and sets a signed,
  `HttpOnly`, `SameSite=Strict` cookie that lasts 8 hours. There are no passwords in the JavaScript.
- The `/fashn` and `/openai` proxies refuse requests without that cookie, only forward the endpoints the app uses,
  and only allow the OpenAI models the app uses. Your API keys stay on the server.
- After 5 wrong passwords from one address the login is blocked for 15 minutes (best effort: the counter lives in the
  memory of one serverless instance).
- Vercel sends security headers (CSP, no framing, no MIME sniffing, HSTS). See `vercel.json`.

Local development uses the same rules (see `devApi()` in `vite.config.js`), so add `APP_USERS` and `SESSION_SECRET` to `.env`
(examples in `.env.example`) and restart `npm run dev`.

Known limits: sessions are stateless, so signing out clears the cookie but a copied cookie works until it expires
(8 hours); change `SESSION_SECRET` to end every session at once. Passwords are stored in plain text in the environment variable.
Set spending limits in the FASHN and OpenAI dashboards, and rotate a key if it was ever committed or shared.

## Deploying to Vercel

Locally, the Vite proxy adds the API keys. On Vercel there is no Vite server, so the same job is done by
serverless functions in `api/` (`/fashn/*` and `/openai/*`), wired up by `vercel.json`. `/cdn/*` and `/media/*`
are plain rewrites and every other path falls back to `index.html`, so pages like `/ai-studio` survive a refresh.

1. In the Vercel project go to **Settings → Environment Variables** and add, for Production (and Preview if you use it):
   - `FASHN_API_KEY`
   - `OPENAI_API_KEY`
   - `APP_USERS` (JSON on one line, see `.env.example`)
   - `SESSION_SECRET` (32+ random characters)

   Use exactly these names, with **no** `VITE_` prefix (a `VITE_` variable would be put into the browser bundle).
2. **Redeploy.** Environment variables only apply to new deployments.

Limits: a Vercel function accepts a request body of up to 4.5 MB, so photos are downsized before sending and the app
shows "Photos too large" if a run still goes over. Functions are allowed 120 s per call (`maxDuration` in `vercel.json`). Your Vercel plan must allow that: on Hobby it needs Fluid Compute (Settings → Functions), otherwise the deploy can fail or the limit is capped lower.
