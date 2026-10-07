/**
 * Pixi view of a match: arena tiles, pickups, flames, pops, Puffs and the game-feel effects.
 *
 * Every frame it extracts a {@link Scene} from the read-only state and copies those numbers onto
 * sprites: static tiles are re-textured only when a cell changes, dynamic things (flames, pops,
 * particles, falling blocks) come from frame pools, and the four Puffs are fixed sprites. The
 * only `Graphics` (side strips and the outer hedge band) is redrawn on layout changes, never per
 * frame. Effects (T3.1) come from simulation events via {@link ArenaView.pushEvents}; the arena
 * (not the side strips) shakes.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  CELL_COUNT,
  Dir,
  EventKind,
  FloorFx,
  GRID_H,
  GRID_W,
  GROW_INTERVAL,
  Hdr,
  MAX_MONSTERS,
  MAX_SEATS,
  Mech,
  Monster,
  SPIRAL,
  Tile,
  beltDir,
  type SimEvent,
} from '../core';
import {
  TRAILS,
  defaultAppearance,
  hatIndex,
  popSkinIndex,
  puffIndex,
  trailIndex,
  type Appearance,
} from '../content/cosmetics';
import {
  BLOCK_DROP_HEIGHT,
  DEFAULT_FX,
  Effects,
  Fx,
  type FxFrame,
  type FxSettings,
} from './effects';
import { gridToScreen, type ArenaLayout } from './layout';
import type { TickHistory } from './interpolation';
import * as P from './palette';
import { FramePool } from './pool';
import type { ReadonlySimState } from './readonlyState';
import {
  Arm,
  EYE_SCARED,
  Scene,
  eyeVariant,
  extractScene,
  fuseFrame,
  type PlayerView,
} from './scene';
import { themeFor, type Theme } from './themes';
import {
  BADGE_TEX,
  FUSE_FRAMES,
  FX_TEX,
  TEX,
  type ArenaTextures,
  type ThemeTextures,
} from './textures';

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

/** Effect state on screen (e2e hook, tests). */
export interface FxStats {
  readonly particles: number;
  /** Shake offset length in px. */
  readonly shake: number;
  readonly flash: number;
  readonly drops: number;
  readonly deaths: number;
  readonly spawned: number;
  readonly reducedMotion: boolean;
  readonly quality: number;
}

/** The next sudden-death block is marked this many ticks before it falls. */
export const DROP_WARNING_TICKS = 30;
const HOT_TINT = 0xff8a7a;

interface PuffSprites {
  readonly root: Container;
  readonly shadow: Sprite;
  readonly body: Sprite;
  readonly hat: Sprite;
  readonly eyes: Sprite;
  readonly badge: Sprite;
  readonly aura: Sprite;
  readonly shield: Sprite;
  readonly glyph: Sprite;
}

/** A floor-mechanic decal sprite (static position, animated per frame). */
interface Decal {
  readonly cell: number;
  readonly fx: number;
  readonly sprite: Sprite;
}

/** A bomb flight (toss or trampoline hop): animated from the origin cell to the landing cell. */
interface Flight {
  start: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/** One trail particle (render-only; positions in tiles, ages in sim ticks). */
interface TrailDot {
  born: number;
  x: number;
  y: number;
  trail: number;
  tint: number;
}

/** Flight length in sim ticks and apex height in tiles. */
export const FLIGHT_TICKS = 22;
export const FLIGHT_HEIGHT = 1.3;
const MAX_FLIGHTS = 8;
const MAX_TRAIL = 64;

interface PopSprites {
  readonly root: Container;
  readonly body: Sprite;
  readonly ring: Sprite;
}

interface DeathSprites {
  readonly root: Container;
  readonly body: Sprite;
  readonly eyes: Sprite;
}

/** Arm bit → rotation of the right-pointing arm texture. */
const ARM_ROTATION: ReadonlyArray<readonly [number, number]> = [
  [Arm.RIGHT, 0],
  [Arm.DOWN, Math.PI / 2],
  [Arm.LEFT, Math.PI],
  [Arm.UP, -Math.PI / 2],
];

/** Rotation of the right-pointing belt decal per belt direction (`Dir`). */
const BELT_ROTATION: readonly number[] = [0, -Math.PI / 2, 0, Math.PI / 2, Math.PI];

/** Trail particle kind → particle texture. */
const TRAIL_FX = {
  dust: Fx.DUST,
  spark: Fx.SPARK,
  star: Fx.STAR,
  confetti: Fx.CONFETTI,
  smoke: Fx.SMOKE,
};

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
  /** Everything that shakes (the arena), above the static side strips. */
  private readonly world = new Container({ label: 'arena-world' });
  private readonly backdrop = new Graphics();
  private readonly band = new Graphics();
  private readonly floorLayer = new Container();
  private readonly decalLayer = new Container();
  private readonly trailLayer = new Container();
  private readonly markLayer = new Container();
  private readonly pickupLayer = new Container();
  private readonly flameLayer = new Container();
  private readonly blockLayer = new Container();
  private readonly popLayer = new Container();
  private readonly monsterLayer = new Container();
  private readonly puffLayer = new Container();
  private readonly deathLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly fallLayer = new Container();
  private readonly flashSprite = new Sprite(Texture.WHITE);
  private readonly dropTarget: Sprite;
  private readonly particles: FramePool<Sprite>;
  private readonly falling: FramePool<Sprite>;
  private readonly dropShadows: FramePool<Sprite>;
  private readonly deaths: DeathSprites[] = [];
  readonly effects = new Effects();
  /** Static block sprites hidden while their falling copy is in the air. */
  private readonly hiddenForDrop = new Uint8Array(CELL_COUNT);
  private readonly hiddenNow = new Uint8Array(CELL_COUNT);
  private fxFrame: FxFrame | undefined;

