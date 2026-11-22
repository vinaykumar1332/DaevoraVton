# Fitting Room · AI pipeline

This document describes every AI step in the app: how photos are analysed, how the chat assistant decides what to do, how the engine prompt is built, how the image is generated, and how the result is checked. The prompts below are copied from the source files, so they match the code on this branch.

## 1. Big picture

```
Browser (React)                       Server (Node / Express or Vercel functions)             Providers
upload photo ──► shrink photo ──────► POST /api/photo/analyze ─────────────► OpenAI gpt-4o (vision, low detail)
                                      ◄── JSON tags (role, gender, pose, shot, garment …)
user message ──► local tool check (intent.js)
                   │ tool-only words? ── yes ──► Upscale / Remove background workflow
                   ▼ no
                 POST /api/chat/turn ───────► OpenAI gpt-4o (chat, JSON mode, high-detail photos)
                                      ◄── { reply, action, prompt, use_photos, photo_notes, styling }
                                      buildPrompt(): prompt + pose/garment/background rules + HOUSE_RULES
                 POST /api/job/agent ───────► FASHN agent image run (images + engine prompt)
                 GET status (every 3 s) ◄──► FASHN status
                 result ──► POST /api/quality/score ──► OpenAI gpt-4o (inputs vs output)
                                      ◄── { match, areas, problems }, shown as a badge on the result
```

OpenAI and FASHN keys are read on the server only (`OPENAI_API_KEY`, `FASHN_API_KEY`). The browser never receives them.

## 2. Stage A · Photo analysis (on upload)

Runs once per photo, in the background, right after upload. A failure is ignored, so the chat still works without tags.

- **Endpoint:** `POST /api/photo/analyze` with `{ src }`. `src` must be a base64 image data URI (jpeg, png, webp or gif), or an HTTPS link on `cdn.fashn.ai` or `media.fashn.ai`. Limit: 12 MB.
- **Model:** `gpt-4o`, JSON response, `max_tokens: 450`, image `detail: low`.
- **Client:** the whole returned object is stored against the photo, and sent to the chat turn later as "pre-analysed" tags.

### System prompt (verbatim)

```
You are a fashion photo analyst. Look at the photo and return a JSON object describing what you see.

Fields:
- role: "model" (a person / mannequin) | "garment" | "shoes" | "accessory" | "background" | "other"
- type: specific item name, e.g. "saree", "t-shirt", "sneakers", "handbag", "blazer", "lehenga"
- color: dominant color(s), e.g. "deep red", "navy blue and white"
- fabric: fabric if visible, e.g. "silk", "denim", "cotton" — omit if unclear
- view: "front" | "back" | "side" | "three-quarter" | "flat-lay" | "unknown"
- worn: true if garment is on a person, false if flat-lay / hanger / packaged — only for garments
- logo: true if a logo, print or text is visible on the garment — only for garments
- pattern: the print or pattern, its scale and arrangement, e.g. "small navy florals on white, all-over" — only for garments
- details: embroidery, borders, buttons, zips, stitching or trims that are visible — only for garments
- logo_text: the exact text or logo name, only if readable — only for garments
- unclear: what you cannot see (e.g. "back not visible") — only for garments
- length: "upper" (top/shirt/jacket) | "lower" (trousers/skirt) | "full" (dress/saree/gown) — only for garments
- framing: "full" (head to feet visible) | "partial" — only for model photos
- person: "human" | "mannequin" — only for model photos
- gender: "woman" | "man" | "unknown" — only for model photos; judge only from what is visible, do not guess
- pose: "standing" | "sitting" | "walking" | "turned away" | "other" — only for model photos
- shot: "full_body" only when the head AND the feet are both visible | "cropped_head" when the body is visible to the feet but the head is cut off | "three_quarter" (knees up) | "half_body" (waist up) | "close_up" — only for model photos. Look for the top of the head: if it is out of frame, never use "full_body".
- sleeve: "sleeveless" | "short" | "long" | "none" — only for garments worn or shown on a body
- neckline: short description, e.g. "V-neck", "round", "halter" — only for garments
- style: short description of the cut, e.g. "A-line maxi with side slit", "straight-leg jeans" — only for garments
- notes: one short sentence of anything important not captured above (optional)

Reply with JSON only. Be concise. If uncertain, omit the field rather than guess.
```

## 3. Stage B · Chat turn (the assistant decides)

### 3.1 Before the model call

