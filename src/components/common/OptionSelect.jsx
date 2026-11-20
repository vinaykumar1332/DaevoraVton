import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';

// Radix Select does not allow an empty-string item value, but several option lists use '' for "Auto".
const EMPTY = '__empty__';
const toKey = (v) => (v === '' || v == null ? EMPTY : String(v));

/**
 * shadcn Select for a list of { label, value } options.
 *   value / onChange use the option's real value ('' is allowed).
 *   groups: [{ label, items: [{ label, value }] }] renders grouped options instead of `options`.
 */
export default function OptionSelect({ value, options = [], groups, onChange, disabled, placeholder = 'Select…', id, 'aria-label': ariaLabel, className }) {
  const all = groups ? groups.flatMap((g) => g.items) : options;
  const pick = (key) => all.find((o) => toKey(o.value) === key)?.value;

  const item = (o) => (
    <SelectItem key={toKey(o.value)} value={toKey(o.value)}>
      {o.label}
    </SelectItem>
  );

  return (
    <Select value={value == null ? '' : toKey(value)} onValueChange={(k) => onChange?.(pick(k))} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className ?? 'w-full'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groups
          ? groups.map((g) => (
              <SelectGroup key={g.label}>
                <SelectLabel>{g.label}</SelectLabel>
                {g.items.map(item)}
              </SelectGroup>
            ))
          : options.map(item)}
      </SelectContent>
    </Select>
  );
}
