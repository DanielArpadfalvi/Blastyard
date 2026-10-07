/** A star (filled when earned). Shape + fill, never colour alone. */
export function StarIcon({ on, size = 18 }: { on: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      class={on ? 'star star-on' : 'star'}
      aria-hidden="true"
    >
      <path
        d="M12 2.6 L14.9 8.7 L21.5 9.5 L16.6 14 L17.9 20.6 L12 17.3 L6.1 20.6 L7.4 14 L2.5 9.5 L9.1 8.7 Z"
        fill={on ? '#ffd23f' : 'rgba(244,241,230,0.12)'}
        stroke="#2b2118"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Three stars, the first `earned` of them filled. */
export function Stars({ earned, size = 18 }: { earned: number; size?: number }) {
  return (
    <span class="stars" aria-label={`${earned}/3`} data-stars={earned}>
      {[0, 1, 2].map((i) => (
        <StarIcon key={i} on={i < earned} size={size} />
      ))}
    </span>
  );
}