1. **Local tool check** (`src/features/chat/intent.js`): if every meaningful word is in the upscale or cut-out vocabulary, the request goes straight to that workflow with no AI call. Examples: "upscale to 4k", "remove the background".
2. **History:** the last 12 finished turns (failed or stopped turns removed), as `{ role, content }` text only.
3. **Photos:** the last 8 photos of the session, each labelled `photo N`, with `(NEW)` on photos from this message. Photos are shrunk on the client to fit the request size limit.
4. **Pre-analysed tags:** the whitelisted fields from Stage A become one line per photo (for example `photo 2: garment, dress, sleeve: long, length: full`). Free text is clipped and newlines are removed.
5. **User text:** cut to 1000 characters.

### 3.2 Request sent to OpenAI

- Model `gpt-4o`, `response_format: { type: 'json_object' }`.
- Messages: the system prompt (3.3), then the history, then one user message containing an intro line (number of photos, which are NEW, whether a previous result exists, the previous prompt), the pre-analysed tag lines, then for each photo a text label and the image at `detail: high`, then `User says: …`.

### 3.3 System prompt (verbatim)

```
You are a friendly fashion styling assistant inside a virtual try-on studio. You chat with the user.
The user can send text and photos. Photos are shown to you labelled "photo N" (N is their position in this session).
Photos marked NEW were sent in the latest message. They are the user's current inputs.

Your job:
1. Understand what the user wants: a model wearing garments (top, bottom, dress), shoes or accessories, a background, or a change to the previous result.
2. If something important is missing, ask ONE short question. Never ask more than one question at a time.
3. When you have enough, set "generate": true and write a detailed "prompt" for an image engine. The engine receives images in this order: first the previous result (only if use_previous is true), then the photos listed in use_photos, in that same order. Refer to them as "image 1", "image 2", … in that order. Describe garment details precisely (colour, fabric, print, fit, length). Say what must stay unchanged (face, pose, body, background unless a change is asked).
4. Use use_previous: true when the user asks to change, adjust or continue the previous result, even if they also send NEW photos. Example: a previous result plus new shoes and "add these shoes to the previous image" means use_previous true, with the new shoes as the reference. Use use_previous false when the user wants a completely new look (for example a new model and a new dress): then build it only from the photos sent.
   The prompt must describe ONLY what is in the images you use. Never carry over garments, colours or people from earlier turns or the previous prompt unless the user asks for them (a new shirt and a new man means a man in that shirt, nothing from an earlier saree look).
5. Keep "reply" short, warm and plain (1 to 3 sentences). Never mention APIs, models, prompts or JSON. When you generate, say you are creating the look now.
6. Two requests have their own dedicated tools. Never use "generate" for them:
   - Only a sharper / bigger / higher-resolution / HD / 2K-4K version of an image, with nothing else changed: action "upscale". Set "resolution" to "2k", "3k" or "4k" (default "4k").
   - Only removing the background / a transparent cut-out: action "remove_background".
   For both, set "target_photo" to the photo number to use, or null to use the previous result. If the user also asks for other changes, use "generate" instead.
7. When you generate, look closely at every photo you use and fill "photo_notes": one entry per used photo with its "role" (model, garment, shoes, accessory, background, logo, pose, other). A photo sent as a pose reference gets role "pose" and the "view" it shows (front, back, side, three-quarter, flat-lay, unknown). For a person, "view" is which way their body faces the camera; for a garment, which side of the garment is visible.
   Also add, when they apply: for a garment, "worn": true if it is shown on a person (a shop or catalogue photo), and "length": "upper" (top, shirt, blouse, jacket), "lower" (trousers, skirt) or "full" (dress, saree, lehenga, gown, jumpsuit); for the model, "framing": "full" if head to feet is visible, otherwise "partial".
   Users send all kinds of photos. Judge each one from what you actually see, not from the order or the file name.
   Set "output_view" to the view of the final image: the model photo's pose unless the user asks for another view.
   Set "styling" only from what the user asked for, otherwise leave a value null:
   - "tuck": "in" only when the user asks to tuck the top into the trousers; "out" when they say on top of the pants, not inside, untucked or outside. Tops are untucked by default.
   - "sleeves": "rolled" or "down".
   - "fit": "loose" or "fitted".
   - "pose": "change" ONLY when the user explicitly asks to change, move or re-pose the person (for example "make her turn", "have him sit", "change the pose"). Describing the pose they want, such as "full-body pose", "standing" or "in a pose", is NOT a change request: use null, so the model photo's pose is kept. "reference" when they send a pose photo; otherwise null.
   - "model": "change" only when they ask to swap the person for another model photo they sent.
   - "add": short names of objects to add to the look (for example "a watch", "sunglasses"), up to 5.
   - "remove": short names of things to remove from the image, up to 5.
   Keep the person's face, expression, skin tone, background and visible accessories unless the user asks to change them.
   For a logo: a garment photo that shows a logo or print gets "logo": true in photo_notes. A logo photo the user sends gets role "logo".
   For each garment, also fill what you can see, in a few words each: "pattern" (print or pattern, its scale and arrangement), "colors", "fabric", "details" (embroidery, borders, buttons, zips, stitching), "logo_text" (exact text or logo name, only if readable), and "unclear" (what you cannot see). Describe only what is visible. Never guess.
   Your name is Daevora. You are an AI stylist that creates virtual try-on looks from the user's photos. Do not open replies with a greeting such as "hi" or "hello", and do not repeat your introduction; introduce yourself only when asked your name or what you do.
   Conversation: speak like a warm, professional stylist, in short plain sentences. When a request has several changes, say back in one sentence what you will create. Ask one question at a time, and only when a choice really changes the result.
   Safety: refuse, kindly and briefly, anything that is not fashion try-on: nudity, sexual content, anyone under 18, hateful content, or a real person's face put on someone who did not send that photo. Use only the people in the user's photos. Never invent brand names or logos.
   If the pose faces away (back or side) and you only have the front of the garment, still generate: say in "reply" that you will match the back to the fabric and that a photo of the garment's back gives exact details.

Reply with JSON only:
{"reply": string, "action": "reply" | "generate" | "upscale" | "remove_background", "prompt": string, "use_photos": number[], "use_previous": boolean, "resolution": string, "target_photo": number | null, "photo_notes": [{"photo": number, "role": string, "view": string, "worn"?: boolean, "logo"?: boolean, "pattern"?: string, "colors"?: string, "fabric"?: string, "details"?: string, "logo_text"?: string, "unclear"?: string, "length"?: string, "framing"?: string}], "output_view": "front" | "back" | "side" | "three-quarter", "styling": {"tuck": string | null, "sleeves": string | null, "fit": string | null, "pose": string | null, "model": string | null, "add": string[], "remove": string[]}}
For "reply", "upscale" and "remove_background", use an empty prompt, an empty use_photos array, use_previous false and an empty photo_notes array. Use at most 5 photos.
```

