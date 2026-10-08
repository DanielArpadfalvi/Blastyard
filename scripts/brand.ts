// Brand art drawn in code (T7.2, CLAUDE.md: no external bitmaps): the app icon and the splash as
// SVG strings. `scripts/assets.ts` renders them to every icon / splash size. Original art only: a
// round Puff peeking over a pulsing pop with its fuse ring – nothing from any reference game.

const OUTLINE = '#2b2118';
const BG_TOP = '#5fbf4a';
const BG_BOTTOM = '#2f7d32';
const POP = '#2ec4b6';
const POP_DARK = '#1b8f85';
const FUSE = '#ffd23f';
const PUFF = '#ff6b5b';
const PUFF_SHADE = '#d9483b';
const SPLASH_BG = '#0b0a14';

/** The emblem (pop + Puff + spark) in a 100×100 box, no background. */
function emblem(): string {
  return `
  <g stroke="${OUTLINE}" stroke-linejoin="round" stroke-linecap="round">
    <!-- the pop -->
    <circle cx="60" cy="42" r="25" fill="${POP}" stroke-width="4"/>
    <path d="M 44 33 A 18 18 0 0 1 58 22" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.85"/>
    <circle cx="60" cy="42" r="31" fill="none" stroke="${FUSE}" stroke-width="5"
      stroke-dasharray="120 80" transform="rotate(-80 60 42)"/>
    <circle cx="60" cy="42" r="25" fill="none" stroke="${POP_DARK}" stroke-width="3" opacity="0.6"
      stroke-dasharray="4 7"/>
    <!-- spark at the end of the fuse ring -->
    <path d="M 84 18 l 3 -9 l 3 9 l 9 3 l -9 3 l -3 9 l -3 -9 l -9 -3 z" fill="#fff6c2"
      stroke-width="2.5"/>
    <!-- the Puff peeking up from below -->
    <path d="M 10 100 C 10 66 28 54 42 54 C 56 54 74 66 74 100 Z" fill="${PUFF}" stroke-width="4"/>
    <path d="M 18 70 C 22 62 30 58 36 58" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.6"/>
    <path d="M 22 54 C 20 44 26 40 30 46 M 54 54 C 56 44 62 42 62 50" fill="${PUFF_SHADE}"
      stroke-width="3.5"/>
    <ellipse cx="34" cy="74" rx="5" ry="6.5" fill="#ffffff" stroke-width="2.5"/>
    <ellipse cx="51" cy="74" rx="5" ry="6.5" fill="#ffffff" stroke-width="2.5"/>
    <circle cx="35.5" cy="75" r="2.6" fill="${OUTLINE}" stroke="none"/>
    <circle cx="52.5" cy="75" r="2.6" fill="${OUTLINE}" stroke="none"/>
    <path d="M 37 87 Q 42.5 92 48 87" fill="none" stroke-width="3"/>
  </g>`;
}

function gradient(id: string): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/>
  </linearGradient></defs>`;
}

export type IconShape = 'square' | 'rounded' | 'circle' | 'foreground';

/**
 * The app icon at `size` px. `square`: full bleed (iOS, the system masks it); `rounded` / `circle`:
 * legacy Android launcher icons; `foreground`: the adaptive-icon layer – transparent, emblem inside
 * the 66 % safe zone.
 */
export function iconSvg(size: number, shape: IconShape): string {
  const s = size;
  const bg =
    shape === 'foreground'
      ? ''
      : shape === 'circle'
        ? `<circle cx="50" cy="50" r="50" fill="url(#bg)"/>`
        : shape === 'rounded'
          ? `<rect width="100" height="100" rx="18" fill="url(#bg)"/>`
          : `<rect width="100" height="100" fill="url(#bg)"/>`;
  // The emblem fills ~78 % of a full icon, ~58 % of the adaptive layer (inside its safe zone).
  const k = shape === 'foreground' ? 0.58 : 0.78;
  const off = (100 - 100 * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100">
  ${gradient('bg')}${bg}
  <g transform="translate(${off} ${off + (shape === 'foreground' ? 0 : 2)}) scale(${k})">${emblem()}</g>
</svg>`;
}

/** The launch screen: dark background, the round icon and the name, centred. */
export function splashSvg(width: number, height: number): string {
  const unit = Math.min(width, height);
  const icon = unit * 0.34;
  const x = (width - icon) / 2;
  const y = height / 2 - icon * 0.62;
  const font = unit * 0.075;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${SPLASH_BG}"/>
  <svg x="${x}" y="${y}" width="${icon}" height="${icon}" viewBox="0 0 100 100">
    ${gradient('sbg')}<circle cx="50" cy="50" r="50" fill="url(#sbg)"/>
    <g transform="translate(11 13) scale(0.78)">${emblem()}</g>
  </svg>
  <text x="${width / 2}" y="${y + icon + font * 1.6}" text-anchor="middle"
    font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-weight="900"
    font-size="${font}" fill="${FUSE}" stroke="${OUTLINE}" stroke-width="${font * 0.08}"
    paint-order="stroke" letter-spacing="${font * 0.04}">Blastyard</text>
</svg>`;
}

/** Background colour of the Android adaptive icon (matches the icon's gradient bottom). */
export const ADAPTIVE_BACKGROUND = BG_BOTTOM;
export const SPLASH_BACKGROUND = SPLASH_BG;

/** Android launcher densities: legacy icon size and adaptive-layer size. */
export const ANDROID_DENSITIES = [
  { dpi: 'mdpi', icon: 48, layer: 108 },
  { dpi: 'hdpi', icon: 72, layer: 162 },
  { dpi: 'xhdpi', icon: 96, layer: 216 },
  { dpi: 'xxhdpi', icon: 144, layer: 324 },
  { dpi: 'xxxhdpi', icon: 192, layer: 432 },
] as const;

/** Android splash drawables (landscape size per density; portrait is the transpose). */
export const ANDROID_SPLASH = [
  { dpi: 'mdpi', w: 480, h: 320 },
  { dpi: 'hdpi', w: 800, h: 480 },
  { dpi: 'xhdpi', w: 1280, h: 720 },
  { dpi: 'xxhdpi', w: 1600, h: 960 },
  { dpi: 'xxxhdpi', w: 1920, h: 1280 },
] as const;

export const IOS_SPLASH = [
  'splash-2732x2732.png',
  'splash-2732x2732-1.png',
  'splash-2732x2732-2.png',
];
