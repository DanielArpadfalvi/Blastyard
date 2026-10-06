/**
 * Pixi view of a match: arena tiles, pickups, flames, pops and Puffs.
 *
 * Every frame it extracts a {@link Scene} from the read-only state and copies those numbers onto
 * sprites: static tiles are re-textured only when a cell changes, dynamic things (flames, pops)
 * come from frame pools, and the four Puffs are fixed sprites. The only `Graphics` (side strips
 * and the outer hedge band) is redrawn on layout changes, never per frame.
 */

import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { CELL_COUNT, GRID_H, GRID_W, MAX_SEATS, Tile } from '../core';
import { gridToScreen, type ArenaLayout } from './layout';
import type { TickHistory } from './interpolation';
import * as P from './palette';
import { FramePool } from './pool';
import type { ReadonlySimState } from './readonlyState';
import { Arm, Scene, eyeVariant, extractScene, fuseFrame, type PlayerView } from './scene';
import { BADGE_TEX, FUSE_FRAMES, TEX, type ArenaTextures } from './textures';

/** What is on screen right now (for the e2e test hook and debugging). */
export interface RenderStats {
  readonly tick: number;
  readonly crates: number;
  readonly pillars: number;
  readonly blocks: number;
  readonly pickups: number;
  readonly flames: number;
  readonly pops: number;
  readonly puffs: number;
  readonly ghosts: number;
}

interface PuffSprites {
  readonly root: Container;
  readonly shadow: Sprite;
  readonly body: Sprite;
  readonly eyes: Sprite;
  readonly badge: Sprite;
}

interface PopSprites {
  readonly root: Container;
  readonly body: Sprite;
  readonly ring: Sprite;
}

/** Arm bit → rotation of the right-pointing arm texture. */
const ARM_ROTATION: ReadonlyArray<readonly [number, number]> = [
  [Arm.RIGHT, 0],
  [Arm.DOWN, Math.PI / 2],
  [Arm.LEFT, Math.PI],
  [Arm.UP, -Math.PI / 2],
];

/** Eye offset (texture px) per eye variant: looking up/right/down/left shifts the eyes. */
const EYE_OFFSET: ReadonlyArray<readonly [number, number]> = [
  [0, -4],
  [0, -11],
  [7, -5],
  [0, 1],
  [-7, -5],
  [0, -4],
  [0, -5],
];

function centred(texture: Texture): Sprite {
  const s = new Sprite(texture);
  s.anchor.set(0.5);
  return s;
}

/** A flame cell with exactly one burning neighbour (end of an arm). */
function isTip(arms: number): boolean {
  return arms !== 0 && (arms & (arms - 1)) === 0;
}

function isInterior(x: number, y: number): boolean {
  return x > 0 && y > 0 && x < GRID_W - 1 && y < GRID_H - 1;
}

export class ArenaView {
  readonly root = new Container({ label: 'arena-view' });
  private readonly backdrop = new Graphics();
  private readonly floorLayer = new Container();
  private readonly pickupLayer = new Container();
  private readonly flameLayer = new Container();
  private readonly blockLayer = new Container();
  private readonly popLayer = new Container();
  private readonly puffLayer = new Container();

  private readonly floor: Sprite[] = [];
  private readonly blocks: Sprite[] = [];
  private readonly pickups: Sprite[] = [];
  private readonly shownTiles = new Uint8Array(CELL_COUNT).fill(0xff);
  private readonly shownPickups = new Uint8Array(CELL_COUNT).fill(0xff);
  private readonly flameCores: FramePool<Sprite>;
  private readonly flameArms: FramePool<Sprite>;
  private readonly pops: FramePool<PopSprites>;
  private readonly puffs: PuffSprites[] = [];
  private readonly scene = new Scene();
  private layout: ArenaLayout | undefined;
  /** Burning cells drawn by the latest `render`. */
  private drawnFlames = 0;

