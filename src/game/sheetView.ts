/**
 * Item sheets (T4.4): `?view=sheet&page=<page>` draws every cosmetic / arena palette / power-up
 * visual of a catalogue on one screen, for review screenshots and the e2e tests. Pages: `seats`
 * (the four seat colours with badge + number; `gray` previews them in grayscale), `puffs` (12),
 * `hats` (18), `pops` (9 pop skins), `trails` (6), `themes` (12 arena palettes), `powers`
 * (pickups, shield bubble, Jinx glyphs, floor-mechanic decals). Dev tooling: labels are the
 * catalogue ids, not user-facing text.
 */

import { Container, Graphics, Sprite, Text, type Application, type Texture } from 'pixi.js';
import { PICKUP_KIND_COUNT } from '../core';
import { HATS, POP_SKINS, PUFFS, SEAT_BADGES, TRAILS } from '../content/cosmetics';
import { FUSE_FRAMES } from '../render/textures';
import { Fx } from '../render/effects';
import * as P from '../render/palette';
import { THEMES } from '../render/themes';
import { PUFF_TEX, TEX, bakeArenaTextures, type ArenaTextures } from '../render/textures';

export const SHEET_PAGES = [
  'seats',
  'puffs',
  'hats',
  'pops',
  'trails',
  'themes',
  'powers',
] as const;
export type SheetPage = (typeof SHEET_PAGES)[number];

/** `window.__blastyardSheet` (always exposed in the sheet view). */
export interface SheetHook {
  readonly ready: true;
  readonly page: SheetPage;
  /** Number of catalogue items drawn on the page. */
  readonly items: number;
  readonly gray: boolean;
}

declare global {
  interface Window {
    __blastyardSheet?: SheetHook;
  }
}

export function wantsSheetView(search: string): boolean {
  return new URLSearchParams(search).get('view') === 'sheet';
}

const TRAIL_FX = {
  dust: Fx.DUST,
  spark: Fx.SPARK,
  star: Fx.STAR,
  confetti: Fx.CONFETTI,
  smoke: Fx.SMOKE,
};

interface Grid {
  readonly cols: number;
  readonly rows: number;
  readonly size: number;
  readonly x0: number;
  readonly y0: number;
}

function gridFor(w: number, h: number, cols: number, rows: number): Grid {
  const size = Math.floor(Math.min(w / cols, h / rows));
  return { cols, rows, size, x0: (w - size * cols) / 2, y0: (h - size * rows) / 2 };
}

function cellCentre(g: Grid, i: number): [number, number] {
  return [
    g.x0 + (i % g.cols) * g.size + g.size / 2,
    g.y0 + Math.floor(i / g.cols) * g.size + g.size / 2,
  ];
}

function sprite(texture: Texture, x: number, y: number, scale: number): Sprite {
  const s = new Sprite(texture);
  s.anchor.set(0.5);
  s.position.set(x, y);
  s.scale.set(scale);
  return s;
}

function label(text: string, x: number, y: number, size: number): Text {
  const t = new Text({
    text,
    style: { fontFamily: 'system-ui, sans-serif', fontSize: Math.max(8, size), fill: 0xffffff },
  });
  t.anchor.set(0.5, 0);
  t.position.set(x, y);
  return t;
}

function card(g: Grid, i: number, tint = 0x2b4a31): Graphics {
  const [cx, cy] = cellCentre(g, i);
  const pad = g.size * 0.04;
  return new Graphics()
    .roundRect(
      cx - g.size / 2 + pad,
      cy - g.size / 2 + pad,
      g.size - pad * 2,
      g.size - pad * 2,
      g.size * 0.08,
    )
    .fill(tint);
}

/** A Puff with eyes (and optionally a hat / badge) centred at (x, y), `size` px for its canvas. */
function puffStack(
  tex: ArenaTextures,
  puff: number,
  seat: number,
  hat: number,
  x: number,
  y: number,
  size: number,
  badge: boolean,
): Container {
  const root = new Container();
  const k = size / PUFF_TEX;
  root.addChild(sprite(tex.puffOf(puff, seat), x, y, k));
  root.addChild(sprite(tex.eyes[0] as Texture, x, y - 4 * k, k));
  if (hat >= 0) root.addChild(sprite(tex.hatOf(hat), x, y, k));
  if (badge) root.addChild(sprite(tex.badge[seat] as Texture, x + 30 * k, y + 28 * k, k * 1.1));
  return root;
}