  private themeTex: ThemeTextures;
  private theme: Theme;
  private readonly decals: Decal[] = [];
  private mech = 0;
  private drawnFlights = 0;
  private growCells: number[] = [];
  private readonly streaks: FramePool<Sprite>;
  private readonly trailSprites: FramePool<Sprite>;
  private readonly flights: Flight[] = [];
  private readonly trail: TrailDot[] = [];
  private readonly lastTrail = new Int32Array(MAX_SEATS).fill(-1000);
  private readonly look: Appearance[] = Array.from({ length: MAX_SEATS }, (_, s) =>
    defaultAppearance(s),
  );
  private readonly floor: Sprite[] = [];
  private readonly blocks: Sprite[] = [];
  private readonly pickups: Sprite[] = [];
  private readonly shownTiles = new Uint8Array(CELL_COUNT).fill(0xff);
  private readonly shownPickups = new Uint8Array(CELL_COUNT).fill(0xff);
  private readonly flameCores: FramePool<Sprite>;
  private readonly flameArms: FramePool<Sprite>;
  private readonly pops: FramePool<PopSprites>;
  private readonly puffs: PuffSprites[] = [];
  private readonly monsters: Array<{ root: Container; body: Sprite; shadow: Sprite }> = [];
  private readonly flagSprite: Sprite;
  private flagCell = 0;
  private readonly scene = new Scene();
  private layout: ArenaLayout | undefined;
  /** Burning cells drawn by the latest `render`. */
  private drawnFlames = 0;

