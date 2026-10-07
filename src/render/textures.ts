/**
 * Code-generated textures (PLAN §1.13): every arena piece is drawn once with Pixi `Graphics`,
 * baked with `renderer.generateTexture` and from then on only shown through pooled sprites –
 * no per-frame `Graphics` redraws. Textures are drawn on a {@link TEX}-pixel cell and baked at
 * the renderer resolution; sprites scale them to the laid-out tile size.
 */

import { Graphics, Rectangle, type Container, type Renderer, type Texture } from 'pixi.js';
import { PICKUP_KIND_COUNT } from '../core';
import {
  HATS,
  POP_SKINS,
  PUFFS,
  START,
  type HatDef,
  type PopSkinDef,
  type PuffDef,
} from '../content/cosmetics';
import * as P from './palette';
import { FX_KINDS, Fx } from './effects';
import {
  BADGE_TEX,
  PUFF_TEX,
  drawBadge,
  drawHatArt,
  drawPopSkin,
  drawPuffArt,
  starPoints,
} from './puffArt';
import { EYE_BLINK, EYE_SCARED, EYE_VARIANTS } from './scene';
import { themeFor, type Theme } from './themes';

export { BADGE_TEX, PUFF_TEX };

/** Logical size of one cell in texture space. */
export const TEX = 96;
/** Fuse ring frames (0 = burnt down … FUSE_FRAMES = full). */
export const FUSE_FRAMES = 24;
export const EYE_TEX_W = 64;
export const EYE_TEX_H = 40;
/** Logical size of a particle texture (particles are scaled relative to the tile). */
export const FX_TEX = 32;

/** The tiles of one arena theme. */
export interface ThemeTextures {
  readonly theme: Theme;
  readonly floor: readonly [Texture, Texture];
  readonly pillar: Texture;
  readonly crate: Texture;
  /** Sudden-death block (interior WALL tile). */
  readonly block: Texture;
}

/** Floor-mechanic decals (drawn over the floor tile of a mechanic cell). */
export interface DecalTextures {
  readonly ice: Texture;
  /** Conveyor belt pointing right, 3 animation frames (rotate for other directions). */
  readonly belt: readonly Texture[];
  readonly teleport: Texture;
  /** Tunnel mouth opening to the right (rotate for other sides). */
  readonly tunnel: Texture;
  readonly trampoline: Texture;
  /** Cracked ground where a pillar is about to grow. */
  readonly grow: Texture;
}

/** Power-up visuals: shield bubble, Jinx aura + glyph per effect (index = `Jinx` id), speed streak. */
export interface PowerTextures {
  readonly shield: Texture;
  readonly jinxAura: Texture;
  readonly jinxGlyph: readonly Texture[];
  readonly streak: Texture;
}

export interface ArenaTextures {
  /** Garden theme (default); see `theme(id)` for the others. */
  readonly floor: readonly [Texture, Texture];
  readonly pillar: Texture;
  readonly crate: Texture;
  readonly block: Texture;
  /** Tiles of a theme, baked on first use. */
  theme(id: string): ThemeTextures;
  readonly decals: DecalTextures;
  readonly power: PowerTextures;
  /** Puff body of catalogue entry `puff` in seat colour `seat`, baked on first use. */
  puffOf(puff: number, seat: number): Texture;
  /** Hat texture on the Puff canvas (index into `HATS`), baked on first use. */
  hatOf(hat: number): Texture;
  /** Pop skin (index into `POP_SKINS`), baked on first use. */
  popOf(skin: number): Texture;
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
  /** White particle textures, index = `Fx` kind (tinted per particle). */
  readonly particles: readonly Texture[];
  /** Shadow of a falling sudden-death block. */
  readonly dropShadow: Texture;
  /** Marker on the cell the next sudden-death block falls on. */
  readonly dropTarget: Texture;
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

function drawFloor(base: number, blade: number): Graphics {
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
      .stroke({ width: 2, color: blade, cap: 'round' });
  }
  return g;
}

function drawPillar(t: Theme): Graphics {
  const g = new Graphics();
  g.roundRect(8, 12, 84, 82, 14).fill({ color: P.SHADOW, alpha: 0.25 });
  g.roundRect(5, 5, 86, 86, 14).fill(t.pillarBody).stroke(outline());
  g.roundRect(11, 9, 74, 66, 11).fill(t.pillarTop);
  g.moveTo(26, 24)
    .lineTo(36, 34)
    .lineTo(34, 46)
    .stroke({ width: 3, color: t.pillarCrack, cap: 'round' });
  g.moveTo(62, 52).lineTo(70, 44).stroke({ width: 3, color: t.pillarCrack, cap: 'round' });
  g.roundRect(18, 14, 26, 8, 4).fill({ color: 0xffffff, alpha: 0.35 });
  return g;
}