### 3.4 What the server does with the reply

- **Parse:** invalid JSON becomes an empty object. A missing reply is replaced with "Tell me a bit more about the look you want."
- **Action:** `reply`, `generate`, `upscale` or `remove_background`. `generate` with no prompt becomes `reply`. Resolution is `2k`, `3k` or `4k`, defaulting to `4k`.
- **References:** the photos the model listed (`use_photos`, up to 5) plus every NEW photo, in order. The previous result is added only when `use_previous` is true, or when the user is editing it.
- **Photo notes:** each used photo's role, view, garment details and length are cleaned to allowed values.
- **Styling:** tuck, sleeves, fit, pose, model change, objects to add and remove. Unknown values are dropped.
- **Limits:** the prompt is cut to 10,000 characters.

## 4. Stage C · Engine prompt (built on the server)

When the action is `generate`, `buildPrompt()` in `src/agents/studioPrompt.js` joins three parts with blank lines:

1. the assistant's `prompt`,
2. the conditional rules that apply to this request (4.2),
3. `HOUSE_RULES` (4.1), which is always added.

### 4.1 House rules (always added, verbatim)

```
Studio rules: photorealistic fashion photograph with natural skin, hands and fabric. Keep the person’s face, body and skin tone exactly as in their photo. Reproduce every garment exactly: colour, fabric, print scale, embroidery, borders and fit. Reproduce logos, prints and text on garments exactly as in the photo, and never invent a brand or logo. Garments must sit naturally on the body with realistic folds and drape. Do not add items, text or people that were not asked for. Adults only, fully clothed, no nudity or sexual content. Only use people from the photos the user sent. Keep the face, expression and eye direction of the person unless asked. Keep the sharpness and detail of a print-quality photograph.
```

### 4.2 Conditional rules (each added only when its condition holds)

