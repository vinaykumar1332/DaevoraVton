import { cn } from '../../../lib/utils.js';
import './Button.css';

/**
 * Reusable Button component.
 * variant: 'primary' | 'secondary' | 'ghost' | 'danger'
 * size:    'sm' | 'md' | 'lg' | 'icon'
 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  ...props
}) {
  return (
    <button
      className={cn('ui-btn', `ui-btn-${variant}`, `ui-btn-${size}`, className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <span className="ui-btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
