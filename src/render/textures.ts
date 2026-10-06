/**
 * Code-generated textures (PLAN §1.13): every arena piece is drawn once with Pixi `Graphics`,
 * baked with `renderer.generateTexture` and from then on only shown through pooled sprites –
 * no per-frame `Graphics` redraws. Textures are drawn on a {@link TEX}-pixel cell and baked at
 * the renderer resolution; sprites scale them to the laid-out tile size.
 */

import { Container, Graphics, Rectangle, Text, type Renderer, type Texture } from 'pixi.js';
import { PICKUP_KIND_COUNT } from '../core';
import * as P from './palette';
import { EYE_BLINK, EYE_SCARED, EYE_VARIANTS } from './scene';

/** Logical size of one cell in texture space. */
export const TEX = 96;
/** Puff textures are larger than a cell (ears, antennae stick out). */
export const PUFF_TEX = 128;
/** Fuse ring frames (0 = burnt down … FUSE_FRAMES = full). */
export const FUSE_FRAMES = 24;
export const EYE_TEX_W = 64;
export const EYE_TEX_H = 40;
export const BADGE_TEX = 44;

export interface ArenaTextures {
  readonly floor: readonly [Texture, Texture];
  readonly pillar: Texture;
  readonly crate: Texture;
  /** Sudden-death block (interior WALL tile). */
  readonly block: Texture;
  readonly shadow: Texture;
  /** Per seat. */
  readonly puff: readonly Texture[];
  readonly badge: readonly Texture[];
  /** See `EYE_*`. */
  readonly eyes: readonly Texture[];
  readonly pop: Texture;
  readonly ghostPop: Texture;
  /** `FUSE_FRAMES + 1` frames, index = remaining fraction × FUSE_FRAMES. */
  readonly fuseRing: readonly Texture[];
  readonly flameCore: Texture;
  /** Arm from the cell centre to its right edge; rotate for other directions. */
  readonly flameArm: Texture;
  /** Index = `Pickup` kind (0 unused). */
  readonly pickups: readonly Texture[];
  destroy(): void;
}

const C = TEX / 2;

function bake(renderer: Renderer, target: Container, w: number, h: number): Texture {
  const texture = renderer.generateTexture({
    target,
    frame: new Rectangle(0, 0, w, h),
    resolution: renderer.resolution,
    antialias: true,
  });
  target.destroy({ children: true });
  return texture;
}

function outline(width = 4): { width: number; color: number; join: 'round' } {
  return { width, color: P.OUTLINE, join: 'round' };
}

// ---------------------------------------------------------------------------------------------
// Tiles

function drawFloor(base: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, TEX, TEX).fill(base);
  // A few fixed grass tufts (deterministic pattern, no randomness).
  const tufts: ReadonlyArray<readonly [number, number]> = [
    [18, 22],
    [62, 14],
    [40, 52],
    [76, 66],
    [16, 74],
  ];
  for (const [x, y] of tufts) {
    g.moveTo(x - 4, y + 5)
      .lineTo(x - 2, y - 2)
      .moveTo(x, y + 5)
      .lineTo(x + 1, y - 4)
      .moveTo(x + 4, y + 5)
      .lineTo(x + 5, y - 1)
      .stroke({ width: 2, color: P.LAWN_BLADE, cap: 'round' });
  }
  return g;
}

function drawPillar(): Graphics {
  const g = new Graphics();
  g.roundRect(8, 12, 84, 82, 14).fill({ color: P.SHADOW, alpha: 0.25 });
  g.roundRect(5, 5, 86, 86, 14).fill(P.STONE_DARK).stroke(outline());
  g.roundRect(11, 9, 74, 66, 11).fill(P.STONE_TOP);
  g.moveTo(26, 24).lineTo(36, 34).lineTo(34, 46).stroke({ width: 3, color: P.STONE, cap: 'round' });
  g.moveTo(62, 52).lineTo(70, 44).stroke({ width: 3, color: P.STONE, cap: 'round' });
  g.roundRect(18, 14, 26, 8, 4).fill({ color: 0xffffff, alpha: 0.35 });
  return g;
}