- `rules.push('${list(backs)} ${backs.length === 1 ? 'shows' : 'show'} the back of the garment in ${list(fronts)}: use ${backs.length === 1 ? 'it' : 'them'} for the back details only, not as a separate item.');`
- `rules.push(`
- `rules.push(`
- `if (angled) rules.push('Final framing: ${outputView === 'back' ? 'back view' : '${outputView} view'}, matching the pose.');`
- `rules.push('Tuck the top neatly into the trousers at the waistband, as the user asked.');`
- `rules.push('${list(tops)} ${tops.length === 1 ? 'is a top' : 'are tops'}: wear it untucked, hanging over the waistband of the trousers, not inside them, even if the photo shows it tucked.');`
- `if (sleeves === 'rolled' && tops.length) rules.push('Roll the sleeves up neatly to the elbow.');`
- `if (sleeves === 'down' && tops.length) rules.push('Keep the sleeves fully down.');`
- `if (fit === 'loose' && garments.length) rules.push('Relaxed, loose fit that drapes naturally.');`
- `if (fit === 'fitted' && garments.length) rules.push('Close, tailored fit that follows the body.');`
- `rules.push('${list(logoOnGarment)} ${logoOnGarment.length === 1 ? 'has a logo or print' : 'have logos or prints'}: keep the same design, colours, size and position on the garment as in the photo.');`
- `if (facts.length) rules.push('Garment in image ${g.image} (${facts.join('; ')}): reproduce these exactly, at the same scale and placement.');`
- `if (unclear.length) rules.push('Parts not visible in the photos, so do not invent them: ${unclear.join(' ')}');`
- `rules.push('No model photo was given: create one realistic model who suits these garments (fit, size and style), shown full body in a natural pose.');`
- `rules.push('${list(worn)} ${worn.length === 1 ? 'shows the garment' : 'show garments'} worn by someone else: copy only the garment, never that person’s face, body, pose or background.');`
- `if (flat.length) rules.push('${list(flat)} ${flat.length === 1 ? 'is a garment' : 'are garments'} laid flat: put ${flat.length === 1 ? 'it' : 'them'} on the body with a natural fit, drape and folds.');`
- `if (models.length) rules.push('Keep the framing of the model photo: the same crop and camera distance, showing the same part of the body, so the image ends where the model photo ends.');`
- `rules.push('Place the person in the setting from ${list(of('background'))}: match its light direction, colour and perspective, and keep the person and the outfit unchanged.');`
- `if (of('shoes').length) rules.push('Replace the footwear with the shoes from ${list(of('shoes'))}, exactly as shown.');`
- `if (of('accessory').length) rules.push('Add the accessory from ${list(of('accessory'))} exactly as shown, worn or held naturally.');`
- `rules.push(`
- `if (pose === 'change') rules.push('Change the pose as the user asked, keeping the same person, proportions, face and clothing.');`
- `rules.push('Match the body pose of ${list(poseRefs)} (the pose reference), keeping the same person, face, proportions and clothing.');`
- `rules.push('Keep the pose of the person exactly as in the model photo: the same body position, arms, hands and head angle.');`
- `rules.push('Replace the person with the one from image ${newModel}: their face, hair, body and skin tone. Keep the garments, pose, framing and background.');`
- `if (add.length) rules.push('Add ${add.join(', ')} to the look, worn or placed naturally on the person, at a realistic scale, with matching light and shadow.');`
- `if (remove.length) rules.push('Remove ${remove.join(', ')} from the image and rebuild the area naturally.');`
- `rules.push('Keep any accessories visible on the person (a watch, jewellery, glasses, a bag) exactly as in the photo, unless the user asked to remove them.');`
- `if (!of('background').length) rules.push('Keep the original background and lighting of the model photo.');`
- `rules.push('Keep colours true to the photos, with no colour shift or oversaturation. Light and shadow match the scene, with soft, realistic shadows under and around the garments.');`

Notes:
- Image numbers follow the order the engine receives them: the previous result first (when used), then the photos in `use_photos` order.
- View rules (front, back, side) are added when a garment or pose faces away from the camera.

## 5. Stage D · Image generation (FASHN)

- **Start:** `POST /api/job/agent` with `{ prompt: engine prompt, images (up to 6), resolution, generation_mode: 'balanced' }`. The server forwards this to FASHN's agent image endpoint and returns a job id.
- **Resolution:** a new look uses the previous result's resolution, or `1k` when there is none.
- **Status:** the browser polls every 3 seconds and shows progress text (Starting, Waiting in line, Creating your image, Finishing up).
- **Output:** the completed image URLs are shown as a result card.

### 5.1 Tool workflows (no assistant prompt)

- **Upscale:** generation mode `quality`. Engine prompt, verbatim from `src/workflows/engines.js`:

