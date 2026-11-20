import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Input, Badge, Card, CardTitle } from '@/components/ui/index.js';

describe('Button', () => {
  it('fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and shows a spinner while loading', () => {
    const { container } = render(<Button loading>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(container.querySelector('.ui-btn-spinner')).toBeInTheDocument();
  });

  it('applies variant and size classes', () => {
    render(<Button variant="danger" size="lg">X</Button>);
    expect(screen.getByRole('button')).toHaveClass('ui-btn-danger', 'ui-btn-lg');
  });
});

describe('Input', () => {
  it('shows the error instead of the hint', () => {
    render(<Input hint="a hint" error="bad value" />);
    expect(screen.getByText('bad value')).toBeInTheDocument();
    expect(screen.queryByText('a hint')).not.toBeInTheDocument();
  });
});

describe('Badge and Card', () => {
  it('render their content', () => {
    render(
      <Card>
        <CardTitle>Title</CardTitle>
        <Badge variant="success">ok</Badge>
      </Card>
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('ok')).toHaveClass('ui-badge-success');
  });
});
