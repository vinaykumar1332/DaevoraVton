// OpenAI image editing (gpt-image-1) through the Vite /openai proxy.
// The proxy injects OPENAI_API_KEY, so the key never reaches the browser.
import { FashnError } from '@/api/fashn.js';
import { OPENAI_IMAGE_EDIT } from '@/api/endpoints.js';

export async function editWithOpenAI({ images, prompt, size = 'auto', quality = 'medium', n = 1, signal }) {
  if (!images.length) throw new FashnError({ status: 400, code: 'BadRequest', message: 'Add at least one image' });

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  form.append('n', String(n));

  for (let i = 0; i < images.length; i++) {
    // fetch() turns data: URIs into Blobs. Remote URLs need CORS on the host.
    const blob = await (await fetch(images[i], { signal })).blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    form.append('image[]', blob, `image${i + 1}.${ext}`);
  }

  const res = await fetch(OPENAI_IMAGE_EDIT, { method: 'POST', body: form, signal });
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
  return (data?.data ?? []).map((d) => (d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url)).filter(Boolean);
}