function drawCrate(t: Theme): Graphics {
  const g = new Graphics();
  g.roundRect(10, 14, 82, 80, 8).fill({ color: P.SHADOW, alpha: 0.25 });
  g.roundRect(7, 7, 82, 82, 8).fill(t.crateWood).stroke(outline());
  // Planks.
  for (const y of [30, 48, 66]) {
    g.moveTo(12, y).lineTo(84, y).stroke({ width: 2, color: t.crateDark, alpha: 0.6 });
  }
  // Frame and cross brace.
  g.roundRect(15, 15, 66, 66, 4).stroke({ width: 5, color: t.crateDark });
  g.moveTo(19, 19).lineTo(77, 77).stroke({ width: 7, color: t.crateDark, cap: 'round' });
  g.moveTo(19, 19).lineTo(77, 77).stroke({ width: 3, color: t.crateLight, cap: 'round' });
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

function drawBlock(t: Theme): Graphics {
  const g = new Graphics();
  g.rect(0, 0, TEX, TEX).fill(t.brickDark);
  const rows = 4;
  const h = TEX / rows;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : TEX / 4;
    for (let x = -TEX / 4 + offset; x < TEX; x += TEX / 2) {
      g.roundRect(x + 2, r * h + 2, TEX / 2 - 4, h - 4, 3).fill(t.brick);
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

// ---------------------------------------------------------------------------------------------
// Pops (bombs)

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

// ---------------------------------------------------------------------------------------------
// Effects (white, tinted per particle)

/** Soft round blob: stacked discs with rising alpha towards the centre. */
function drawSoftDisc(core: number): Graphics {
  const g = new Graphics();
  const c = FX_TEX / 2;
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const r = c - 1 - i * ((c - 1 - core) / steps);
    g.circle(c, c, r).fill({ color: 0xffffff, alpha: 0.22 });
  }
  g.circle(c, c, core).fill({ color: 0xffffff, alpha: 0.9 });
  return g;
}

function drawParticle(kind: number): Graphics {
  const c = FX_TEX / 2;
  switch (kind) {
    case Fx.SPARK: {
      const g = drawSoftDisc(5);
      g.circle(c, c, 4).fill(0xffffff);
      return g;
    }
    case Fx.CHIP:
      return new Graphics()
        .roundRect(3, 9, FX_TEX - 6, FX_TEX - 18, 3)
        .fill(0xffffff)
        .stroke({ width: 2.5, color: 0x5a4636 });
    case Fx.STAR: {
      const g = new Graphics();
      g.poly([
        c,
        1,
        c + 4,
        c - 4,
        FX_TEX - 1,
        c,
        c + 4,
        c + 4,
        c,
        FX_TEX - 1,
        c - 4,
        c + 4,
        1,
        c,
        c - 4,
        c - 4,
      ]).fill(0xffffff);
      return g;
    }
    case Fx.CONFETTI:
      return new Graphics().rect(4, 10, FX_TEX - 8, FX_TEX - 20).fill(0xffffff);
    default:
      // Fire, smoke and dust: soft round puffs.
      return drawSoftDisc(kind === Fx.FIRE ? 9 : 7);
  }
}

function drawDropShadow(): Graphics {
  const g = new Graphics();
  g.roundRect(8, 10, TEX - 16, TEX - 16, 14).fill({ color: P.SHADOW, alpha: 0.35 });
  g.roundRect(16, 18, TEX - 32, TEX - 32, 10).fill({ color: P.SHADOW, alpha: 0.3 });
  return g;
}

function drawDropTarget(): Graphics {
  const g = new Graphics();
  g.roundRect(6, 6, TEX - 12, TEX - 12, 12).fill({ color: P.BRICK, alpha: 0.22 });
  // Corner brackets read as "incoming" without colour.
  const L = 22;
  const a = 8;
  const b = TEX - 8;
  g.moveTo(a, a + L)
    .lineTo(a, a)
    .lineTo(a + L, a);
  g.moveTo(b - L, a)
    .lineTo(b, a)
    .lineTo(b, a + L);
  g.moveTo(b, b - L)
    .lineTo(b, b)
    .lineTo(b - L, b);
  g.moveTo(a + L, b)
    .lineTo(a, b)
    .lineTo(a, b - L);
  g.stroke({ width: 6, color: P.BRICK_DARK, cap: 'round', join: 'round' });
  return g;
}

// ---------------------------------------------------------------------------------------------
// Floor-mechanic decals (T4.3)

function drawIceDecal(): Graphics {
  const g = new Graphics();
  g.roundRect(3, 3, TEX - 6, TEX - 6, 10).fill({ color: 0xbfe6ff, alpha: 0.4 });
  g.roundRect(3, 3, TEX - 6, TEX - 6, 10).stroke({ width: 2.5, color: 0xffffff, alpha: 0.6 });
  g.moveTo(16, 72)
    .lineTo(40, 48)
    .moveTo(48, 42)
    .lineTo(74, 18)
    .moveTo(56, 76)
    .lineTo(70, 62)
    .stroke({ width: 4, color: 0xffffff, alpha: 0.85, cap: 'round' });
  g.poly(starPoints(70, 70, 8, 3)).fill({ color: 0xffffff, alpha: 0.9 });
  return g;
}

function drawBeltDecal(frame: number): Graphics {
  const g = new Graphics();
  g.roundRect(4, 10, TEX - 8, TEX - 20, 10)
    .fill({ color: 0x3d4350, alpha: 0.85 })
    .stroke(outline(3));
  g.moveTo(10, 18)
    .lineTo(TEX - 10, 18)
    .moveTo(10, TEX - 18)
    .lineTo(TEX - 10, TEX - 18)
    .stroke({ width: 3, color: 0x8d97a3 });
  const pitch = 28;
  for (let k = -1; k < 4; k++) {
    const x = 8 + k * pitch + (frame * pitch) / 3;
    if (x < 8 || x > TEX - 28) continue;
    g.moveTo(x, 30)
      .lineTo(x + 14, TEX / 2)
      .lineTo(x, TEX - 30)
      .stroke({ width: 8, color: 0xffc83d, cap: 'round', join: 'round' });
  }
  return g;
}

function drawTeleportDecal(): Graphics {
  const g = new Graphics();
  g.circle(C, C, 38).fill({ color: 0x5b2a86, alpha: 0.92 }).stroke(outline(4));
  g.circle(C, C, 30).stroke({ width: 3, color: 0xb57bff });
  g.moveTo(C, C);
  for (let i = 1; i <= 36; i++) {
    const a = i * 0.45;
    const r = i * 0.8;
    g.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
  }
  g.stroke({ width: 4, color: 0xf2e6ff, cap: 'round', join: 'round' });
  return g;
}

function drawTunnelDecal(): Graphics {
  const g = new Graphics();
  g.roundRect(-4, 6, TEX - 2, TEX - 12, 14)
    .fill(0x1c1511)
    .stroke({ width: 5, color: 0x8a7258, join: 'round' });
  g.roundRect(10, 18, TEX - 30, TEX - 36, 10).fill(0x0b0806);
  for (const y of [34, 62]) {
    g.poly([34, y - 8, 52, y, 34, y + 8]).fill({ color: 0xffc83d, alpha: 0.9 });
  }
  return g;
}

function drawTrampolineDecal(): Graphics {
  const g = new Graphics();
  g.circle(C, C + 2, 37)
    .fill(0xe63946)
    .stroke(outline(4));
  g.circle(C, C + 2, 28)
    .fill(0xfff1d0)
    .stroke({ width: 3, color: P.OUTLINE });
  g.moveTo(C - 24, C + 2)
    .lineTo(C + 24, C + 2)
    .moveTo(C, C - 22)
    .lineTo(C, C + 26)
    .moveTo(C - 17, C - 15)
    .lineTo(C + 17, C + 19)
    .moveTo(C + 17, C - 15)
    .lineTo(C - 17, C + 19)
    .stroke({ width: 2, color: 0xe63946, alpha: 0.6 });
  g.circle(C, C + 2, 6).fill(0xe63946);
  return g;
}

function drawGrowDecal(): Graphics {
  const g = new Graphics();
  g.roundRect(5, 5, TEX - 10, TEX - 10, 12).fill({ color: 0x5b4b3d, alpha: 0.28 });
  g.moveTo(14, 22)
    .lineTo(34, 38)
    .lineTo(30, 54)
    .lineTo(52, 66)
    .moveTo(34, 38)
    .lineTo(58, 30)
    .lineTo(76, 18)
    .moveTo(52, 66)
    .lineTo(70, 76)
    .lineTo(84, 70)
    .stroke({ width: 4, color: 0x4a3b2f, alpha: 0.9, cap: 'round', join: 'round' });
  for (const [x, y, r] of [
    [22, 70, 5],
    [76, 44, 4],
    [48, 18, 4],
    [66, 84, 3],
  ] as const) {
    g.circle(x, y, r).fill(0x8c7f70).stroke({ width: 2, color: P.OUTLINE, alpha: 0.7 });
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Power-up visuals (T4.1 follow-up): shield bubble, Jinx aura and glyphs, speed streak

function drawShieldBubble(): Graphics {
  const g = new Graphics();
  g.circle(C, C, 43).fill({ color: 0x8fd0ff, alpha: 0.22 });
  g.circle(C, C, 43).stroke({ width: 3.5, color: 0xffffff, alpha: 0.85 });
  g.circle(C, C, 43).stroke({ width: 1.5, color: 0x2f74c4, alpha: 0.8 });
  g.arc(C, C, 34, Math.PI * 1.1, Math.PI * 1.5).stroke({
    width: 4,
    color: 0xffffff,
    alpha: 0.8,
    cap: 'round',
  });
  return g;
}

function drawJinxAura(): Graphics {
  const g = new Graphics();
  g.circle(C, C, 43).fill({ color: 0x7a3fb0, alpha: 0.2 });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    g.arc(C, C, 43, a, a + 0.5).stroke({ width: 4.5, color: 0xb57bff, alpha: 0.95, cap: 'round' });
  }
  return g;
}

/** Jinx effect glyph on a purple disc: 1 reversed, 2 slow, 3 haste, 4 no bombs. */
function drawJinxGlyph(effect: number): Graphics {
  const g = new Graphics();
  g.circle(C, C, 40).fill(P.JINX_BG).stroke(outline(4));
  const ink = { width: 5, color: 0xf2e6ff, cap: 'round' as const, join: 'round' as const };
  switch (effect) {
    case 1:
      g.moveTo(C - 20, C - 9)
        .lineTo(C + 18, C - 9)
        .moveTo(C + 8, C - 19)
        .lineTo(C + 18, C - 9)
        .lineTo(C + 8, C + 1)
        .moveTo(C + 20, C + 11)
        .lineTo(C - 18, C + 11)
        .moveTo(C - 8, C + 1)
        .lineTo(C - 18, C + 11)
        .lineTo(C - 8, C + 21)
        .stroke(ink);
      break;
    case 2:
      g.poly([C - 16, C - 22, C + 16, C - 22, C, C]).fill(0xf2e6ff);
      g.poly([C - 16, C + 22, C + 16, C + 22, C, C]).fill(0xf2e6ff);
      g.moveTo(C - 20, C - 22)
        .lineTo(C + 20, C - 22)
        .moveTo(C - 20, C + 22)
        .lineTo(C + 20, C + 22)
        .stroke(ink);
      break;
    case 3:
      g.poly([
        C + 6,
        C - 26,
        C - 14,
        C + 4,
        C - 1,
        C + 4,
        C - 7,
        C + 26,
        C + 16,
        C - 6,
        C + 2,
        C - 6,
      ])
        .fill(0xffd23f)
        .stroke({ width: 2.5, color: P.OUTLINE, join: 'round' });
      break;
    default:
      g.circle(C - 2, C + 4, 14).fill(0xf2e6ff);
      g.moveTo(C - 24, C - 22)
        .lineTo(C + 22, C + 24)
        .stroke({ width: 7, color: 0xe63946, cap: 'round' });
      g.circle(C, C, 28).stroke({ width: 5, color: 0xe63946 });
      break;
  }
  return g;
}

function drawStreak(): Graphics {
  const g = new Graphics();
  g.ellipse(C, C, 44, 14).fill({ color: 0xffffff, alpha: 0.18 });
  g.ellipse(C, C, 34, 9).fill({ color: 0xffffff, alpha: 0.3 });
  g.ellipse(C + 6, C, 22, 4.5).fill({ color: 0xffffff, alpha: 0.5 });
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
  const particles: Texture[] = [];
  for (let k = 0; k < FX_KINDS; k++)
    particles.push(keep(bake(renderer, drawParticle(k), FX_TEX, FX_TEX)));
  const badge: Texture[] = [];
  for (let s = 0; s < P.SEAT_COLORS.length; s++) {
    badge.push(keep(bake(renderer, drawBadge(s), BADGE_TEX, BADGE_TEX)));
  }

  const themes = new Map<string, ThemeTextures>();
  const themeTextures = (id: string): ThemeTextures => {
    const t = themeFor(id);
    let baked = themes.get(t.id);
    if (!baked) {
      baked = {
        theme: t,
        floor: [cell(drawFloor(t.floorA, t.blade)), cell(drawFloor(t.floorB, t.blade))],
        pillar: cell(drawPillar(t)),
        crate: cell(drawCrate(t)),
        block: cell(drawBlock(t)),
      };
      themes.set(t.id, baked);
    }
    return baked;
  };
  const garden = themeTextures('garden');

  const lazy = new Map<string, Texture>();
  const lazyTexture = (key: string, make: () => Texture): Texture => {
    let t = lazy.get(key);
    if (!t) {
      t = keep(make());
      lazy.set(key, t);
    }
    return t;
  };
  const puffOf = (puff: number, seat: number): Texture =>
    lazyTexture(`puff:${puff}:${seat}`, () =>
      bake(renderer, drawPuffArt(PUFFS[puff] ?? (PUFFS[0] as PuffDef), seat), PUFF_TEX, PUFF_TEX),
    );
  const popOf = (skin: number): Texture =>
    lazyTexture(`pop:${skin}`, () =>
      bake(renderer, drawPopSkin(POP_SKINS[skin] ?? (POP_SKINS[0] as PopSkinDef)), TEX, TEX),
    );

  const decals: DecalTextures = {
    ice: cell(drawIceDecal()),
    belt: [0, 1, 2].map((f) => cell(drawBeltDecal(f))),
    teleport: cell(drawTeleportDecal()),
    tunnel: cell(drawTunnelDecal()),
    trampoline: cell(drawTrampolineDecal()),
    grow: cell(drawGrowDecal()),
  };
  const power: PowerTextures = {
    shield: cell(drawShieldBubble()),
    jinxAura: cell(drawJinxAura()),
    jinxGlyph: [0, 1, 2, 3, 4].map((e) => cell(e === 0 ? new Graphics() : drawJinxGlyph(e))),
    streak: cell(drawStreak()),
  };

  return {
    floor: garden.floor,
    pillar: garden.pillar,
    crate: garden.crate,
    block: garden.block,
    theme: themeTextures,
    decals,
    power,
    puffOf,
    hatOf: (hat) =>
      lazyTexture(`hat:${hat}`, () =>
        bake(renderer, drawHatArt(HATS[hat] ?? (HATS[0] as HatDef)), PUFF_TEX, PUFF_TEX),
      ),
    popOf,
    shadow: cell(drawShadow()),
    puff: [0, 1, 2, 3].map((s) => puffOf(s, s)),
    badge,
    eyes,
    pop: popOf(0),
    ghostPop: cell(
      drawPopSkin({
        id: 'ghost',
        body: P.POP_GHOST,
        dark: 0x7d68b8,
        pattern: 'none',
        mark: 0xffffff,
        unlock: START,
      }),
    ),
    fuseRing,
    flameCore: cell(drawFlameCore()),
    flameArm: cell(drawFlameArm()),
    pickups,
    particles,
    dropShadow: cell(drawDropShadow()),
    dropTarget: cell(drawDropTarget()),
    destroy(): void {
      for (const t of all) t.destroy(true);
      all.length = 0;
      themes.clear();
      lazy.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Touch controls (drawn in white, tinted per seat by the sprites)

/** Logical size of the control textures. */
export const CONTROL_TEX = 128;

export interface ControlTextures {
  /** Thin white ring touching the texture edge. */
  readonly ring: Texture;
  /** Filled white disc touching the texture edge. */
  readonly disc: Texture;
  /** Stick knob: white disc with a dark rim. */
  readonly knob: Texture;
  destroy(): void;
}

/** Bakes the touch-control textures once. */
export function bakeControlTextures(renderer: Renderer): ControlTextures {
  const R = CONTROL_TEX / 2;
  const ring = new Graphics().circle(R, R, R - 4).stroke({ width: 6, color: 0xffffff });
  const disc = new Graphics().circle(R, R, R - 1).fill(0xffffff);
  const knob = new Graphics()
    .circle(R, R, R - 6)
    .fill(0xffffff)
    .stroke({ width: 8, color: P.OUTLINE, alpha: 0.6 });
  const all = [ring, disc, knob].map((g) => bake(renderer, g, CONTROL_TEX, CONTROL_TEX));
  return {
    ring: all[0] as Texture,
    disc: all[1] as Texture,
    knob: all[2] as Texture,
    destroy(): void {
      for (const t of all) t.destroy(true);
    },
  };
}