function drawCrate(): Graphics {
  const g = new Graphics();
  g.roundRect(10, 14, 82, 80, 8).fill({ color: P.SHADOW, alpha: 0.25 });
  g.roundRect(7, 7, 82, 82, 8).fill(P.WOOD).stroke(outline());
  // Planks.
  for (const y of [30, 48, 66]) {
    g.moveTo(12, y).lineTo(84, y).stroke({ width: 2, color: P.WOOD_DARK, alpha: 0.6 });
  }
  // Frame and cross brace.
  g.roundRect(15, 15, 66, 66, 4).stroke({ width: 5, color: P.WOOD_DARK });
  g.moveTo(19, 19).lineTo(77, 77).stroke({ width: 7, color: P.WOOD_DARK, cap: 'round' });
  g.moveTo(19, 19).lineTo(77, 77).stroke({ width: 3, color: P.WOOD_LIGHT, cap: 'round' });
  for (const [x, y] of [
    [15, 15],
    [81, 15],
    [15, 81],
    [81, 81],
  ] as const) {
    g.circle(x, y, 3).fill(P.OUTLINE);
  }
  return g;
}

function drawBlock(): Graphics {
  const g = new Graphics();
  g.rect(0, 0, TEX, TEX).fill(P.BRICK_DARK);
  const rows = 4;
  const h = TEX / rows;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : TEX / 4;
    for (let x = -TEX / 4 + offset; x < TEX; x += TEX / 2) {
      g.roundRect(x + 2, r * h + 2, TEX / 2 - 4, h - 4, 3).fill(P.BRICK);
    }
  }
  g.rect(1.5, 1.5, TEX - 3, TEX - 3).stroke(outline(3));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Puffs

function drawShadow(): Graphics {
  const g = new Graphics();
  g.ellipse(C, C + 26, 32, 12).fill({ color: P.SHADOW, alpha: 0.28 });
  return g;
}

function drawPuff(seat: number): Graphics {
  const g = new Graphics();
  const c = PUFF_TEX / 2;
  const color = P.SEAT_COLORS[seat] as number;
  const shade = P.SEAT_SHADES[seat] as number;
  const r = 36;
  // Silhouette feature behind the body: ears, antenna, spikes, beak (one per seat).
  switch (seat) {
    case 0:
      for (const sx of [-1, 1]) {
        g.circle(c + sx * 25, c - 27, 13)
          .fill(color)
          .stroke(outline());
        g.circle(c + sx * 25, c - 27, 6).fill(shade);
      }
      break;
    case 1:
      g.moveTo(c + 4, c - r + 4)
        .quadraticCurveTo(c + 8, c - r - 10, c + 16, c - r - 18)
        .stroke({ width: 4, color: P.OUTLINE, cap: 'round' });
      g.circle(c + 16, c - r - 18, 8)
        .fill(shade)
        .stroke(outline(3.5));
      break;
    case 2:
      for (const [dx, h] of [
        [-20, 14],
        [0, 18],
        [20, 14],
      ] as const) {
        g.poly([c + dx - 10, c - r + 10, c + dx, c - r - h + 4, c + dx + 10, c - r + 10])
          .fill(shade)
          .stroke(outline(3.5));
      }
      break;
    default:
      // Little tail tuft at the back.
      g.ellipse(c, c + r - 2, 12, 9)
        .fill(shade)
        .stroke(outline(3.5));
      break;
  }
  g.circle(c, c, r).fill(color).stroke(outline(5));
  g.ellipse(c - 11, c - 15, 15, 10).fill({ color: 0xffffff, alpha: 0.32 });
  // Cheeks.
  g.ellipse(c - 21, c + 12, 7, 4).fill({ color: 0xff8fa3, alpha: 0.6 });
  g.ellipse(c + 21, c + 12, 7, 4).fill({ color: 0xff8fa3, alpha: 0.6 });
  if (seat === 3) {
    // Beak.
    g.poly([c - 9, c + 10, c + 9, c + 10, c, c + 22])
      .fill(0xff9f1c)
      .stroke(outline(3));
  } else {
    g.moveTo(c - 6, c + 14)
      .quadraticCurveTo(c, c + 19, c + 6, c + 14)
      .stroke({ width: 3, color: P.OUTLINE, cap: 'round' });
  }
  return g;
}