function build(
  app: Application,
  tex: ArenaTextures,
  page: SheetPage,
): { root: Container; items: number } {
  const root = new Container();
  const W = app.screen.width;
  const H = app.screen.height;
  let items = 0;
  switch (page) {
    case 'seats': {
      const g = gridFor(W, H, 4, 1);
      for (let s = 0; s < 4; s++) {
        root.addChild(card(g, s));
        const [cx, cy] = cellCentre(g, s);
        const k = g.size * 0.92;
        root.addChild(puffStack(tex, s, s, -1, cx, cy - g.size * 0.12, k, true));
        root.addChild(sprite(tex.pop, cx, cy + g.size * 0.3, (g.size * 0.4) / TEX));
        root.addChild(label(`${s + 1} · ${SEAT_BADGES[s]}`, cx, cy + g.size * 0.38, g.size * 0.1));
        items++;
      }
      break;
    }
    case 'puffs': {
      const g = gridFor(W, H, 4, 3);
      PUFFS.forEach((p, i) => {
        root.addChild(card(g, i, p.unlock.kind === 'plus' ? 0x4a3b63 : 0x2b4a31));
        const [cx, cy] = cellCentre(g, i);
        root.addChild(puffStack(tex, i, i % 4, -1, cx, cy - g.size * 0.05, g.size * 0.95, i < 4));
        root.addChild(label(p.id, cx, cy + g.size * 0.34, g.size * 0.11));
        items++;
      });
      break;
    }
    case 'hats': {
      const g = gridFor(W, H, 6, 3);
      HATS.forEach((h, i) => {
        root.addChild(card(g, i, h.unlock.kind === 'plus' ? 0x4a3b63 : 0x2b4a31));
        const [cx, cy] = cellCentre(g, i);
        root.addChild(puffStack(tex, 3, i % 4, i, cx, cy + g.size * 0.05, g.size * 0.95, false));
        root.addChild(label(h.id, cx, cy + g.size * 0.33, g.size * 0.11));
        items++;
      });
      break;
    }
    case 'pops': {
      const g = gridFor(W, H, 5, 2);
      POP_SKINS.forEach((p, i) => {
        root.addChild(card(g, i, p.unlock.kind === 'plus' ? 0x4a3b63 : 0x2b4a31));
        const [cx, cy] = cellCentre(g, i);
        root.addChild(sprite(tex.popOf(i), cx, cy - g.size * 0.04, (g.size * 0.92) / TEX));
        root.addChild(
          sprite(
            tex.fuseRing[FUSE_FRAMES - 8] as Texture,
            cx,
            cy - g.size * 0.04,
            (g.size * 0.92) / TEX,
          ),
        );
        root.addChild(label(p.id, cx, cy + g.size * 0.34, g.size * 0.11));
        items++;
      });
      const [gx, gy] = cellCentre(g, POP_SKINS.length);
      root.addChild(card(g, POP_SKINS.length, 0x2b4a31));
      root.addChild(sprite(tex.ghostPop, gx, gy - g.size * 0.04, (g.size * 0.92) / TEX));
      root.addChild(label('ghost', gx, gy + g.size * 0.34, g.size * 0.11));
      break;
    }
    case 'trails': {
      const g = gridFor(W, H, 1, TRAILS.length);
      const row = g.size;
      TRAILS.forEach((t, i) => {
        const y = g.y0 + i * row + row / 2;
        root.addChild(
          new Graphics()
            .roundRect(g.x0 + 4, y - row / 2 + 3, W - 8, row - 6, row * 0.12)
            .fill(t.unlock.kind === 'plus' ? 0x4a3b63 : 0x2b4a31),
        );
        const dots = 9;
        const left = W * 0.2;
        const span = W * 0.7;
        for (let d = 0; d < dots; d++) {
          const age = (dots - 1 - d) / (dots - 1);
          const s = sprite(
            tex.particles[TRAIL_FX[t.particle]] as Texture,
            left + (span * d) / (dots - 1),
            y + row * 0.18,
            ((row * 0.5) / 32) * (1 - 0.4 * age),
          );
          s.tint = t.tints[d % t.tints.length] as number;
          s.alpha = 1 - 0.85 * age;
          s.rotation = d * 0.6;
          root.addChild(s);
        }
        root.addChild(
          puffStack(tex, i, i % 4, -1, W * 0.1, y, Math.min(row * 0.95, W * 0.17), false),
        );
        root.addChild(label(t.id, W * 0.1, y + row * 0.3, row * 0.14));
        items++;
      });
      break;
    }
    case 'themes': {
      const g = gridFor(W, H, 4, 3);
      THEMES.forEach((theme, i) => {
        const tt = tex.theme(theme.id);
        const [cx, cy] = cellCentre(g, i);
        const w = g.size * 0.92;
        root.addChild(
          new Graphics()
            .roundRect(cx - w / 2, cy - w / 2, w, w, w * 0.08)
            .fill(theme.hedge)
            .stroke({ width: 2, color: P.OUTLINE }),
        );
        const t = (w * 0.9) / 3;
        const k = t / TEX;
        const x0 = cx - t;
        const y0 = cy - t - w * 0.04;
        const place = (texture: Texture, col: number, row: number): void => {
          root.addChild(sprite(texture, x0 + col * t, y0 + row * t, k));
        };
        place(tt.floor[0], 0, 0);
        place(tt.floor[1], 1, 0);
        place(tt.floor[0], 2, 0);
        place(tt.floor[1], 0, 1);
        place(tt.pillar, 1, 1);
        place(tt.floor[1], 2, 1);
        place(tt.crate, 0, 2);
        place(tt.block, 1, 2);
        place(tt.floor[0], 2, 2);
        root.addChild(label(theme.id, cx, cy + w * 0.38, g.size * 0.1));
        items++;
      });
      break;
    }
    case 'powers': {
      const g = gridFor(W, H, 9, 4);
      for (let k = 1; k <= PICKUP_KIND_COUNT; k++) {
        root.addChild(card(g, k - 1));
        const [cx, cy] = cellCentre(g, k - 1);
        root.addChild(sprite(tex.pickups[k] as Texture, cx, cy, (g.size * 0.9) / TEX));
        items++;
      }
      // Row 2: shield bubble and the four Jinx curses on Puffs.
      const shield = puffStack(tex, 0, 1, -1, 0, 0, g.size * 0.7, false);
      const [sx, sy] = cellCentre(g, 9);
      root.addChild(card(g, 9));
      shield.position.set(sx, sy);
      root.addChild(shield);
      root.addChild(sprite(tex.power.shield, sx, sy, (g.size * 0.9) / TEX));
      items++;
      for (let e = 1; e <= 4; e++) {
        const [jx, jy] = cellCentre(g, 9 + e);
        root.addChild(card(g, 9 + e));
        root.addChild(puffStack(tex, 1, e % 4, -1, jx, jy + g.size * 0.08, g.size * 0.7, false));
        root.addChild(sprite(tex.power.jinxAura, jx, jy + g.size * 0.08, (g.size * 0.9) / TEX));
        root.addChild(
          sprite(tex.power.jinxGlyph[e] as Texture, jx, jy - g.size * 0.34, (g.size * 0.36) / TEX),
        );
        items++;
      }
      // Row 3: floor-mechanic decals.
      const d = tex.decals;
      const decals: Texture[] = [
        d.ice,
        d.belt[0] as Texture,
        d.teleport,
        d.tunnel,
        d.trampoline,
        d.grow,
      ];
      decals.forEach((t, i) => {
        const [cx, cy] = cellCentre(g, 18 + i);
        root.addChild(card(g, 18 + i, THEMES[0]!.floorA));
        root.addChild(sprite(t, cx, cy, (g.size * 0.9) / TEX));
        items++;
      });
      // Row 4: pop on its way (streak) and a kicked pop.
      const [px, py] = cellCentre(g, 27);
      root.addChild(card(g, 27));
      root.addChild(sprite(tex.power.streak, px - g.size * 0.3, py, (g.size * 0.8) / TEX));
      root.addChild(sprite(tex.pop, px, py, (g.size * 0.8) / TEX));
      items++;
      break;
    }
  }
  return { root, items };
}

/** Draws the requested sheet page on `app`'s stage. */
export function startSheetView(app: Application, search: string): void {
  const q = new URLSearchParams(search);
  const requested = q.get('page');
  const page = (SHEET_PAGES as readonly string[]).includes(requested ?? '')
    ? (requested as SheetPage)
    : 'puffs';
  const gray = q.has('gray');
  const tex = bakeArenaTextures(app.renderer);
  const { root, items } = build(app, tex, page);
  app.stage.addChild(root);
  if (gray) app.canvas.style.filter = 'grayscale(1)';
  window.__blastyardSheet = { ready: true, page, items, gray };
}