  constructor(private readonly tex: ArenaTextures) {
    this.root.addChild(
      this.backdrop,
      this.floorLayer,
      this.pickupLayer,
      this.flameLayer,
      this.blockLayer,
      this.popLayer,
      this.puffLayer,
    );
    for (let c = 0; c < CELL_COUNT; c++) {
      const x = c % GRID_W;
      const y = (c - x) / GRID_W;
      const floor = centred(tex.floor[(x + y) % 2] as Texture);
      floor.visible = isInterior(x, y);
      this.floor.push(floor);
      this.floorLayer.addChild(floor);
      const block = centred(tex.crate);
      block.visible = false;
      this.blocks.push(block);
      this.blockLayer.addChild(block);
      const pickup = centred(tex.pickups[0] as Texture);
      pickup.visible = false;
      this.pickups.push(pickup);
      this.pickupLayer.addChild(pickup);
    }
    const show = (item: { visible: boolean }, visible: boolean): void => {
      item.visible = visible;
    };
    this.flameCores = new FramePool(() => {
      const s = centred(tex.flameCore);
      this.flameLayer.addChild(s);
      return s;
    }, show);
    this.flameArms = new FramePool(() => {
      const s = centred(tex.flameArm);
      // Arms go under the cores so the joints stay round.
      this.flameLayer.addChildAt(s, 0);
      return s;
    }, show);
    this.pops = new FramePool(
      () => {
        const root = new Container();
        const body = centred(tex.pop);
        const ring = centred(tex.fuseRing[FUSE_FRAMES] as Texture);
        root.addChild(body, ring);
        this.popLayer.addChild(root);
        return { root, body, ring };
      },
      (item, visible) => {
        item.root.visible = visible;
      },
    );
    for (let s = 0; s < MAX_SEATS; s++) {
      const root = new Container();
      const shadow = centred(tex.shadow);
      const body = centred(tex.puff[s] as Texture);
      const eyes = centred(tex.eyes[0] as Texture);
      const badge = centred(tex.badge[s] as Texture);
      root.addChild(shadow, body, eyes, badge);
      root.visible = false;
      this.puffLayer.addChild(root);
      this.puffs.push({ root, shadow, body, eyes, badge });
    }
  }

  /** Places the static parts for a new viewport layout. */
  setLayout(layout: ArenaLayout): void {
    this.layout = layout;
    const k = layout.tile / TEX;
    for (let c = 0; c < CELL_COUNT; c++) {
      const x = c % GRID_W;
      const y = (c - x) / GRID_W;
      const sx = gridToScreen(layout, x + 0.5, 'x');
      const sy = gridToScreen(layout, y + 0.5, 'y');
      for (const s of [this.floor[c], this.blocks[c], this.pickups[c]] as Sprite[]) {
        s.position.set(sx, sy);
        s.scale.set(k);
      }
    }
    this.drawBackdrop(layout);
  }

  private drawBackdrop(layout: ArenaLayout): void {
    const g = this.backdrop.clear();
    const inset = Math.max(4, Math.round(layout.tile * 0.12));
    for (const strip of [layout.leftStrip, layout.rightStrip]) {
      if (strip.w <= inset * 2) continue;
      g.roundRect(strip.x + inset, strip.y + inset, strip.w - inset * 2, strip.h - inset * 2, 18)
        .fill(P.STRIP)
        .stroke({ width: 2, color: P.STRIP_EDGE });
    }
    const a = layout.arena;
    const r = Math.max(4, layout.wall);
    g.roundRect(a.x + 2, a.y + 5, a.w, a.h, r).fill({ color: P.SHADOW, alpha: 0.3 });
    g.roundRect(a.x, a.y, a.w, a.h, r)
      .fill(P.HEDGE)
      .stroke({ width: Math.max(2, layout.wall * 0.25), color: P.OUTLINE });
    const i = layout.interior;
    g.rect(i.x - 1, i.y - 1, i.w + 2, i.h + 2).stroke({
      width: Math.max(1.5, layout.wall * 0.2),
      color: P.HEDGE_LIGHT,
    });
  }

  /** Draws `state` (read only) interpolated `alpha` ticks past its latest step. */
  render(state: ReadonlySimState, history: TickHistory, alpha: number): void {
    const layout = this.layout;
    if (!layout) return;
    const scene = extractScene(state, history, alpha, this.scene);
    const k = layout.tile / TEX;
    this.syncCells(scene);

    // Flames.
    this.flameCores.begin();
    this.flameArms.begin();
    for (let f = 0; f < scene.flameCount; f++) {
      const flame = scene.flames[f]!;
      const x = flame.cell % GRID_W;
      const y = (flame.cell - x) / GRID_W;
      const sx = gridToScreen(layout, x + 0.5, 'x');
      const sy = gridToScreen(layout, y + 0.5, 'y');
      // Solid until the last third of its life, then it shrinks and fades out.
      const fade = Math.min(1, flame.strength * 3);
      const girth = 0.7 + 0.3 * flame.strength;
      // Straight runs are drawn as a continuous beam; centres, bends and tips get a round core.
      const straight = flame.arms === (Arm.LEFT | Arm.RIGHT) || flame.arms === (Arm.UP | Arm.DOWN);
      if (!straight) {
        const core = this.flameCores.next();
        core.position.set(sx, sy);
        core.scale.set(k * girth * (flame.arms === 0 || isTip(flame.arms) ? 0.85 : 1));
        core.alpha = fade;
      }
      for (const [bit, rotation] of ARM_ROTATION) {
        if ((flame.arms & bit) === 0) continue;
        const arm = this.flameArms.next();
        arm.position.set(sx, sy);
        arm.rotation = rotation;
        arm.scale.set(k, k * girth);
        arm.alpha = fade;
      }
    }
    this.drawnFlames = scene.flameCount;
    this.flameCores.end();
    this.flameArms.end();

    // Pops.
    this.pops.begin();
    for (let b = 0; b < scene.bombCount; b++) {
      const bomb = scene.bombs[b]!;
      const pop = this.pops.next();
      pop.root.position.set(gridToScreen(layout, bomb.x, 'x'), gridToScreen(layout, bomb.y, 'y'));
      pop.body.texture = bomb.ghost ? this.tex.ghostPop : this.tex.pop;
      pop.body.scale.set(k * bomb.pulse);
      pop.ring.texture = this.tex.fuseRing[fuseFrame(bomb.fuse, FUSE_FRAMES)] as Texture;
      pop.ring.scale.set(k);
    }
    this.pops.end();

    // Puffs.
    for (let s = 0; s < MAX_SEATS; s++) {
      const view = scene.players[s]!;
      const sprites = this.puffs[s]!;
      sprites.root.visible = view.visible;
      if (view.visible) this.placePuff(sprites, view, layout, k);
    }
  }