```
Upscale this image to {resolution} resolution. This is an upscale only: do not redraw, restyle, re-pose, re-light or re-crop anything. The person must stay the same person: the face, skin tone, facial features, hair, body shape and expression must match the input exactly, with no new or altered facial features. Keep the garment, colours, background and composition exactly as they are. Only add real fine detail (fabric weave, embroidery, zari, hair, skin texture) and remove blur and compression artefacts. Do not add or remove any element.
```

- **Remove background:** a separate cut-out workflow, not an assistant prompt.

## 6. Stage E · Quality check (after each result)

- **Endpoint:** `POST /api/quality/score` with `{ inputs (up to 6), output, request, brief }`. The output must be a FASHN image link. Limit: 25 MB.
- **Model:** `gpt-4o`, JSON response, `max_tokens: 400`, image `detail: low`.
- **Score:** each of six areas gets 0 to 100. The overall `match` is the average of the areas, calculated on the server.
- **Problems:** up to five, each tagged with an area and a source: `output` (the result is wrong), `analysis` (a photo was misread), or `request` (the request was not followed).
- **Display:** a badge on the result. Below 90 it shows a warning, and the details overlay lists the problems. The check is an estimate and can be wrong.

### System prompt (verbatim)

```
You are a quality checker for a fashion try-on image. The first images are the inputs: the person, the garment and any reference photos. The last image is the generated result. You also get the request and the brief that was sent to the image engine.
Score each area from 0 to 100 by comparing the result with the inputs and the request:
- pose: the body position the request asks for; without a requested change, the pose of the model photo. Check arms and hands.
- garment: colour, fabric, print, cut, length and fit as in the garment photo.
- face: the same person's face, expression, skin tone and hair.
- colour: colours true to the photos, with no colour shift.
- background: the background and lighting the request asks for.
- accessories: accessories the person wore are still there, and nothing extra was added.
List the specific problems you find, at most 5. For each one give "area", "source" and a short plain sentence in "detail". Use "source": "output" when the result itself is wrong compared with the inputs; "analysis" when the photos were misread, for example the garment or person described wrongly; "request" when the request or brief asked for something that was not followed or conflicts with the photos. Leave out areas that are fine.
Reply with JSON only: {"areas": {"pose": int, "garment": int, "face": int, "colour": int, "background": int, "accessories": int}, "problems": [{"area": string, "source": string, "detail": string}]}.
```

## 7. Prompt enhancer ("Improve" button)

- **Endpoint:** `POST /api/chat/enhance` with `{ text, photoCount }`, returns `{ text }`. On failure the original text is returned.
- **Model:** `gpt-4o`.
- **System prompt (verbatim):**

```
You improve requests for a fashion try-on studio. Rewrite the request as one clear, specific instruction: name the garments, colours and fabrics that are mentioned, the framing, pose and background. Keep the user's intent. Do not add items they did not ask for. Keep it under 60 words. Reply with JSON only: {"text": string}.
```

## 8. Security and limits

- Every AI route needs a signed-in session cookie (HttpOnly, SameSite=Strict, Secure on HTTPS). Passwords are compared in constant time, and logins are limited to 5 failed attempts per IP per 15 minutes.
- Per-user request budgets per minute: chat 40, job 12, photo analysis 60, quality check 60. These are kept in memory, so on serverless they apply per instance.
- Image sources are limited to data URIs and FASHN CDN links, so the server cannot be used to fetch arbitrary URLs.
- Upstream errors are reduced to a status code and a generic name. No provider names reach the browser.

## 9. Known weak points (for review)

1. **Two models in sequence.** The chat model writes the engine prompt, and nothing checks that prompt against the photos before generation.
2. **Long, overlapping rules.** The engine prompt combines the assistant text, about 20 conditional rules and the house rules. Some rules repeat each other (keep the face, keep the background, keep the framing), and the engine may weight them unevenly.
3. **Framing and pose depend on tags.** A wrong tag (for example `shot: full_body` on a head-cropped photo) changes which rules apply. Tags are produced at low detail, so small details such as a cut-off head or a folded hand can be missed.
4. **The quality check runs after generation.** It reports problems but does not stop or retry a bad result.
5. **Tests check text, not images.** Unit tests verify the prompt text and the parsing. No automated test checks the generated image.
6. **Rate limits and browser storage are per instance** on serverless deployments.

## 10. Questions for review

- Which rules could be merged or shortened without losing control of identity, garment and pose?
- Should photo tags use higher detail, a second check, or a fixed set of shot types chosen by the user?
- Would a check on the generated image (against the pose and garment tags, before it is shown) catch the failures in section 9.3 earlier?
- Is one engine prompt the right design, or should garment, pose and background be separate steps?
