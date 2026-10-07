/** A row of mutually exclusive buttons (settings, party setup). */
export function Segmented<T extends string | number | boolean>(props: {
  testId: string;
  value: T;
  options: readonly T[];
  label: (v: T) => string;
  onChange: (v: T) => void;
  /** Options that are shown but cannot be picked. */
  disabled?: (v: T) => boolean;
}) {
  return (
    <div class="segmented" role="radiogroup" data-testid={props.testId}>
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o === props.value}
          disabled={props.disabled?.(o) ?? false}
          class={o === props.value ? 'segment segment-on' : 'segment'}
          data-testid={`${props.testId}-${String(o)}`}
          onClick={() => props.onChange(o)}
        >
          {props.label(o)}
        </button>
      ))}
    </div>
  );
}