/** Eye pair; `dir` 0 = looking at the viewer, 1–4 = up/right/down/left, or blink / scared. */
function drawEyes(variant: number): Graphics {
  const g = new Graphics();
  const cy = EYE_TEX_H / 2;
  const cx = EYE_TEX_W / 2;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * 12;
    if (variant === EYE_BLINK) {
      g.moveTo(ex - 7, cy + 1)
        .quadraticCurveTo(ex, cy + 6, ex + 7, cy + 1)
        .stroke({ width: 3.5, color: P.OUTLINE, cap: 'round' });
      continue;
    }
    const scared = variant === EYE_SCARED;
    const rx = scared ? 9.5 : 8;
    const ry = scared ? 12 : 10;
    g.ellipse(ex, cy, rx, ry).fill(P.EYE_WHITE).stroke(outline(3));
    let px = 0;
    let py = 1.5;
    if (variant === 1) py = -4;
    else if (variant === 2) px = 3.5;
    else if (variant === 3) py = 4;
    else if (variant === 4) px = -3.5;
    g.circle(ex + px, cy + py, scared ? 2.6 : 4.4).fill(P.PUPIL);
    if (!scared) g.circle(ex + px + 1.6, cy + py - 1.8, 1.4).fill(0xffffff);
  }
  return g;
}

function starPoints(cx: number, cy: number, outer: number, inner: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

/** Seat badge: shape (circle, triangle, square, star) + seat number. */
function drawBadge(seat: number): Container {
  const root = new Container();
  const g = new Graphics();
  const c = BADGE_TEX / 2;
  const fill = { color: 0xffffff };
  switch (seat) {
    case 0:
      g.circle(c, c, 15).fill(fill).stroke(outline(3));
      break;
    case 1:
      g.poly([c, c - 18, c + 18, c + 14, c - 18, c + 14])
        .fill(fill)
        .stroke(outline(3));
      break;
    case 2:
      g.roundRect(c - 14, c - 14, 28, 28, 4)
        .fill(fill)
        .stroke(outline(3));
      break;
    default:
      g.poly(starPoints(c, c + 1, 20, 10))
        .fill(fill)
        .stroke(outline(3));
      break;
  }
  root.addChild(g);
  const label = new Text({
    text: String(seat + 1),
    style: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: 17,
      fontWeight: '900',
      fill: P.OUTLINE,
    },
  });
  label.anchor.set(0.5);
  label.position.set(c, seat === 1 ? c + 4 : c + 1);
  root.addChild(label);
  return root;
}

// ---------------------------------------------------------------------------------------------
// Pops (bombs)

function drawPop(body: number, dark: number): Graphics {
  const g = new Graphics();
  g.ellipse(C, C + 28, 30, 10).fill({ color: P.SHADOW, alpha: 0.28 });
  g.circle(C, C + 2, 31)
    .fill(body)
    .stroke(outline(4.5));
  // Pod segments.
  g.moveTo(C - 14, C - 24)
    .quadraticCurveTo(C - 25, C + 2, C - 14, C + 28)
    .stroke({ width: 3, color: dark, cap: 'round' });
  g.moveTo(C + 14, C - 24)
    .quadraticCurveTo(C + 25, C + 2, C + 14, C + 28)
    .stroke({ width: 3, color: dark, cap: 'round' });
  g.ellipse(C - 9, C - 10, 8, 6).fill({ color: 0xffffff, alpha: 0.45 });
  // Leafy cap.
  g.ellipse(C - 7, C - 29, 9, 5)
    .fill(0x6cc551)
    .stroke(outline(3));
  g.ellipse(C + 7, C - 29, 9, 5)
    .fill(0x6cc551)
    .stroke(outline(3));
  return g;
}

