import { useEffect, useRef } from 'preact/hooks';
import type { ArenaDef } from '../core';
import { themeFor } from '../render/themes';

/** Pixels per arena cell in the thumbnail canvas. */
const CELL = 3;
const SIZE = 13 * CELL;

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Floor-effect characters and the tint they get in the thumbnail. */
const FX_TINT: Readonly<Record<string, string>> = {
  '~': '#bfe9ff',
  '^': '#f2b35a',
  '>': '#f2b35a',
  v: '#f2b35a',
  '<': '#f2b35a',
  T: '#b58cf0',
  U: '#b58cf0',
  '=': '#2b2118',
  b: '#ff8fb1',
  g: '#a08a6a',
};

/** Draws a 13×13 arena as tiny coloured cells: walls, pillars, crates, effects, spawns. */
export function drawArenaThumb(ctx: CanvasRenderingContext2D, arena: ArenaDef): void {
  const theme = themeFor(arena.theme);
  ctx.clearRect(0, 0, SIZE, SIZE);
  arena.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x] as string;
      let color = css((x + y) % 2 === 0 ? theme.floorA : theme.floorB);
      if (ch === '#') color = css(theme.hedge);
      else if (ch === 'o') color = css(theme.pillarBody);
      else if (ch === '+') color = css(theme.crateDark);
      else if (ch === '?') color = css(theme.crateWood);
      else if (FX_TINT[ch]) color = FX_TINT[ch] as string;
      else if (ch >= '1' && ch <= '4') color = '#ffffff';
      ctx.fillStyle = color;
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  });
}

/** Small preview of an arena for the picker. */
export function ArenaThumb({ arena }: { arena: ArenaDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawArenaThumb(ctx, arena);
  }, [arena]);
  return (
    <canvas
      ref={ref}
      class="arena-thumb"
      width={SIZE}
      height={SIZE}
      aria-hidden="true"
      data-testid={`arena-thumb-${arena.id}`}
    />
  );
}
