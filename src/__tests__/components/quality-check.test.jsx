import { render, screen, fireEvent } from '@testing-library/react';
import ResultBubble from '@/features/gallery/ResultCard.jsx';
import { qaTone, QA_TARGET } from '@/lib/qa.js';
import { summarize } from '../../../backend/handlers/score.js';

const IMG = 'data:image/png;base64,iVBORw0KGgo=';

describe('quality colours', () => {
  it('green at the 90% target, amber 75-89, red below 75', () => {
    expect(QA_TARGET).toBe(90);
    expect(qaTone(90)).toBe('ok');
    expect(qaTone(89)).toBe('warn');
    expect(qaTone(75)).toBe('warn');
    expect(qaTone(74)).toBe('bad');
  });
});

describe('quality check on the server', () => {
  it('averages the area scores into one 0-100 match', () => {
    const r = summarize(JSON.stringify({ areas: { pose: 100, garment: 80, face: 90, colour: 70, background: 100, accessories: 60 }, problems: [] }));
    expect(r.match).toBe(83);
    expect(r.areas.pose).toBe(100);
  });

  it('clamps out-of-range scores and keeps only known areas and sources', () => {
    const r = summarize(
      JSON.stringify({
        areas: { pose: 140, garment: -5, nonsense: 50 },
        problems: [
          { area: 'pose', source: 'output', detail: 'Arms are folded.' },
          { area: 'nope', source: 'output', detail: 'ignored' },
          { area: 'face', source: 'weird', detail: 'Face changed.' },
        ],
      })
    );
    expect(r.match).toBe(50);
    expect(r.areas).toEqual({ pose: 100, garment: 0 });
    expect(r.problems).toEqual([
      { area: 'pose', source: 'output', detail: 'Arms are folded.' },
      { area: 'face', source: 'output', detail: 'Face changed.' },
    ]);
  });

  it('returns null when no area was scored', () => {
    expect(summarize('{"problems": []}')).toBeNull();
  });
});

describe('result card quality check', () => {
  const score = {
    match: 84,
    areas: { pose: 60, garment: 95, face: 98, colour: 90, background: 95, accessories: 90 },
    problems: [{ area: 'pose', source: 'output', detail: 'The arms are folded in front of the body.' }],
  };
  const m = { id: 'r1', role: 'result', kind: 'look', text: 'Here is your look.', images: [IMG], engine: 'brief', prompt: 'p', score };

  it('shows a circle with the score and a warning below the target', () => {
    render(<ResultBubble m={m} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: /quality score 84 out of 100/i })).toHaveTextContent('84/100');
    expect(screen.getByText(/below the 90% target/i)).toBeInTheDocument();
  });

  it('opens the overlay with what is missing and where it came from', () => {
    render(<ResultBubble m={m} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /quality score 84 out of 100/i }));
    expect(screen.getByRole('dialog', { name: /quality check/i })).toBeInTheDocument();
    expect(screen.getByText(/arms are folded/i)).toBeInTheDocument();
    expect(screen.getByText('From the result')).toBeInTheDocument();
  });

  it('shows a pending state while the check runs, and no warning', () => {
    render(<ResultBubble m={{ ...m, score: { pending: true } }} onOpen={() => {}} />);
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.queryByText(/below the 90% target/i)).toBeNull();
  });

  it('shows no circle when the check failed', () => {
    render(<ResultBubble m={{ ...m, score: null }} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: /quality check/i })).toBeNull();
    expect(screen.queryByText('Checking')).toBeNull();
  });
});