  private placePuff(sprites: PuffSprites, view: PlayerView, layout: ArenaLayout, k: number): void {
    const x = gridToScreen(layout, view.x, 'x');
    const y = gridToScreen(layout, view.y, 'y');
    sprites.root.position.set(x, y);
    sprites.root.alpha = view.ghost ? 0.55 : 1;
    const tint = view.ghost ? P.GHOST_TINT : 0xffffff;
    sprites.body.tint = tint;
    sprites.shadow.visible = !view.ghost;
    sprites.shadow.scale.set(k * (1 + view.hop * 1.5));
    const hop = view.hop * layout.tile;
    sprites.body.position.set(0, hop);
    sprites.body.scale.set(k * view.scaleX, k * view.scaleY);
    const variant = eyeVariant(view);
    const [ex, ey] = EYE_OFFSET[variant]!;
    sprites.eyes.texture = this.tex.eyes[variant] as Texture;
    sprites.eyes.position.set(ex * k * view.scaleX, hop + ey * k * view.scaleY);
    sprites.eyes.scale.set(k * view.scaleX, k * view.scaleY);
    const badgeScale = Math.max(k * 0.95, 16 / BADGE_TEX);
    sprites.badge.scale.set(badgeScale);
    sprites.badge.position.set(30 * k, hop + 28 * k);
  }

  /** Re-textures the cells whose tile or pickup changed since the last frame. */
  private syncCells(scene: Scene): void {
    for (let c = 0; c < CELL_COUNT; c++) {
      const tile = scene.tiles[c]!;
      if (tile !== this.shownTiles[c]) {
        this.shownTiles[c] = tile;
        const x = c % GRID_W;
        const y = (c - x) / GRID_W;
        const sprite = this.blocks[c]!;
        // The outer wall is the hedge band of the backdrop, not per-cell sprites.
        sprite.visible = tile !== Tile.FLOOR && isInterior(x, y);
        if (tile === Tile.CRATE) sprite.texture = this.tex.crate;
        else if (tile === Tile.PILLAR) sprite.texture = this.tex.pillar;
        else if (tile === Tile.WALL) sprite.texture = this.tex.block;
      }
      const pickup = scene.pickups[c]!;
      if (pickup !== this.shownPickups[c]) {
        this.shownPickups[c] = pickup;
        const sprite = this.pickups[c]!;
        sprite.visible = pickup !== 0;
        if (pickup !== 0) sprite.texture = this.tex.pickups[pickup] as Texture;
      }
    }
  }

  /** What the latest `render` put on screen (counted from the sprites, not from the state). */
  getStats(): RenderStats {
    const scene = this.scene;
    let crates = 0;
    let pillars = 0;
    let blocks = 0;
    let pickups = 0;
    for (let c = 0; c < CELL_COUNT; c++) {
      if (!this.blocks[c]!.visible) {
        if (this.pickups[c]!.visible) pickups++;
        continue;
      }
      const texture = this.blocks[c]!.texture;
      if (texture === this.tex.crate) crates++;
      else if (texture === this.tex.pillar) pillars++;
      else blocks++;
    }
    let puffs = 0;
    let ghosts = 0;
    for (let s = 0; s < MAX_SEATS; s++) {
      if (!this.puffs[s]!.root.visible) continue;
      if (scene.players[s]!.ghost) ghosts++;
      else puffs++;
    }
    return {
      tick: scene.tick,
      crates,
      pillars,
      blocks,
      pickups,
      flames: this.drawnFlames,
      pops: this.pops.active,
      puffs,
      ghosts,
    };
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
