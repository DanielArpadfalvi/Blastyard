/**
 * Procedural art of the cosmetic catalogue (T4.4): Puff silhouettes, hats, pop skins and the seat
 * badges, all drawn with Pixi `Graphics` from the code data in `src/content/cosmetics.ts`. Puffs
 * and hats share one 128 px canvas with the body centred, so a hat sprite sits exactly on its
 * Puff's sprite and follows its squash & stretch.
 */

import { Container, Graphics, Text } from 'pixi.js';
import { SEAT_BADGES, type HatDef, type PopSkinDef, type PuffDef } from '../content/cosmetics';
import * as P from './palette';

/** Canvas of a Puff / hat texture (body centred). */
export const PUFF_TEX = 128;
/** Logical size of one cell (pop textures). */
const CELL = 96;
export const BADGE_TEX = 44;
/** Body radius in the Puff canvas. */
const R = 36;

function outline(width = 4): { width: number; color: number; join: 'round' } {
  return { width, color: P.OUTLINE, join: 'round' };
}

export function starPoints(cx: number, cy: number, outer: number, inner: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Puffs

/** Features drawn behind the body. */
function drawBehind(g: Graphics, def: PuffDef, color: number, shade: number): void {
  const c = PUFF_TEX / 2;
  switch (def.silhouette) {
    case 'bunny':
      for (const sx of [-1, 1]) {
        g.circle(c + sx * 25, c - 27, 13)
          .fill(color)
          .stroke(outline());
        g.circle(c + sx * 25, c - 27, 6).fill(shade);
      }
      break;
    case 'antenna':
      g.moveTo(c + 4, c - R + 4)
        .quadraticCurveTo(c + 8, c - R - 10, c + 16, c - R - 18)
        .stroke({ width: 4, color: P.OUTLINE, cap: 'round' });
      g.circle(c + 16, c - R - 18, 8)
        .fill(shade)
        .stroke(outline(3.5));
      break;
    case 'spikes':
      for (const [dx, h] of [
        [-20, 14],
        [0, 18],
        [20, 14],
      ] as const) {
        g.poly([c + dx - 10, c - R + 10, c + dx, c - R - h + 4, c + dx + 10, c - R + 10])
          .fill(shade)
          .stroke(outline(3.5));
      }
      break;
    case 'duck':
      g.ellipse(c, c + R - 2, 12, 9)
        .fill(shade)
        .stroke(outline(3.5));
      break;
    case 'horns':
      for (const sx of [-1, 1]) {
        g.moveTo(c + sx * 14, c - R + 6)
          .quadraticCurveTo(c + sx * 30, c - R - 2, c + sx * 28, c - R - 22)
          .quadraticCurveTo(c + sx * 20, c - R - 8, c + sx * 6, c - R + 2)
          .closePath()
          .fill(0xfff1d0)
          .stroke(outline(3.5));
      }
      break;
    case 'sprout':
      g.moveTo(c, c - R + 4)
        .quadraticCurveTo(c - 2, c - R - 8, c + 2, c - R - 16)
        .stroke({ width: 4, color: P.OUTLINE, cap: 'round' });
      for (const sx of [-1, 1]) {
        g.ellipse(c + sx * 10, c - R - 18, 12, 6.5)
          .fill(0x6cc551)
          .stroke(outline(3));
      }
      break;
    case 'fin':
      g.poly([c - 6, c - R + 8, c + 4, c - R - 24, c + 20, c - R + 10])
        .fill(shade)
        .stroke(outline(3.5));
      g.poly([c - 38, c + 6, c - 52, c + 14, c - 36, c + 20])
        .fill(shade)
        .stroke(outline(3));
      g.poly([c + 38, c + 6, c + 52, c + 14, c + 36, c + 20])
        .fill(shade)
        .stroke(outline(3));
      break;
    case 'snout':
      for (const sx of [-1, 1]) {
        g.ellipse(c + sx * 26, c - 24, 9, 12)
          .fill(shade)
          .stroke(outline(3.5));
      }
      break;
    case 'cat':
      for (const sx of [-1, 1]) {
        g.poly([c + sx * 30, c - 12, c + sx * 28, c - R - 14, c + sx * 8, c - R + 4])
          .fill(color)
          .stroke(outline(3.5));
        g.poly([c + sx * 25, c - 20, c + sx * 24, c - R - 4, c + sx * 14, c - R + 4]).fill(
          0xff8fa3,
        );
      }
      break;
    case 'owl':
      for (const sx of [-1, 1]) {
        g.poly([c + sx * 30, c - 10, c + sx * 34, c - R - 10, c + sx * 12, c - R + 2])
          .fill(shade)
          .stroke(outline(3.5));
      }
      break;
    case 'bat':
      for (const sx of [-1, 1]) {
        g.moveTo(c + sx * 30, c - 8)
          .lineTo(c + sx * 58, c - 24)
          .quadraticCurveTo(c + sx * 52, c - 8, c + sx * 58, c + 2)
          .quadraticCurveTo(c + sx * 46, c, c + sx * 44, c + 12)
          .quadraticCurveTo(c + sx * 36, c + 6, c + sx * 30, c + 14)
          .closePath()
          .fill(shade)
          .stroke(outline(3.5));
        g.poly([c + sx * 14, c - R + 6, c + sx * 20, c - R - 14, c + sx * 28, c - R + 14])
          .fill(color)
          .stroke(outline(3));
      }
      break;
    case 'jelly':
      for (const dx of [-22, -8, 8, 22]) {
        g.moveTo(c + dx, c + R - 10)
          .quadraticCurveTo(c + dx + 8, c + R + 2, c + dx - 2, c + R + 10)
          .quadraticCurveTo(c + dx - 8, c + R + 16, c + dx + 2, c + R + 20)
          .stroke({ width: 7, color: P.OUTLINE, cap: 'round' });
        g.moveTo(c + dx, c + R - 10)
          .quadraticCurveTo(c + dx + 8, c + R + 2, c + dx - 2, c + R + 10)
          .quadraticCurveTo(c + dx - 8, c + R + 16, c + dx + 2, c + R + 20)
          .stroke({ width: 3.5, color: shade, cap: 'round' });
      }
      break;
  }
}

/** Features drawn on top of the body (below the eye sprite). */
function drawFront(g: Graphics, def: PuffDef, shade: number): void {
  const c = PUFF_TEX / 2;
  const smile = (): void => {
    g.moveTo(c - 6, c + 14)
      .quadraticCurveTo(c, c + 19, c + 6, c + 14)
      .stroke({ width: 3, color: P.OUTLINE, cap: 'round' });
  };
  switch (def.silhouette) {
    case 'duck':
      g.poly([c - 9, c + 10, c + 9, c + 10, c, c + 22])
        .fill(0xff9f1c)
        .stroke(outline(3));
      break;
    case 'snout':
      g.ellipse(c, c + 12, 13, 9.5)
        .fill(0xffb3c1)
        .stroke(outline(3));
      g.circle(c - 4.5, c + 12, 2).fill(P.OUTLINE);
      g.circle(c + 4.5, c + 12, 2).fill(P.OUTLINE);
      break;
    case 'cat':
      g.poly([c - 4, c + 8, c + 4, c + 8, c, c + 13]).fill(0xff8fa3);
      for (const sx of [-1, 1]) {
        for (const dy of [-2, 5]) {
          g.moveTo(c + sx * 14, c + 12 + dy * 0.5)
            .lineTo(c + sx * 32, c + 8 + dy)
            .stroke({ width: 2, color: P.OUTLINE, cap: 'round' });
        }
      }
      break;
    case 'owl':
      g.ellipse(c, c + 20, 17, 12).fill({ color: 0xffffff, alpha: 0.4 });
      g.poly([c - 6, c + 8, c + 6, c + 8, c, c + 18])
        .fill(0xffb627)
        .stroke(outline(3));
      for (const dy of [22, 30]) {
        g.moveTo(c - 10, c + dy - 4)
          .quadraticCurveTo(c, c + dy + 2, c + 10, c + dy - 4)
          .stroke({ width: 2, color: shade, cap: 'round' });
      }
      break;
    case 'bat':
      g.poly([c - 7, c + 13, c - 3, c + 20, c - 1, c + 13]).fill(0xffffff);
      g.poly([c + 7, c + 13, c + 3, c + 20, c + 1, c + 13]).fill(0xffffff);
      g.moveTo(c - 8, c + 12)
        .lineTo(c + 8, c + 12)
        .stroke({ width: 3, color: P.OUTLINE, cap: 'round' });
      break;
    case 'jelly':
      g.moveTo(c - 6, c + 14)
        .quadraticCurveTo(c, c + 21, c + 6, c + 14)
        .stroke({ width: 3, color: P.OUTLINE, cap: 'round' });
      for (const [x, y] of [
        [-16, -20],
        [10, -24],
        [22, -8],
      ] as const) {
        g.circle(c + x, c + y, 3).fill({ color: 0xffffff, alpha: 0.5 });
      }
      break;
    default:
      smile();
  }
}

/** One Puff in seat colour `seat`: silhouette, body, cheeks and mouth (eyes are a separate sprite). */
export function drawPuffArt(def: PuffDef, seat: number): Graphics {
  const g = new Graphics();
  const c = PUFF_TEX / 2;
  const color = P.SEAT_COLORS[seat] as number;
  const shade = P.SEAT_SHADES[seat] as number;
  drawBehind(g, def, color, shade);
  g.circle(c, c, R).fill(color).stroke(outline(5));
  g.ellipse(c - 11, c - 15, 15, 10).fill({ color: 0xffffff, alpha: 0.32 });
  g.ellipse(c - 21, c + 12, 7, 4).fill({ color: 0xff8fa3, alpha: 0.6 });
  g.ellipse(c + 21, c + 12, 7, 4).fill({ color: 0xff8fa3, alpha: 0.6 });
  drawFront(g, def, shade);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Hats (drawn on the Puff canvas; the head top is at y = 28)

export function drawHatArt(def: HatDef): Graphics {
  const g = new Graphics();
  const c = PUFF_TEX / 2;
  const top = c - R; // 28
  const { color, accent } = def;
  switch (def.shape) {
    case 'cap':
      g.moveTo(c - 26, top + 12)
        .quadraticCurveTo(c, top - 24, c + 26, top + 12)
        .closePath()
        .fill(color)
        .stroke(outline(3.5));
      g.roundRect(c + 8, top + 6, 30, 8, 4)
        .fill(color)
        .stroke(outline(3));
      g.circle(c, top - 6, 3.5).fill(accent);
      break;
    case 'party':
      g.poly([c - 16, top + 10, c + 2, top - 36, c + 18, top + 10])
        .fill(color)
        .stroke(outline(3.5));
      for (const [x, y] of [
        [c - 4, top - 8],
        [c + 6, top - 18],
        [c, top + 2],
      ] as const) {
        g.circle(x, y, 3).fill(accent);
      }
      g.circle(c + 2, top - 38, 5)
        .fill(accent)
        .stroke(outline(2.5));
      break;
    case 'tophat':
      g.roundRect(c - 30, top + 2, 60, 9, 4)
        .fill(color)
        .stroke(outline(3.5));
      g.roundRect(c - 19, top - 28, 38, 34, 4)
        .fill(color)
        .stroke(outline(3.5));
      g.rect(c - 19, top - 6, 38, 8).fill(accent);
      break;
    case 'headband':
      g.roundRect(c - 31, top + 8, 62, 11, 5)
        .fill(color)
        .stroke(outline(3));
      g.poly([c + 28, top + 12, c + 44, top + 4, c + 40, top + 22])
        .fill(color)
        .stroke(outline(2.5));
      g.circle(c, top + 13.5, 4).fill(accent);
      break;
    case 'beanie':
      g.moveTo(c - 29, top + 14)
        .quadraticCurveTo(c, top - 34, c + 29, top + 14)
        .closePath()
        .fill(color)
        .stroke(outline(3.5));
      g.roundRect(c - 31, top + 8, 62, 12, 5)
        .fill(accent)
        .stroke(outline(3));
      g.circle(c, top - 16, 7)
        .fill(accent)
        .stroke(outline(3));
      break;
    case 'flower':
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        g.circle(c + 16 + Math.cos(a) * 9, top + 2 + Math.sin(a) * 9, 7)
          .fill(color)
          .stroke(outline(2.5));
      }
      g.circle(c + 16, top + 2, 5)
        .fill(accent)
        .stroke(outline(2));
      break;
    case 'propeller':
      g.moveTo(c - 20, top + 10)
        .quadraticCurveTo(c, top - 14, c + 20, top + 10)
        .closePath()
        .fill(color)
        .stroke(outline(3.5));
      g.ellipse(c - 15, top - 12, 16, 4.5)
        .fill(accent)
        .stroke(outline(2.5));
      g.ellipse(c + 15, top - 12, 16, 4.5)
        .fill(accent)
        .stroke(outline(2.5));
      g.rect(c - 2, top - 14, 4, 10).fill(P.OUTLINE);
      g.circle(c, top - 14, 4).fill(P.OUTLINE);
      break;
    case 'chef':
      g.roundRect(c - 22, top - 2, 44, 14, 3)
        .fill(color)
        .stroke(outline(3.5));
      for (const dx of [-16, 0, 16])
        g.circle(c + dx, top - 12, 13)
          .fill(color)
          .stroke(outline(3));
      g.roundRect(c - 22, top + 2, 44, 10, 3).fill(color);
      g.moveTo(c - 20, top + 8)
        .lineTo(c + 20, top + 8)
        .stroke({ width: 2, color: accent });
      break;
    case 'antlers':
      for (const sx of [-1, 1]) {
        g.moveTo(c + sx * 12, top + 6)
          .quadraticCurveTo(c + sx * 24, top - 6, c + sx * 26, top - 26)
          .stroke({ width: 7, color: P.OUTLINE, cap: 'round' });
        g.moveTo(c + sx * 12, top + 6)
          .quadraticCurveTo(c + sx * 24, top - 6, c + sx * 26, top - 26)
          .stroke({ width: 3.5, color, cap: 'round' });
        g.moveTo(c + sx * 22, top - 8)
          .lineTo(c + sx * 36, top - 14)
          .stroke({ width: 7, color: P.OUTLINE, cap: 'round' });
        g.moveTo(c + sx * 22, top - 8)
          .lineTo(c + sx * 36, top - 14)
          .stroke({ width: 3.5, color: accent, cap: 'round' });
      }
      break;
    case 'bow':
      g.poly([c, top + 4, c - 24, top - 12, c - 24, top + 16])
        .fill(color)
        .stroke(outline(3));
      g.poly([c, top + 4, c + 24, top - 12, c + 24, top + 16])
        .fill(color)
        .stroke(outline(3));
      g.circle(c, top + 4, 6)
        .fill(accent)
        .stroke(outline(2.5));
      break;
    case 'sailor':
      g.roundRect(c - 28, top - 2, 56, 16, 6)
        .fill(color)
        .stroke(outline(3.5));
      g.ellipse(c, top - 2, 24, 8)
        .fill(color)
        .stroke(outline(3));
      g.rect(c - 28, top + 6, 56, 4).fill(accent);
      g.circle(c, top - 6, 3).fill(accent);
      break;
    case 'helmet':
      g.moveTo(c - 30, top + 16)
        .quadraticCurveTo(c, top - 34, c + 30, top + 16)
        .closePath()
        .fill(color)
        .stroke(outline(3.5));
      g.roundRect(c - 4, top - 14, 8, 28, 3)
        .fill(accent)
        .stroke(outline(2));
      g.roundRect(c - 31, top + 12, 62, 6, 3)
        .fill(color)
        .stroke(outline(2.5));
      break;
    case 'crown':
      g.poly([
        c - 26,
        top + 12,
        c - 26,
        top - 16,
        c - 13,
        top - 2,
        c,
        top - 22,
        c + 13,
        top - 2,
        c + 26,
        top - 16,
        c + 26,
        top + 12,
      ])
        .fill(color)
        .stroke(outline(3.5));
      for (const dx of [-14, 0, 14])
        g.circle(c + dx, top + 4, 3.5)
          .fill(accent)
          .stroke(outline(1.5));
      break;
    case 'wizard':
      g.ellipse(c, top + 10, 34, 8)
        .fill(color)
        .stroke(outline(3.5));
      g.poly([c - 20, top + 8, c + 6, top - 44, c + 20, top + 8])
        .fill(color)
        .stroke(outline(3.5));
      g.poly(starPoints(c - 2, top - 8, 7, 3)).fill(accent);
      break;
    case 'cowboy':
      g.ellipse(c, top + 10, 36, 9)
        .fill(color)
        .stroke(outline(3.5));
      g.moveTo(c - 20, top + 8)
        .quadraticCurveTo(c - 18, top - 22, c, top - 12)
        .quadraticCurveTo(c + 18, top - 22, c + 20, top + 8)
        .closePath()
        .fill(color)
        .stroke(outline(3.5));
      g.rect(c - 19, top - 2, 38, 5).fill(accent);
      break;
    case 'halo':
      g.ellipse(c, top - 10, 24, 7).stroke({ width: 8, color: P.OUTLINE });
      g.ellipse(c, top - 10, 24, 7).stroke({ width: 4.5, color, alpha: 1 });
      g.ellipse(c - 8, top - 12, 8, 2).fill({ color: accent, alpha: 0.7 });
      break;
    case 'pirate':
      g.moveTo(c - 32, top + 12)
        .quadraticCurveTo(c - 26, top - 24, c, top - 20)
        .quadraticCurveTo(c + 26, top - 24, c + 32, top + 12)
        .quadraticCurveTo(c, top + 2, c - 32, top + 12)
        .closePath()
        .fill(color)
        .stroke(outline(3.5));
      g.circle(c, top - 8, 5).fill(accent);
      g.moveTo(c - 8, top - 2)
        .lineTo(c + 8, top - 14)
        .moveTo(c + 8, top - 2)
        .lineTo(c - 8, top - 14)
        .stroke({ width: 2.5, color: accent, cap: 'round' });
      break;
    case 'laurel':
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          g.ellipse(c + sx * (26 - i * 5), top + 14 - i * 8, 9, 4.5)
            .fill(color)
            .stroke(outline(2));
        }
      }
      g.circle(c, top + 2, 4)
        .fill(accent)
        .stroke(outline(2));
      break;
  }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Pop skins

