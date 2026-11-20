import { cn } from '../../../lib/utils.js';
import './Badge.css';

export function Badge({ variant = 'default', className, children, ...props }) {
  return (
    <span className={cn('ui-badge', variant !== 'default' && `ui-badge-${variant}`, className)} {...props}>
      {children}
    </span>
  );
}