  constructor(
    private readonly tex: ArenaTextures,
    fx: FxSettings = DEFAULT_FX,
  ) {
    this.effects.setSettings(fx);
    this.themeTex = tex.theme('garden');
    this.theme = this.themeTex.theme;
    this.root.addChild(this.backdrop, this.world);
    this.world.addChild(
      this.band,
      this.floorLayer,
      this.decalLayer,
      this.markLayer,
      this.pickupLayer,
      this.flameLayer,
      this.blockLayer,
      this.trailLayer,
      this.popLayer,
      this.monsterLayer,
      this.puffLayer,
      this.deathLayer,
      this.fxLayer,
      this.fallLayer,
      this.flashSprite,
    );
    this.flashSprite.visible = false;
    this.flashSprite.tint = 0xfffbe8;
    this.dropTarget = centred(tex.dropTarget);
    this.dropTarget.visible = false;
    this.markLayer.addChild(this.dropTarget);
    this.flagSprite = centred(tex.flag);
    this.flagSprite.visible = false;
    this.markLayer.addChild(this.flagSprite);
    for (let i = 0; i < MAX_MONSTERS; i++) {
      const root = new Container();
      const shadow = centred(tex.shadow);
      const body = centred(tex.monsters[1] as Texture);
      root.addChild(shadow, body);
      root.visible = false;
      this.monsterLayer.addChild(root);
      this.monsters.push({ root, body, shadow });
    }
    for (let c = 0; c < CELL_COUNT; c++) {
      const x = c % GRID_W;
      const y = (c - x) / GRID_W;
      const floor = centred(this.themeTex.floor[(x + y) % 2] as Texture);
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
    this.particles = new FramePool(() => {
      const s = centred(tex.particles[0] as Texture);
      this.fxLayer.addChild(s);
      return s;
    }, show);
    this.falling = new FramePool(() => {
      const s = centred(tex.block);
      this.fallLayer.addChild(s);
      return s;
    }, show);
    this.streaks = new FramePool(() => {
      const s = centred(tex.power.streak);
      this.trailLayer.addChild(s);
      return s;
    }, show);
    this.trailSprites = new FramePool(() => {
      const s = centred(tex.particles[0] as Texture);
      this.trailLayer.addChild(s);
      return s;
    }, show);
    this.dropShadows = new FramePool(() => {
      const s = centred(tex.dropShadow);
      this.markLayer.addChild(s);
      return s;
    }, show);
    for (let s = 0; s < MAX_SEATS; s++) {
      const root = new Container();
      const body = centred(tex.puff[s] as Texture);
      const eyes = centred(tex.eyes[EYE_SCARED] as Texture);
      root.addChild(body, eyes);
      root.visible = false;
      this.deathLayer.addChild(root);
      this.deaths.push({ root, body, eyes });
    }
    for (let s = 0; s < MAX_SEATS; s++) {
      const root = new Container();
      const shadow = centred(tex.shadow);
      const body = centred(tex.puff[s] as Texture);
      const hat = centred(tex.hatOf(0));
      hat.visible = false;
      const eyes = centred(tex.eyes[0] as Texture);
      const badge = centred(tex.badge[s] as Texture);
      const aura = centred(tex.power.jinxAura);
      const shield = centred(tex.power.shield);
      const glyph = centred(tex.power.jinxGlyph[1] as Texture);
      aura.visible = false;
      shield.visible = false;
      glyph.visible = false;
      root.addChild(shadow, aura, body, eyes, hat, shield, badge, glyph);
      root.visible = false;
      this.puffLayer.addChild(root);
      this.puffs.push({ root, shadow, body, hat, eyes, badge, aura, shield, glyph });
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
    for (const d of this.decals) this.placeDecal(d, layout);
    this.placeFlag();
    this.drawBackdrop(layout);
  }

  private placeFlag(): void {
    const layout = this.layout;
    this.flagSprite.visible = this.flagCell > 0 && layout !== undefined;
    if (!layout || this.flagCell <= 0) return;
    const x = this.flagCell % GRID_W;
    const y = (this.flagCell - x) / GRID_W;
    this.flagSprite.position.set(
      gridToScreen(layout, x + 0.5, 'x'),
      gridToScreen(layout, y + 0.5, 'y'),
    );
    this.flagSprite.scale.set(layout.tile / TEX);
  }

  /**
   * Binds the view to a match: picks the arena theme and builds the floor-mechanic decals
   * (ice, belts, teleports, tunnels, trampolines, growing pillars) from the state's floor layer.
   */
  bindArena(state: ReadonlySimState, themeId: string): void {
    this.setTheme(themeId);
    for (const d of this.decals) d.sprite.destroy();
    this.decals.length = 0;
    this.decalLayer.removeChildren();
    this.mech = state.hdr[Hdr.MECH] as number;
    this.flagCell = state.hdr[Hdr.GOAL_CELL] as number;
    this.placeFlag();
    this.growCells = [];
    const dec = this.tex.decals;
    for (let c = 0; c < CELL_COUNT; c++) {
      const fx = state.floor[c] as number;
      if (fx === FloorFx.NONE) continue;
      if (fx === FloorFx.GROW) this.growCells.push(c);
      const texture =
        fx === FloorFx.ICE
          ? dec.ice
          : beltDir(fx) !== 0
            ? (dec.belt[0] as Texture)
            : fx === FloorFx.TELEPORT
              ? dec.teleport
              : fx === FloorFx.TUNNEL
                ? dec.tunnel
                : fx === FloorFx.TRAMPOLINE
                  ? dec.trampoline
                  : dec.grow;
      const sprite = centred(texture);
      const x = c % GRID_W;
      const y = (c - x) / GRID_W;
      if (fx === FloorFx.TUNNEL) {
        // The mouth opens towards the arena: right on the left side, left on the right side…
        sprite.rotation =
          x === 0 ? 0 : x === GRID_W - 1 ? Math.PI : y === 0 ? Math.PI / 2 : -Math.PI / 2;
      } else if (beltDir(fx) !== 0) {
        sprite.rotation = BELT_ROTATION[beltDir(fx)] as number;
      }
      this.decalLayer.addChild(sprite);
      const decal: Decal = { cell: c, fx, sprite };
      this.decals.push(decal);
      if (this.layout) this.placeDecal(decal, this.layout);
    }
  }

  private placeDecal(d: Decal, layout: ArenaLayout): void {
    const x = d.cell % GRID_W;
    const y = (d.cell - x) / GRID_W;
    d.sprite.position.set(gridToScreen(layout, x + 0.5, 'x'), gridToScreen(layout, y + 0.5, 'y'));
    d.sprite.scale.set(layout.tile / TEX);
  }

  /** Swaps the tile set (floor, pillars, crates, blocks, hedge colours) to an arena theme. */
  setTheme(id: string): void {
    this.themeTex = this.tex.theme(id);
    this.theme = themeFor(id);
    for (let c = 0; c < CELL_COUNT; c++) {
      const x = c % GRID_W;
      const y = (c - x) / GRID_W;
      this.floor[c]!.texture = this.themeTex.floor[(x + y) % 2] as Texture;
    }
    this.shownTiles.fill(0xff);
    if (this.layout) this.drawBackdrop(this.layout);
  }

  /** What `seat` wears: Puff, hat, pop skin and trail (cosmetic only). */
  setAppearance(seat: number, appearance: Appearance): void {
    this.look[seat] = appearance;
    const sprites = this.puffs[seat];
    if (!sprites) return;
    sprites.body.texture = this.tex.puffOf(puffIndex(appearance.puff), seat);
    const deathBody = this.deaths[seat]?.body;
    if (deathBody) deathBody.texture = sprites.body.texture;
    const hat = hatIndex(appearance.hat);
    sprites.hat.visible = hat >= 0;
    if (hat >= 0) sprites.hat.texture = this.tex.hatOf(hat);
  }

  /** Effect settings (reduced motion, quality); applies to effects spawned from now on. */
  setFx(settings: FxSettings): void {
    this.effects.setSettings(settings);
  }

  /** One simulated tick's events; `state` is the state right after that tick (read only). */
  pushEvents(events: readonly SimEvent[], state: ReadonlySimState): void {
    this.effects.push(events, state);
    for (const e of events) {
      if (e.kind !== EventKind.BOMB_TOSSED) continue;
      const to = e.cell;
      const from = e.value;
      const flight: Flight = {
        start: e.tick,
        fromX: (from % GRID_W) + 0.5,
        fromY: (from - (from % GRID_W)) / GRID_W + 0.5,
        toX: (to % GRID_W) + 0.5,
        toY: (to - (to % GRID_W)) / GRID_W + 0.5,
      };
      if (this.flights.length >= MAX_FLIGHTS) this.flights.shift();
      this.flights.push(flight);
    }
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
    const band = this.band.clear();
    band.roundRect(a.x + 2, a.y + 5, a.w, a.h, r).fill({ color: P.SHADOW, alpha: 0.3 });
    band
      .roundRect(a.x, a.y, a.w, a.h, r)
      .fill(this.theme.hedge)
      .stroke({ width: Math.max(2, layout.wall * 0.25), color: P.OUTLINE });
    const i = layout.interior;
    band.rect(i.x - 1, i.y - 1, i.w + 2, i.h + 2).stroke({
      width: Math.max(1.5, layout.wall * 0.2),
      color: this.theme.hedgeLight,
    });
    this.flashSprite.position.set(a.x, a.y);
    this.flashSprite.width = a.w;
    this.flashSprite.height = a.h;
  }

  /** Draws `state` (read only) interpolated `alpha` ticks past its latest step. */
  render(state: ReadonlySimState, history: TickHistory, alpha: number): void {
    const layout = this.layout;
    if (!layout) return;
    const scene = extractScene(state, history, alpha, this.scene);
    const k = layout.tile / TEX;
    const time = scene.tick + scene.alpha;
    const fx = this.effects.update(time);
    this.fxFrame = fx;
    const lively = this.effects.getSettings().quality > 0;
    this.syncCells(scene);
    this.world.position.set(fx.shakeX, fx.shakeY);
    if (lively) this.bobPickups(scene, k, time);
    this.animateDecals(state, scene, k, time, lively);

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
      const flicker = lively ? 1 + 0.06 * Math.sin(time * 1.3 + flame.cell * 1.7) : 1;
      const girth = (0.7 + 0.3 * flame.strength) * flicker;
      // Straight runs are drawn as a continuous beam; centres, bends and tips get a round core.
      const straight = flame.arms === (Arm.LEFT | Arm.RIGHT) || flame.arms === (Arm.UP | Arm.DOWN);
      if (!straight) {
        const core = this.flameCores.next();
        core.position.set(sx, sy);
        core.scale.set(k * girth * (flame.arms === 0 || isTip(flame.arms) ? 0.85 : 1));
        core.alpha = fade;
      }
      for (let a = 0; a < ARM_ROTATION.length; a++) {
        const [bit, rotation] = ARM_ROTATION[a] as readonly [number, number];
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
    this.streaks.begin();
    this.drawnFlights = 0;
    for (let b = 0; b < scene.bombCount; b++) {
      const bomb = scene.bombs[b]!;
      const pop = this.pops.next();
      let bx = bomb.x;
      let by = bomb.y;
      let lift = 0;
      let grow = 1;
      const flight = this.flightOf(bomb.x, bomb.y, time);
      if (flight) {
        this.drawnFlights++;
        const t = Math.min(1, (time - flight.start) / FLIGHT_TICKS);
        bx = flight.fromX + (flight.toX - flight.fromX) * t;
        by = flight.fromY + (flight.toY - flight.fromY) * t;
        lift = Math.sin(t * Math.PI) * FLIGHT_HEIGHT;
        grow = 1 + 0.3 * Math.sin(t * Math.PI);
      }
      pop.root.position.set(
        gridToScreen(layout, bx, 'x'),
        gridToScreen(layout, by, 'y') - lift * layout.tile,
      );
      pop.body.texture = bomb.ghost
        ? this.tex.ghostPop
        : this.tex.popOf(popSkinIndex(this.look[bomb.owner]?.pop ?? 'classic'));
      let sx = grow;
      let sy = grow;
      if (bomb.slide !== 0) {
        // A sliding pop stretches along its path and leaves a speed streak behind it.
        const horizontal = bomb.slide === Dir.LEFT || bomb.slide === Dir.RIGHT;
        if (horizontal) sx *= 1.16;
        else sy *= 1.16;
        const streak = this.streaks.next();
        const back = bomb.slide === Dir.RIGHT || bomb.slide === Dir.DOWN ? -1 : 1;
        streak.position.set(
          gridToScreen(layout, bx + (horizontal ? back * 0.62 : 0), 'x'),
          gridToScreen(layout, by + (horizontal ? 0 : back * 0.62), 'y'),
        );
        streak.rotation = horizontal ? 0 : Math.PI / 2;
        streak.scale.set(k * 0.9);
        streak.alpha = 0.55 + 0.25 * Math.sin(time * 0.9);
      }
      pop.body.scale.set(k * bomb.pulse * sx, k * bomb.pulse * sy);
      pop.body.tint = bomb.hot ? HOT_TINT : 0xffffff;
      pop.ring.texture = this.tex.fuseRing[fuseFrame(bomb.fuse, FUSE_FRAMES)] as Texture;
      pop.ring.scale.set(k * grow);
    }
    this.pops.end();
    this.streaks.end();
    this.drawTrails(scene, layout, k, time);

    // Puffs.
    for (let s = 0; s < MAX_SEATS; s++) {
      const view = scene.players[s]!;
      const sprites = this.puffs[s]!;
      sprites.root.visible = view.visible;
      if (view.visible) {
        this.placePuff(
          sprites,
          view,
          layout,
          k,
          fx.pulseX[s] as number,
          fx.pulseY[s] as number,
          time,
        );
      }
    }

    this.drawMonsters(state, layout, k, alpha, time, lively);
    this.drawEffects(state, fx, layout, k, time);
  }

  /** Challenge monsters: walk (or hop) from their tile to the next, wobble while resting. */
  private drawMonsters(
    state: ReadonlySimState,
    layout: ArenaLayout,
    k: number,
    alpha: number,
    time: number,
    lively: boolean,
  ): void {
    for (let i = 0; i < MAX_MONSTERS; i++) {
      const sprites = this.monsters[i] as { root: Container; body: Sprite; shadow: Sprite };
      const kind = state.monKind[i] as number;
      if (kind === Monster.NONE || !state.monAlive[i]) {
        sprites.root.visible = false;
        continue;
      }
      sprites.root.visible = true;
      sprites.body.texture = this.tex.monsters[kind] as Texture;
      const from = state.monCell[i] as number;
      const to = state.monNext[i] as number;
      const span = Math.max(1, state.monSpan[i] as number);
      const progress =
        to === from
          ? 0
          : Math.min(1, Math.max(0, (span - (state.monTimer[i] as number) + alpha) / span));
      const fx0 = from % GRID_W;
      const fy0 = (from - fx0) / GRID_W;
      const tx0 = to % GRID_W;
      const ty0 = (to - tx0) / GRID_W;
      const x = fx0 + (tx0 - fx0) * progress + 0.5;
      const y = fy0 + (ty0 - fy0) * progress + 0.5;
      const hop = state.monJump[i] ? Math.sin(progress * Math.PI) : 0;
      const wobble = lively ? 1 + 0.05 * Math.sin(time * 0.22 + i * 1.7) : 1;
      sprites.root.position.set(
        gridToScreen(layout, x, 'x'),
        gridToScreen(layout, y, 'y') - hop * 0.7 * layout.tile,
      );
      sprites.body.scale.set(k * 0.86 * wobble, k * 0.86 * (2 - wobble));
      sprites.shadow.scale.set(k * (0.8 - 0.25 * hop));
      sprites.shadow.position.set(0, hop * 0.7 * layout.tile);
    }
  }

  /** Particles, falling blocks, the next-drop marker, eliminations and the flash. */
  private drawEffects(
    state: ReadonlySimState,
    fx: FxFrame,
    layout: ArenaLayout,
    k: number,
    time: number,
  ): void {
    this.particles.begin();
    const pk = layout.tile / FX_TEX;
    for (let i = 0; i < fx.count; i++) {
      const sprite = this.particles.next();
      sprite.texture = this.tex.particles[fx.kind[i] as number] as Texture;
      sprite.position.set(
        gridToScreen(layout, fx.x[i] as number, 'x'),
        gridToScreen(layout, fx.y[i] as number, 'y'),
      );
      sprite.rotation = fx.rotation[i] as number;
      sprite.scale.set((fx.scale[i] as number) * pk);
      sprite.alpha = fx.alpha[i] as number;
      sprite.tint = fx.tint[i] as number;
    }
    this.particles.end();

    // Sudden-death blocks: the static block stays hidden while its copy falls in.
    this.hiddenNow.fill(0);
    this.falling.begin();
    this.dropShadows.begin();
    for (let d = 0; d < fx.dropCount; d++) {
      const cell = fx.dropCell[d] as number;
      const p = fx.dropProgress[d] as number;
      if (p >= 1) continue;
      const x = cell % GRID_W;
      const y = (cell - x) / GRID_W;
      const sx = gridToScreen(layout, x + 0.5, 'x');
      const sy = gridToScreen(layout, y + 0.5, 'y');
      this.hiddenNow[cell] = 1;
      const block = this.falling.next();
      block.texture = this.themeTex.block;
      block.position.set(sx, sy - (1 - p * p) * BLOCK_DROP_HEIGHT * layout.tile);
      block.scale.set(k * (1.18 - 0.18 * p));
      const shadow = this.dropShadows.next();
      shadow.position.set(sx, sy);
      shadow.scale.set(k * (0.45 + 0.55 * p));
      shadow.alpha = 0.35 + 0.65 * p;
    }
    this.falling.end();
    this.dropShadows.end();
    for (let c = 0; c < CELL_COUNT; c++) {
      const hide = this.hiddenNow[c] as number;
      if (hide === this.hiddenForDrop[c]) continue;
      this.hiddenForDrop[c] = hide;
      const x = c % GRID_W;
      const y = (c - x) / GRID_W;
      const tile = this.shownTiles[c] as number;
      this.blocks[c]!.visible =
        hide === 0 && tile !== Tile.FLOOR && tile !== 0xff && isInterior(x, y);
    }

    // Marker on the cell the next sudden-death block falls on.
    const sdTimer = state.hdr[Hdr.SD_TIMER] as number;
    const sdIndex = state.hdr[Hdr.SD_INDEX] as number;
    const next = sdIndex < SPIRAL.length ? (SPIRAL[sdIndex] as number) : -1;
    const nextTile = next >= 0 ? (state.tiles[next] as number) : Tile.WALL;
    const warn =
      sdTimer > 0 &&
      sdTimer <= DROP_WARNING_TICKS &&
      (nextTile === Tile.FLOOR || nextTile === Tile.CRATE);
    this.dropTarget.visible = warn;
    if (warn) {
      const x = next % GRID_W;
      const y = (next - x) / GRID_W;
      this.dropTarget.position.set(
        gridToScreen(layout, x + 0.5, 'x'),
        gridToScreen(layout, y + 0.5, 'y'),
      );
      this.dropTarget.scale.set(k * (0.92 + 0.06 * Math.sin(time * 0.6)));
      this.dropTarget.alpha = 0.55 + 0.45 * (1 - sdTimer / DROP_WARNING_TICKS);
    }

    // Eliminated Puffs deflate where they fell.
    for (let s = 0; s < MAX_SEATS; s++) {
      const d = this.deaths[s]!;
      const p = fx.deathProgress[s] as number;
      d.root.visible = p >= 0;
      if (p < 0) continue;
      d.root.position.set(
        gridToScreen(layout, fx.deathX[s] as number, 'x'),
        gridToScreen(layout, fx.deathY[s] as number, 'y') + p * 0.25 * layout.tile,
      );
      const sx = 1 + 0.4 * p;
      const sy = Math.max(0.12, 1 - 0.88 * p);
      d.body.scale.set(k * sx, k * sy);
      d.eyes.scale.set(k * sx, k * sy);
      d.eyes.position.set(0, -4 * k * sy);
      d.root.rotation = 0.25 * Math.sin(p * Math.PI * 3) * (1 - p);
      d.root.alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    }

    this.flashSprite.visible = fx.flash > 0.005;
    this.flashSprite.alpha = fx.flash;
  }

  /** Open pickups bob gently so they read as collectible. */
  private bobPickups(scene: Scene, k: number, time: number): void {
    for (let c = 0; c < CELL_COUNT; c++) {
      if (scene.pickups[c] === 0) continue;
      this.pickups[c]!.scale.set(k * (1 + 0.045 * Math.sin(time * 0.12 + c * 0.9)));
    }
  }

  private placePuff(
    sprites: PuffSprites,
    view: PlayerView,
    layout: ArenaLayout,
    k: number,
    pulseX: number,
    pulseY: number,
    time: number,
  ): void {
    const x = gridToScreen(layout, view.x, 'x');
    const y = gridToScreen(layout, view.y, 'y');
    sprites.root.position.set(x, y);
    sprites.root.rotation = view.rotation;
    sprites.root.alpha = view.ghost ? 0.55 : 1;
    // After a Shield broke the Puff flickers while it is invulnerable.
    if (view.invuln > 0 && Math.floor(time / 3) % 2 === 0) sprites.root.alpha = 0.45;
    const tint = view.ghost ? P.GHOST_TINT : 0xffffff;
    sprites.body.tint = tint;
    sprites.shadow.visible = !view.ghost;
    sprites.shadow.scale.set(k * (1 + view.hop * 1.5));
    const hop = view.hop * layout.tile;
    const sx = view.scaleX * pulseX;
    const sy = view.scaleY * pulseY;
    // Squash anchors at the feet: a flatter body sits lower.
    const sink = (1 - sy) * 0.3 * layout.tile;
    sprites.body.position.set(0, hop + sink);
    sprites.body.scale.set(k * sx, k * sy);
    const variant = eyeVariant(view);
    const [ex, ey] = EYE_OFFSET[variant]!;
    sprites.eyes.texture = this.tex.eyes[variant] as Texture;
    sprites.eyes.position.set(ex * k * sx, hop + sink + ey * k * sy);
    sprites.eyes.scale.set(k * sx, k * sy);
    const badgeScale = Math.max(k * 0.95, 16 / BADGE_TEX);
    sprites.badge.scale.set(badgeScale);
    sprites.badge.position.set(30 * k, hop + 28 * k);
    sprites.hat.position.set(0, hop + sink);
    sprites.hat.scale.set(k * sx, k * sy);
    sprites.hat.tint = tint;
    // Shield bubble around the Puff.
    sprites.shield.visible = view.shield && !view.ghost;
    if (sprites.shield.visible) {
      sprites.shield.position.set(0, hop);
      sprites.shield.scale.set(k * (1.04 + 0.04 * Math.sin(time * 0.2)));
    }
    // Jinx: a purple aura turning around the Puff and the curse's glyph above its head.
    const cursed = view.jinx !== 0 && !view.ghost;
    sprites.aura.visible = cursed;
    sprites.glyph.visible = cursed;
    if (cursed) {
      sprites.aura.position.set(0, hop);
      sprites.aura.rotation = time * 0.07;
      sprites.aura.scale.set(k * (1.05 + 0.05 * Math.sin(time * 0.3)));
      sprites.glyph.texture = this.tex.power.jinxGlyph[view.jinx] as Texture;
      sprites.glyph.position.set(0, hop - 0.86 * layout.tile + 2 * Math.sin(time * 0.25) * k);
      sprites.glyph.scale.set(k * 0.46);
      sprites.glyph.rotation = -view.rotation;
    }
  }

  /** The flight a pop at (x, y) tiles is part of, or undefined (drops finished flights). */
  private flightOf(x: number, y: number, time: number): Flight | undefined {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]!;
      const age = time - f.start;
      if (age >= FLIGHT_TICKS || age < -1) {
        this.flights.splice(i, 1);
        continue;
      }
      if (Math.abs(f.toX - x) < 0.02 && Math.abs(f.toY - y) < 0.02) return f;
    }
    return undefined;
  }

  /** Belts scroll, teleports turn, trampolines breathe, cracked ground warns before a pillar grows. */
  private animateDecals(
    state: ReadonlySimState,
    scene: Scene,
    k: number,
    time: number,
    lively: boolean,
  ): void {
    if (this.decals.length === 0) return;
    const frame = lively ? Math.floor(time / 3) % 3 : 0;
    let next = -1;
    const growTimer = state.hdr[Hdr.GROW_TIMER] as number;
    if ((this.mech & Mech.GROW) !== 0 && growTimer > 0 && growTimer <= GROW_INTERVAL) {
      for (const c of this.growCells) {
        if (scene.tiles[c] === Tile.FLOOR) {
          next = c;
          break;
        }
      }
    }
    for (const d of this.decals) {
      const s = d.sprite;
      if (d.fx === FloorFx.TELEPORT) {
        if (lively) s.rotation = time * 0.05 * (d.cell % 2 === 0 ? 1 : -1);
      } else if (d.fx === FloorFx.TRAMPOLINE) {
        s.scale.set(k * (lively ? 1 + 0.05 * Math.sin(time * 0.2 + d.cell) : 1));
      } else if (d.fx === FloorFx.GROW) {
        s.visible = scene.tiles[d.cell] === Tile.FLOOR;
        const warn = d.cell === next;
        s.scale.set(k * (warn ? 1.05 + 0.08 * Math.sin(time * 1.4) : 1));
        s.alpha = warn ? 1 : 0.8;
        s.rotation = warn ? 0.06 * Math.sin(time * 1.7) : 0;
      } else if (beltDir(d.fx) !== 0) {
        s.texture = this.tex.decals.belt[frame] as Texture;
      }
    }
  }

  /** Trail particles behind moving Puffs that wear a trail. */
  private drawTrails(scene: Scene, layout: ArenaLayout, k: number, time: number): void {
    void k;
    const tick = scene.tick;
    for (let s = 0; s < MAX_SEATS; s++) {
      const ti = trailIndex(this.look[s]!.trail);
      const view = scene.players[s]!;
      if (ti < 0 || !view.visible || view.ghost || !view.moving) continue;
      const def = TRAILS[ti]!;
      if (tick < this.lastTrail[s]!) this.lastTrail[s] = tick - def.interval;
      if (tick - this.lastTrail[s]! < def.interval) continue;
      this.lastTrail[s] = tick;
      if (this.trail.length >= MAX_TRAIL) this.trail.shift();
      this.trail.push({
        born: tick,
        x: view.x,
        y: view.y + 0.28,
        trail: ti,
        tint: def.tints[Math.floor(tick / def.interval) % def.tints.length] as number,
      });
    }
    this.trailSprites.begin();
    const pk = layout.tile / FX_TEX;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const dot = this.trail[i]!;
      const def = TRAILS[dot.trail]!;
      const age = time - dot.born;
      if (age >= def.life || age < 0) {
        this.trail.splice(i, 1);
        continue;
      }
      const t = age / def.life;
      const sprite = this.trailSprites.next();
      sprite.texture = this.tex.particles[TRAIL_FX[def.particle]] as Texture;
      sprite.position.set(
        gridToScreen(layout, dot.x, 'x'),
        gridToScreen(layout, dot.y - 0.12 * t, 'y'),
      );
      sprite.rotation = age * 0.12;
      sprite.scale.set(pk * 0.5 * (1 - 0.45 * t));
      sprite.alpha = 0.85 * (1 - t);
      sprite.tint = dot.tint;
    }
    this.trailSprites.end();
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
        sprite.visible = tile !== Tile.FLOOR && isInterior(x, y) && this.hiddenForDrop[c] === 0;
        if (tile === Tile.CRATE) sprite.texture = this.themeTex.crate;
        else if (tile === Tile.PILLAR) sprite.texture = this.themeTex.pillar;
        else if (tile === Tile.WALL) sprite.texture = this.themeTex.block;
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
      if (texture === this.themeTex.crate) crates++;
      else if (texture === this.themeTex.pillar) pillars++;
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

  /** Power-up visuals drawn by the latest `render`. */
  getPowerStats(): { shields: number; curses: number; sliding: number; flying: number } {
    let shields = 0;
    let curses = 0;
    for (const p of this.puffs) {
      if (p.root.visible && p.shield.visible) shields++;
      if (p.root.visible && p.aura.visible) curses++;
    }
    return { shields, curses, sliding: this.streaks.active, flying: this.drawnFlights };
  }

  /** Floor-mechanic decals placed for the bound arena. */
  getDecalCount(): number {
    return this.decals.length;
  }

  /** Effects currently on screen. */
  getFxStats(): FxStats {
    const fx = this.fxFrame;
    const settings = this.effects.getSettings();
    let deaths = 0;
    if (fx) for (let s = 0; s < MAX_SEATS; s++) if ((fx.deathProgress[s] as number) >= 0) deaths++;
    return {
      particles: fx?.count ?? 0,
      shake: fx ? Math.hypot(fx.shakeX, fx.shakeY) : 0,
      flash: fx?.flash ?? 0,
      drops: fx?.dropCount ?? 0,
      deaths,
      spawned: this.effects.totalSpawned,
      reducedMotion: settings.reducedMotion,
      quality: settings.quality,
    };
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
