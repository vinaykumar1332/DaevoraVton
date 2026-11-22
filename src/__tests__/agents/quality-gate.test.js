import { passes, retryInstruction, QUALITY_THRESHOLDS } from '@/agents/qualityGate.js';
import { summarize } from '../../../backend/handlers/score.js';

const good = { face: 90, pose: 85, garment: 90, colour: 80, background: 80, accessories: 80 };

describe('quality gate', () => {
  it('uses the agreed thresholds', () => {
    expect(QUALITY_THRESHOLDS).toEqual({ match: 85, face: 85, pose: 80, garment: 85 });
  });

  it('passes when the match and the face, pose and garment scores all reach their thresholds', () => {
    expect(passes(good, 88)).toBe(true);
  });

  it('fails when any one of the four required scores is below its threshold', () => {
    expect(passes({ ...good, face: 84 }, 90)).toBe(false);
    expect(passes({ ...good, pose: 79 }, 90)).toBe(false);
    expect(passes({ ...good, garment: 84 }, 90)).toBe(false);
    expect(passes(good, 84)).toBe(false);
  });

  it('fails when a required area is missing', () => {
    expect(passes({ face: 90, garment: 90 }, 90)).toBe(false);
  });

  it('builds the retry line from the problems, at most five', () => {
    const problems = [1, 2, 3, 4, 5, 6].map((i) => ({ detail: `problem ${i}.` }));
    expect(retryInstruction(problems)).toBe('Fix these problems from the previous attempt: problem 1. problem 2. problem 3. problem 4. problem 5.');
  });

  it('falls back to a general instruction when there are no problems to name', () => {
    expect(retryInstruction([])).toMatch(/^Improve how closely/);
  });

  it('the server summary sets pass from the same rule', () => {
    const passing = summarize(JSON.stringify({ areas: good, problems: [] }));
    expect(passing.pass).toBe(passes(passing.areas, passing.match));
    expect(summarize(JSON.stringify({ areas: { ...good, face: 60 }, problems: [] })).pass).toBe(false);
  });
});
