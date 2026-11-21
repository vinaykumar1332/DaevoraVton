/**
 * One quick-action card, used everywhere a feature is offered as a starting point.
 * `disabled` shows the feature as not available yet (no click, labelled "Coming soon").
 */
export default function QuickActionCard({ icon: Icon, title, hint, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={`qa-card${disabled ? ' is-disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      <span className="qa-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="qa-text">
        <b>{title}</b>
        <small>{disabled ? 'Coming soon' : hint}</small>
      </span>
    </button>
  );
}
