// JSON schema for the chat turn reply (OpenAI structured outputs, strict mode).
// Strict mode requires every property to be listed as required, so optional values are nullable.
// parseTurnReply() validates the reply again on our side, because the model can still return bad values.

const ACTIONS = ['reply', 'generate', 'upscale', 'remove_background'];
const VIEWS = ['front', 'back', 'side', 'three-quarter'];

const nullable = (type) => ({ type: [type, 'null'] });
const str = nullable('string');

const photoNote = {
  type: 'object',
  additionalProperties: false,
  required: ['photo', 'role', 'view', 'worn', 'logo', 'design_only', 'pattern', 'colors', 'fabric', 'details', 'logo_text', 'unclear', 'length', 'framing'],
  properties: {
    photo: { type: 'integer' },
    role: { type: 'string' },
    view: { type: 'string' },
    worn: nullable('boolean'),
    logo: nullable('boolean'),
    design_only: nullable('boolean'),
    pattern: str,
    colors: str,
    fabric: str,
    details: str,
    logo_text: str,
    unclear: str,
    length: str,
    framing: str,
  },
};

const styling = {
  type: 'object',
  additionalProperties: false,
  required: ['tuck', 'sleeves', 'fit', 'pose', 'model', 'add', 'remove'],
  properties: {
    tuck: str,
    sleeves: str,
    fit: str,
    pose: str,
    model: str,
    add: { type: 'array', items: { type: 'string' } },
    remove: { type: 'array', items: { type: 'string' } },
  },
};

export const TURN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'action', 'prompt', 'use_photos', 'use_previous', 'resolution', 'target_photo', 'photo_notes', 'output_view', 'styling'],
  properties: {
    reply: { type: 'string' },
    action: { type: 'string', enum: ACTIONS },
    prompt: { type: 'string' },
    use_photos: { type: 'array', items: { type: 'integer' } },
    use_previous: { type: 'boolean' },
    resolution: str,
    target_photo: { type: ['integer', 'null'] },
    photo_notes: { type: 'array', items: photoNote },
    output_view: { type: 'string', enum: VIEWS },
    styling,
  },
};

/** The response_format block sent with the chat request. */
export const TURN_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: { name: 'studio_turn', strict: true, schema: TURN_SCHEMA },
};

const isInt = (v) => Number.isInteger(v);

/**
 * Checks a parsed reply against the shape above.
 * Returns { ok: true, value } or { ok: false, reason }. Nothing is changed or filled in here.
 */
export function parseTurnReply(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'not an object' };
  if (typeof value.reply !== 'string') return { ok: false, reason: 'reply missing' };
  if (!ACTIONS.includes(value.action)) return { ok: false, reason: 'action invalid' };
  if (typeof value.prompt !== 'string') return { ok: false, reason: 'prompt missing' };
  if (!Array.isArray(value.use_photos) || !value.use_photos.every(isInt)) return { ok: false, reason: 'use_photos invalid' };
  if (typeof value.use_previous !== 'boolean') return { ok: false, reason: 'use_previous invalid' };
  if (value.target_photo !== null && !isInt(value.target_photo)) return { ok: false, reason: 'target_photo invalid' };
  if (!Array.isArray(value.photo_notes)) return { ok: false, reason: 'photo_notes invalid' };
  if (!VIEWS.includes(value.output_view)) return { ok: false, reason: 'output_view invalid' };
  if (!value.styling || typeof value.styling !== 'object') return { ok: false, reason: 'styling invalid' };
  return { ok: true, value };
}
