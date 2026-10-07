/**
 * Procedural art for the challenge monsters and the flag (T5.2, PLAN §1.13): three small creatures
 * with distinct silhouettes (a round shelled Snail, a floppy-eared Hound, a springy Hopper) and a
 * flag on a post, all drawn once on the 96-px cell and baked by `textures.ts`. They use the shared
 * thick-outline style; nothing here reads the simulation.
 */

import { Graphics } from 'pixi.js';
import { Monster } from '../core';
import * as P from './palette';

const C = 48;
const INK = { width: 4, color: P.OUTLINE, join: 'round' as const };

function eyes(g: Graphics, y: number, gap: number, r: number): void {
  for (const dx of [-gap, gap]) {
    g.circle(C + dx, y, r)
      .fill(P.EYE_WHITE)
      .stroke({ width: 2.5, color: P.OUTLINE });
    g.circle(C + dx + 1, y + 1, r * 0.5).fill(P.PUPIL);
  }
}

function drawSnail(): Graphics {
  const g = new Graphics();
  g.ellipse(C, C + 22, 28, 8).fill({ color: P.SHADOW, alpha: 0.25 });
  // Body: a plump green blob with a head poking out at the bottom (towards the player).
  g.ellipse(C, C + 8, 26, 20)
    .fill(0x8fd16a)
    .stroke(INK);
  g.circle(C, C + 22, 11)
    .fill(0x8fd16a)
    .stroke(INK);
  eyes(g, C + 19, 5, 4.5);
  // Shell: orange disc with a spiral.
  g.circle(C, C - 6, 21)
    .fill(0xf2994a)
    .stroke(INK);
  g.circle(C, C - 6, 13).stroke({ width: 3, color: 0xb5651d });
  g.circle(C, C - 6, 6).stroke({ width: 3, color: 0xb5651d });
  g.circle(C - 7, C - 14, 4).fill({ color: 0xffffff, alpha: 0.4 });
  return g;
}

function drawHound(): Graphics {
  const g = new Graphics();
  g.ellipse(C, C + 24, 30, 8).fill({ color: P.SHADOW, alpha: 0.25 });
  // Floppy ears behind the head.
  for (const dx of [-1, 1]) {
    g.ellipse(C + dx * 25, C - 4, 10, 19)
      .fill(0x6b3f22)
      .stroke(INK);
  }
  g.circle(C, C, 26).fill(0xa8683a).stroke(INK);
  // Snout with a nose.
  g.ellipse(C, C + 12, 14, 11)
    .fill(0xe6c08e)
    .stroke({ width: 3, color: P.OUTLINE });
  g.ellipse(C, C + 8, 6, 4.5).fill(0x2b2118);
  g.moveTo(C, C + 12)
    .lineTo(C, C + 18)
    .stroke({ width: 3, color: P.OUTLINE, cap: 'round' });
  g.ellipse(C, C + 22, 5, 3.5)
    .fill(0xff7b8a)
    .stroke({ width: 2, color: P.OUTLINE });
  eyes(g, C - 8, 10, 6);
  // Angry brows: this one chases.
  for (const dx of [-1, 1]) {
    g.moveTo(C + dx * 4, C - 19)
      .lineTo(C + dx * 16, C - 15)
      .stroke({ width: 3.5, color: P.OUTLINE, cap: 'round' });
  }
  return g;
}

function drawHopper(): Graphics {
  const g = new Graphics();
  g.ellipse(C, C + 24, 24, 7).fill({ color: P.SHADOW, alpha: 0.25 });
  // Folded springy legs.
  for (const dx of [-1, 1]) {
    g.moveTo(C + dx * 14, C + 6)
      .lineTo(C + dx * 32, C + 2)
      .lineTo(C + dx * 26, C + 22)
      .stroke({ width: 8, color: P.OUTLINE, cap: 'round', join: 'round' });
    g.moveTo(C + dx * 14, C + 6)
      .lineTo(C + dx * 32, C + 2)
      .lineTo(C + dx * 26, C + 22)
      .stroke({ width: 4, color: 0x4fc26a, cap: 'round', join: 'round' });
  }
  g.ellipse(C, C + 2, 24, 22)
    .fill(0x6fdc7c)
    .stroke(INK);
  g.ellipse(C, C + 12, 15, 9).fill({ color: 0xcdf5c9, alpha: 0.85 });
  // Big bulging eyes on top.
  for (const dx of [-1, 1]) {
    g.circle(C + dx * 12, C - 14, 10)
      .fill(P.EYE_WHITE)
      .stroke({ width: 3, color: P.OUTLINE });
    g.circle(C + dx * 12 + 1, C - 12, 5).fill(P.PUPIL);
  }
  g.moveTo(C - 8, C + 6)
    .quadraticCurveTo(C, C + 14, C + 8, C + 6)
    .stroke({ width: 3, color: P.OUTLINE, cap: 'round' });
  return g;
}

/** Monster texture of `kind` (`Monster` id) on the 96-px cell. */
export function drawMonster(kind: number): Graphics {
  switch (kind) {
    case Monster.SNAIL:
      return drawSnail();
    case Monster.HOUND:
      return drawHound();
    default:
      return drawHopper();
  }
}

/** The challenge flag: a post with a waving red pennant on a small mound. */
export function drawFlag(): Graphics {
  const g = new Graphics();
  g.ellipse(C, C + 24, 26, 8).fill({ color: P.SHADOW, alpha: 0.25 });
  g.ellipse(C, C + 20, 20, 9)
    .fill(0xcbb48a)
    .stroke({ width: 3, color: P.OUTLINE });
  g.roundRect(C - 3, C - 32, 6, 54, 3)
    .fill(0xf4efe4)
    .stroke({ width: 3, color: P.OUTLINE });
  g.moveTo(C + 3, C - 30)
    .bezierCurveTo(C + 18, C - 38, C + 26, C - 22, C + 40, C - 28)
    .lineTo(C + 36, C - 8)
    .bezierCurveTo(C + 24, C - 12, C + 16, C - 2, C + 3, C - 8)
    .closePath()
    .fill(0xff4d5e)
    .stroke(INK);
  g.circle(C, C - 34, 5)
    .fill(0xffd23f)
    .stroke({ width: 3, color: P.OUTLINE });
  return g;
}
