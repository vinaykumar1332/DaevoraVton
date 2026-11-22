import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeTurnLog, logTurn } from '../../../backend/logTurn.js';

describe('turn log', () => {
  it('drops keys and tokens and hashes image data', () => {
    const out = sanitizeTurnLog({ user: 'admin', apiKey: 'sk-secret', nested: { sessionToken: 'x', ok: 1 }, photo: 'data:image/png;base64,AAAA' });
    expect(out).toEqual({ user: 'admin', nested: { ok: 1 }, photo: expect.stringMatching(/^sha256:[0-9a-f]{16}$/) });
    expect(JSON.stringify(out)).not.toMatch(/sk-secret|AAAA|sessionToken/);
  });

  it('writes one JSON line per turn to the configured file', () => {
    const file = path.join(os.tmpdir(), `turn-log-${Date.now()}.jsonl`);
    try {
      logTurn({ action: 'generate' }, { file });
      logTurn({ action: 'reply' }, { file });
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({ action: 'generate' });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('writes nothing when no file is configured', () => {
    expect(() => logTurn({ action: 'reply' }, { file: undefined })).not.toThrow();
  });
});