function heart(g: Graphics, x: number, y: number, s: number, color: number): void {
  g.moveTo(x, y + 6 * s)
    .bezierCurveTo(x - 10 * s, y - 2 * s, x - 6 * s, y - 10 * s, x, y - 4 * s)
    .bezierCurveTo(x + 6 * s, y - 10 * s, x + 10 * s, y - 2 * s, x, y + 6 * s)
    .closePath()
    .fill(color);
}

/** A pop (bomb gubbin) in a skin; pattern drawn on the body disc (centre 48/50, radius 31). */
export function drawPopSkin(def: PopSkinDef): Graphics {
  const C = CELL / 2;
  const g = new Graphics();
  g.ellipse(C, C + 28, 30, 10).fill({ color: P.SHADOW, alpha: 0.28 });
  g.circle(C, C + 2, 31)
    .fill(def.body)
    .stroke(outline(4.5));
  const m = def.mark;
  switch (def.pattern) {
    case 'dots':
      for (const [x, y, r] of [
        [-12, 4, 4.5],
        [10, -8, 4],
        [8, 16, 5],
        [-4, -18, 3.5],
      ] as const) {
        g.circle(C + x, C + y, r).fill({ color: m, alpha: 0.85 });
      }
      break;
    case 'stripes':
      for (const k of [-16, -2, 12]) {
        const hw = Math.sqrt(31 * 31 - k * k) - 3;
        g.moveTo(C - hw, C + 2 + k)
          .lineTo(C + hw, C + 2 + k)
          .stroke({ width: 5.5, color: m, alpha: 0.75, cap: 'butt' });
      }
      break;
    case 'stars':
      g.poly(starPoints(C - 10, C + 6, 7, 3)).fill(m);
      g.poly(starPoints(C + 12, C - 8, 6, 2.6)).fill(m);
      g.poly(starPoints(C + 6, C + 18, 4.5, 2)).fill(m);
      break;
    case 'hearts':
      heart(g, C - 10, C + 4, 1.1, m);
      heart(g, C + 12, C - 8, 0.9, m);
      heart(g, C + 4, C + 18, 0.7, m);
      break;
    case 'sparkle':
      for (const [x, y, s] of [
        [-10, 4, 8],
        [12, -10, 6],
        [8, 16, 5],
      ] as const) {
        const px = C + x;
        const py = C + y;
        g.poly([
          px,
          py - s,
          px + s * 0.28,
          py - s * 0.28,
          px + s,
          py,
          px + s * 0.28,
          py + s * 0.28,
          px,
          py + s,
          px - s * 0.28,
          py + s * 0.28,
          px - s,
          py,
          px - s * 0.28,
          py - s * 0.28,
        ]).fill(m);
      }
      break;
    default:
      break;
  }
  g.moveTo(C - 14, C - 24)
    .quadraticCurveTo(C - 25, C + 2, C - 14, C + 28)
    .stroke({ width: 3, color: def.dark, cap: 'round' });
  g.moveTo(C + 14, C - 24)
    .quadraticCurveTo(C + 25, C + 2, C + 14, C + 28)
    .stroke({ width: 3, color: def.dark, cap: 'round' });
  g.ellipse(C - 9, C - 10, 8, 6).fill({ color: 0xffffff, alpha: 0.45 });
  g.ellipse(C - 7, C - 29, 9, 5)
    .fill(0x6cc551)
    .stroke(outline(3));
  g.ellipse(C + 7, C - 29, 9, 5)
    .fill(0x6cc551)
    .stroke(outline(3));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Seat badges

/** Seat badge: shape (circle, triangle, square, star) + seat number. */
export function drawBadge(seat: number): Container {
  const root = new Container();
  const g = new Graphics();
  const c = BADGE_TEX / 2;
  const fill = { color: 0xffffff };
  switch (SEAT_BADGES[seat % 4]) {
    case 'circle':
      g.circle(c, c, 15).fill(fill).stroke(outline(3));
      break;
    case 'triangle':
      g.poly([c, c - 18, c + 18, c + 14, c - 18, c + 14])
        .fill(fill)
        .stroke(outline(3));
      break;
    case 'square':
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
    text: String((seat % 4) + 1),
    style: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontSize: 17,
      fontWeight: '900',
      fill: P.OUTLINE,
    },
  });
  label.anchor.set(0.5);
  label.position.set(c, seat % 4 === 1 ? c + 4 : c + 1);
  root.addChild(label);
  return root;
}