function drawFuseRing(frame: number): Graphics {
  const g = new Graphics();
  const r = 42;
  g.circle(C, C + 2, r).stroke({ width: 6, color: P.FUSE_TRACK, alpha: 0.45 });
  if (frame > 0) {
    const start = -Math.PI / 2;
    const end = start + (frame / FUSE_FRAMES) * Math.PI * 2;
    g.moveTo(C + Math.cos(start) * r, C + 2 + Math.sin(start) * r)
      .arc(C, C + 2, r, start, end)
      .stroke({ width: 6, color: P.FUSE, cap: 'round' });
    // Spark at the burning end.
    const sx = C + Math.cos(end) * r;
    const sy = C + 2 + Math.sin(end) * r;
    g.circle(sx, sy, 6).fill(0xfff6c2).stroke({ width: 2, color: P.FLAME_OUTER });
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Flames (striped so they read without colour, PLAN §1.12)

function drawFlameCore(): Graphics {
  const g = new Graphics();
  g.circle(C, C, 40).fill(P.FLAME_OUTER);
  g.circle(C, C, 29).fill(P.FLAME_MID);
  g.circle(C, C, 16).fill(P.FLAME_CORE);
  return g;
}

function drawFlameArm(): Graphics {
  const g = new Graphics();
  g.rect(C - 1, C - 34, C + 1, 68).fill(P.FLAME_OUTER);
  g.rect(C - 1, C - 23, C + 1, 46).fill(P.FLAME_MID);
  g.rect(C - 1, C - 10, C + 1, 20).fill(P.FLAME_CORE);
  for (let x = C + 6; x < TEX; x += 14) {
    g.moveTo(x, C - 28)
      .lineTo(x + 8, C - 21)
      .moveTo(x, C + 21)
      .lineTo(x + 8, C + 28)
      .stroke({ width: 3, color: P.FLAME_CORE, alpha: 0.55, cap: 'round' });
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Pickups (index = Pickup kind)

function flameDrop(g: Graphics, cx: number, cy: number, s: number, outer: number): void {
  g.moveTo(cx, cy - 20 * s)
    .bezierCurveTo(cx + 6 * s, cy - 8 * s, cx + 16 * s, cy - 2 * s, cx + 14 * s, cy + 8 * s)
    .bezierCurveTo(cx + 12 * s, cy + 18 * s, cx - 12 * s, cy + 18 * s, cx - 14 * s, cy + 8 * s)
    .bezierCurveTo(cx - 16 * s, cy - 2 * s, cx - 6 * s, cy - 8 * s, cx, cy - 20 * s)
    .closePath()
    .fill(outer)
    .stroke(outline(3));
  g.ellipse(cx, cy + 7 * s, 6 * s, 7 * s).fill(P.FLAME_CORE);
}

function drawPickup(kind: number): Graphics {
  const g = new Graphics();
  const jinx = kind === 9;
  g.roundRect(15, 19, 68, 68, 16).fill({ color: P.SHADOW, alpha: 0.22 });
  g.roundRect(13, 13, 70, 70, 16)
    .fill(jinx ? P.JINX_BG : P.PICKUP_BG)
    .stroke(outline(4));
  const ink = { width: 4, color: P.OUTLINE, cap: 'round' as const, join: 'round' as const };
  switch (kind) {
    case 1: // Extra pop
      g.circle(C - 4, C + 4, 15)
        .fill(P.POP)
        .stroke(outline(3));
      g.ellipse(C - 9, C - 1, 4, 3).fill({ color: 0xffffff, alpha: 0.5 });
      g.moveTo(C + 18, C - 22)
        .lineTo(C + 18, C - 6)
        .moveTo(C + 10, C - 14)
        .lineTo(C + 26, C - 14)
        .stroke({ ...ink, width: 5, color: 0x2a9d3a });
      break;
    case 2: // Flame range
      flameDrop(g, C, C + 2, 1.1, P.FLAME_OUTER);
      break;
    case 3: // Roller (speed)
      g.circle(C + 4, C + 2, 15)
        .fill(0x4a4a5a)
        .stroke(outline(3));
      g.circle(C + 4, C + 2, 6).fill(0xd8d8e0);
      for (const y of [-10, 0, 10]) {
        g.moveTo(C - 26, C + 2 + y)
          .lineTo(C - 15, C + 2 + y)
          .stroke({ ...ink, width: 3.5 });
      }
      break;
    case 4: // Kick: boot
      g.poly([
        C - 16,
        C - 20,
        C - 2,
        C - 20,
        C - 2,
        C + 2,
        C + 18,
        C + 6,
        C + 20,
        C + 18,
        C - 16,
        C + 18,
      ])
        .fill(0xc0572f)
        .stroke(outline(3));
      g.moveTo(C - 16, C + 12)
        .lineTo(C + 20, C + 12)
        .stroke({ ...ink, width: 3 });
      break;
    case 5: // Toss: arc arrow over a pop
      g.circle(C - 14, C + 14, 9)
        .fill(P.POP)
        .stroke(outline(3));
      g.moveTo(C - 14, C + 2)
        .quadraticCurveTo(C, C - 30, C + 18, C + 4)
        .stroke(ink);
      g.poly([C + 10, C + 2, C + 24, C, C + 19, C + 14]).fill(P.OUTLINE);
      break;
    case 6: // Pierce: arrow through a crate
      g.roundRect(C - 6, C - 14, 24, 28, 3)
        .fill(P.WOOD)
        .stroke(outline(3));
      g.moveTo(C - 26, C)
        .lineTo(C + 22, C)
        .stroke({ ...ink, width: 5, color: P.FLAME_OUTER });
      g.poly([C + 16, C - 9, C + 30, C, C + 16, C + 9])
        .fill(P.FLAME_OUTER)
        .stroke(outline(2.5));
      break;
    case 7: // Shield
      g.moveTo(C, C - 22)
        .lineTo(C + 19, C - 14)
        .quadraticCurveTo(C + 18, C + 12, C, C + 24)
        .quadraticCurveTo(C - 18, C + 12, C - 19, C - 14)
        .closePath()
        .fill(0x4fa3ff)
        .stroke(outline(3));
      g.moveTo(C, C - 14)
        .lineTo(C, C + 14)
        .stroke({ width: 4, color: 0xffffff, alpha: 0.7, cap: 'round' });
      break;
    case 8: // Max flame
      flameDrop(g, C - 3, C + 4, 1.05, 0xe63946);
      g.poly(starPoints(C + 19, C - 18, 11, 5))
        .fill(P.FUSE)
        .stroke(outline(2.5));
      break;
    default: // Jinx: swirl
      g.moveTo(C, C);
      for (let i = 1; i <= 40; i++) {
        const a = i * 0.42;
        const r = i * 0.62;
        g.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
      }
      g.stroke({ width: 4, color: 0xf2e6ff, cap: 'round', join: 'round' });
      break;
  }
  return g;
}

/** Bakes every arena texture once. Call `destroy()` when the renderer goes away. */
export function bakeArenaTextures(renderer: Renderer): ArenaTextures {
  const all: Texture[] = [];
  const keep = (t: Texture): Texture => {
    all.push(t);
    return t;
  };
  const cell = (g: Container): Texture => keep(bake(renderer, g, TEX, TEX));

  const pickups: Texture[] = [];
  for (let k = 0; k <= PICKUP_KIND_COUNT; k++) {
    pickups.push(k === 0 ? cell(new Graphics()) : cell(drawPickup(k)));
  }
  const fuseRing: Texture[] = [];
  for (let f = 0; f <= FUSE_FRAMES; f++) fuseRing.push(cell(drawFuseRing(f)));
  const eyes: Texture[] = [];
  for (let v = 0; v < EYE_VARIANTS; v++) {
    eyes.push(keep(bake(renderer, drawEyes(v), EYE_TEX_W, EYE_TEX_H)));
  }
  const puff: Texture[] = [];
  const badge: Texture[] = [];
  for (let s = 0; s < P.SEAT_COLORS.length; s++) {
    puff.push(keep(bake(renderer, drawPuff(s), PUFF_TEX, PUFF_TEX)));
    badge.push(keep(bake(renderer, drawBadge(s), BADGE_TEX, BADGE_TEX)));
  }

  return {
    floor: [cell(drawFloor(P.LAWN_A)), cell(drawFloor(P.LAWN_B))],
    pillar: cell(drawPillar()),
    crate: cell(drawCrate()),
    block: cell(drawBlock()),
    shadow: cell(drawShadow()),
    puff,
    badge,
    eyes,
    pop: cell(drawPop(P.POP, P.POP_DARK)),
    ghostPop: cell(drawPop(P.POP_GHOST, 0x7d68b8)),
    fuseRing,
    flameCore: cell(drawFlameCore()),
    flameArm: cell(drawFlameArm()),
    pickups,
    destroy(): void {
      for (const t of all) t.destroy(true);
      all.length = 0;
    },
  };
}
