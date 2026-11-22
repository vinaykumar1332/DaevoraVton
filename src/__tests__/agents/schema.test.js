import { TURN_SCHEMA, TURN_RESPONSE_FORMAT, parseTurnReply } from '@/agents/schema.js';
import { normalizeNotes } from '@/agents/studioPrompt.js';

const valid = {
  reply: 'Creating the look now.',
  action: 'generate',
  prompt: 'A woman in a navy dress.',
  use_photos: [1, 2],
  use_previous: false,
  resolution: '1k',
  target_photo: null,
  photo_notes: [{ photo: 1, role: 'model', view: 'front', worn: null, logo: null, pattern: null, colors: null, fabric: null, details: null, logo_text: null, unclear: null, length: null, framing: 'full' }],
  output_view: 'front',
  styling: { tuck: null, sleeves: null, fit: null, pose: null, model: null, add: [], remove: [] },
};

describe('chat reply schema', () => {
  it('accepts a complete reply', () => {
    const r = parseTurnReply(JSON.stringify(valid));
    expect(r.ok).toBe(true);
    expect(r.value.action).toBe('generate');
  });

  it('rejects a reply with a missing field and names it', () => {
    const { reply, ...rest } = valid;
    expect(parseTurnReply(JSON.stringify(rest))).toEqual({ ok: false, reason: 'reply missing' });
  });

  it('rejects invalid JSON', () => {
    expect(parseTurnReply('{"reply": ')).toEqual({ ok: false, reason: 'not JSON' });
  });

  it('rejects an unknown action and an unknown output view', () => {
    expect(parseTurnReply(JSON.stringify({ ...valid, action: 'delete_everything' })).reason).toBe('action invalid');
    expect(parseTurnReply(JSON.stringify({ ...valid, output_view: 'top' })).reason).toBe('output_view invalid');
  });

  it('rejects non-integer photo numbers', () => {
    expect(parseTurnReply(JSON.stringify({ ...valid, use_photos: ['1'] })).reason).toBe('use_photos invalid');
  });

  it('is in strict mode: every property of every object is listed as required', () => {
    const check = (node, path) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') {
        expect(node.additionalProperties, `${path} must forbid extra keys`).toBe(false);
        for (const key of Object.keys(node.properties)) {
          expect(node.required, `${path}.${key} must be required`).toContain(key);
        }
      }
      if (node.properties) Object.entries(node.properties).forEach(([k, v]) => check(v, `${path}.${k}`));
      if (node.items) check(node.items, `${path}[]`);
    };
    check(TURN_SCHEMA, 'turn');
    expect(TURN_RESPONSE_FORMAT.json_schema.strict).toBe(true);
  });

  it('the null values that strict mode returns are handled by the existing normaliser', () => {
    const notes = normalizeNotes(valid.photo_notes, 2);
    expect(notes).toHaveLength(1);
    expect(notes[0]).not.toHaveProperty('worn');
    expect(notes[0]).not.toHaveProperty('logo');
  });
});
