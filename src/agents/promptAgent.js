// AI prompt agent: OpenAI vision model reads the garment (and model) images and writes
// the prompt that FASHN's Agent renders. Also used to revise a prompt from a change request.
import { FashnError } from '@/api/fashn.js';

const SYSTEM = `You write prompts for a fashion image engine that dresses a model in a garment.
You receive labelled images. Refer to them ONLY by their numbers ("image 1", "image 2", ...) exactly as listed.
Describe the garment precisely so it is reproduced exactly: type, colour, fabric, print, embroidery, border, fit, length, neckline, sleeves, closures, and any shoes or accessories visible.
Say what must stay unchanged (face, pose, body, background unless a change is requested). Specify framing, background, lighting and camera.
Some garments come with a FRONT and a BACK image. Treat both as one garment: describe the back details too, and do not dress the model in the back photo as a separate item.
If a change request is given, apply it to the previous prompt and keep everything else identical.
Never ask questions. Reply with JSON only: {"prompt": "<final prompt, max 1500 characters>", "notes": "<one short line on what you noticed>"}`;

export async function writePrompt({ labels, images, instruction = '', change = '', previousPrompt = '', signal }) {
  const legend = labels.map((l, i) => `image ${i + 1} = ${l}`).join('\n');
  let user = `Images attached in this order:\n${legend}`;
  if (instruction.trim()) user += `\n\nUser instructions: ${instruction.trim()}`;
  if (previousPrompt && change.trim()) {
    user += `\n\nPrevious prompt:\n${previousPrompt}\n\nChange request (apply it, keep everything else identical): ${change.trim()}`;
  }

  const content = [
    { type: 'text', text: user },
    ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
  ];

  const res = await fetch('/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content },
      ],
    }),
    signal,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new FashnError({
      status: res.status,
      code: e.code || e.type || `OpenAI${res.status}`,
      message: e.message || res.statusText,
      raw: data,
    });
  }

  let parsed = {};
  try {
    parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? '{}');
  } catch {
    parsed = {};
  }
  if (!parsed.prompt) throw new FashnError({ code: 'PromptError', message: 'The AI agent did not return a prompt' });
  return { prompt: String(parsed.prompt).slice(0, 10000), notes: parsed.notes ?? '' };
}
