import { render, screen, fireEvent } from '@testing-library/react';
import ResultBubble from '@/features/gallery/ResultCard.jsx';

const RESULT = 'data:image/png;base64,iVBORw0KGgo=';
const INPUT_A = 'data:image/png;base64,AAAA';
const INPUT_B = 'data:image/png;base64,BBBB';

describe('result image opens a before and after view', () => {
  const m = { id: 'r2', role: 'result', kind: 'look', text: 'Here is your look.', images: [RESULT], used: [INPUT_A, INPUT_B], engine: 'brief', prompt: 'p' };

  it('opens the comparison on click, with a picker for the input photo', () => {
    const onOpen = vi.fn();
    render(<ResultBubble m={m} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /compare before and after/i }));
    expect(screen.getByRole('dialog', { name: /before and after/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /input 1/i })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /input 2/i }));
    expect(screen.getByRole('radio', { name: /input 2/i })).toHaveAttribute('aria-checked', 'true');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the full image from the comparison', () => {
    const onOpen = vi.fn();
    render(<ResultBubble m={m} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /compare before and after/i }));
    fireEvent.click(screen.getByRole('button', { name: /full image/i }));
    expect(onOpen).toHaveBeenCalledWith([RESULT], 0);
  });

  it('a result without inputs still opens the full image directly', () => {
    const onOpen = vi.fn();
    render(<ResultBubble m={{ ...m, used: [] }} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /open image full screen/i }));
    expect(onOpen).toHaveBeenCalledWith([RESULT], 0);
  });
});
