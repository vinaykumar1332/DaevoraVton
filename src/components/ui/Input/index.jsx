import { cn } from '../../../lib/utils.js';
import './Input.css';

/**
 * Reusable Input with optional label, icons, hint and error.
 */
export function Input({
  label,
  required,
  iconLeft,
  iconRight,
  hint,
  error,
  className,
  ...props
}) {
  return (
    <div className="ui-input-wrap">
      {label && (
        <label className="ui-input-label">
          {label}
          {required && <span className="required">*</span>}
        </label>
      )}
      <div className="ui-input-inner">
        {iconLeft && <i className={cn('ui-input-icon-left', iconLeft)} aria-hidden="true" />}
        <input
          className={cn(
            'ui-input',
            iconLeft && 'has-left',
            iconRight && 'has-right',
            error && 'error',
            className
          )}
          {...props}
        />
        {iconRight && <i className={cn('ui-input-icon-right', iconRight)} aria-hidden="true" />}
      </div>
      {hint && !error && <span className="ui-input-hint">{hint}</span>}
      {error && <span className="ui-input-error-msg">{error}</span>}
    </div>
  );
}
